// DeploymentMatrixStore — the NgRx Signal Store that backs the dashboard.
//
// Shape and behaviour follow the architecture doc §7 and the mockup's
// Alpine state (search, showFailuresOnly, highlightedVersion, drawer*):
//   - matrix:           Record<service, Record<env, SlotState | null>>
//   - topology:         Record<service, Topology>   (FR-13)
//   - topologyConfig:   { correlationAttribute, perServiceOverrides }
//                        — server-side defaults; read-only label source for
//                        the picker. The user's own pick is `correlationAttribute`.
//   - correlationAttribute: CorrelationAttribute | undefined
//                        — the per-tab user pick from localStorage. Sent as
//                        the `correlationAttribute` query parameter on
//                        matrix GETs (SAD §10 Decision #7).
//   - services:         ServiceDescriptor[]
//   - environments:     EnvironmentDescriptor[] (promotion-flow order)
//   - search:           string
//   - showFailuresOnly: boolean
//   - focusOnLastEvent: boolean — mockup header toggle; when on, an
//                        incoming SSE slot-update scrolls the affected row
//                        into view and amber-pulses it.
//   - highlightedVersion: string | null
//   - view + attrs + layout (FR-12 / FR-13)
//   - drawer{Open,Service,Env,History}
//
// Derived signals:
//   - filteredServices  — search + failures-only applied
//   - failureCount      — total slots currently in 'failure'
//   - neverProdCount    — services with no matrix entry for any env labelled
//                         PROD (case-insensitive; FR-09 — no hardcoded env list)
//   - lastDeployRelative — relative time of the most recent slot
//   - activeCorrelationAttribute — explicit user pick > server default; the
//                        value the picker labels as "active" for display
//   - edgesFor(service) — signal of edges for one service (FR-13)
//
// SSE dispatch:
//   - slotUpdated(payload) patches ONE slot only (SAD §7 "SSE topology
//     semantics" — the SSE wire carries slot state only; topology is
//     refreshed via a follow-up GET in the app component).

import { computed } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState
} from '@ngrx/signals';
import type {
  EnvironmentDescriptor,
  HistoryEntry,
  MatrixState,
  ServiceDescriptor,
  SlotState,
  SlotUpdatePayload,
  Topology,
  TopologyConfig,
  TopologyState
} from './models';
import { relativeTime } from './relative-time';
import {
  CAPS,
  DEFAULT_ATTRS,
  DEFAULT_FOCUS_ON_LAST_EVENT,
  DEFAULT_LAYOUT,
  DEFAULT_VIEW,
  VIEWS,
  type AttrKey,
  type CorrelationAttribute,
  type LayoutId,
  type ViewId
} from './view-config';

export interface DeploymentMatrixState {
  matrix: MatrixState;
  /** Per-service env DAG (FR-13). Empty object when no service has loaded yet. */
  topology: TopologyState;
  /** Active topology-correlation config (FR-13). `null` until first fetch. */
  topologyConfig: TopologyConfig | null;
  /**
   * Per-tab correlation-attribute override loaded from localStorage
   * (`dashboard.correlationAttribute`). `undefined` = follow the server
   * default (no `correlationAttribute` query parameter sent on matrix GETs).
   * SAD §10 Decision #7.
   */
  correlationAttribute: CorrelationAttribute | undefined;
  services: readonly ServiceDescriptor[];
  environments: readonly EnvironmentDescriptor[];
  search: string;
  showFailuresOnly: boolean;
  /**
   * Mockup header "Focus on last event" toggle. When `true` (default),
   * incoming SSE slot-update events scroll the affected service row into
   * view and apply the 900 ms `swap-pulse` keyframe; when `false`, only
   * already-visible rows pulse and no scroll happens. Persisted in
   * localStorage under `dashboard.focusOnLastEvent`.
   */
  focusOnLastEvent: boolean;
  highlightedVersion: string | null;
  drawerOpen: boolean;
  drawerService: ServiceDescriptor | null;
  drawerEnv: EnvironmentDescriptor | null;
  drawerHistory: readonly HistoryEntry[];
  drawerHistoryLoading: boolean;
  // FR-12 — layout view + per-view attribute selection.
  view: ViewId;
  attrs: Record<ViewId, readonly AttrKey[]>;
  // FR-13 — outer layout (matrix / swim-lane / workflow-rows).
  layout: LayoutId;
  // Focus-view only — services whose row is expanded to full Detailed
  // fidelity. Pinned services are also stored here; the persistence layer
  // is intentionally out of scope (per the SAD, only view + attrs + layout
  // are persisted — pinning is per-session).
  expandedServices: ReadonlySet<string>;
  pinnedServices: ReadonlySet<string>;
  // FR-13 — Workflow-rows expand-all-paths set, per-session only.
  expandedWorkflowServices: ReadonlySet<string>;
}

