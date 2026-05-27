// Hardcoded canonical fixtures for the mockup-app.
//
// Shapes mirror frontend/shared/src/lib/models.ts (camelCase domain types)
// by MANUAL DISCIPLINE — no TypeScript enforcement across the boundary.
// When the wire models evolve, this file must be updated by hand.
//
// Rev 3 (ADR-0012 rev 3 / issue #90):
//   - Service model replaced: `deployments: Deployment[]` per ADR-0012 §5.
//   - Pre-baked `nodes[]` / `edges[]` removed from service entities.
//   - DAG derived in FE from deployments[] (see dag-builder.ts).
//   - MatrixState + TopologyState retained for LayoutLeaf template access only
//     (slot.current.* for status/version display); NOT used for DAG construction.
//   - Naming: `parentDeployments` (matches wire model) per FE dispatch decision.

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

// ---- ADR-0012 §5 Deployment model ----------------------------------------

export interface Deployment {
  readonly id: string;
  readonly env: EnvironmentDescriptor;
  readonly version: string;
  readonly sha?: string | null;
  readonly ref?: string | null;
  readonly status: DeploymentStatus;
  readonly timestamp: string;          // ISO-8601 wall-clock
  readonly parentDeployments?: readonly string[];  // deployment IDs (optional)
}

// Service now carries deployments[] — DAG derived in FE per ADR-0012 §5.
// MatrixState kept separately for LayoutLeaf slot access (display only).
export interface ServiceWithDeployments extends ServiceDescriptor {
  readonly deployments: readonly Deployment[];
}

// ---- Canonical fixture data -----------------------------------------------

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

// Helper to look up an environment by id.
function env(id: string): EnvironmentDescriptor {
  return MOCKUP_ENVIRONMENTS.find(e => e.id === id)!;
}

// ---- MOCKUP_SERVICES_WITH_DEPLOYMENTS -------------------------------------
//
// Each service carries deployments[] per ADR-0012 §5.
// Content preserved from cycle 1 (same services, envs, statuses, versions).
//
// Service A: linear chain dev→qa→uat→prod (correlation-key: sha wins since
//   dev has sha=9f1c0d2e8a, qa has sha=4d2a8b1c0e — different shas, so sha
//   is the discriminating key). No QAHOTFIX.
//
// Service B: linear chain dev→qa→uat→prod. No QAHOTFIX.
//   qa sha=7e3f9a0b22 (lastSuccessful), current qa has no sha.
//   Using sha correlation would fail (some have null sha). version varies.
//   Use version as correlation key (v1.7.7→v1.7.8→v1.7.9→v1.8.0).
//   But direction: earlier→later by timestamp.
//
// Service C: branching — dev→qa AND dev→qahotfix; qa→uat→prod.
//   parentDeployments set explicitly for qa and qahotfix (both from dev).
//   qahotfix uses qa-hotfix-specific deployment id to prove independent env.
//
// Service D: linear dev→qa→uat (no prod slot). No QAHOTFIX.
//   Uses explicit parentDeployments.

