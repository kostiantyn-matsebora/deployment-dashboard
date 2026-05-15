import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  DeploymentMatrixStore,
  FIXTURE_ENVIRONMENTS,
  FIXTURE_MATRIX,
  FIXTURE_SERVICES,
  FIXTURE_TOPOLOGY,
  enumeratePaths,
  type DeploymentMatrixStoreType,
  type SlotState
} from '../public-api';

function setup(): DeploymentMatrixStoreType {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()]
  });
  const store = TestBed.inject(DeploymentMatrixStore);
  store.setServices(FIXTURE_SERVICES);
  store.setEnvironments(FIXTURE_ENVIRONMENTS);
  store.setMatrix(FIXTURE_MATRIX);
  return store;
}

describe('DeploymentMatrixStore', () => {
  it('exposes services and environments after initial load', () => {
    const store = setup();
    expect(store.services().length).toBe(4);
    expect(store.environments().length).toBe(5);
  });

  it('filteredServices is the full list when no filters are set', () => {
    const store = setup();
    expect(store.filteredServices().length).toBe(4);
  });

  it('filteredServices applies a case-insensitive substring search', () => {
    const store = setup();
    store.setSearch('Service C');
    expect(store.filteredServices().map(s => s.id)).toEqual(['service-c']);
    store.setSearch('service c');
    expect(store.filteredServices().map(s => s.id)).toEqual(['service-c']);
    store.setSearch('zzz');
    expect(store.filteredServices().length).toBe(0);
  });

  it('filteredServices applies the failures-only toggle', () => {
    const store = setup();
    store.setShowFailuresOnly(true);
    // service-b (qa = failure) and service-d (qa = failure) —
    // service-a and service-c have no current failures.
    const ids = store.filteredServices().map(s => s.id).sort();
    expect(ids).toEqual(['service-b', 'service-d']);
  });

  it('failureCount counts only slots whose current status is failure', () => {
    const store = setup();
    // service-b.qa + service-d.qa = 2
    expect(store.failureCount()).toBe(2);
  });

  it('neverProdCount counts services with no PROD slot', () => {
    const store = setup();
    // service-d has prod === null → 1
    expect(store.neverProdCount()).toBe(1);
  });

  it('slotUpdated patches a single slot and leaves siblings untouched', () => {
    const store = setup();
    const before = store.slot('service-a', 'qa');
    const newSlot: SlotState = {
      current: {
        deploymentId: 'test-9999',
        version: 'v9.9.9',
        status: 'success',
        runUrl: '#',
        runNumber: 9999,
        actor: 'claude',
        deployedAt: '2026-05-14T15:00:00Z',
        parentDeployments: []
      },
      lastSuccessful: null,
      previousFailed: false
    };
    store.slotUpdated({ service: 'service-a', environment: 'dev', state: newSlot });
    expect(store.slot('service-a', 'dev')?.current.version).toBe('v9.9.9');
    // Sibling untouched.
    expect(store.slot('service-a', 'qa')).toBe(before);
    // Other services untouched.
    expect(store.slot('service-d', 'qa')?.current.status).toBe('failure');
  });

  it('slotUpdated appends a brand-new service to the services list (FR-08 + FR-09)', () => {
    const store = setup();
    const before = store.services().length;
    const newSlot: SlotState = {
      current: {
        deploymentId: 'qa-bot-1',
        version: 'v0.0.1',
        status: 'in-progress',
        runUrl: '#',
        runNumber: 1,
        actor: 'qa-bot',
        deployedAt: '2026-05-14T15:00:00Z',
        parentDeployments: []
      },
      lastSuccessful: null,
      previousFailed: false
    };
    store.slotUpdated({ service: 'qa-bot-realtime', environment: 'dev', state: newSlot });
    const services = store.services();
    expect(services.length).toBe(before + 1);
    const added = services.find(s => s.id === 'qa-bot-realtime');
    expect(added).toBeTruthy();
    expect(added?.name).toBe('qa-bot-realtime');
    // Matrix patch still happened.
    expect(store.slot('qa-bot-realtime', 'dev')?.current.version).toBe('v0.0.1');
  });

  it('slotUpdated appends a brand-new environment to the environments list (FR-08 + FR-09)', () => {
    const store = setup();
    const before = store.environments().length;
    const newSlot: SlotState = {
      current: {
        deploymentId: 'qa-bot-2',
        version: 'v0.0.1',
        status: 'success',
        runUrl: '#',
        runNumber: 1,
        actor: 'qa-bot',
        deployedAt: '2026-05-14T15:00:00Z',
        parentDeployments: []
      },
      lastSuccessful: null,
      previousFailed: false
    };
    store.slotUpdated({ service: 'service-a', environment: 'e2e-discovery-env', state: newSlot });
    const envs = store.environments();
    expect(envs.length).toBe(before + 1);
    const added = envs.find(e => e.id === 'e2e-discovery-env');
    expect(added).toBeTruthy();
    expect(added?.label).toBe('E2E-DISCOVERY-ENV');
    // New env appended at the tail until next API refresh re-orders.
    expect(envs[envs.length - 1].id).toBe('e2e-discovery-env');
  });

  it('slotUpdated for an existing (service, env) pair does not duplicate either list', () => {
    const store = setup();
    const beforeServices = store.services().length;
    const beforeEnvs = store.environments().length;
    const newSlot: SlotState = {
      current: {
        deploymentId: 'test-9999',
        version: 'v9.9.9',
        status: 'success',
        runUrl: '#',
        runNumber: 9999,
        actor: 'claude',
        deployedAt: '2026-05-14T15:00:00Z',
        parentDeployments: []
      },
      lastSuccessful: null,
      previousFailed: false
    };
    store.slotUpdated({ service: 'service-a', environment: 'dev', state: newSlot });
    expect(store.services().length).toBe(beforeServices);
    expect(store.environments().length).toBe(beforeEnvs);
    expect(store.services().filter(s => s.id === 'service-a').length).toBe(1);
    expect(store.environments().filter(e => e.id === 'dev').length).toBe(1);
  });

  it('drawer state opens and closes', () => {
    const store = setup();
    expect(store.drawerOpen()).toBeFalse();
    store.openDrawer(FIXTURE_SERVICES[0], FIXTURE_ENVIRONMENTS[0]);
    expect(store.drawerOpen()).toBeTrue();
    expect(store.drawerService()?.id).toBe('service-a');
    store.closeDrawer();
    expect(store.drawerOpen()).toBeFalse();
    expect(store.drawerService()).toBeNull();
  });

  it('highlightedVersion is set / cleared as a single signal', () => {
    const store = setup();
    expect(store.highlightedVersion()).toBeNull();
    store.setHighlightedVersion('v2.3.1');
    expect(store.highlightedVersion()).toBe('v2.3.1');
    store.setHighlightedVersion(null);
    expect(store.highlightedVersion()).toBeNull();
  });

  // ---- FR-12: view + attribute picker -------------------------------------

  describe('FR-12 — view and attribute picker', () => {
    it('defaults to the Detailed view on first visit', () => {
      const store = setup();
      expect(store.view()).toBe('detailed');
    });

    it('exposes the documented per-view defaults', () => {
      const store = setup();
      expect(store.attrs().detailed).toEqual(['status', 'version', 'run', 'ago', 'actor']);
      expect(store.attrs().compact).toEqual(['status', 'version', 'run', 'ago']);
      expect(store.attrs().glance).toEqual(['version']);
      expect(store.attrs().focus).toEqual(['status', 'version', 'run', 'ago']);
    });

    it('setView changes the active view and updates derived signals', () => {
      const store = setup();
      store.setView('glance');
      expect(store.view()).toBe('glance');
      expect(store.cap()).toBe(1);
      expect(store.activeAttrs()).toEqual(['version']);
      expect(store.attrsSelectedCount()).toBe(1);
    });

    it('setView is a no-op when the view is already active', () => {
      const store = setup();
      const before = store.attrs();
      store.setView('detailed');
      expect(store.attrs()).toBe(before);
    });

    it('toggleAttr removes an existing key and returns true', () => {
      const store = setup();
      expect(store.toggleAttr('detailed', 'actor')).toBeTrue();
      expect(store.attrs().detailed).toEqual(['status', 'version', 'run', 'ago']);
    });

    it('toggleAttr adds a key when under the cap and returns true', () => {
      const store = setup();
      // compact defaults are 4/5 — adding actor brings it to 5/5.
      expect(store.toggleAttr('compact', 'actor')).toBeTrue();
      expect(store.attrs().compact).toContain('actor');
      expect(store.attrs().compact.length).toBe(5);
    });

    it('toggleAttr is a no-op (returns false) when adding past the cap', () => {
      const store = setup();
      // Compact cap = 5 (SAD §7). Fill to 5/5 first, then try a 6th.
      store.toggleAttr('compact', 'actor');
      expect(store.attrs().compact.length).toBe(5);
      expect(store.toggleAttr('compact', 'ref')).toBeFalse();
      expect(store.attrs().compact).not.toContain('ref');
      expect(store.attrs().compact.length).toBe(5);
    });

    it('Detailed cap of 7 — every canonical attribute fits', () => {
      const store = setup();
      // Defaults are the canonical five — adding ref + sha must succeed.
      expect(store.toggleAttr('detailed', 'ref')).toBeTrue();
      expect(store.toggleAttr('detailed', 'sha')).toBeTrue();
      expect(store.attrs().detailed.length).toBe(7);
      // An 8th add would be impossible (only seven keys exist), but adding
      // an already-present key removes it — defence in depth.
      expect(store.toggleAttr('detailed', 'actor')).toBeTrue();
      expect(store.attrs().detailed.length).toBe(6);
    });

    it('Glance cap of 1 — adding a second attribute is rejected (including ref / sha)', () => {
      const store = setup();
      expect(store.toggleAttr('glance', 'status')).toBeFalse();
      expect(store.toggleAttr('glance', 'ref')).toBeFalse();
      expect(store.toggleAttr('glance', 'sha')).toBeFalse();
      expect(store.attrs().glance).toEqual(['version']);
    });

    it('Glance — clearing version then picking ref / sha is a legal swap', () => {
      const store = setup();
      store.toggleAttr('glance', 'version');
      expect(store.attrs().glance).toEqual([]);
      expect(store.toggleAttr('glance', 'sha')).toBeTrue();
      expect(store.attrs().glance).toEqual(['sha']);
    });

    it('toggleAttr can fully empty a view (legitimate user choice)', () => {
      const store = setup();
      // Empty the detailed view one key at a time.
      ['status', 'version', 'run', 'ago', 'actor'].forEach(k =>
        store.toggleAttr('detailed', k as never)
      );
      expect(store.attrs().detailed).toEqual([]);
      store.setView('detailed');
      expect(store.activeAttrs()).toEqual([]);
      expect(store.attrsSelectedCount()).toBe(0);
    });

    it('per-view selections are independent', () => {
      const store = setup();
      store.toggleAttr('detailed', 'actor');
      expect(store.attrs().detailed).not.toContain('actor');
      // Switching does not affect the other views.
      expect(store.attrs().compact).toEqual(['status', 'version', 'run', 'ago']);
      expect(store.attrs().focus).toEqual(['status', 'version', 'run', 'ago']);
    });

    it('setAttrsForView truncates to the view cap', () => {
      const store = setup();
      store.setAttrsForView('glance', ['version', 'status', 'run']);
      expect(store.attrs().glance.length).toBe(1);
    });

    it('Focus-view expand toggle + isExpanded signal', () => {
      const store = setup();
      const isA = store.isExpanded('service-a');
      expect(isA()).toBeFalse();
      store.toggleExpand('service-a');
      expect(isA()).toBeTrue();
      store.toggleExpand('service-a');
      expect(isA()).toBeFalse();
    });

    it('togglePin expands the row and isPinned tracks pin state', () => {
      const store = setup();
      const pinned = store.isPinned('service-b');
      const expanded = store.isExpanded('service-b');
      expect(pinned()).toBeFalse();
      store.togglePin('service-b');
      expect(pinned()).toBeTrue();
      expect(expanded()).toBeTrue();
      store.togglePin('service-b');
      expect(pinned()).toBeFalse();
      // Unpinning leaves the row expanded — mirrors the mockup.
      expect(expanded()).toBeTrue();
    });

    it('collapseAll collapses unpinned rows and preserves pinned ones', () => {
      const store = setup();
      store.toggleExpand('service-a');
      store.togglePin('service-b'); // also expands
      store.collapseAll();
      expect(store.isExpanded('service-a')()).toBeFalse();
      // Pinned service stays expanded.
      expect(store.isExpanded('service-b')()).toBeTrue();
    });
  });

  // ---- FR-13: layout + topology -------------------------------------------

  describe('FR-13 — layout and topology', () => {
    it('defaults to the Matrix layout on first visit', () => {
      const store = setup();
      expect(store.layout()).toBe('matrix');
    });

    it('setLayout switches the layout and is a no-op when already active', () => {
      const store = setup();
      store.setLayout('swim-lane');
      expect(store.layout()).toBe('swim-lane');
      const ref = store.layout();
      store.setLayout('swim-lane');
      expect(store.layout()).toBe(ref);
    });

    it('topologyFor returns an empty edge list when missing', () => {
      const store = setup();
      expect(store.topologyFor('service-z').edges.length).toBe(0);
    });

    it('setTopology populates topologyFor lookups', () => {
      const store = setup();
      store.setTopology(FIXTURE_TOPOLOGY);
      expect(store.topologyFor('service-a').edges.length).toBeGreaterThan(0);
    });

    it('slotUpdated does NOT mutate the topology snapshot (SAD §"SSE topology semantics")', () => {
      const store = setup();
      store.setTopology(FIXTURE_TOPOLOGY);
      const before = store.topologyFor('service-a').edges;
      const newSlot: SlotState = {
        current: {
          deploymentId: 'gh-9999',
          version: 'v9.9.9',
          status: 'success',
          runUrl: '#',
          runNumber: 9999,
          actor: 'claude',
          deployedAt: '2026-05-14T15:00:00Z',
          parentDeployments: []
        },
        lastSuccessful: null,
        previousFailed: false
      };
      // The SSE payload no longer carries `topology` — the app component
      // re-fetches /api/deployments after each event. The store must
      // leave the topology map untouched here.
      store.slotUpdated({
        service: 'service-a',
        environment: 'qa',
        state: newSlot
      });
      expect(store.topologyFor('service-a').edges).toBe(before);
    });

    it('topology config setter accepts and clears the config', () => {
      const store = setup();
      expect(store.topologyConfig()).toBeNull();
      store.setTopologyConfig({
        correlationAttribute: 'ref',
        perServiceOverrides: { 'service-a': 'sha' }
      });
      expect(store.topologyConfig()?.correlationAttribute).toBe('ref');
      store.setTopologyConfig(null);
      expect(store.topologyConfig()).toBeNull();
    });

    it('activeCorrelationAttribute resolves user pick > config default > null', () => {
      const store = setup();
      expect(store.activeCorrelationAttribute()).toBeNull();
      store.setTopologyConfig({
        correlationAttribute: 'version',
        perServiceOverrides: {}
      });
      expect(store.activeCorrelationAttribute()).toBe('version');
      store.setCorrelationAttribute('sha');
      expect(store.activeCorrelationAttribute()).toBe('sha');
      store.setCorrelationAttribute(undefined);
      expect(store.activeCorrelationAttribute()).toBe('version');
    });

    it('correlationAttribute setter accepts a valid value and clears it', () => {
      const store = setup();
      expect(store.correlationAttribute()).toBeUndefined();
      store.setCorrelationAttribute('ref');
      expect(store.correlationAttribute()).toBe('ref');
      store.setCorrelationAttribute(undefined);
      expect(store.correlationAttribute()).toBeUndefined();
    });

    it('focusOnLastEvent defaults to true and toggles via setter', () => {
      const store = setup();
      expect(store.focusOnLastEvent()).toBeTrue();
      store.setFocusOnLastEvent(false);
      expect(store.focusOnLastEvent()).toBeFalse();
      store.setFocusOnLastEvent(true);
      expect(store.focusOnLastEvent()).toBeTrue();
    });

    it('Workflow-rows expand toggle + isWorkflowExpanded signal', () => {
      const store = setup();
      const isA = store.isWorkflowExpanded('service-a');
      expect(isA()).toBeFalse();
      store.toggleWorkflowExpand('service-a');
      expect(isA()).toBeTrue();
      store.toggleWorkflowExpand('service-a');
      expect(isA()).toBeFalse();
    });

    it('toggleAllWorkflowExpand seeds or clears the set wholesale', () => {
      const store = setup();
      store.toggleAllWorkflowExpand(['service-a', 'service-c'], false);
      expect(store.isWorkflowExpanded('service-a')()).toBeTrue();
      expect(store.isWorkflowExpanded('service-c')()).toBeTrue();
      store.toggleAllWorkflowExpand(['service-a', 'service-c'], true);
      expect(store.isWorkflowExpanded('service-a')()).toBeFalse();
    });

    it('enumeratePaths returns a stable sorted list of root-to-leaf paths', () => {
      const paths = enumeratePaths({
        edges: [
          { from: 'dev', to: 'qa', source: 'correlated' },
          { from: 'dev', to: 'qahotfix', source: 'correlated' },
          { from: 'qa', to: 'uat', source: 'correlated' },
          { from: 'uat', to: 'prod', source: 'correlated' }
        ]
      });
      // 1) dev > qa > uat > prod   2) dev > qahotfix
      expect(paths.length).toBe(2);
      expect(paths[0]).toEqual(['dev', 'qa', 'uat', 'prod']);
      expect(paths[1]).toEqual(['dev', 'qahotfix']);
    });

    it('enumeratePaths returns [] for an empty edge set', () => {
      expect(enumeratePaths({ edges: [] })).toEqual([]);
    });
  });
});