function defaultAttrs(): Record<ViewId, readonly AttrKey[]> {
  // Clone the readonly arrays so the store can patch one view without
  // mutating the shared DEFAULT_ATTRS source.
  return VIEWS.reduce((acc, v) => {
    acc[v.id] = [...DEFAULT_ATTRS[v.id]];
    return acc;
  }, {} as Record<ViewId, readonly AttrKey[]>);
}

const INITIAL: DeploymentMatrixState = {
  matrix: {},
  topology: {},
  topologyConfig: null,
  correlationAttribute: undefined,
  services: [],
  environments: [],
  search: '',
  showFailuresOnly: false,
  focusOnLastEvent: DEFAULT_FOCUS_ON_LAST_EVENT,
  highlightedVersion: null,
  drawerOpen: false,
  drawerService: null,
  drawerEnv: null,
  drawerHistory: [],
  drawerHistoryLoading: false,
  view: DEFAULT_VIEW,
  attrs: defaultAttrs(),
  layout: DEFAULT_LAYOUT,
  expandedServices: new Set<string>(),
  pinnedServices: new Set<string>(),
  expandedWorkflowServices: new Set<string>()
};

function isProdEnv(env: EnvironmentDescriptor): boolean {
  return env.id.toLowerCase() === 'prod' || env.label.toUpperCase() === 'PROD';
}

