// Unit tests for RateLimitClusterComponent (CR-0011 § 3d).
//
// Coverage:
//   - Renders at each severity band (green / amber / red) — pill + counter +
//     correct data-severity attribute on the cluster root.
//   - Aggregated worst-band wins (red beats amber beats green).
//   - Stale state — every snapshot stale → stale layout fires; data-stale=true.
//   - Cluster hidden entirely on cold start (no snapshots).
//   - Counter button toggles the per-source popover; popover rows expose
//     `data-testid="rate-limit-row-{adapter}-{source}"`.
//   - Collapse signal switches between full and collapsed layouts.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import {
  FetcherUsageApiService,
  FetcherUsageStore,
  type FetcherUsageSnapshot,
  type FetcherUsageStoreType
} from '@dd/shared';
import { RateLimitClusterComponent } from './rate-limit-cluster.component';

function snap(
  adapter: string,
  source: string,
  limit: number,
  used: number,
  receivedAtMs: number,
  resetAtMs?: number
): FetcherUsageSnapshot {
  const reset = new Date(resetAtMs ?? receivedAtMs + 18 * 60 * 1000).toISOString();
  return {
    adapter_id: adapter,
    source_id: source,
    upstream_limit: limit,
    upstream_remaining: limit - used,
    upstream_reset_at: reset,
    self_imposed_cap: 1500,
    upstream_used: used,
    observed_at: new Date(receivedAtMs).toISOString(),
    received_at: new Date(receivedAtMs).toISOString()
  };
}

function setup(): { fixture: ReturnType<typeof TestBed.createComponent<RateLimitClusterComponent>>; store: FetcherUsageStoreType } {
  TestBed.configureTestingModule({
    imports: [RateLimitClusterComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: FetcherUsageApiService,
        useValue: { fetch: () => of([] as readonly FetcherUsageSnapshot[]) }
      }
    ]
  });
  const store = TestBed.inject(FetcherUsageStore);
  const fixture = TestBed.createComponent(RateLimitClusterComponent);
  // Default — assume the cluster has plenty of slack and a wide viewport
  // so the full layout renders. Specific tests override `collapsed` directly.
  fixture.componentInstance.collapsed.set(false);
  return { fixture, store };
}

function root(fixture: ReturnType<typeof TestBed.createComponent<RateLimitClusterComponent>>): HTMLElement | null {
  return fixture.nativeElement.querySelector('[data-testid="rate-limit-cluster"]');
}

