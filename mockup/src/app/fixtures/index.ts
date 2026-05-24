// Hardcoded canonical fixtures for the mockup-app.
//
// Shapes mirror frontend/shared/src/lib/models.ts (camelCase domain types)
// by MANUAL DISCIPLINE — no TypeScript enforcement across the boundary.
// When the wire models evolve, this file must be updated by hand.
//
// FR-13: every service entry carries topology edges (per-service env DAG).
// Wire shape: MatrixState = Record<service, Record<env, SlotState | null>>
//             TopologyState = Record<service, { edges: Edge[] }>

// ---- Type mirrors (manually kept in sync with @dd/shared models.ts) --------

export type DeploymentStatus = 'success' | 'failure' | 'in-progress';

export interface DeploymentEvent {
  deploymentId: string;
  version: string;
  status?: DeploymentStatus;
  runUrl: string;
  runNumber: number;
  actor: string;
  deployedAt: string;
  parentDeployments: readonly string[];
  ref?: string | null;
  sha?: string | null;
}

export interface SlotState {
  current: DeploymentEvent & { status: DeploymentStatus };
  lastSuccessful: DeploymentEvent | null;
  previousFailed: boolean;
}

export type MatrixState = Record<string, Record<string, SlotState | null>>;

export interface ServiceDescriptor {
  id: string;
  name: string;
}

export interface EnvironmentDescriptor {
  id: string;
  label: string;
}

export interface Edge {
  from: string;
  to: string;
  source: 'explicit' | 'correlated';
}

export interface Topology {
  edges: readonly Edge[];
}

export type TopologyState = Record<string, Topology>;

export interface TopologyConfig {
  correlationAttribute: string;
  perServiceOverrides: Readonly<Record<string, string>>;
}

// ---- Canonical fixture data (mirrors frontend/shared/src/lib/fixtures.ts) --

export const MOCKUP_ENVIRONMENTS: readonly EnvironmentDescriptor[] = [
  { id: 'dev',      label: 'DEV'      },
  { id: 'qa',       label: 'QA'       },
  { id: 'qahotfix', label: 'QAHOTFIX' },
  { id: 'uat',      label: 'UAT'      },
  { id: 'prod',     label: 'PROD'     }
];

export const MOCKUP_SERVICES: readonly ServiceDescriptor[] = [
  { id: 'service-a', name: 'Service A' },
  { id: 'service-b', name: 'Service B' },
  { id: 'service-c', name: 'Service C' },
  { id: 'service-d', name: 'Service D' }
];

// Minimal helper — same shape as FIXTURE_MATRIX ev() in frontend/shared.
function ev(
  deploymentId: string,
  version: string,
  status: DeploymentStatus,
  iso: string,
  run: number,
  actor: string,
  parents: readonly string[] = [],
  extras?: { ref?: string | null; sha?: string | null }
): DeploymentEvent & { status: DeploymentStatus } {
  const base: DeploymentEvent & { status: DeploymentStatus } = {
    deploymentId, version, status,
    runUrl: '#', runNumber: run, actor,
    deployedAt: iso, parentDeployments: parents
  };
  if (extras && 'ref' in extras) base.ref = extras.ref;
  if (extras && 'sha' in extras) base.sha = extras.sha;
  return base;
}

