// Variant fixture — branching DAG topology.
// PoC slot for issue #54: a service whose environment graph has a true fork
// (dev branches to both qa and qahotfix) and a merge (both converge to uat).
// Shape mirrors frontend/shared/src/lib/models.ts by manual discipline.

import type {
  MatrixState,
  ServiceDescriptor,
  EnvironmentDescriptor,
  TopologyState,
  ServiceWithDeployments,
  Deployment
} from '../index';

export const BRANCHING_ENVIRONMENTS: readonly EnvironmentDescriptor[] = [
  { id: 'dev',      label: 'DEV'      },
  { id: 'qa',       label: 'QA'       },
  { id: 'qahotfix', label: 'QAHOTFIX' },
  { id: 'uat',      label: 'UAT'      },
  { id: 'prod',     label: 'PROD'     }
];

export const BRANCHING_SERVICES: readonly ServiceDescriptor[] = [
  { id: 'gateway',  name: 'Gateway'   },
  { id: 'payments', name: 'Payments'  },
  { id: 'auth',     name: 'Auth'      }
];

function ev(
  id: string, version: string,
  status: 'success' | 'failure' | 'in-progress',
  iso: string, run: number, actor: string
) {
  return { deploymentId: id, version, status, runUrl: '#', runNumber: run, actor, deployedAt: iso, parentDeployments: [] as string[] };
}

export const MOCKUP_MATRIX_BRANCHING: MatrixState = {
  'gateway': {
    dev:      { current: ev('gw-101', 'v1.2.0', 'success',     '2026-05-14T10:00:00Z', 101, 'alice'), lastSuccessful: null, previousFailed: false },
    qa:       { current: ev('gw-102', 'v1.2.0', 'success',     '2026-05-14T11:00:00Z', 102, 'alice'), lastSuccessful: null, previousFailed: false },
    qahotfix: { current: ev('gw-103', 'v1.1.5', 'success',     '2026-05-13T08:00:00Z', 103, 'bob'),   lastSuccessful: null, previousFailed: false },
    uat:      { current: ev('gw-104', 'v1.2.0', 'in-progress', '2026-05-14T12:00:00Z', 104, 'alice'), lastSuccessful: null, previousFailed: false },
    prod:     null
  },
  'payments': {
    dev:      { current: ev('pay-201', 'v3.0.1', 'in-progress', '2026-05-14T13:00:00Z', 201, 'carol'), lastSuccessful: null, previousFailed: true },
    qa:       { current: ev('pay-202', 'v3.0.0', 'failure',     '2026-05-14T09:00:00Z', 202, 'carol'),
                lastSuccessful: ev('pay-200', 'v2.9.9', 'success', '2026-05-12T14:00:00Z', 200, 'carol'),
                previousFailed: false },
    qahotfix: { current: ev('pay-210', 'v2.9.9', 'success', '2026-05-11T10:00:00Z', 210, 'dave'), lastSuccessful: null, previousFailed: false },
    uat:      { current: ev('pay-199', 'v2.9.8', 'success', '2026-05-10T15:00:00Z', 199, 'dave'), lastSuccessful: null, previousFailed: false },
    prod:     { current: ev('pay-190', 'v2.9.7', 'success', '2026-05-08T12:00:00Z', 190, 'dave'), lastSuccessful: null, previousFailed: false }
  },
  'auth': {
    dev:      { current: ev('auth-301', 'v5.1.0', 'success', '2026-05-14T08:30:00Z', 301, 'eve'), lastSuccessful: null, previousFailed: false },
    qa:       { current: ev('auth-302', 'v5.1.0', 'success', '2026-05-14T09:30:00Z', 302, 'eve'), lastSuccessful: null, previousFailed: false },
    qahotfix: null,
    uat:      { current: ev('auth-303', 'v5.0.9', 'success', '2026-05-13T16:00:00Z', 303, 'eve'), lastSuccessful: null, previousFailed: false },
    prod:     { current: ev('auth-290', 'v5.0.8', 'success', '2026-05-10T11:00:00Z', 290, 'frank'), lastSuccessful: null, previousFailed: false }
  }
};