describe('RateLimitClusterComponent', () => {
  afterEach(() => {
    try { TestBed.inject(FetcherUsageStore).stop(); } catch (_) { /* torn down */ }
  });

  it('cold start — cluster is hidden entirely when no snapshots exist', () => {
    const { fixture } = setup();
    fixture.detectChanges();
    expect(root(fixture)).toBeNull();
  });

  it('green band — single snapshot at 28% renders the green pill + counter', () => {
    const { fixture, store } = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([snap('github-actions', 'acme/widget-a', 5000, 1400, now)]);
    fixture.detectChanges();
    const r = root(fixture)!;
    expect(r).not.toBeNull();
    expect(r.getAttribute('data-severity')).toBe('green');
    expect(r.getAttribute('data-stale')).toBe('false');
    const pill = r.querySelector('[data-testid="rate-limit-cluster-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain('28');
    expect(pill?.textContent).toContain('used');
    expect(pill?.className).toContain('text-green-700');
    const counter = r.querySelector('[data-testid="rate-limit-counter"]');
    expect(counter?.textContent).toContain('1');
    expect(counter?.textContent).toContain('sources');
  });

  it('amber band — 75% renders the amber pill', () => {
    const { fixture, store } = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([snap('a', 'b', 5000, 3750, now)]);
    fixture.detectChanges();
    const r = root(fixture)!;
    expect(r.getAttribute('data-severity')).toBe('amber');
    const pill = r.querySelector('[data-testid="rate-limit-cluster-pill"]');
    expect(pill?.textContent).toContain('75');
    expect(pill?.className).toContain('text-amber-700');
  });

  it('red band — 88% renders the red pill', () => {
    const { fixture, store } = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([snap('a', 'b', 5000, 4400, now)]);
    fixture.detectChanges();
    const r = root(fixture)!;
    expect(r.getAttribute('data-severity')).toBe('red');
    const pill = r.querySelector('[data-testid="rate-limit-cluster-pill"]');
    expect(pill?.textContent).toContain('88');
    expect(pill?.className).toContain('text-red-700');
  });

  it('aggregated worst band wins — red beats amber beats green', () => {
    const { fixture, store } = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([
      snap('github-actions', 'acme/widget-a', 5000, 1400, now), // green 28%
      snap('github-actions', 'acme/widget-b', 5000, 3750, now), // amber 75%
      snap('azure-devops',  'contoso/payments', 5000, 4400, now) // red 88%
    ]);
    fixture.detectChanges();
    const r = root(fixture)!;
    expect(r.getAttribute('data-severity')).toBe('red');
    expect(r.querySelector('[data-testid="rate-limit-cluster-pill"]')?.textContent).toContain('88');
    expect(r.querySelector('[data-testid="rate-limit-counter"]')?.textContent).toContain('3');
  });

  it('stale state — all snapshots stale fires the stale layout (D6)', () => {
    const { fixture, store } = setup();
    store.setPollIntervalMs(60_000);
    const now = 2_000_000_000_000;
    store.setNowTick(now);
    // received_at = now - 300s → > 2 × 60s → stale.
    store.setSnapshots([snap('a', 'b', 5000, 4400, now - 300_000)]);
    fixture.detectChanges();
    const r = root(fixture)!;
    expect(r.getAttribute('data-stale')).toBe('true');
    expect(r.getAttribute('data-severity')).toBe('neutral');
    expect(r.querySelector('[data-testid="rate-limit-stale"]')).not.toBeNull();
    // Fresh pill is NOT rendered when stale.
    expect(r.querySelector('[data-testid="rate-limit-cluster-pill"]')).toBeNull();
  });

  it('collapse — collapsed signal switches to dot+percent layout (D8)', () => {
    const { fixture, store } = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([snap('a', 'b', 5000, 4400, now)]);
    fixture.componentInstance.collapsed.set(true);
    fixture.detectChanges();
    const r = root(fixture)!;
    expect(r.getAttribute('data-cluster-collapsed')).toBe('true');
    // Pill testid still present (so the collapsed trigger has a known anchor),
    // but no counter and no "used" word.
    const pill = r.querySelector('[data-testid="rate-limit-cluster-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).not.toContain('used');
    expect(r.querySelector('[data-testid="rate-limit-counter"]')).toBeNull();
  });

  it('counter click toggles the per-source popover with one row per snapshot', () => {
    const { fixture, store } = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([
      snap('github-actions', 'acme/widget-a', 5000, 1400, now),
      snap('azure-devops',  'contoso/payments', 5000, 4400, now)
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="rate-limit-popover"]')).toBeNull();
    const counter = fixture.nativeElement.querySelector('[data-testid="rate-limit-counter"]') as HTMLButtonElement;
    counter.click();
    fixture.detectChanges();
    const popover = fixture.nativeElement.querySelector('[data-testid="rate-limit-popover"]');
    expect(popover).not.toBeNull();
    const rowA = popover.querySelector('[data-testid="rate-limit-row-github-actions-acme/widget-a"]');
    const rowB = popover.querySelector('[data-testid="rate-limit-row-azure-devops-contoso/payments"]');
    expect(rowA).not.toBeNull();
    expect(rowB).not.toBeNull();
    expect(rowA?.textContent).toContain('28%');
    expect(rowB?.textContent).toContain('88%');
  });

  it('pillClasses and dotClasses produce stable Tailwind triplets per band', () => {
    const { fixture } = setup();
    const c = fixture.componentInstance;
    expect(c.pillClasses('green')).toBe('bg-green-100 border-green-200 text-green-700');
    expect(c.pillClasses('amber')).toBe('bg-amber-100 border-amber-200 text-amber-700');
    expect(c.pillClasses('red')).toBe('bg-red-100 border-red-200 text-red-700');
    expect(c.dotClasses('green')).toBe('bg-green-500');
    expect(c.dotClasses('amber')).toBe('bg-amber-500');
    expect(c.dotClasses('red')).toBe('bg-red-500');
    expect(c.dotClasses('neutral')).toBe('bg-gray-400');
  });
});
