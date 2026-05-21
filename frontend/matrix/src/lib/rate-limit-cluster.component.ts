// Rate-limit cluster — right-aligned stats-strip cluster wiring the
// FetcherUsageStore to the visual layout locked in Phase 2b
// (`docs/ui/rate-limit-cluster.md`) and the canonical mockup
// (`docs/ui/deployment-dashboard.html` lines 1422–1521).
//
// Structurally + visually identical to the mockup section per the
// mockup-before-implementation rule (CR-0011 § 3e). Three variants:
//
//   - Full layout      — pill (severity colour + percent) + " · N sources"
//                        counter button. Default at viewport ≥ 1280 px AND
//                        ≥ 360 px slack.
//   - Collapsed layout — coloured dot + percent only (no label, no counter).
//                        Fires when slack < 360 px OR viewport < 1280 px
//                        (D8 / mockup `usageClusterCollapsed`).
//   - Stale layout     — dimmed neutral pill, "—" instead of %, italic
//                        "stale" label. Fires when EVERY snapshot is stale
//                        (D6).
//
// All three variants expose:
//   - `data-testid="rate-limit-cluster"`         — root
//   - `data-severity="green|amber|red|neutral"`  — drives I12.c oracle
//   - `data-stale="true|false"`                  — drives I12.f oracle
//   - `data-cluster-collapsed="true|false"`      — drives oracle / e2e
//
// Per-source rows in the click-popover get
//   `data-testid="rate-limit-row-{adapter_id}-{source_id}"` per QA's Phase
// 2e request. The popover is right-anchored and closes on outside click +
// Escape (mirrors the theme popover dismissal pattern).
//
// Cluster is hidden entirely on cold start (no snapshots).

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FetcherUsageStore,
  fetcherUsageBand,
  fetcherUsageRatio,
  isFetcherUsageStale,
  type FetcherUsageBand,
  type FetcherUsageSnapshot
} from '@dd/shared';

/**
 * Collapse thresholds — locked in Phase 3 (D8) + design note
 * `docs/ui/rate-limit-cluster.md § Collapse threshold`. Cluster collapses
 * to a single dot + percent when EITHER condition is true.
 */
const COLLAPSE_VIEWPORT_PX = 1280;
const COLLAPSE_SLACK_PX = 360;
const COLLAPSE_GUTTER_PX = 24;