export const DeploymentMatrixStore = signalStore(
  { providedIn: 'root' },
  withState<DeploymentMatrixState>(INITIAL),
  withComputed(store => ({
    filteredServices: computed(() => {
      const matrix = store.matrix();
      const search = store.search().toLowerCase();
      const failuresOnly = store.showFailuresOnly();
      return store.services().filter(s => {
        if (search && !s.name.toLowerCase().includes(search)) return false;
        if (failuresOnly) {
          const envs = matrix[s.id] ?? {};
          const hasFailure = Object.values(envs).some(
            slot => slot?.current.status === 'failure'
          );
          if (!hasFailure) return false;
        }
        return true;
      });
    }),
    failureCount: computed(() => {
      const matrix = store.matrix();
      let n = 0;
      for (const service of Object.keys(matrix)) {
        for (const env of Object.keys(matrix[service])) {
          if (matrix[service][env]?.current.status === 'failure') n++;
        }
      }
      return n;
    }),
    neverProdCount: computed(() => {
      const matrix = store.matrix();
      const prodEnvs = store.environments().filter(isProdEnv);
      if (prodEnvs.length === 0) return 0;
      return store.services().reduce((n, svc) => {
        const envs = matrix[svc.id] ?? {};
        const reachedProd = prodEnvs.some(e => envs[e.id] != null);
        return n + (reachedProd ? 0 : 1);
      }, 0);
    }),
    lastDeployRelative: computed(() => {
      const matrix = store.matrix();
      let latest = 0;
      for (const service of Object.keys(matrix)) {
        for (const env of Object.keys(matrix[service])) {
          const t = Date.parse(matrix[service][env]?.current.deployedAt ?? '');
          if (!Number.isNaN(t) && t > latest) latest = t;
        }
      }
      return latest === 0 ? '—' : relativeTime(new Date(latest).toISOString());
    }),
    /**
     * Effective correlation attribute for display purposes — the user's
     * explicit pick wins, otherwise the server-side default. `null` until
     * the topology-config GET has resolved. SAD §10 Decision #7 precedence
     * order for the SPA's read perspective (server PerServiceOverrides
     * still beats this on the server side at request time).
     */
    activeCorrelationAttribute: computed<string | null>(() => {
      const userPick = store.correlationAttribute();
      if (userPick) return userPick;
      return store.topologyConfig()?.correlationAttribute ?? null;
    }),
    /** Currently-selected attribute keys for the active view (FR-12). */
    activeAttrs: computed(() => store.attrs()[store.view()]),
    /** Cap (max attributes allowed) for the active view. */
    cap: computed(() => CAPS[store.view()]),
    /** Number of attributes currently selected in the active view. */
    attrsSelectedCount: computed(() => store.attrs()[store.view()].length),
    /** Total number of paths across all services (Workflow-rows footer). */
    totalWorkflowPaths: computed(() => {
      const services = store.services();
      const topology = store.topology();
      let n = 0;
      for (const s of services) {
        const t = topology[s.id];
        if (!t) { n += 1; continue; }
        n += enumeratePaths(t).length || 1;
      }
      return n;
    })
  })),
  withMethods(store => ({
    /** Replace the entire matrix (initial load, post-reconnect refresh). */
    setMatrix(matrix: MatrixState): void {
      patchState(store, { matrix });
    },
    /** Replace the entire topology map (initial load, post-reconnect refresh). */
    setTopology(topology: TopologyState): void {
      patchState(store, { topology });
    },
    /** Update / clear the topology-correlation config (FR-13). */
    setTopologyConfig(topologyConfig: TopologyConfig | null): void {
      patchState(store, { topologyConfig });
    },
    setServices(services: readonly ServiceDescriptor[]): void {
      patchState(store, { services });
    },
    setEnvironments(environments: readonly EnvironmentDescriptor[]): void {
      patchState(store, { environments });
    },
    /**
     * Patch exactly one slot in-place (SSE update).
     *
     * SAD §7 "SSE topology semantics" — the SSE wire carries slot state
     * only; topology is refreshed via a follow-up `GET /api/deployments`
     * on every event (driven from the app component with burst coalescing).
     * This method therefore does NOT touch the topology map.
     *
     * FR-08 + FR-09 — when an SSE event references a (service, environment)
     * pair that wasn't in the initial discovery responses, append it to the
     * respective list so the matrix renders a new row/column without a page
     * reload. Promotion-flow ordering is API-driven; append-at-end here is
     * fine until the next full refresh sorts it.
     */
    slotUpdated(payload: SlotUpdatePayload): void {
      const matrix = store.matrix();
      const services = store.services();
      const environments = store.environments();
      const svcMap = { ...(matrix[payload.service] ?? {}) };
      svcMap[payload.environment] = payload.state;
      const nextServices = services.some(s => s.id === payload.service)
        ? services
        : [...services, { id: payload.service, name: payload.service }];
      const nextEnvironments = environments.some(e => e.id === payload.environment)
        ? environments
        : [...environments, { id: payload.environment, label: payload.environment.toUpperCase() }];
      patchState(store, {
        matrix: { ...matrix, [payload.service]: svcMap },
        services: nextServices,
        environments: nextEnvironments
      });
    },
    /** Remove a slot (rare — used for tests / future tombstones). */
    slotCleared(service: string, environment: string): void {
      const matrix = store.matrix();
      if (!matrix[service]) return;
      const svcMap = { ...matrix[service] };
      svcMap[environment] = null;
      patchState(store, {
        matrix: { ...matrix, [service]: svcMap }
      });
    },
    setSearch(search: string): void {
      patchState(store, { search });
    },
    setShowFailuresOnly(showFailuresOnly: boolean): void {
      patchState(store, { showFailuresOnly });
    },
    /**
     * Set / clear the user's correlation-attribute pick. `undefined`
     * removes the override; the next matrix GET omits the query parameter
     * and falls back to the server default (SAD §10 Decision #7).
     */
    setCorrelationAttribute(value: CorrelationAttribute | undefined): void {
      patchState(store, { correlationAttribute: value });
    },
    /**
     * Mockup header toggle. Toggles whether incoming SSE slot-update
     * events scroll the affected service row into view (SAD §"Visual
     * layout" localStorage table → `dashboard.focusOnLastEvent`).
     */
    setFocusOnLastEvent(focusOnLastEvent: boolean): void {
      patchState(store, { focusOnLastEvent });
    },
    setHighlightedVersion(highlightedVersion: string | null): void {
      patchState(store, { highlightedVersion });
    },
    openDrawer(service: ServiceDescriptor, env: EnvironmentDescriptor): void {
      patchState(store, {
        drawerOpen: true,
        drawerService: service,
        drawerEnv: env,
        drawerHistory: [],
        drawerHistoryLoading: true
      });
    },
    setDrawerHistory(drawerHistory: readonly HistoryEntry[]): void {
      patchState(store, { drawerHistory, drawerHistoryLoading: false });
    },
    closeDrawer(): void {
      patchState(store, {
        drawerOpen: false,
        drawerService: null,
        drawerEnv: null,
        drawerHistory: [],
        drawerHistoryLoading: false
      });
    },
    /** Test helper — read the current slot for an assertion. */
    slot(service: string, environment: string): SlotState | null {
      return store.matrix()[service]?.[environment] ?? null;
    },
    /** Read topology for one service. Returns `{ edges: [] }` when missing. */
    topologyFor(serviceId: string): Topology {
      return store.topology()[serviceId] ?? { edges: [] };
    },

    // ----- FR-12: view + attribute picker actions ---------------------------

    /** Switch the active matrix view. No-op when already active. */
    setView(id: ViewId): void {
      if (store.view() === id) return;
      patchState(store, { view: id });
    },
    /**
     * Toggle a picker attribute for the given view.
     *
     * Cap enforcement — checking a NEW key beyond the view's cap is a no-op
     * and returns `false`. Unchecking an existing key always succeeds.
     * Returns `true` when the state actually changed.
     */
    toggleAttr(viewId: ViewId, key: AttrKey): boolean {
      const all = store.attrs();
      const current = all[viewId];
      const idx = current.indexOf(key);
      const cap = CAPS[viewId];
      let next: readonly AttrKey[];
      if (idx >= 0) {
        next = [...current.slice(0, idx), ...current.slice(idx + 1)];
      } else {
        if (current.length >= cap) return false;
        next = [...current, key];
      }
      patchState(store, { attrs: { ...all, [viewId]: next } });
      return true;
    },
    /**
     * Replace the attribute selection for a single view wholesale. Used by
     * the persistence layer on bootstrap. Filters to known keys and clamps
     * to the cap defensively — the caller (view-prefs.service) already
     * does this, but defence-in-depth keeps the store invariants.
     */
    setAttrsForView(viewId: ViewId, attrs: readonly AttrKey[]): void {
      patchState(store, {
        attrs: { ...store.attrs(), [viewId]: attrs.slice(0, CAPS[viewId]) }
      });
    },

    // ----- FR-13: layout actions -------------------------------------------

    /** Switch the active layout. No-op when already active. */
    setLayout(id: LayoutId): void {
      if (store.layout() === id) return;
      patchState(store, { layout: id });
    },

    // ----- Focus-view: expand + pin actions --------------------------------

    /** Toggle the expanded state of a service row (Focus view only). */
    toggleExpand(serviceId: string): void {
      const set = new Set(store.expandedServices());
      const pinned = new Set(store.pinnedServices());
      if (set.has(serviceId)) {
        set.delete(serviceId);
        // Collapsing also unpins (mirrors mockup behaviour).
        pinned.delete(serviceId);
      } else {
        set.add(serviceId);
      }
      patchState(store, { expandedServices: set, pinnedServices: pinned });
    },
    /** Toggle pin — pinning a row also expands it. Unpinning leaves it. */
    togglePin(serviceId: string): void {
      const pinned = new Set(store.pinnedServices());
      const expanded = new Set(store.expandedServices());
      if (pinned.has(serviceId)) {
        pinned.delete(serviceId);
      } else {
        pinned.add(serviceId);
        expanded.add(serviceId);
      }
      patchState(store, { pinnedServices: pinned, expandedServices: expanded });
    },
    /** Collapse all expanded rows that are NOT pinned. */
    collapseAll(): void {
      const pinned = store.pinnedServices();
      const next = new Set<string>();
      for (const id of store.expandedServices()) {
        if (pinned.has(id)) next.add(id);
      }
      patchState(store, { expandedServices: next });
    },
    /**
     * Per-service expansion signal. Returns a `Signal<boolean>` so callers
     * can bind directly in templates: `[class.row-expanded]="isExpanded('a')()"`.
     */
    isExpanded(serviceId: string) {
      return computed(() => store.expandedServices().has(serviceId));
    },
    /** Per-service pin signal — same shape as `isExpanded`. */
    isPinned(serviceId: string) {
      return computed(() => store.pinnedServices().has(serviceId));
    },

    // ----- FR-13: Workflow-rows path expansion -----------------------------

    /** Toggle workflow-rows path expansion for one service. */
    toggleWorkflowExpand(serviceId: string): void {
      const set = new Set(store.expandedWorkflowServices());
      if (set.has(serviceId)) set.delete(serviceId);
      else set.add(serviceId);
      patchState(store, { expandedWorkflowServices: set });
    },
    /** Bulk-toggle every multi-path service. */
    toggleAllWorkflowExpand(everyMultiPathServiceId: readonly string[], allOn: boolean): void {
      patchState(store, {
        expandedWorkflowServices: allOn ? new Set<string>() : new Set(everyMultiPathServiceId)
      });
    },
    isWorkflowExpanded(serviceId: string) {
      return computed(() => store.expandedWorkflowServices().has(serviceId));
    }
  }))
);