export const MOCKUP_SERVICES_WITH_DEPLOYMENTS: readonly ServiceWithDeployments[] = [
  {
    id: 'service-a',
    name: 'Service A',
    // No parentDeployments → correlation-key path. sha varies across deployments.
    // sha: 9f1c0d2e8a (dev), 4d2a8b1c0e (qa), null (uat), null (prod).
    // sha is not discriminating (some null). version: v2.3.2, v2.3.0, v2.2.5, v2.2.4 — all differ.
    // version wins as correlation key. Sorted by timestamp: prod→uat→qa→dev.
    // Edges: prod→uat→qa→dev (earlier timestamp first).
    deployments: [
      {
        id: 'gh-1210',
        env: env('prod'),
        version: 'v2.2.4',
        sha: null,
        ref: null,
        status: 'success',
        timestamp: '2026-05-07T16:45:00Z'
      },
      {
        id: 'gh-1220',
        env: env('uat'),
        version: 'v2.2.5',
        sha: null,
        ref: null,
        status: 'success',
        timestamp: '2026-05-11T09:00:00Z'
      },
      {
        id: 'gh-1240',
        env: env('qa'),
        version: 'v2.3.0',
        sha: '4d2a8b1c0e',
        ref: null,
        status: 'success',
        timestamp: '2026-05-13T10:15:00Z'
      },
      {
        id: 'gh-1251',
        env: env('dev'),
        version: 'v2.3.2',
        sha: '9f1c0d2e8a',
        ref: 'feature/login-revamp',
        status: 'in-progress',
        timestamp: '2026-05-14T14:34:00Z'
      }
    ]
  },
  {
    id: 'service-b',
    name: 'Service B',
    // No parentDeployments → correlation-key path. versions all differ.
    // version is discriminating key. Sorted by timestamp: prod→uat→qa→dev.
    deployments: [
      {
        id: 'gh-1185',
        env: env('prod'),
        version: 'v1.7.7',
        sha: null,
        ref: null,
        status: 'success',
        timestamp: '2026-04-30T09:15:00Z'
      },
      {
        id: 'gh-1215',
        env: env('uat'),
        version: 'v1.7.8',
        sha: null,
        ref: null,
        status: 'success',
        timestamp: '2026-05-09T10:30:00Z'
      },
      {
        id: 'gh-1232',
        env: env('qa'),
        version: 'v1.7.9',
        sha: null,
        ref: null,
        status: 'failure',
        timestamp: '2026-05-12T14:00:00Z'
      },
      {
        id: 'gh-1245',
        env: env('dev'),
        version: 'v1.8.0',
        sha: null,
        ref: null,
        status: 'success',
        timestamp: '2026-05-14T11:45:00Z'
      }
    ]
  },
  {
    id: 'service-c',
    name: 'Service C',
    // parentDeployments set → parent-explicit path.
    // dev(gh-1252) is root. qa(gh-1243) and qahotfix(gh-1218) both derive from dev.
    // uat(gh-1234u) derives from qa. prod(gh-1222) derives from uat.
    // THIS IS THE KEY FIXTURE: qahotfix must render in QAHOTFIX column (rank=2),
    // NOT under QA column (rank=1). The rank is set by env.id in the DAG builder.
    deployments: [
      {
        id: 'gh-1252',
        env: env('dev'),
        version: 'v3.1.2',
        sha: null,
        ref: 'v3.1.2-rc1',
        status: 'in-progress',
        timestamp: '2026-05-14T14:35:00Z'
        // no parentDeployments = root
      },
      {
        id: 'gh-1243',
        env: env('qa'),
        version: 'v3.1.1',
        sha: null,
        ref: null,
        status: 'success',
        timestamp: '2026-05-14T08:30:00Z',
        parentDeployments: ['gh-1252']
      },
      {
        id: 'gh-1218',
        env: env('qahotfix'),
        version: 'v3.0.5',
        sha: null,
        ref: null,
        status: 'success',
        timestamp: '2026-05-10T11:00:00Z',
        parentDeployments: ['gh-1252']   // also branches from dev
      },
      {
        id: 'gh-1234u',
        env: env('uat'),
        version: 'v3.1.0',
        sha: null,
        ref: null,
        status: 'success',
        timestamp: '2026-05-12T16:00:00Z',
        parentDeployments: ['gh-1243']   // from qa
      },
      {
        id: 'gh-1222',
        env: env('prod'),
        version: 'v3.0.9',
        sha: null,
        ref: null,
        status: 'success',
        timestamp: '2026-05-10T14:30:00Z',
        parentDeployments: ['gh-1234u']  // from uat
      }
    ]
  },
  {
    id: 'service-d',
    name: 'Service D',
    // parentDeployments set → parent-explicit path.
    // dev is root; qa from dev; uat from qa; no prod.
    // Service D's "analogous" deployment: no qahotfix (different from service-c).
    // uat is in-progress (demonstrating multi-env active state).
    deployments: [
      {
        id: 'gh-1250',
        env: env('dev'),
        version: 'v4.0.3',
        sha: null,
        ref: null,
        status: 'in-progress',
        timestamp: '2026-05-14T14:33:00Z'
        // root
      },
      {
        id: 'gh-1249',
        env: env('qa'),
        version: 'v4.0.3',
        sha: null,
        ref: null,
        status: 'failure',
        timestamp: '2026-05-14T14:05:00Z',
        parentDeployments: ['gh-1250']
      },
      {
        id: 'gh-1253',
        env: env('uat'),
        version: 'v4.0.4',
        sha: null,
        ref: null,
        status: 'in-progress',
        timestamp: '2026-05-14T14:36:00Z',
        parentDeployments: ['gh-1249']
      }
    ]
  }
];

// ---- MatrixState (retained for LayoutLeaf slot display access) -------------
// Keyed by service.id → env.id → SlotState | null.
// This is the display layer only — DAG construction uses MOCKUP_SERVICES_WITH_DEPLOYMENTS.

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
      // Recovered case: success after a previous failure — demonstrates the
      // "recovered" state combo (success + previousFailed: true).
      current: ev('gh-1215', 'v1.7.8', 'success', '2026-05-09T10:30:00Z', 1215, 'alice.johnson'),
      lastSuccessful: null,
      previousFailed: true
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

// Edge type retained for LayoutLeaf imports that reference it (none currently),
// and for any future display-layer consumers.
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

// MOCKUP_TOPOLOGY: retained as empty-edges per service since cycle 2 derives
// topology from deployments[]. Components no longer use this for DAG construction.
// Kept to avoid breaking imports in existing test specs.
export const MOCKUP_TOPOLOGY: TopologyState = {
  'service-a': { edges: [] },
  'service-b': { edges: [] },
  'service-c': { edges: [] },
  'service-d': { edges: [] }
};

export const MOCKUP_TOPOLOGY_CONFIG: TopologyConfig = {
  correlationAttribute: 'version',
  perServiceOverrides: {}
};
