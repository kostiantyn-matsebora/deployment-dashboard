// Implements testing/e2e/scenarios/swim-lane-connectors.md
//
// Validates FR-13 Swim-lane connector geometry for the seeded
// `topo-explicit` service (dev -> qa -> prod, both explicit edges).
// The check is intentionally narrow: for each expected (from, to)
// edge from the matrix API, find the corresponding env nodes in the
// rendered swim-lane and assert that a connector starts at the
// source's right edge and ends at the target's left edge within
// ±2 px (same tolerance as the mockup-visual harness).

import { test, expect } from '@playwright/test';
import { READ_BASE_URL } from './support/env';

const TOPO_SERVICE = 'topo-explicit';
const REACH_TOLERANCE_PX = 2;

type Edge = { from: string; to: string; source: 'explicit' | 'correlated' };

async function fetchEdges(service: string): Promise<Edge[]> {
  const resp = await fetch(`${READ_BASE_URL}/api/deployments`);
  if (!resp.ok) throw new Error(`GET /api/deployments returned ${resp.status}`);
  const matrix = (await resp.json()) as Record<string, { topology?: { edges?: Edge[] } }>;
  const svc = matrix[service];
  if (!svc) throw new Error(`Matrix missing service '${service}' - run testing/scripts/seed.ps1`);
  return svc.topology?.edges ?? [];
}

test('Swim-lane connectors anchor to env-node edges for topo-explicit', async ({ page }) => {
  const expectedEdges = await fetchEdges(TOPO_SERVICE);
  expect(expectedEdges.length).toBeGreaterThanOrEqual(2);

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByTestId('layout-option-swim-lane').click();
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', 'swim-lane');

  // Wait for swim-lane SVG overlays to size themselves AND for the
  // component's queueMicrotask -> requestAnimationFrame recompute
  // pipeline to have populated `edgePaths`. Two rAF ticks aren't
  // always enough on a cold paint - we poll for the actual
  // `path.edge` elements to materialise instead. NFR-09 sets the
  // 5 s upper bound; we use 5 s here too.
  await page.waitForSelector(`[data-service-row="${TOPO_SERVICE}"]`, { timeout: 10_000 });
  await page.waitForFunction(
    (service) => {
      const row = document.querySelector(`[data-service-row="${service}"]`);
      if (!row) return false;
      const svg = row.querySelector('svg.edge-overlay');
      if (!svg) return false;
      const w = parseFloat(svg.getAttribute('width') ?? '0');
      const paths = row.querySelectorAll('path.edge');
      return w > 0 && paths.length > 0;
    },
    TOPO_SERVICE,
    { timeout: 5_000 },
  );

  // For each expected edge, ask the page whether a connector exists
  // whose geometry reaches both endpoints. We accept either an SVG
  // path inside `svg.edge-overlay` or a CSS-line connector (same
  // structure the mockup harness already understands).
  const violations: string[] = await page.evaluate(
    ({ service, edges, tol }: { service: string; edges: Edge[]; tol: number }) => {
      const out: string[] = [];
      const row = document.querySelector(`[data-service-row="${service}"]`);
      if (!row) {
        out.push(`No row found for service '${service}'.`);
        return out;
      }

      function nodeRectFor(env: string): DOMRect | null {
        // Anchor on the inner stage-box, NEVER the env-tag wrapper.
        // The `.leaf-pair` wrapper (`[data-env]`) appears first in DOM
        // order, so querySelector with a comma list would return the
        // wrapper and the rects would be off by ~28 px. SAD §"Topology
        // Derivation" + mockup invariant "Anchor on the inner box,
        // never the env-tag wrapper".
        const box = row!.querySelector(
          `[data-testid='stage-box-${service}-${env}']`,
        ) as HTMLElement | null;
        return box ? box.getBoundingClientRect() : null;
      }

      function parsePathEndpoints(d: string): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
        const cmds = d.match(/[ML]\s*-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/g);
        if (!cmds || cmds.length < 2) return null;
        const pts = cmds
          .map((c) => {
            const m = c.match(/([ML])\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
            return m ? { cmd: m[1], x: parseFloat(m[2]), y: parseFloat(m[3]) } : null;
          })
          .filter((p): p is { cmd: string; x: number; y: number } => p !== null);
        if (pts.length < 2) return null;
        return { start: { x: pts[0].x, y: pts[0].y }, end: { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y } };
      }

      for (const edge of edges) {
        const srcRect = nodeRectFor(edge.from);
        const tgtRect = nodeRectFor(edge.to);
        if (!srcRect || !tgtRect) {
          out.push(`Missing env node(s) for edge ${edge.from} -> ${edge.to} (src=${!!srcRect}, tgt=${!!tgtRect}).`);
          continue;
        }

        // Find any path whose start is near srcRect.right and end is
        // near tgtRect.left. The SVG itself overlays the row, so SVG-
        // space x maps to row-space x after adding svgRect.left.
        const overlays = Array.from(row.querySelectorAll('svg.edge-overlay')) as SVGElement[];
        let matched = false;
        const observed: { startX: number; endX: number }[] = [];
        for (const svg of overlays) {
          const svgRect = svg.getBoundingClientRect();
          const paths = Array.from(svg.querySelectorAll('path.edge')) as SVGPathElement[];
          for (const p of paths) {
            const d = p.getAttribute('d') || '';
            const ends = parsePathEndpoints(d);
            if (!ends) continue;
            const startX = svgRect.left + ends.start.x;
            const endX = svgRect.left + ends.end.x;
            observed.push({ startX, endX });
            if (Math.abs(startX - srcRect.right) <= tol && Math.abs(endX - tgtRect.left) <= tol) {
              matched = true;
              break;
            }
          }
          if (matched) break;
        }
        if (!matched) {
          const obs = observed
            .map((o) => `[${o.startX.toFixed(1)}->${o.endX.toFixed(1)}]`)
            .join(' ');
          out.push(
            `No connector geometry within ${tol} px matches edge ${edge.from} (right=${srcRect.right.toFixed(
              1,
            )}) -> ${edge.to} (left=${tgtRect.left.toFixed(1)}). Observed paths: ${obs || '(none)'}`,
          );
        }
      }
      return out;
    },
    { service: TOPO_SERVICE, edges: expectedEdges, tol: REACH_TOLERANCE_PX },
  );

  expect(violations, `Swim-lane connector violations:\n${violations.map((v) => '  - ' + v).join('\n')}`).toEqual([]);
});
