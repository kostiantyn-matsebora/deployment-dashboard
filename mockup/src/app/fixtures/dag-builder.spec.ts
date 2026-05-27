// DAG builder + path enumerator unit tests — ADR-0012 §5 coverage.
//
// Test coverage per #90 acceptance criteria:
//   DAG builder:
//     1. parent-explicit derivation
//     2. time-correlation derivation — sha wins
//     3. time-correlation derivation — version wins (sha not discriminating)
//     4. time-correlation derivation — ref wins (sha + version not discriminating)
//     5. empty-deployments edge case
//     6. single-deployment edge case
//   Path enumerator:
//     1. linear DAG (1 path)
//     2. simple fork (2 paths)
//     3. nested fork (≥3 paths)
//     4. cap-overflow (≥9 paths → returns top-8 + overflow count)

import { buildDag, enumeratePaths, envColumnIndex, ENV_ORDER } from './dag-builder';
import type { Deployment } from './index';

// ---- Fixture helpers -------------------------------------------------------

function mkEnv(id: string) {
  return { id, label: id.toUpperCase() };
}

function mkDeployment(
  id: string,
  envId: string,
  version: string,
  timestamp: string,
  opts: {
    sha?: string | null;
    ref?: string | null;
    status?: string;
    parentDeployments?: string[];
  } = {}
): Deployment {
  return {
    id,
    env: mkEnv(envId),
    version,
    sha: opts.sha ?? null,
    ref: opts.ref ?? null,
    status: (opts.status ?? 'success') as any,
    timestamp,
    parentDeployments: opts.parentDeployments
  };
}

// ---- envColumnIndex ---------------------------------------------------------

describe('envColumnIndex', () => {
  it('returns correct rank for each canonical env', () => {
    expect(envColumnIndex('dev')).toBe(0);
    expect(envColumnIndex('qa')).toBe(1);
    expect(envColumnIndex('qahotfix')).toBe(2);
    expect(envColumnIndex('uat')).toBe(3);
    expect(envColumnIndex('prod')).toBe(4);
  });

  it('returns ENV_ORDER.length for unknown env', () => {
    expect(envColumnIndex('staging')).toBe(ENV_ORDER.length);
  });
});

// ---- buildDag: empty deployments -------------------------------------------

describe('buildDag — empty deployments', () => {
  it('returns empty nodes and edges', () => {
    const result = buildDag('svc', []);
    expect(result.nodes.length).toBe(0);
    expect(result.edges.length).toBe(0);
  });
});

// ---- buildDag: single deployment -------------------------------------------

describe('buildDag — single deployment', () => {
  it('returns one node with correct rank and no edges', () => {
    const deps = [mkDeployment('d1', 'qa', 'v1.0.0', '2026-01-01T00:00:00Z')];
    const result = buildDag('svc', deps);
    expect(result.nodes.length).toBe(1);
    expect(result.edges.length).toBe(0);
    expect(result.nodes[0].rank).toBe(envColumnIndex('qa'));  // 1
    expect(result.nodes[0].data.envId).toBe('qa');
  });
});

// ---- buildDag: parent-explicit ---------------------------------------------

