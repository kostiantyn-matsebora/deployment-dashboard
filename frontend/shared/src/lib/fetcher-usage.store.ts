// FetcherUsageStore — the NgRx Signal Store that backs the rate-limit
// cluster (CR-0011 § 3d / Phase 3 design decision D5).
//
// Shape:
//   - snapshots:  readonly FetcherUsageSnapshot[]   (wire shape, verbatim)
//   - nowTick:    number                            (epoch ms, 1 s tick)
//   - pollIntervalMs: number                        (D5/D6 — MVP = 60 000)
//
// Derived signals:
//   - freshSnapshots()    — snapshots that are NOT stale at `nowTick`
//   - worstBand()         — worst-band aggregation across fresh snapshots
//                            (CR-0011 § 3d "max ratio wins"); null when no
//                            fresh data exists
//   - worstSnapshot()     — the fresh snapshot driving worstBand()
//   - worstPercent()      — rounded percent for the pill text
//   - allStale()          — every snapshot stale → stale-affordance fires
//   - mostRecentReceivedAt() — drives the stale tooltip ("last seen Xm ago")
//   - sourceCount()       — total snapshot count (drives "· N sources")
//   - isStale()           — convenience alias for allStale()
//
// Polling lifecycle:
//   - `start()` opens a `GET /api/fetcher/usage` poll on `pollIntervalMs`
//     cadence + a 1 s `nowTick` interval that re-evaluates the stale
//     derivation without an HTTP call.
//   - `stop()` clears both intervals.
//   - The store is `providedIn: 'root'`; the dashboard app starts it from
//     a `provideEnvironmentInitializer` so polling begins before first paint.
//
// Stale semantics (D6): `now − received_at > 2 × pollIntervalMs`.
// Stale snapshots are EXCLUDED from worstBand() aggregation because a stale
// row's band is no longer operationally meaningful (matches the Alpine
// mockup behaviour in `rateLimitFreshSnapshots`).

import { DestroyRef, computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState
} from '@ngrx/signals';
import type { FetcherUsageBand, FetcherUsageSnapshot } from './models';
import {
  FETCHER_USAGE_POLL_INTERVAL_MS,
  fetcherUsageBand,
  fetcherUsageRatio,
  fetcherUsageWorstSnapshot,
  isFetcherUsageStale
} from './models';
import { FetcherUsageApiService } from './fetcher-usage-api.service';

export interface FetcherUsageState {
  snapshots: readonly FetcherUsageSnapshot[];
  /** Epoch ms — bumped every 1 s so stale derivations re-evaluate cheaply. */
  nowTick: number;
  /** D6 — `now − received_at > 2 × pollIntervalMs` ⇒ stale. */
  pollIntervalMs: number;
}

const INITIAL: FetcherUsageState = {
  snapshots: [],
  nowTick: Date.now(),
  pollIntervalMs: FETCHER_USAGE_POLL_INTERVAL_MS
};

export const FetcherUsageStore = signalStore(
  { providedIn: 'root' },
  withState<FetcherUsageState>(INITIAL),
  withComputed(store => ({
    /**
     * Snapshots that are not stale at the current `nowTick`. Recomputes
     * whenever `nowTick` advances (1 s cadence) or when a poll lands.
     */
    freshSnapshots: computed(() => {
      const now = store.nowTick();
      const interval = store.pollIntervalMs();
      return store.snapshots().filter(s => !isFetcherUsageStale(s, now, interval));
    }),
    sourceCount: computed(() => store.snapshots().length)
  })),
  withComputed(store => ({
    /**
     * The fresh snapshot that drives the worst band. `null` when no fresh
     * snapshots exist (either cold start or fully stale).
     */
    worstSnapshot: computed<FetcherUsageSnapshot | null>(() =>
      fetcherUsageWorstSnapshot(store.freshSnapshots())
    ),
    /** Every snapshot stale → cluster renders in the stale visual. */
    allStale: computed(() =>
      store.snapshots().length > 0 && store.freshSnapshots().length === 0
    ),
    /** Latest `received_at` across ALL snapshots (fresh OR stale). */
    mostRecentReceivedAt: computed<string | null>(() => {
      const snaps = store.snapshots();
      if (snaps.length === 0) return null;
      let mostRecent = snaps[0].received_at;
      for (let i = 1; i < snaps.length; i++) {
        if (snaps[i].received_at > mostRecent) mostRecent = snaps[i].received_at;
      }
      return mostRecent;
    })
  })),
  withComputed(store => ({
    worstBand: computed<FetcherUsageBand | null>(() => {
      const w = store.worstSnapshot();
      return w ? fetcherUsageBand(w) : null;
    }),
    worstPercent: computed<number | null>(() => {
      const w = store.worstSnapshot();
      return w ? Math.round(fetcherUsageRatio(w) * 100) : null;
    }),
    /** Convenience — true when no fresh data is available. */
    isStale: computed(() => store.allStale())
  })),
  withMethods(store => {
    const api = inject(FetcherUsageApiService);
    let pollHandle: ReturnType<typeof setInterval> | null = null;
    let tickHandle: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;

    /** Replace the snapshot set wholesale; the GET returns the full snapshot. */
    function setSnapshots(snapshots: readonly FetcherUsageSnapshot[]): void {
      patchState(store, { snapshots });
    }

    /** Pull one poll cycle immediately; coalesces if a poll is in flight. */
    function refresh(): void {
      if (inFlight) return;
      inFlight = true;
      api.fetch().subscribe({
        next: snaps => {
          inFlight = false;
          patchState(store, { snapshots: snaps, nowTick: Date.now() });
        },
        error: () => {
          inFlight = false;
        }
      });
    }

    /**
     * Begin polling + tick-driven stale re-evaluation. Idempotent — safe to
     * call twice (second call is a no-op).
     */
    function start(): void {
      if (pollHandle !== null || tickHandle !== null) return;
      refresh();
      const interval = store.pollIntervalMs();
      pollHandle = setInterval(refresh, interval);
      tickHandle = setInterval(() => {
        patchState(store, { nowTick: Date.now() });
      }, 1_000);
    }

    function stop(): void {
      if (pollHandle !== null) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
      if (tickHandle !== null) {
        clearInterval(tickHandle);
        tickHandle = null;
      }
    }

    /** Test seam — overrides the poll cadence (and the 2× stale gate). */
    function setPollIntervalMs(ms: number): void {
      patchState(store, { pollIntervalMs: ms });
    }

    /** Test seam — pins `nowTick` to a deterministic value. */
    function setNowTick(epochMs: number): void {
      patchState(store, { nowTick: epochMs });
    }

    return {
      setSnapshots,
      refresh,
      start,
      stop,
      setPollIntervalMs,
      setNowTick
    };
  }),
  withHooks({
    onInit(store) {
      // Best-effort cleanup on the root injector's destroy (test teardown).
      const destroyRef = inject(DestroyRef, { optional: true });
      destroyRef?.onDestroy(() => store.stop());
    }
  })
);

export type FetcherUsageStoreType = InstanceType<typeof FetcherUsageStore>;
