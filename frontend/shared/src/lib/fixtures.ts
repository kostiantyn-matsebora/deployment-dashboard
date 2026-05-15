// Canonical fixture data — mirrors the mockup's SERVICES block exactly.
// Used for development bootstrap and component unit tests. The wire shape
// uses ISO timestamps; relative-time / dt strings are derived for display.
//
// FR-13 — every deployment event carries `deploymentId` + `parentDeployments`
// (empty by default; the correlation fallback derives edges from
// `current.version`). The per-service `FIXTURE_TOPOLOGY` mirrors the dev →
// qa → uat → prod canonical promotion chain.

import type {
  EnvironmentDescriptor,
  HistoryEntry,
  MatrixState,
  ServiceDescriptor,
  TopologyState
} from './models';

export const FIXTURE_ENVIRONMENTS: readonly EnvironmentDescriptor[] = [
  { id: 'dev', label: 'DEV' },
  { id: 'qa', label: 'QA' },
  { id: 'qahotfix', label: 'QAHOTFIX' },
  { id: 'uat', label: 'UAT' },
  { id: 'prod', label: 'PROD' }
];

export const FIXTURE_SERVICES: readonly ServiceDescriptor[] = [
  { id: 'service-a', name: 'Service A' },
  { id: 'service-b', name: 'Service B' },
  { id: 'service-c', name: 'Service C' },
  { id: 'service-d', name: 'Service D' }
];

// Minimal helper so the fixture stays readable.
//
// `extras` lets a single fixture row exercise the optional `ref` / `sha`
// fields (SAD §7 "Matrix response shape" field rules). Both are optional
// AND nullable on the wire; clients MUST treat absent and `null` as
// equivalent. To keep the four cases honest in the fixture set we:
//   - some rows omit `extras` entirely             → neither
//   - some pass `{ ref: 'feature/...' }`           → ref-only
//   - some pass `{ sha: '9f1c0d2e8a' }`            → sha-only
//   - some pass both                               → both
//   - some pass `{ ref: null, sha: null }`         → explicit null (legal)
// These fields are not rendered anywhere yet; the SPA wires them through
// the store + adapters only for a later picker / drawer column.
function ev(
  deploymentId: string,
  version: string,
  status: 'success' | 'failure' | 'in-progress',
  iso: string,
  run: number,
  actor: string,
  parents: readonly string[] = [],
  extras?: { ref?: string | null; sha?: string | null }
) {
  const base = {
    deploymentId,
    version,
    status,
    runUrl: '#',
    runNumber: run,
    actor,
    deployedAt: iso,
    parentDeployments: parents
  };
  if (extras && 'ref' in extras) (base as { ref?: string | null }).ref = extras.ref;
  if (extras && 'sha' in extras) (base as { sha?: string | null }).sha = extras.sha;
  return base;
}