describe('buildDag — parent-explicit derivation', () => {
  const deps: Deployment[] = [
    mkDeployment('d-dev', 'dev', 'v1.0.0', '2026-01-01T10:00:00Z'),
    mkDeployment('d-qa',  'qa',  'v1.0.0', '2026-01-01T12:00:00Z', { parentDeployments: ['d-dev'] }),
    mkDeployment('d-uat', 'uat', 'v1.0.0', '2026-01-01T14:00:00Z', { parentDeployments: ['d-qa'] })
  ];

  it('builds 3 nodes with correct env ranks', () => {
    const result = buildDag('svc', deps);
    expect(result.nodes.length).toBe(3);
    const byEnv = Object.fromEntries(result.nodes.map(n => [n.data.envId, n.rank]));
    expect(byEnv['dev']).toBe(0);
    expect(byEnv['qa']).toBe(1);
    expect(byEnv['uat']).toBe(3);
  });

  it('builds 2 explicit edges with source="explicit"', () => {
    const result = buildDag('svc', deps);
    expect(result.edges.length).toBe(2);
    result.edges.forEach(e => expect(e.data.source).toBe('explicit'));
  });

  it('edge direction: parent node is source, child node is target', () => {
    const result = buildDag('svc', deps);
    const devNode = result.nodes.find(n => n.data.envId === 'dev')!;
    const qaNode  = result.nodes.find(n => n.data.envId === 'qa')!;
    const devToQa = result.edges.find(e => e.source === devNode.id && e.target === qaNode.id);
    expect(devToQa).toBeTruthy();
  });

  it('branching: dev→qa AND dev→qahotfix generates 2 edges from dev', () => {
    const branchDeps: Deployment[] = [
      mkDeployment('d-dev',      'dev',      'v2.0.0', '2026-01-01T10:00:00Z'),
      mkDeployment('d-qa',       'qa',       'v2.0.0', '2026-01-01T12:00:00Z', { parentDeployments: ['d-dev'] }),
      mkDeployment('d-qahotfix', 'qahotfix', 'v2.0.0', '2026-01-01T11:00:00Z', { parentDeployments: ['d-dev'] })
    ];
    const result = buildDag('svc', branchDeps);
    const devNode = result.nodes.find(n => n.data.envId === 'dev')!;
    const edgesFromDev = result.edges.filter(e => e.source === devNode.id);
    expect(edgesFromDev.length).toBe(2);
  });

  it('qahotfix node has rank=2 (not rank=1)', () => {
    const branchDeps: Deployment[] = [
      mkDeployment('d-dev',      'dev',      'v2.0.0', '2026-01-01T10:00:00Z'),
      mkDeployment('d-qahotfix', 'qahotfix', 'v2.0.0', '2026-01-01T11:00:00Z', { parentDeployments: ['d-dev'] })
    ];
    const result = buildDag('svc', branchDeps);
    const qahNode = result.nodes.find(n => n.data.envId === 'qahotfix')!;
    expect(qahNode.rank).toBe(2);  // not 1 (qa rank)
  });
});

// ---- buildDag: correlation-key — sha wins ----------------------------------

describe('buildDag — correlated, sha discriminating', () => {
  // sha differs across deployments → sha wins as correlation key.
  const deps: Deployment[] = [
    mkDeployment('d-dev', 'dev', 'v1.0.0', '2026-01-01T10:00:00Z', { sha: 'aabbcc1' }),
    mkDeployment('d-qa',  'qa',  'v1.0.0', '2026-01-01T12:00:00Z', { sha: 'ddeeff2' }),
    mkDeployment('d-uat', 'uat', 'v1.0.0', '2026-01-02T10:00:00Z', { sha: 'aabbcc1' })  // same sha as dev
  ];
  // sha values: aabbcc1, ddeeff2, aabbcc1 → two groups → sha IS discriminating.
  // Group aabbcc1 = dev + uat → edge dev→uat (earlier→later by timestamp).
  // Group ddeeff2 = qa only → no intra-group edge.

  it('builds edges using sha as correlation key', () => {
    const result = buildDag('svc', deps);
    // dev (sha=aabbcc1, ts=10:00) → uat (sha=aabbcc1, ts=10:00 next day)
    const devNode = result.nodes.find(n => n.data.envId === 'dev')!;
    const uatNode = result.nodes.find(n => n.data.envId === 'uat')!;
    const devToUat = result.edges.find(e => e.source === devNode.id && e.target === uatNode.id);
    expect(devToUat).toBeTruthy();
    expect(devToUat!.data.source).toBe('correlated');
  });
});

// ---- buildDag: correlation-key — version wins (sha not discriminating) ----

