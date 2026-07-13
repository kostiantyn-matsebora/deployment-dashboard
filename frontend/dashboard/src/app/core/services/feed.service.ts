import { effect, inject, Injectable, Injector, signal } from '@angular/core';

import { DeploymentEvent } from '../models/deployment.model';
import { DeploymentApiService } from './deployment-api.service';

/** localStorage keys — mirrors AppStateService's `dd:*` prefix convention. */
const K = {
  grouped: 'dd:feedGrouped',
  dock:    'dd:feedDock',
} as const;

/** Newest-first buffer size kept for the dock's "last 8" rollup (headroom for accurate ×N counts). */
const DOCK_BUFFER = 60;

/** Fields searched client-side to decide whether a live event belongs on an
 * active Feed-page search (mirrors the server-side `q` contract exactly —
 * docs/api/openapi.yaml listDeployments `q` param). */
function matchesQuery(ev: DeploymentEvent, q: string): boolean {
  if (!q) return true;
  const hay = [
    ev.service, ev.namespace, ev.environment, ev.version, ev.status,
    ev.actor, ev.ref, ev.sha, ev.deployment_id, ev.run_number,
  ]
    .filter((v): v is string => v != null)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

/**
 * The dock's persisted preference (`dockOpenPref`) is distinct from its
 * on-screen visibility: it is always suppressed while the Feed view itself
 * is active (the page IS the full log) without touching the stored
 * preference, so leaving Feed restores exactly what the user had (#397).
 * Shared by FeedDockComponent and App (padding-bottom clearance) so both
 * agree on the same suppression rule.
 */
export function isDockVisible(dockOpenPref: boolean, activeView: string): boolean {
  return dockOpenPref && activeView !== 'feed';
}

/**
 * FeedService — shared state for the deployment feed (#397): the bottom dock
 * (visible on every view) and the Feed route both read from this single
 * root-provided service.
 *
 * Design (recorded per BRIEF — kept OUT of AppStateService.matrixData
 * ingestion, which is a distinct concern):
 *   - `grouped` / `dockOpenPref` are the two pieces of state genuinely shared
 *     between the dock and the page (the LOCKED "one shared grouped/flat
 *     state" requirement) — both toggle the same signals.
 *   - `dockEvents` is an independent rolling buffer seeded once and grown by
 *     live SSE prepends; it is never paged and never affected by the Feed
 *     page's search box (the mockup dock has no search input either).
 *   - `pageEvents` backs the Feed page's cursor-paginated + searchable list;
 *     `search()` resets it and re-fetches from the server (search spans full
 *     history, not just what happens to be loaded), `loadMore()` appends the
 *     next cursor page. Live events are prepended into `pageEvents` too, but
 *     only while a Feed page is mounted (`activatePage()`/`deactivatePage()`)
 *     and only when they match the active search text — mirrors the
 *     mockup's `feedIngest()`.
 *
 * HttpClient is resolved LAZILY via `Injector`, not injected directly in the
 * constructor (mirrors PresetsService's DeploymentApiService access) — so
 * merely constructing/injecting FeedService (e.g. from PresetsService.
 * captureSettings()) never requires an HttpClient provider and never opens a
 * connection. All I/O is deferred to `init()`, called once by App.ngOnInit,
 * exactly like AppStateService's matrix load + SSE subscribe.
 */
@Injectable({ providedIn: 'root' })
export class FeedService {
  private readonly injector = inject(Injector);
  private initialized = false;
  private pageActive = false;
  private pageLoaded = false;
  private pageCursor: string | null = null;
  /**
   * Bumped by every `search()` call — a `fetchPage()` response only applies
   * if its captured id still matches. Without this, a stale in-flight search
   * request (e.g. a narrow query with few/no matches) that resolves AFTER a
   * later `search()` has already reset the sequence clobbers the newer,
   * correct state — including `pageHasMore`, permanently killing infinite
   * scroll (issue #417). `loadMore()` reuses the current id — it continues
   * the SAME sequence, so it must not be invalidated by its own request.
   */
  private pageRequestId = 0;

  // ── Shared toggle state ────────────────────────────────────
  readonly grouped = signal<boolean>(this.ls(K.grouped, (v) => (v === 'true' ? true : v === 'false' ? false : null), true));
  readonly dockOpenPref = signal<boolean>(this.ls(K.dock, (v) => (v === 'open' ? true : v === 'closed' ? false : null), false));

  // ── Dock — rolling live buffer ─────────────────────────────
  readonly dockEvents = signal<DeploymentEvent[]>([]);
  /** id of the most recently ingested dock row — components flash it once, then clear. */
  readonly dockFlashId = signal<string | null>(null);

  // ── Feed page — cursor-paginated + searchable ──────────────
  readonly pageEvents = signal<DeploymentEvent[]>([]);
  readonly pageQuery = signal<string>('');
  readonly pageLoadingInitial = signal<boolean>(false);
  readonly pageLoadingMore = signal<boolean>(false);
  readonly pageHasMore = signal<boolean>(false);
  readonly pageFlashId = signal<string | null>(null);

  constructor() {
    effect(() => this.save(K.grouped, String(this.grouped())));
    effect(() => this.save(K.dock, this.dockOpenPref() ? 'open' : 'closed'));
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /** Idempotent. Seeds the dock buffer and subscribes to the shared live stream. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    const api = this.injector.get(DeploymentApiService);
    api.listDeployments({ limit: DOCK_BUFFER }).subscribe({
      next:  (page) => this.dockEvents.set(page.items),
      error: () => { /* dock stays empty until the next live event */ },
    });
    // Explicit error handler — without one, RxJS re-throws a source error
    // asynchronously as an unhandled exception (this shares App's own
    // EventSource-backed stream, so a subscriber-less error path here would
    // surface even though App.connectSSE() already handles it for itself).
    api.streamEvents().subscribe({
      next:  (ev) => this.ingest(ev),
      error: () => { /* live stream unavailable — dock stays at its last-seeded state */ },
    });
  }

  /** Feed page mounted — live events start feeding pageEvents again. */
  activatePage(): void {
    this.pageActive = true;
  }

  /** Feed page unmounted — stop growing pageEvents off-screen. */
  deactivatePage(): void {
    this.pageActive = false;
  }

  /** Load the first page once per app session; subsequent mounts reuse the loaded list. */
  ensureLoaded(): void {
    if (this.pageLoaded) return;
    this.search('');
  }

  // ── Toggles ─────────────────────────────────────────────────

  setGrouped(v: boolean): void {
    this.grouped.set(v);
  }

  setDockOpen(v: boolean): void {
    this.dockOpenPref.set(v);
  }

  // ── Feed page — search + pagination ────────────────────────

  /** Reset pagination and fetch page 1 for a (possibly empty) query. */
  search(q: string): void {
    this.pageLoaded = true;
    this.pageQuery.set(q);
    this.pageCursor = null;
    this.pageRequestId++;
    this.pageEvents.set([]);
    this.pageHasMore.set(true);
    this.fetchPage(true);
  }

  loadMore(): void {
    if (!this.pageHasMore() || this.pageLoadingMore() || this.pageLoadingInitial()) return;
    this.fetchPage(false);
  }

  private fetchPage(initial: boolean): void {
    const api = this.injector.get(DeploymentApiService);
    const requestId = this.pageRequestId;
    if (initial) this.pageLoadingInitial.set(true);
    else this.pageLoadingMore.set(true);

    const q = this.pageQuery().trim();
    api
      .listDeployments({
        limit: 50,
        ...(this.pageCursor ? { cursor: this.pageCursor } : {}),
        ...(q ? { q } : {}),
      })
      .subscribe({
        next: (page) => {
          // The loading flag THIS request owns is cleared unconditionally,
          // even when the response turns out to be stale — otherwise a
          // loadMore() superseded by a newer search() would leave
          // pageLoadingMore stuck true forever (nothing else ever resets
          // it), permanently blocking loadMore()'s own guard (issue #417).
          if (initial) this.pageLoadingInitial.set(false);
          else this.pageLoadingMore.set(false);
          // A newer search() has already reset the sequence — this response
          // belongs to a superseded query; applying it would clobber the
          // correct state (issue #417).
          if (requestId !== this.pageRequestId) return;
          this.pageEvents.update((events) => (initial ? page.items : [...events, ...page.items]));
          this.pageCursor = page.next_cursor ?? null;
          this.pageHasMore.set(this.pageCursor !== null);
        },
        error: () => {
          if (initial) this.pageLoadingInitial.set(false);
          else this.pageLoadingMore.set(false);
          if (requestId !== this.pageRequestId) return;
          this.pageHasMore.set(false);
        },
      });
  }

  // ── Live ingest ─────────────────────────────────────────────

  private ingest(ev: DeploymentEvent): void {
    this.dockEvents.update((events) => [ev, ...events].slice(0, DOCK_BUFFER));
    this.dockFlashId.set(ev.id);

    if (this.pageActive && matchesQuery(ev, this.pageQuery().trim().toLowerCase())) {
      this.pageEvents.update((events) => [ev, ...events]);
      this.pageFlashId.set(ev.id);
    }
  }

  // ── localStorage helpers (mirrors AppStateService.ls/save) ──

  private ls<T>(key: string, parse: (raw: string) => T | null, def: T): T {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = parse(raw);
        if (parsed !== null) return parsed;
      }
    } catch { /* storage unavailable or parse error */ }
    return def;
  }

  private save(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch { /* quota exceeded or private mode */ }
  }
}