export const FIXTURE_MATRIX: MatrixState = {
  'service-a': {
    dev: {
      // Both ref + sha populated (typical CI/CD payload).
      current: ev('gh-1251', 'v2.3.2', 'in-progress', '2026-05-14T14:34:00Z', 1251, 'john.doe', [], {
        ref: 'feature/login-revamp',
        sha: '9f1c0d2e8a'
      }),
      // ref-only (e.g. ingestor knows the branch but not the SHA).
      lastSuccessful: ev('gh-1247', 'v2.3.1', 'success', '2026-05-14T12:30:00Z', 1247, 'john.doe', [], {
        ref: 'main'
      }),
      previousFailed: false
    },
    qa: {
      // sha-only.
      current: ev('gh-1240', 'v2.3.0', 'success', '2026-05-13T10:15:00Z', 1240, 'jane.smith', ['gh-1239'], {
        sha: '4d2a8b1c0e'
      }),
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
      // Both ref + sha (PR-style ref).
      lastSuccessful: ev('gh-1216', 'v1.7.8', 'success', '2026-05-09T12:00:00Z', 1216, 'alice.johnson', [], {
        ref: 'pr/482',
        sha: '7e3f9a0b22'
      }),
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
      // ref-only (e.g. tag-driven deploy where the SHA wasn't surfaced).
      current: ev('gh-1252', 'v3.1.2', 'in-progress', '2026-05-14T14:35:00Z', 1252, 'carol.davis', [], {
        ref: 'v3.1.2-rc1'
      }),
      // Explicit null/null — server stored the row with both columns NULL
      // and emitted them on the wire as `null`. The SPA must treat this
      // exactly the same as the omitted form elsewhere in the fixture
      // (SAD §7: absent and `null` are equivalent on the wire).
      lastSuccessful: ev('gh-1234', 'v3.1.0', 'success', '2026-05-12T11:00:00Z', 1234, 'carol.davis', [], {
        ref: null,
        sha: null
      }),
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
      // State 6: Running + Failed (no successful history)
      current: ev('gh-1250', 'v4.0.3', 'in-progress', '2026-05-14T14:33:00Z', 1250, 'john.doe'),
      lastSuccessful: null,
      previousFailed: true
    },
    qa: {
      // State 4: Failed + Last Successful
      current: ev('gh-1249', 'v4.0.3', 'failure', '2026-05-14T14:05:00Z', 1249, 'john.doe'),
      lastSuccessful: ev('gh-1241', 'v4.0.2', 'success', '2026-05-13T11:00:00Z', 1241, 'jane.smith'),
      previousFailed: false
    },
    qahotfix: null,
    uat: {
      // State 5: Running (first deploy, no history)
      current: ev('gh-1253', 'v4.0.4', 'in-progress', '2026-05-14T14:36:00Z', 1253, 'john.doe'),
      lastSuccessful: null,
      previousFailed: false
    },
    prod: null
  }
};

/**
 * Canonical per-service topology snapshot for the fixture matrix. Linear
 * dev → qa → uat → prod chains where slots are populated. Lets the
 * Swim-lane + Workflow-rows layouts render meaningfully in local dev /
 * unit tests before the backend is wired up.
 */
export const FIXTURE_TOPOLOGY: TopologyState = {
  'service-a': {
    edges: [
      { from: 'dev', to: 'qa', source: 'correlated' },
      { from: 'qa', to: 'uat', source: 'correlated' },
      { from: 'uat', to: 'prod', source: 'correlated' }
    ]
  },
  'service-b': {
    edges: [
      { from: 'dev', to: 'qa', source: 'correlated' },
      { from: 'qa', to: 'uat', source: 'correlated' },
      { from: 'uat', to: 'prod', source: 'correlated' }
    ]
  },
  'service-c': {
    edges: [
      { from: 'dev', to: 'qa', source: 'correlated' },
      { from: 'dev', to: 'qahotfix', source: 'correlated' },
      { from: 'qa', to: 'uat', source: 'correlated' },
      { from: 'uat', to: 'prod', source: 'correlated' }
    ]
  },
  'service-d': {
    edges: [
      { from: 'dev', to: 'qa', source: 'correlated' },
      { from: 'qa', to: 'uat', source: 'correlated' }
    ]
  }
};