describe('buildDag — correlated, version discriminating (sha null/uniform)', () => {
  // sha all null → sha not discriminating. version all differ.
  const deps: Deployment[] = [
    mkDeployment('d-prod', 'prod', 'v1.0.0', '2026-01-01T08:00:00Z'),
    mkDeployment('d-uat',  'uat',  'v1.1.0', '2026-01-02T08:00:00Z'),
    mkDeployment('d-qa',   'qa',   'v1.2.0', '2026-01-03T08:00:00Z'),
    mkDeployment('d-dev',  'dev',  'v1.3.0', '2026-01-04T08:00:00Z')
  ];
  // version varies → version wins (sha null for all, not discriminating).
  // Each version is unique → 4 groups of size 1 → no intra-group edges.
  // So no edges expected (each deployment is in its own group).

  it('produces no edges when each version is unique (each in own group)', () => {
    const result = buildDag('svc', deps);
    expect(result.edges.length).toBe(0);
  });

  it('produces a chain when versions repeat in timestamp order', () => {
    // If two deployments share version, they are in same group → one edge.
    const deps2: Deployment[] = [
      mkDeployment('d-dev', 'dev', 'v1.0.0', '2026-01-01T08:00:00Z'),
      mkDeployment('d-qa',  'qa',  'v1.0.0', '2026-01-02T08:00:00Z')
      // sha both null → not discriminating. version both v1.0.0 → not discriminating.
      // ref both null → not discriminating. Falls back to version (arbitrary), single group.
    ];
    const result2 = buildDag('svc', deps2);
    // single group with 2 items → 1 edge (dev→qa by timestamp)
    expect(result2.edges.length).toBe(1);
    expect(result2.edges[0].data.source).toBe('correlated');
    const devNode = result2.nodes.find(n => n.data.envId === 'dev')!;
    const qaNode  = result2.nodes.find(n => n.data.envId === 'qa')!;
    expect(result2.edges[0].source).toBe(devNode.id);
    expect(result2.edges[0].target).toBe(qaNode.id);
  });
});

// ---- buildDag: correlation-key — ref wins ----------------------------------

describe('buildDag — correlated, ref discriminating (sha+version uniform)', () => {
  // sha all null, version all same → neither discriminating. ref differs.
  const deps: Deployment[] = [
    mkDeployment('d-dev', 'dev', 'v1.0.0', '2026-01-01T08:00:00Z', { ref: 'feature/x' }),
    mkDeployment('d-qa',  'qa',  'v1.0.0', '2026-01-02T08:00:00Z', { ref: 'main' })
  ];
  // ref: feature/x, main → 2 groups of 1 each → no edges.

  it('uses ref as correlation key when sha+version not discriminating', () => {
    const result = buildDag('svc', deps);
    // Two different ref values → 2 groups of 1 → no edges.
    expect(result.edges.length).toBe(0);
  });

  it('chains within same ref group by timestamp', () => {
    const deps2: Deployment[] = [
      mkDeployment('d-dev', 'dev', 'v1.0.0', '2026-01-01T08:00:00Z', { ref: 'main' }),
      mkDeployment('d-qa',  'qa',  'v1.0.0', '2026-01-02T08:00:00Z', { ref: 'main' })
    ];
    const result2 = buildDag('svc', deps2);
    expect(result2.edges.length).toBe(1);
    expect(result2.edges[0].data.source).toBe('correlated');
  });
});

// ---- enumeratePaths: linear DAG -------------------------------------------

describe('enumeratePaths — linear (1 path)', () => {
  it('returns exactly 1 path for a simple chain', () => {
    const { nodes, edges } = buildDag('svc', [
      mkDeployment('d-dev', 'dev', 'v1', '2026-01-01T00:00:00Z'),
      mkDeployment('d-qa',  'qa',  'v1', '2026-01-02T00:00:00Z')
    ]);
    // both same version → single group → 1 edge dev→qa
    const result = enumeratePaths(nodes, edges);
    expect(result.paths.length).toBe(1);
    expect(result.overflowCount).toBe(0);
    expect(result.totalCount).toBe(1);
  });
});

// ---- enumeratePaths: simple fork (2 paths) ---------------------------------

describe('enumeratePaths — simple fork (2 paths)', () => {
  it('returns 2 paths for a dev→qa + dev→qahotfix fork', () => {
    const { nodes, edges } = buildDag('svc', [
      mkDeployment('d-dev',      'dev',      'v2', '2026-01-01T00:00:00Z'),
      mkDeployment('d-qa',       'qa',       'v2', '2026-01-02T00:00:00Z', { parentDeployments: ['d-dev'] }),
      mkDeployment('d-qahotfix', 'qahotfix', 'v2', '2026-01-02T01:00:00Z', { parentDeployments: ['d-dev'] })
    ]);
    const result = enumeratePaths(nodes, edges);
    expect(result.paths.length).toBe(2);
    expect(result.overflowCount).toBe(0);
    expect(result.totalCount).toBe(2);
  });
});