// ServiceWithDeployments — derives DAG from deployments[] per ADR-0012 rev 3.
// Uses parentDeployments for the branching topology (explicit path).
export const BRANCHING_SERVICES_WITH_DEPLOYMENTS: readonly ServiceWithDeployments[] = [
  {
    id: 'gateway',
    name: 'Gateway',
    deployments: [
      { id: 'gw-101', env: BRANCHING_ENVIRONMENTS[0], version: 'v1.2.0', status: 'success',     timestamp: '2026-05-14T10:00:00Z' },
      { id: 'gw-102', env: BRANCHING_ENVIRONMENTS[1], version: 'v1.2.0', status: 'success',     timestamp: '2026-05-14T11:00:00Z', parentDeployments: ['gw-101'] },
      { id: 'gw-103', env: BRANCHING_ENVIRONMENTS[2], version: 'v1.1.5', status: 'success',     timestamp: '2026-05-13T08:00:00Z', parentDeployments: ['gw-101'] },
      { id: 'gw-104', env: BRANCHING_ENVIRONMENTS[3], version: 'v1.2.0', status: 'in-progress', timestamp: '2026-05-14T12:00:00Z', parentDeployments: ['gw-102', 'gw-103'] }
      // prod: null (no deployment)
    ]
  },
  {
    id: 'payments',
    name: 'Payments',
    deployments: [
      { id: 'pay-190', env: BRANCHING_ENVIRONMENTS[4], version: 'v2.9.7', status: 'success',     timestamp: '2026-05-08T12:00:00Z' },
      { id: 'pay-199', env: BRANCHING_ENVIRONMENTS[3], version: 'v2.9.8', status: 'success',     timestamp: '2026-05-10T15:00:00Z', parentDeployments: ['pay-190'] },
      { id: 'pay-210', env: BRANCHING_ENVIRONMENTS[2], version: 'v2.9.9', status: 'success',     timestamp: '2026-05-11T10:00:00Z', parentDeployments: ['pay-199'] },
      { id: 'pay-202', env: BRANCHING_ENVIRONMENTS[1], version: 'v3.0.0', status: 'failure',     timestamp: '2026-05-14T09:00:00Z', parentDeployments: ['pay-199'] },
      { id: 'pay-201', env: BRANCHING_ENVIRONMENTS[0], version: 'v3.0.1', status: 'in-progress', timestamp: '2026-05-14T13:00:00Z', parentDeployments: ['pay-202'] }
    ]
  },
  {
    id: 'auth',
    name: 'Auth',
    deployments: [
      { id: 'auth-290', env: BRANCHING_ENVIRONMENTS[4], version: 'v5.0.8', status: 'success', timestamp: '2026-05-10T11:00:00Z' },
      { id: 'auth-303', env: BRANCHING_ENVIRONMENTS[3], version: 'v5.0.9', status: 'success', timestamp: '2026-05-13T16:00:00Z', parentDeployments: ['auth-290'] },
      { id: 'auth-302', env: BRANCHING_ENVIRONMENTS[1], version: 'v5.1.0', status: 'success', timestamp: '2026-05-14T09:30:00Z', parentDeployments: ['auth-303'] },
      { id: 'auth-301', env: BRANCHING_ENVIRONMENTS[0], version: 'v5.1.0', status: 'success', timestamp: '2026-05-14T08:30:00Z', parentDeployments: ['auth-302'] }
      // qahotfix: null (no deployment)
    ]
  }
];

// Branching DAG: dev forks to qa AND qahotfix; both converge to uat; uat → prod.
// This is the #54-reporter topology that caused the 6-iteration Alpine burn.
export const MOCKUP_TOPOLOGY_BRANCHING: TopologyState = {
  'gateway': {
    edges: [
      { from: 'dev',      to: 'qa',       source: 'correlated' },
      { from: 'dev',      to: 'qahotfix', source: 'correlated' },
      { from: 'qa',       to: 'uat',      source: 'correlated' },
      { from: 'qahotfix', to: 'uat',      source: 'correlated' },
      { from: 'uat',      to: 'prod',     source: 'correlated' }
    ]
  },
  'payments': {
    edges: [
      { from: 'dev',      to: 'qa',       source: 'correlated' },
      { from: 'dev',      to: 'qahotfix', source: 'correlated' },
      { from: 'qa',       to: 'uat',      source: 'correlated' },
      { from: 'qahotfix', to: 'uat',      source: 'correlated' },
      { from: 'uat',      to: 'prod',     source: 'correlated' }
    ]
  },
  'auth': {
    edges: [
      { from: 'dev', to: 'qa',   source: 'correlated' },
      { from: 'qa',  to: 'uat',  source: 'correlated' },
      { from: 'uat', to: 'prod', source: 'correlated' }
    ]
  }
};