export const MOCKUP_MATRIX: MatrixState = {
  'service-a': {
    dev: {
      current: ev('gh-1251', 'v2.3.2', 'in-progress', '2026-05-14T14:34:00Z', 1251, 'john.doe', [],
        { ref: 'feature/login-revamp', sha: '9f1c0d2e8a' }),
      lastSuccessful: ev('gh-1247', 'v2.3.1', 'success', '2026-05-14T12:30:00Z', 1247, 'john.doe', [],
        { ref: 'main' }),
      previousFailed: false
    },
    qa: {
      current: ev('gh-1240', 'v2.3.0', 'success', '2026-05-13T10:15:00Z', 1240, 'jane.smith', ['gh-1239'],
        { sha: '4d2a8b1c0e' }),
      lastSuccessful: null,
      previousFailed: false
    },
    qahotfix: null,
    uat: {
      current: ev('gh-1220', 'v2.2.5', 'success', '2026-05-11T09:00:00Z', 1220, 'john.doe', ['gh-1219']),
      lastSuccessful: null,
      previousFailed: false
    },
    prod: {
      current: ev('gh-1210', 'v2.2.4', 'success', '2026-05-07T16:45:00Z', 1210, 'jane.smith', ['gh-1208']),
      lastSuccessful: null,
      previousFailed: false
    }
  },
  'service-b': {
    dev: {
      current: ev('gh-1245', 'v1.8.0', 'success', '2026-05-14T11:45:00Z', 1245, 'alice.johnson'),
      lastSuccessful: null,
      previousFailed: false
    },
    qa: {
      current: ev('gh-1232', 'v1.7.9', 'failure', '2026-05-12T14:00:00Z', 1232, 'bob.wilson'),
      lastSuccessful: ev('gh-1216', 'v1.7.8', 'success', '2026-05-09T12:00:00Z', 1216, 'alice.johnson', [],
        { ref: 'pr/482', sha: '7e3f9a0b22' }),
      previousFailed: false
    },
    qahotfix: null,
    uat: {
      current: ev('gh-1215', 'v1.7.8', 'success', '2026-05-09T10:30:00Z', 1215, 'alice.johnson'),
      lastSuccessful: null,
      previousFailed: false
    },
    prod: {
      current: ev('gh-1185', 'v1.7.7', 'success', '2026-04-30T09:15:00Z', 1185, 'bob.wilson'),
      lastSuccessful: null,
      previousFailed: false
    }
  },
  'service-c': {
    dev: {
      current: ev('gh-1252', 'v3.1.2', 'in-progress', '2026-05-14T14:35:00Z', 1252, 'carol.davis', [],
        { ref: 'v3.1.2-rc1' }),
      lastSuccessful: ev('gh-1234', 'v3.1.0', 'success', '2026-05-12T11:00:00Z', 1234, 'carol.davis', [],
        { ref: null, sha: null }),
      previousFailed: true
    },
    qa: {
      current: ev('gh-1243', 'v3.1.1', 'success', '2026-05-14T08:30:00Z', 1243, 'carol.davis'),
      lastSuccessful: null,
      previousFailed: false
    },
    qahotfix: {
      current: ev('gh-1218', 'v3.0.5', 'success', '2026-05-10T11:00:00Z', 1218, 'dave.martin'),
      lastSuccessful: null,
      previousFailed: false
    },
    uat: {
      current: ev('gh-1234u', 'v3.1.0', 'success', '2026-05-12T16:00:00Z', 1234, 'carol.davis'),
      lastSuccessful: null,
      previousFailed: false
    },
    prod: {
      current: ev('gh-1222', 'v3.0.9', 'success', '2026-05-10T14:30:00Z', 1222, 'dave.martin'),
      lastSuccessful: null,
      previousFailed: false
    }
  },
  'service-d': {
    dev: {
      current: ev('gh-1250', 'v4.0.3', 'in-progress', '2026-05-14T14:33:00Z', 1250, 'john.doe'),
      lastSuccessful: null,
      previousFailed: true
    },
    qa: {
      current: ev('gh-1249', 'v4.0.3', 'failure', '2026-05-14T14:05:00Z', 1249, 'john.doe'),
      lastSuccessful: ev('gh-1241', 'v4.0.2', 'success', '2026-05-13T11:00:00Z', 1241, 'jane.smith'),
      previousFailed: false
    },
    qahotfix: null,
    uat: {
      current: ev('gh-1253', 'v4.0.4', 'in-progress', '2026-05-14T14:36:00Z', 1253, 'john.doe'),
      lastSuccessful: null,
      previousFailed: false
    },
    prod: null
  }
};

// Canonical per-service topology — linear dev→qa→uat→prod chains
// with service-c branching dev→qa + dev→qahotfix.
export const MOCKUP_TOPOLOGY: TopologyState = {
  'service-a': {
    edges: [
      { from: 'dev', to: 'qa',   source: 'correlated' },
      { from: 'qa',  to: 'uat',  source: 'correlated' },
      { from: 'uat', to: 'prod', source: 'correlated' }
    ]
  },
  'service-b': {
    edges: [
      { from: 'dev', to: 'qa',   source: 'correlated' },
      { from: 'qa',  to: 'uat',  source: 'correlated' },
      { from: 'uat', to: 'prod', source: 'correlated' }
    ]
  },
  'service-c': {
    edges: [
      { from: 'dev', to: 'qa',       source: 'correlated' },
      { from: 'dev', to: 'qahotfix', source: 'correlated' },
      { from: 'qa',  to: 'uat',      source: 'correlated' },
      { from: 'uat', to: 'prod',     source: 'correlated' }
    ]
  },
  'service-d': {
    edges: [
      { from: 'dev', to: 'qa',  source: 'correlated' },
      { from: 'qa',  to: 'uat', source: 'correlated' }
    ]
  }
};

export const MOCKUP_TOPOLOGY_CONFIG: TopologyConfig = {
  correlationAttribute: 'version',
  perServiceOverrides: {}
};
