// Variant fixture — disconnected topology.
// PoC slot for issue #54: two independent sub-DAGs with no shared edges.
// alpha has a linear dev→qa→uat→prod chain; beta has a standalone dev→staging chain;
// gamma has a single prod environment (orphan, no edges at all).
// Shape mirrors frontend/shared/src/lib/models.ts by manual discipline.

import type {
  MatrixState,
  ServiceDescriptor,
  EnvironmentDescriptor,
  TopologyState,
  ServiceWithDeployments
} from '../index';

export const DISCONNECTED_ENVIRONMENTS: readonly EnvironmentDescriptor[] = [
  { id: 'dev',     label: 'DEV'     },
  { id: 'staging', label: 'STAGING' },
  { id: 'qa',      label: 'QA'      },
  { id: 'uat',     label: 'UAT'     },
  { id: 'prod',    label: 'PROD'    }
];

export const DISCONNECTED_SERVICES: readonly ServiceDescriptor[] = [
  { id: 'alpha', name: 'Alpha'   },
  { id: 'beta',  name: 'Beta'    },
  { id: 'gamma', name: 'Gamma'   }
];

function ev(
  id: string, version: string,
  status: 'success' | 'failure' | 'in-progress',
  iso: string, run: number, actor: string
) {
  return { deploymentId: id, version, status, runUrl: '#', runNumber: run, actor, deployedAt: iso, parentDeployments: [] as string[] };
}

export const MOCKUP_MATRIX_DISCONNECTED: MatrixState = {
  'alpha': {
    dev:     { current: ev('al-001', 'v1.0.0', 'success',     '2026-05-14T08:00:00Z', 1, 'alice'), lastSuccessful: null, previousFailed: false },
    staging: null,
    qa:      { current: ev('al-002', 'v1.0.0', 'success',     '2026-05-14T09:00:00Z', 2, 'alice'), lastSuccessful: null, previousFailed: false },
    uat:     { current: ev('al-003', 'v0.9.9', 'success',     '2026-05-13T12:00:00Z', 3, 'bob'),   lastSuccessful: null, previousFailed: false },
    prod:    { current: ev('al-004', 'v0.9.8', 'success',     '2026-05-10T10:00:00Z', 4, 'bob'),   lastSuccessful: null, previousFailed: false }
  },
  'beta': {
    dev:     { current: ev('bt-001', 'v2.1.0', 'in-progress', '2026-05-14T14:00:00Z', 101, 'carol'), lastSuccessful: null, previousFailed: false },
    staging: { current: ev('bt-002', 'v2.0.5', 'failure',     '2026-05-14T11:00:00Z', 102, 'carol'),
               lastSuccessful: ev('bt-000', 'v2.0.4', 'success', '2026-05-12T09:00:00Z', 100, 'carol'),
               previousFailed: false },
    qa:      null,
    uat:     null,
    prod:    null
  },
  'gamma': {
    dev:     null,
    staging: null,
    qa:      null,
    uat:     null,
    prod:    { current: ev('gm-001', 'v0.1.0', 'success', '2026-05-01T08:00:00Z', 201, 'dave'), lastSuccessful: null, previousFailed: false }
  }
};

// ServiceWithDeployments — disconnected topology via correlation-key fallback.
// No parentDeployments set, so DAG builder uses correlation key.
// alpha: version varies → version is discriminating → linear chain by timestamp.
// beta: version varies → version is discriminating → dev→staging.
// gamma: only prod → single node, no edges.
export const DISCONNECTED_SERVICES_WITH_DEPLOYMENTS: readonly ServiceWithDeployments[] = [
  {
    id: 'alpha',
    name: 'Alpha',
    deployments: [
      { id: 'al-001', env: DISCONNECTED_ENVIRONMENTS[0], version: 'v1.0.0', status: 'success',     timestamp: '2026-05-14T08:00:00Z' },
      { id: 'al-002', env: DISCONNECTED_ENVIRONMENTS[2], version: 'v1.0.1', status: 'success',     timestamp: '2026-05-14T09:00:00Z' },
      { id: 'al-003', env: DISCONNECTED_ENVIRONMENTS[3], version: 'v0.9.9', status: 'success',     timestamp: '2026-05-13T12:00:00Z' },
      { id: 'al-004', env: DISCONNECTED_ENVIRONMENTS[4], version: 'v0.9.8', status: 'success',     timestamp: '2026-05-10T10:00:00Z' }
    ]
  },
  {
    id: 'beta',
    name: 'Beta',
    deployments: [
      { id: 'bt-001', env: DISCONNECTED_ENVIRONMENTS[0], version: 'v2.1.0', status: 'in-progress', timestamp: '2026-05-14T14:00:00Z' },
      { id: 'bt-002', env: DISCONNECTED_ENVIRONMENTS[1], version: 'v2.0.5', status: 'failure',     timestamp: '2026-05-14T11:00:00Z' }
    ]
  },
  {
    id: 'gamma',
    name: 'Gamma',
    deployments: [
      { id: 'gm-001', env: DISCONNECTED_ENVIRONMENTS[4], version: 'v0.1.0', status: 'success', timestamp: '2026-05-01T08:00:00Z' }
    ]
  }
];

// Disconnected topology:
//   alpha: linear dev→qa→uat→prod (sub-DAG 1; no staging)
//   beta:  isolated dev→staging (sub-DAG 2; no qa/uat/prod)
//   gamma: no edges at all (orphan single environment)
export const MOCKUP_TOPOLOGY_DISCONNECTED: TopologyState = {
  'alpha': {
    edges: [
      { from: 'dev', to: 'qa',   source: 'correlated' },
      { from: 'qa',  to: 'uat',  source: 'correlated' },
      { from: 'uat', to: 'prod', source: 'correlated' }
    ]
  },
  'beta': {
    edges: [
      { from: 'dev', to: 'staging', source: 'correlated' }
    ]
  },
  'gamma': {
    edges: []
  }
};