export type DeploymentMatrixStoreType = InstanceType<typeof DeploymentMatrixStore>;

/**
 * Root-to-leaf path enumeration through one service's DAG, stable ordering.
 * Exported here so derived signals (totalWorkflowPaths) can use it; the
 * Workflow-rows renderer imports the same helper to keep one implementation.
 *
 * Returns a single empty-chain path equivalent when there are no edges; the
 * caller is responsible for handling the empty-topology fallback (single
 * root chain ordered by `current.deployed_at`).
 */
export function enumeratePaths(topology: Topology): readonly (readonly string[])[] {
  const edges = topology.edges;
  if (edges.length === 0) return [];
  const children: Record<string, string[]> = {};
  const incoming: Record<string, number> = {};
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
    (children[e.from] ??= []).push(e.to);
    incoming[e.to] = (incoming[e.to] ?? 0) + 1;
    incoming[e.from] = incoming[e.from] ?? 0;
  }
  for (const k of Object.keys(children)) children[k].sort();
  const roots = [...nodes].filter(n => (incoming[n] ?? 0) === 0).sort();
  const paths: string[][] = [];
  function dfs(node: string, acc: string[]): void {
    const trail = [...acc, node];
    const next = children[node] ?? [];
    if (next.length === 0) {
      paths.push(trail);
      return;
    }
    for (const c of next) dfs(c, trail);
  }
  for (const r of roots) dfs(r, []);
  paths.sort((a, b) => a.join('>').localeCompare(b.join('>')));
  return paths;
}