export const FIXTURE_HISTORY: Record<string, Record<string, HistoryEntry[]>> = {
  'service-a': {
    dev: [
      // both
      { deploymentId: 'gh-1251', version: 'v2.3.2', status: 'in-progress', deployedAt: '2026-05-14T14:34:00Z', actor: 'john.doe',   runNumber: 1251, runUrl: '#', parentDeployments: [], ref: 'feature/login-revamp', sha: '9f1c0d2e8a' },
      // ref-only
      { deploymentId: 'gh-1247', version: 'v2.3.1', status: 'success',     deployedAt: '2026-05-14T12:30:00Z', actor: 'john.doe',   runNumber: 1247, runUrl: '#', parentDeployments: [], ref: 'main' },
      // sha-only
      { deploymentId: 'gh-1246', version: 'v2.3.0', status: 'failure',     deployedAt: '2026-05-14T11:50:00Z', actor: 'john.doe',   runNumber: 1246, runUrl: '#', parentDeployments: [], sha: 'c0a13b88f1' },
      // neither (omitted entirely — represents the original 7-field shape)
      { deploymentId: 'gh-1235', version: 'v2.2.9', status: 'success',     deployedAt: '2026-05-12T15:20:00Z', actor: 'jane.smith', runNumber: 1235, runUrl: '#', parentDeployments: [] }
    ],
    qa: [
      { deploymentId: 'gh-1240', version: 'v2.3.0', status: 'success', deployedAt: '2026-05-13T10:15:00Z', actor: 'jane.smith', runNumber: 1240, runUrl: '#', parentDeployments: ['gh-1239'] },
      { deploymentId: 'gh-1229', version: 'v2.2.9', status: 'success', deployedAt: '2026-05-10T11:00:00Z', actor: 'john.doe',   runNumber: 1229, runUrl: '#', parentDeployments: [] }
    ],
    qahotfix: [],
    uat: [
      { deploymentId: 'gh-1220', version: 'v2.2.5', status: 'success', deployedAt: '2026-05-11T09:00:00Z', actor: 'john.doe',   runNumber: 1220, runUrl: '#', parentDeployments: ['gh-1219'] },
      { deploymentId: 'gh-1200', version: 'v2.2.4', status: 'success', deployedAt: '2026-05-05T11:20:00Z', actor: 'jane.smith', runNumber: 1200, runUrl: '#', parentDeployments: [] }
    ],
    prod: [
      { deploymentId: 'gh-1210', version: 'v2.2.4', status: 'success', deployedAt: '2026-05-07T16:45:00Z', actor: 'jane.smith', runNumber: 1210, runUrl: '#', parentDeployments: ['gh-1208'] },
      { deploymentId: 'gh-1180', version: 'v2.2.3', status: 'success', deployedAt: '2026-04-30T10:00:00Z', actor: 'john.doe',   runNumber: 1180, runUrl: '#', parentDeployments: [] }
    ]
  },
  'service-b': {
    dev: [
      { deploymentId: 'gh-1245', version: 'v1.8.0', status: 'success', deployedAt: '2026-05-14T11:45:00Z', actor: 'alice.johnson', runNumber: 1245, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1231', version: 'v1.7.9', status: 'success', deployedAt: '2026-05-12T09:00:00Z', actor: 'alice.johnson', runNumber: 1231, runUrl: '#', parentDeployments: [] }
    ],
    qa: [
      { deploymentId: 'gh-1232', version: 'v1.7.9', status: 'failure', deployedAt: '2026-05-12T14:00:00Z', actor: 'bob.wilson',    runNumber: 1232, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1216', version: 'v1.7.8', status: 'success', deployedAt: '2026-05-09T12:00:00Z', actor: 'alice.johnson', runNumber: 1216, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1201', version: 'v1.7.7', status: 'success', deployedAt: '2026-05-05T10:00:00Z', actor: 'bob.wilson',    runNumber: 1201, runUrl: '#', parentDeployments: [] }
    ],
    qahotfix: [],
    uat: [
      { deploymentId: 'gh-1215', version: 'v1.7.8', status: 'success', deployedAt: '2026-05-09T10:30:00Z', actor: 'alice.johnson', runNumber: 1215, runUrl: '#', parentDeployments: [] }
    ],
    prod: [
      { deploymentId: 'gh-1185', version: 'v1.7.7', status: 'success', deployedAt: '2026-04-30T09:15:00Z', actor: 'bob.wilson',    runNumber: 1185, runUrl: '#', parentDeployments: [] }
    ]
  },
  'service-c': {
    dev: [
      { deploymentId: 'gh-1252', version: 'v3.1.2', status: 'in-progress', deployedAt: '2026-05-14T14:35:00Z', actor: 'carol.davis', runNumber: 1252, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1249c', version: 'v3.1.1', status: 'failure',     deployedAt: '2026-05-14T13:00:00Z', actor: 'carol.davis', runNumber: 1249, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1234', version: 'v3.1.0', status: 'success',     deployedAt: '2026-05-12T11:00:00Z', actor: 'carol.davis', runNumber: 1234, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1217', version: 'v3.0.9', status: 'success',     deployedAt: '2026-05-10T08:00:00Z', actor: 'dave.martin', runNumber: 1217, runUrl: '#', parentDeployments: [] }
    ],
    qa: [
      { deploymentId: 'gh-1243', version: 'v3.1.1', status: 'success', deployedAt: '2026-05-14T08:30:00Z', actor: 'carol.davis', runNumber: 1243, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1236', version: 'v3.1.0', status: 'success', deployedAt: '2026-05-12T17:00:00Z', actor: 'carol.davis', runNumber: 1236, runUrl: '#', parentDeployments: [] }
    ],
    qahotfix: [
      { deploymentId: 'gh-1218', version: 'v3.0.5', status: 'success', deployedAt: '2026-05-10T11:00:00Z', actor: 'dave.martin', runNumber: 1218, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1212', version: 'v3.0.4', status: 'failure', deployedAt: '2026-05-09T14:00:00Z', actor: 'dave.martin', runNumber: 1212, runUrl: '#', parentDeployments: [] }
    ],
    uat: [
      { deploymentId: 'gh-1234u', version: 'v3.1.0', status: 'success', deployedAt: '2026-05-12T16:00:00Z', actor: 'carol.davis', runNumber: 1234, runUrl: '#', parentDeployments: [] }
    ],
    prod: [
      { deploymentId: 'gh-1222', version: 'v3.0.9', status: 'success', deployedAt: '2026-05-10T14:30:00Z', actor: 'dave.martin', runNumber: 1222, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1190', version: 'v3.0.8', status: 'success', deployedAt: '2026-05-01T09:00:00Z', actor: 'carol.davis', runNumber: 1190, runUrl: '#', parentDeployments: [] }
    ]
  },
  'service-d': {
    dev: [
      { deploymentId: 'gh-1250', version: 'v4.0.3', status: 'in-progress', deployedAt: '2026-05-14T14:33:00Z', actor: 'john.doe',   runNumber: 1250, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1244', version: 'v4.0.2', status: 'failure',     deployedAt: '2026-05-14T12:00:00Z', actor: 'john.doe',   runNumber: 1244, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1242', version: 'v4.0.1', status: 'failure',     deployedAt: '2026-05-13T16:00:00Z', actor: 'jane.smith', runNumber: 1242, runUrl: '#', parentDeployments: [] }
    ],
    qa: [
      { deploymentId: 'gh-1249', version: 'v4.0.3', status: 'failure', deployedAt: '2026-05-14T14:05:00Z', actor: 'john.doe',   runNumber: 1249, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1241', version: 'v4.0.2', status: 'success', deployedAt: '2026-05-13T11:00:00Z', actor: 'jane.smith', runNumber: 1241, runUrl: '#', parentDeployments: [] },
      { deploymentId: 'gh-1224', version: 'v4.0.1', status: 'success', deployedAt: '2026-05-10T14:00:00Z', actor: 'john.doe',   runNumber: 1224, runUrl: '#', parentDeployments: [] }
    ],
    qahotfix: [],
    uat: [
      { deploymentId: 'gh-1253', version: 'v4.0.4', status: 'in-progress', deployedAt: '2026-05-14T14:36:00Z', actor: 'john.doe', runNumber: 1253, runUrl: '#', parentDeployments: [] }
    ],
    prod: []
  }
};

/** Default topology-correlation config rendered during local dev.
 *
 *  Per SAD §10 Decision #7 the SPA is read-only against
 *  `/api/config/topology`; this object is only the "system default" label
 *  source for the picker. `allowUserOverride` is gone — the picker is
 *  always present. */
export const FIXTURE_TOPOLOGY_CONFIG = {
  correlationAttribute: 'version',
  perServiceOverrides: {}
} as const;
