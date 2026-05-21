// Unit tests for FetcherUsageStore.
//
// Coverage:
//   - worstBand() correctly aggregates across the input set
//     (CR-0011 § 3d "max ratio wins" — green / amber / red precedence).
//   - isStale() / allStale() honour `received_at + pollInterval` (D6:
//     `now - received_at > 2 × poll_interval`).
//   - sourceCount() reflects total snapshots (drives " · N sources").
//   - mostRecentReceivedAt() returns the latest `received_at` for the
//     stale tooltip.
//   - setSnapshots() / setNowTick() / setPollIntervalMs() test seams.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import {
  FETCHER_USAGE_POLL_INTERVAL_MS,
  FetcherUsageApiService,
  FetcherUsageStore,
  type FetcherUsageSnapshot,
  type FetcherUsageStoreType
} from '../public-api';

function snap(
  adapter: string,
  source: string,
  limit: number,
  used: number,
  receivedAtMs: number,
  resetAtMs?: number,
  cap?: number
): FetcherUsageSnapshot {
  const reset = new Date(resetAtMs ?? receivedAtMs + 18 * 60 * 1000).toISOString();
  return {
    adapter_id: adapter,
    source_id: source,
    upstream_limit: limit,
    upstream_remaining: limit - used,
    upstream_reset_at: reset,
    self_imposed_cap: cap ?? Math.floor(limit / 3),
    upstream_used: used,
    observed_at: new Date(receivedAtMs).toISOString(),
    received_at: new Date(receivedAtMs).toISOString()
  };
}

function setup(): FetcherUsageStoreType {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: FetcherUsageApiService,
        useValue: { fetch: () => of([] as readonly FetcherUsageSnapshot[]) }
      }
    ]
  });
  return TestBed.inject(FetcherUsageStore);
}

describe('FetcherUsageStore', () => {
  afterEach(() => {
    // Defensive — any spec that called start() must not leak a timer.
    try {
      TestBed.inject(FetcherUsageStore).stop();
    } catch (_) { /* injector torn down */ }
  });

  it('starts empty with the MVP poll interval', () => {
    const store = setup();
    expect(store.snapshots().length).toBe(0);
    expect(store.sourceCount()).toBe(0);
    expect(store.worstBand()).toBeNull();
    expect(store.worstSnapshot()).toBeNull();
    expect(store.allStale()).toBe(false);
    expect(store.pollIntervalMs()).toBe(FETCHER_USAGE_POLL_INTERVAL_MS);
  });

  it('worstBand() returns green when every snapshot ratio < 0.60', () => {
    const store = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([
      snap('github-actions', 'acme/widget-a', 5000, 1400, now), // 28%
      snap('github-actions', 'acme/widget-b', 5000, 2900, now)  // 58%
    ]);
    expect(store.worstBand()).toBe('green');
    expect(store.worstPercent()).toBe(58);
  });

  it('worstBand() returns amber when at least one ratio is in [0.60, 0.85]', () => {
    const store = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([
      snap('github-actions', 'acme/widget-a', 5000, 1400, now), // 28% green
      snap('github-actions', 'acme/widget-b', 5000, 3750, now)  // 75% amber
    ]);
    expect(store.worstBand()).toBe('amber');
    expect(store.worstPercent()).toBe(75);
  });

  it('worstBand() returns red when ANY snapshot ratio > 0.85 (max wins)', () => {
    const store = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([
      snap('github-actions', 'acme/widget-a', 5000, 1400, now), // 28% green
      snap('github-actions', 'acme/widget-b', 5000, 3750, now), // 75% amber
      snap('azure-devops',  'contoso/payments', 5000, 4400, now) // 88% red
    ]);
    expect(store.worstBand()).toBe('red');
    expect(store.worstPercent()).toBe(88);
    expect(store.worstSnapshot()?.source_id).toBe('contoso/payments');
  });

  it('worstBand() boundary — exactly 0.60 ratio is amber (per CR-0011 § 3d)', () => {
    const store = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([snap('a', 'b', 5000, 3000, now)]); // exactly 60%
    expect(store.worstBand()).toBe('amber');
  });

  it('worstBand() boundary — exactly 0.85 ratio is amber (red is strictly >)', () => {
    const store = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([snap('a', 'b', 5000, 4250, now)]); // exactly 85%
    expect(store.worstBand()).toBe('amber');
  });

  it('isStale() fires when now - received_at > 2 × pollInterval (D6)', () => {
    const store = setup();
    store.setPollIntervalMs(60_000);
    const now = 2_000_000_000_000;
    store.setNowTick(now);
    // Snapshot received_at = now - 121s → 121 > 120 → stale.
    store.setSnapshots([snap('a', 'b', 5000, 1000, now - 121_000)]);
    expect(store.allStale()).toBe(true);
    expect(store.isStale()).toBe(true);
    // worstBand() drops stale rows → null when ALL are stale.
    expect(store.worstBand()).toBeNull();
  });

  it('isStale() boundary — exactly 2 × pollInterval is NOT stale (strict >)', () => {
    const store = setup();
    store.setPollIntervalMs(60_000);
    const now = 2_000_000_000_000;
    store.setNowTick(now);
    store.setSnapshots([snap('a', 'b', 5000, 1000, now - 120_000)]); // exactly 2×
    expect(store.allStale()).toBe(false);
    expect(store.worstBand()).toBe('green');
  });

  it('allStale() requires snapshots > 0 (cold start ≠ stale)', () => {
    const store = setup();
    store.setSnapshots([]);
    expect(store.allStale()).toBe(false);
    expect(store.sourceCount()).toBe(0);
  });

  it('worstBand() excludes stale snapshots from aggregation', () => {
    const store = setup();
    store.setPollIntervalMs(60_000);
    const now = 2_000_000_000_000;
    store.setNowTick(now);
    store.setSnapshots([
      snap('a', 'fresh-green', 5000, 1400, now),                // fresh 28% green
      snap('a', 'stale-red',   5000, 4400, now - 1_000_000)     // stale 88% red — excluded
    ]);
    // Stale red row is excluded; only the fresh green row remains.
    expect(store.worstBand()).toBe('green');
    expect(store.allStale()).toBe(false);
    expect(store.sourceCount()).toBe(2); // counter still shows total
  });

  it('mostRecentReceivedAt() returns the latest received_at across all snapshots', () => {
    const store = setup();
    const now = 2_000_000_000_000;
    store.setSnapshots([
      snap('a', 'older', 5000, 1000, now - 30_000),
      snap('a', 'newer', 5000, 1000, now - 5_000),
      snap('a', 'middle', 5000, 1000, now - 15_000)
    ]);
    expect(store.mostRecentReceivedAt()).toBe(new Date(now - 5_000).toISOString());
  });

  it('refresh() calls the API and replaces snapshots wholesale', () => {
    const fixture: FetcherUsageSnapshot[] = [snap('x', 'y', 100, 50, Date.now())];
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: FetcherUsageApiService,
          useValue: { fetch: () => of(fixture) }
        }
      ]
    });
    const store = TestBed.inject(FetcherUsageStore);
    store.refresh();
    expect(store.snapshots().length).toBe(1);
    expect(store.worstPercent()).toBe(50);
    expect(store.worstBand()).toBe('green');
  });

  it('upstream_limit of 0 collapses ratio to 0 (defensive — no NaN)', () => {
    const store = setup();
    const now = Date.now();
    store.setNowTick(now);
    store.setSnapshots([snap('a', 'b', 0, 0, now)]);
    expect(store.worstBand()).toBe('green'); // 0% < 60%
    expect(store.worstPercent()).toBe(0);
  });
});