// ---- enumeratePaths: nested fork (≥3 paths) --------------------------------

describe('enumeratePaths — nested fork (≥3 paths)', () => {
  // dev → qa → uat (path 1)
  //           → qahotfix (path 2)
  //      → prod (path 3)  [separate fork from dev]
  it('returns 3+ paths for a nested fork', () => {
    const { nodes, edges } = buildDag('svc', [
      mkDeployment('d-dev',      'dev',      'v3', '2026-01-01T00:00:00Z'),
      mkDeployment('d-qa',       'qa',       'v3', '2026-01-02T00:00:00Z', { parentDeployments: ['d-dev'] }),
      mkDeployment('d-qahotfix', 'qahotfix', 'v3', '2026-01-02T01:00:00Z', { parentDeployments: ['d-dev'] }),
      mkDeployment('d-uat',      'uat',      'v3', '2026-01-03T00:00:00Z', { parentDeployments: ['d-qa'] }),
      mkDeployment('d-prod',     'prod',     'v3', '2026-01-03T01:00:00Z', { parentDeployments: ['d-qa'] })
    ]);
    // Paths: dev→qa→uat, dev→qa→prod, dev→qahotfix
    const result = enumeratePaths(nodes, edges);
    expect(result.paths.length).toBeGreaterThanOrEqual(3);
    expect(result.totalCount).toBeGreaterThanOrEqual(3);
  });
});

// ---- enumeratePaths: cap-overflow (≥9 paths → top-8 + overflow count) ------

describe('enumeratePaths — cap-overflow (9+ paths → 8 returned + overflow)', () => {
  it('caps at 8 and reports overflow count', () => {
    // Create a 1-root, 9-leaf fan-out: dev → [qa1..qa9] (using env ids as proxies).
    // We will use parentDeployments to express the fan.
    // env names: we use dev + 9 made-up envs (will get rank=ENV_ORDER.length).
    const leafIds = Array.from({ length: 9 }, (_, i) => `d-leaf${i}`);
    const leafDeps: Deployment[] = leafIds.map((id, i) => ({
      id,
      env: { id: `env${i}`, label: `ENV${i}` },
      version: 'v1',
      sha: null,
      ref: null,
      status: 'success' as const,
      timestamp: `2026-01-0${(i + 2).toString().padStart(2, '0')}T00:00:00Z`,
      parentDeployments: ['d-root']
    }));
    const allDeps: Deployment[] = [
      {
        id: 'd-root',
        env: { id: 'dev', label: 'DEV' },
        version: 'v1',
        sha: null,
        ref: null,
        status: 'success',
        timestamp: '2026-01-01T00:00:00Z'
        // no parentDeployments → root
      },
      ...leafDeps
    ];
    const { nodes, edges } = buildDag('svc', allDeps);
    // 9 leaf paths from root
    const result = enumeratePaths(nodes, edges, 8);
    expect(result.paths.length).toBe(8);
    expect(result.overflowCount).toBe(1);
    expect(result.totalCount).toBe(9);
  });
});

// ---- enumeratePaths: most-recent path is first -----------------------------

describe('enumeratePaths — ranking by max timestamp', () => {
  it('most-recently-updated path appears first', () => {
    // dev→qa (qa updated 2026-01-02) and dev→qahotfix (qahotfix updated 2026-01-03).
    // Expected: dev→qahotfix path first.
    const { nodes, edges } = buildDag('svc', [
      mkDeployment('d-dev',      'dev',      'v1', '2026-01-01T00:00:00Z'),
      mkDeployment('d-qa',       'qa',       'v1', '2026-01-02T00:00:00Z', { parentDeployments: ['d-dev'] }),
      mkDeployment('d-qahotfix', 'qahotfix', 'v1', '2026-01-03T00:00:00Z', { parentDeployments: ['d-dev'] })
    ]);
    const result = enumeratePaths(nodes, edges);
    expect(result.paths.length).toBe(2);
    // First path should contain the qahotfix node (most recent max ts).
    const firstPath = result.paths[0];
    const qahNode = nodes.find(n => n.data.envId === 'qahotfix')!;
    expect(firstPath).toContain(qahNode.id);
  });
});