@Component({
  selector: 'dd-rate-limit-cluster',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Outer wrapper — flex-column so the highlight-hint can stack ABOVE
         the pill row when a version is hovered (D7 — chosen reconciliation
         strategy from rate-limit-cluster.md § highlight-hint reconciliation).
         The hint itself lives in the parent stats-bar; the cluster wrapper
         only carries the pill row.

         Hidden entirely when no snapshots have arrived (cold start —
         rate-limit-cluster.md § Empty). A missing fetcher is not a failure;
         it is the absence of an optional component. -->
    @if (store.sourceCount() > 0) {
      <div class="flex items-center gap-2 relative"
           data-testid="rate-limit-cluster"
           [attr.data-severity]="severityAttr()"
           [attr.data-stale]="store.allStale().toString()"
           [attr.data-cluster-collapsed]="collapsed().toString()"
           #clusterRoot>

        <!-- Stale layout — wins over full/collapsed when EVERY snapshot is stale. -->
        @if (store.allStale()) {
          <div class="flex items-center gap-1.5 px-2 py-0.5 border rounded-full text-xs font-medium opacity-50 bg-gray-100 border-gray-200 text-gray-500"
               [attr.title]="staleTooltip()"
               data-testid="rate-limit-stale">
            <span class="w-2 h-2 rounded-full bg-gray-400"></span>
            <span>— <span class="italic">stale</span></span>
          </div>
        } @else {
          <!-- Full layout (default) — pill + counter. -->
          @if (!collapsed() && store.worstSnapshot()) {
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1.5 px-2 py-0.5 border rounded-full text-xs font-medium"
                   [class]="pillClasses(store.worstBand())"
                   [attr.title]="freshTooltip()"
                   data-testid="rate-limit-cluster-pill">
                <span class="w-2 h-2 rounded-full" [class]="dotClasses(store.worstBand())"></span>
                <span><span>{{ store.worstPercent() }}</span>% used</span>
              </div>
              <button type="button"
                      class="text-xs text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
                      (click)="togglePopover($event)"
                      [attr.aria-expanded]="popoverOpen().toString()"
                      aria-haspopup="dialog"
                      data-testid="rate-limit-counter">
                · <span>{{ store.sourceCount() }}</span> sources
              </button>
            </div>
          }

          <!-- Collapsed layout — dot + percent only; pill text is the trigger. -->
          @if (collapsed() && store.worstSnapshot()) {
            <button type="button"
                    class="flex items-center gap-1.5 text-xs font-medium hover:underline underline-offset-2"
                    [class.text-red-700]="store.worstBand() === 'red'"
                    [class.text-amber-700]="store.worstBand() === 'amber'"
                    [class.text-green-700]="store.worstBand() === 'green'"
                    (click)="togglePopover($event)"
                    [attr.title]="freshTooltip()"
                    data-testid="rate-limit-cluster-pill">
              <span class="w-2 h-2 rounded-full" [class]="dotClasses(store.worstBand())"></span>
              <span><span>{{ store.worstPercent() }}</span>%</span>
            </button>
          }
        }

        <!-- Per-source popover — right-anchored; closes on outside-click
             (host listener) + Escape. Mirrors the mockup popover (mockup
             lines 1482-1518). -->
        @if (popoverOpen()) {
          <div class="absolute top-full right-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-20"
               role="dialog"
               aria-label="Rate-limit usage by source"
               data-testid="rate-limit-popover"
               (keydown.escape)="closePopover()">
            <div class="px-3 pb-1.5 text-[11px] uppercase tracking-wide text-gray-500">
              Per-source usage
            </div>
            @for (snap of store.snapshots(); track snap.adapter_id + '|' + snap.source_id) {
              <div class="px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-gray-50"
                   [attr.data-testid]="'rate-limit-row-' + snap.adapter_id + '-' + snap.source_id">
                <span class="w-2 h-2 rounded-full shrink-0"
                      [class]="dotClasses(rowBand(snap))"></span>
                <div class="flex-1 min-w-0">
                  <div class="font-mono text-[11px] truncate">
                    {{ snap.adapter_id }} / {{ snap.source_id }}
                  </div>
                  <div class="text-[10px] text-gray-500">
                    cap {{ snap.self_imposed_cap.toLocaleString('en-US') }}
                    · resets {{ formatReset(snap.upstream_reset_at) }}
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-xs font-semibold">
                    @if (!isRowStale(snap)) {
                      <span>{{ rowPercent(snap) }}%</span>
                    } @else {
                      <span class="italic text-gray-400">stale</span>
                    }
                  </div>
                  <div class="text-[10px] text-gray-500">
                    {{ snap.upstream_used.toLocaleString('en-US') }}
                    / {{ snap.upstream_limit.toLocaleString('en-US') }}
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    }
  `
})
export class RateLimitClusterComponent implements OnInit, OnDestroy {
  readonly store = inject(FetcherUsageStore);
  private readonly hostEl: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly clusterRoot = viewChild<ElementRef<HTMLElement>>('clusterRoot');

  /** Popover open/close — internal UI state only. */
  readonly popoverOpen = signal(false);

  /**
   * Collapse signal — written by a ResizeObserver on the stats-bar AND by a
   * window resize listener. Read by the template to switch between full /
   * collapsed layouts (D8). Default `true` until the first measurement runs
   * (defensive — better to start collapsed and grow than to render full and
   * collide with the left cluster on the first paint).
   */
  readonly collapsed = signal(false);

  /** Severity attribute exposed for the QA mockup-visual oracle (I12.c). */
  readonly severityAttr = computed<'green' | 'amber' | 'red' | 'neutral'>(() => {
    if (this.store.allStale()) return 'neutral';
    return this.store.worstBand() ?? 'neutral';
  });

  private ro: ResizeObserver | null = null;
  private removeResize: (() => void) | null = null;

  ngOnInit(): void {
    // Recompute collapse whenever the stats-bar resizes (failure-count
    // digit width, etc.) OR the viewport changes. Matches the same
    // ResizeObserver pattern the mockup uses (mockup line 3672).
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.recomputeCollapse());
      const strip = document.querySelector('[data-testid="stats-bar"]');
      if (strip) this.ro.observe(strip);
    }
    const onResize = () => this.recomputeCollapse();
    window.addEventListener('resize', onResize);
    this.removeResize = () => window.removeEventListener('resize', onResize);
    // Initial measurement on next frame (DOM mounted).
    queueMicrotask(() => requestAnimationFrame(() => this.recomputeCollapse()));
  }

  ngOnDestroy(): void {
    if (this.ro) {
      this.ro.disconnect();
      this.ro = null;
    }
    if (this.removeResize) {
      this.removeResize();
      this.removeResize = null;
    }
  }

  togglePopover(ev: MouseEvent): void {
    ev.stopPropagation();
    this.popoverOpen.update(v => !v);
  }

  closePopover(): void {
    this.popoverOpen.set(false);
  }

  /** Outside-click handler — closes the popover when click is not within the cluster. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (!this.popoverOpen()) return;
    const root = this.clusterRoot()?.nativeElement;
    if (!root) return;
    if (root.contains(ev.target as Node)) return;
    this.popoverOpen.set(false);
  }

  /** Escape closes the popover regardless of focus location. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.popoverOpen()) this.popoverOpen.set(false);
  }

  // ---------- Render helpers ----------

  /**
   * Pill background + border + text classes per
   * `docs/ui/rate-limit-cluster.md § Severity-band colour tokens`.
   * Composes with the Theme axis (CR-0006) via the existing
   * `[data-theme=dark]` overlay block — no new colour tokens.
   */
  pillClasses(band: FetcherUsageBand | null): string {
    if (band === 'red')   return 'bg-red-100 border-red-200 text-red-700';
    if (band === 'amber') return 'bg-amber-100 border-amber-200 text-amber-700';
    if (band === 'green') return 'bg-green-100 border-green-200 text-green-700';
    return 'bg-gray-100 border-gray-200 text-gray-500';
  }

  dotClasses(band: FetcherUsageBand | 'neutral' | null): string {
    if (band === 'red')   return 'bg-red-500';
    if (band === 'amber') return 'bg-amber-500';
    if (band === 'green') return 'bg-green-500';
    return 'bg-gray-400';
  }

  /** Tooltip on the FRESH pill — `1,400 / 5,000 · resets 14:00 UTC` (D8). */
  freshTooltip(): string {
    const w = this.store.worstSnapshot();
    if (!w) return '';
    const used = w.upstream_used.toLocaleString('en-US');
    const limit = w.upstream_limit.toLocaleString('en-US');
    return `${used} / ${limit} · resets ${this.formatReset(w.upstream_reset_at)}`;
  }

  /** Tooltip on the STALE pill — `last seen 4 minutes ago` (D6). */
  staleTooltip(): string {
    const iso = this.store.mostRecentReceivedAt();
    if (!iso) return '';
    return `last seen ${this.formatRelative(iso, this.store.nowTick())}`;
  }

  formatReset(iso: string): string {
    const d = new Date(iso);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm} UTC`;
  }

  private formatRelative(iso: string, nowMs: number): string {
    const deltaSec = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
    if (deltaSec < 60) return `${deltaSec}s ago`;
    const mins = Math.round(deltaSec / 60);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    return `${hrs} h ago`;
  }

  rowBand(snap: FetcherUsageSnapshot): FetcherUsageBand | 'neutral' {
    if (this.isRowStale(snap)) return 'neutral';
    return fetcherUsageBand(snap);
  }

  rowPercent(snap: FetcherUsageSnapshot): number {
    return Math.round(fetcherUsageRatio(snap) * 100);
  }

  isRowStale(snap: FetcherUsageSnapshot): boolean {
    return isFetcherUsageStale(snap, this.store.nowTick(), this.store.pollIntervalMs());
  }

  // ---------- Collapse measurement ----------

  /**
   * Recomputes the `collapsed` signal — collapse fires on EITHER:
   *   1. `stripSlackPx < 360` — `stripWidth − leftClusterRect.right − 24 gutter`
   *   2. `viewport < 1280 px`
   *
   * Mirrors the mockup `recomputeCollapse` body (mockup lines 3656-3667).
   * No-op when the strip elements aren't in the DOM yet (defensive — e.g.
   * during test teardown the host is detached).
   */
  private recomputeCollapse(): void {
    if (typeof window === 'undefined') return;
    if (window.innerWidth < COLLAPSE_VIEWPORT_PX) {
      this.collapsed.set(true);
      return;
    }
    const strip = document.querySelector<HTMLElement>('[data-testid="stats-bar"]');
    const leftCluster = document.querySelector<HTMLElement>(
      '[data-testid="stats-strip-left-cluster"]'
    );
    if (!strip || !leftCluster) {
      this.collapsed.set(false);
      return;
    }
    const stripRect = strip.getBoundingClientRect();
    const leftRect = leftCluster.getBoundingClientRect();
    const slack = stripRect.right - leftRect.right - COLLAPSE_GUTTER_PX;
    this.collapsed.set(slack < COLLAPSE_SLACK_PX);
  }
}
