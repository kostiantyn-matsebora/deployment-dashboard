// Implements testing/e2e/scenarios/spa-visual-invariants.md
//
// Ports the six geometric invariants from
// testing/mockup-visual/mockup-invariants.spec.ts to the live Angular
// SPA. Iterates the 12 (view, layout) combinations declared in
// testing/e2e/spa-invariants.config.json. Per CLAUDE.md
// "Configuration vs. data": no URLs, selectors, or tolerances live as
// literals in this file - they're in the JSON config.
//
// Citations:
// - docs/architecture.md §5 NFR-09 (the six
//   invariants and the Glance-only exception).
// - docs/architecture.md §7 "Mockup <-> Angular
//   SPA bridge" - the SPA must pass the same six invariants the
//   mockup harness already validates.
// - testing/mockup-visual/mockup-invariants.spec.ts - source of truth
//   for the invariant logic; this spec is its SPA twin.

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

type Rect = { left: number; right: number; top: number; bottom: number };

type InvariantViolation = {
  invariantId: string;
  message: string;
  details?: unknown;
};

// Load the declarative config so the spec body stays thin.
const CONFIG_PATH = path.resolve(__dirname, '..', 'spa-invariants.config.json');
type HarnessConfig = {
  tolerances: {
    boxContentClipPx: number;
    connectorReachPx: number;
    envTagSubpixelPx: number;
    connectorSourceEmergePx: number;
    envTagConnectorCrossPx: number;
  };
  views: string[];
  layouts: string[];
  viewExceptions?: Record<string, Record<string, { enabled?: boolean }>>;
};
const harnessConfig: HarnessConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

function evaluateInvariantsScript(view: string): string {
  // Identical structure to testing/mockup-visual/mockup-invariants.spec.ts.
  // We pass per-view exception flags via baked-in literals so the
  // function body shipped to the browser is self-contained.
  const viewExceptions = harnessConfig.viewExceptions ?? {};
  const exceptionsForView = viewExceptions[view] ?? {};
  const allowPairedEnvTagInsidePairedBox = !!(
    exceptionsForView['I1-paired-envtag-inside-paired-box'] &&
    exceptionsForView['I1-paired-envtag-inside-paired-box'].enabled
  );
  return `(() => {
    const TOL = ${JSON.stringify(harnessConfig.tolerances)};
    const ALLOW_PAIRED_ENVTAG_INSIDE_PAIRED_BOX = ${JSON.stringify(allowPairedEnvTagInsidePairedBox)};
    const VIEW_ID = ${JSON.stringify(view)};

    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const intersect = (a, b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const intersectAmount = (a, b) => {
      const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return { dx, dy };
    };
    const describeBox = (el) => {
      const tid = el.getAttribute('data-testid');
      return tid ? tid : (el.tagName.toLowerCase());
    };

    const violations = [];
    const push = (id, message, details) => violations.push({ invariantId: id, message, details });

    const boxes = Array.from(document.querySelectorAll("[data-testid^='stage-box-']"));
    const envTags = Array.from(document.querySelectorAll('.env-tag'));
    const arrowLines = Array.from(document.querySelectorAll('.arrow-line'));
    const svgPaths = Array.from(document.querySelectorAll('svg.edge-overlay path.edge'));

    // ---- I1 - no overlap: env-tag vs deployment box (Glance exception applies) ----
    for (const tag of envTags) {
      const tagRect = rectOf(tag);
      const tagText = (tag.textContent || '').trim();
      const pair = tag.closest('.leaf-pair');
      const pairedBox = pair ? pair.querySelector("[data-testid^='stage-box-']") : null;
      for (const box of boxes) {
        const boxRect = rectOf(box);
        if (intersect(tagRect, boxRect)) {
          const { dx, dy } = intersectAmount(tagRect, boxRect);
          const isPaired = box === pairedBox;
          if (isPaired && ALLOW_PAIRED_ENVTAG_INSIDE_PAIRED_BOX) continue;
          push('I1-no-overlap-envtag-vs-box',
            isPaired
              ? \`Env-tag '\${tagText}' overlaps its OWN paired box \${describeBox(box)} by \${dx.toFixed(1)}x\${dy.toFixed(1)} px.\`
              : \`Env-tag '\${tagText}' overlaps unrelated box \${describeBox(box)} by \${dx.toFixed(1)}x\${dy.toFixed(1)} px.\`,
            { tagText, boxTestid: describeBox(box), dx, dy, paired: isPaired, view: VIEW_ID });
        }
      }
    }

    // ---- I2 - env-tag text is not clipped ----
    for (const tag of envTags) {
      const tagText = (tag.textContent || '').trim();
      const overflowX = tag.scrollWidth - tag.clientWidth;
      if (overflowX > TOL.envTagSubpixelPx) {
        push('I2-envtag-not-clipped',
          \`Env-tag '\${tagText}' is clipped: scrollWidth(\${tag.scrollWidth}) > clientWidth(\${tag.clientWidth}) by \${overflowX} px.\`,
          { tagText, scrollWidth: tag.scrollWidth, clientWidth: tag.clientWidth });
      }
    }

    // ---- helpers for I3 / I4 / I5 - connector geometry ----
    //
    // HARDENED RESOLVER (same logic as mockup-invariants.spec.ts after
    // the false-pass fix): never silently skip a rendered .arrow-line
    // because its ancestor chain lacks data-arrow-target. Resolution
    // order: (1) explicit data-target/data-source on the wrapper,
    // (2) data-arrow-target (current pattern), (3) geometry. Source /
    // target candidates are STRICTLY box elements (stage-box / .node /
    // .pill) - never .leaf-pair, which extends past the box.
    function findEnclosingRow(line) {
      // Under Focus the lane-row / workflow-rows section's primary
      // data-testid flips to row-collapsed-{id} / row-expanded-{id};
      // the legacy testids still exist as sr-only alias spans but they
      // are siblings of the arrow-line wrapper, not ancestors, so
      // closest() never matches them. Add the Focus-grade anchors so
      // row resolution works in Focus too.
      return line.closest('[data-service-row]')
        || line.closest('[data-testid^="swim-lane-row-"]')
        || line.closest('[data-testid^="workflow-rows-"]')
        || line.closest('[data-testid^="row-collapsed-"]')
        || line.closest('[data-testid^="row-expanded-"]')
        || line.ownerDocument.body;
    }
    function nearestBoxByEdgeDirectional(row, edge, x, y, requireDirection, exclude) {
      const candidates = Array.from(row.querySelectorAll("[data-testid^='stage-box-'], .node, .pill"));
      let best = null, bestDelta = Infinity;
      for (const el of candidates) {
        if (exclude && el === exclude) continue;
        const r = el.getBoundingClientRect();
        if (y < r.top - 200 || y > r.bottom + 200) continue;
        if (edge === 'left' && requireDirection && r.left < x - 1) continue;
        if (edge === 'right' && requireDirection && r.right > x + 1) continue;
        const d = Math.abs((edge === 'right' ? r.right : r.left) - x);
        if (d < bestDelta) { bestDelta = d; best = el; }
      }
      return best;
    }
    function cssLineConnectors() {
      const out = [];
      for (const line of arrowLines) {
        const lineRect = rectOf(line);
        // Skip non-rendered (display:none / zero-area) connectors.
        if (lineRect.right - lineRect.left === 0 && lineRect.bottom - lineRect.top === 0) continue;
        const cs = getComputedStyle(line);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const wrapper = line.parentElement;
        if (wrapper) {
          const wcs = getComputedStyle(wrapper);
          if (wcs.display === 'none' || wcs.visibility === 'hidden') continue;
        }
        const row = findEnclosingRow(line);

        let target = null;
        let source = null;
        let targetTestid = null;
        const explicitTarget = wrapper ? wrapper.getAttribute('data-target') : null;
        const explicitSource = wrapper ? wrapper.getAttribute('data-source') : null;
        if (explicitTarget) {
          target = row.querySelector(\`[data-testid='\${explicitTarget}']\`);
          targetTestid = explicitTarget;
        }
        if (explicitSource) {
          source = row.querySelector(\`[data-testid='\${explicitSource}']\`);
        }
        let declaredTargetTestid = null;
        if (!target) {
          const arrowTarget = wrapper ? wrapper.getAttribute('data-arrow-target') : null;
          if (arrowTarget) {
            declaredTargetTestid = arrowTarget;
            target = row.querySelector(\`[data-testid='\${arrowTarget}']\`);
            if (target) targetTestid = arrowTarget;
          }
        }
        if (declaredTargetTestid && !target) {
          // Target env has no deployment - this is a stub connector
          // into a placeholder cell. Don't measure.
          continue;
        }
        const lineMidY = (lineRect.top + lineRect.bottom) / 2;
        if (!target) {
          target = nearestBoxByEdgeDirectional(row, 'left', lineRect.right + 6, lineMidY, true);
          if (target) targetTestid = target.getAttribute('data-testid') || '<geometry-resolved>';
        }
        if (!source) {
          source = nearestBoxByEdgeDirectional(row, 'right', lineRect.left, lineMidY, true, target);
        }
        if (!target) {
          push('I0-connector-orphan-no-target',
            \`SPA .arrow-line could not be resolved to any target box - no data-target / data-arrow-target on its wrapper, and no nearby stage-box within the enclosing row. This is the false-pass case the oracle was tightened to catch.\`,
            { lineRect, wrapperAttrs: wrapper ? Array.from(wrapper.attributes).map((a) => \`\${a.name}=\${a.value}\`) : [] });
          continue;
        }
        out.push({ kind: 'css', line, lineRect, target, targetRect: rectOf(target), source, sourceRect: source ? rectOf(source) : null, targetTestid });
      }
      return out;
    }
    function svgConnectors() {
      const out = [];
      for (const pathEl of svgPaths) {
        const d = pathEl.getAttribute('d') || '';
        const cmds = d.match(/[ML]\\s*-?\\d+(?:\\.\\d+)?\\s+-?\\d+(?:\\.\\d+)?/g) || [];
        if (cmds.length < 2) continue;
        const pts = cmds.map((c) => {
          const m = c.match(/([ML])\\s*(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)/);
          return m ? { cmd: m[1], x: parseFloat(m[2]), y: parseFloat(m[3]) } : null;
        }).filter(Boolean);
        if (pts.length < 2) continue;
        const svg = pathEl.closest('svg');
        if (!svg) continue;
        const svgRect = svg.getBoundingClientRect();
        const start = { x: svgRect.left + pts[0].x, y: svgRect.top + pts[0].y };
        const end = { x: svgRect.left + pts[pts.length - 1].x, y: svgRect.top + pts[pts.length - 1].y };
        const segments = [];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const r = {
            left: svgRect.left + Math.min(a.x, b.x) - 1,
            right: svgRect.left + Math.max(a.x, b.x) + 1,
            top: svgRect.top + Math.min(a.y, b.y) - 1,
            bottom: svgRect.top + Math.max(a.y, b.y) + 1,
          };
          segments.push(r);
        }
        out.push({ kind: 'svg', pathEl, d, start, end, segments });
      }
      return out;
    }
    const cssConns = cssLineConnectors();
    const svgConns = svgConnectors();

    // ---- I3 - connector reaches its target ----
    for (const c of cssConns) {
      const tip = c.lineRect.right + 6;
      const delta = tip - c.targetRect.left;
      if (Math.abs(delta) > TOL.connectorReachPx) {
        push('I3-connector-reaches-target',
          \`CSS connector to \${c.targetTestid} is \${delta > 0 ? 'overshooting' : 'short of'} target by \${Math.abs(delta).toFixed(1)} px.\`,
          { targetTestid: c.targetTestid, tip, targetLeft: c.targetRect.left, delta });
      }
    }
    for (const c of svgConns) {
      const row = c.pathEl.closest('[data-service-row]');
      if (!row) continue;
      const candidates = Array.from(row.querySelectorAll("[data-testid^='stage-box-'], .node, .pill"));
      let best = null, bestDelta = Infinity;
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.left - c.end.x);
        if (d < bestDelta) { bestDelta = d; best = el; }
      }
      if (bestDelta > TOL.connectorReachPx && best) {
        const targetDesc = best.getAttribute('data-testid') || best.className || 'unknown';
        push('I3-connector-reaches-target',
          \`SVG connector terminus is \${bestDelta.toFixed(1)} px off the nearest box left.\`,
          { end: c.end, bestDelta, targetDesc });
      }
    }

    // ---- I4 - connector emerges from source ----
    for (const c of cssConns) {
      if (!c.sourceRect) continue;
      if (c.lineRect.left < c.sourceRect.right - TOL.connectorSourceEmergePx) {
        push('I4-connector-emerges-from-source',
          \`CSS connector starts \${(c.sourceRect.right - c.lineRect.left).toFixed(1)} px LEFT of source's right edge.\`,
          { leftEdge: c.lineRect.left, sourceRight: c.sourceRect.right });
      }
    }
    for (const c of svgConns) {
      const row = c.pathEl.closest('[data-service-row]');
      if (!row) continue;
      const candidates = Array.from(row.querySelectorAll("[data-testid^='stage-box-'], .node, .pill"));
      let best = null, bestDelta = Infinity;
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.right - c.start.x);
        if (d < bestDelta) { bestDelta = d; best = el; }
      }
      if (bestDelta > TOL.connectorSourceEmergePx && best) {
        push('I4-connector-emerges-from-source',
          \`SVG connector start is \${bestDelta.toFixed(1)} px off the nearest box right edge.\`,
          { start: c.start, bestDelta });
      }
    }

    // ---- I5 - connector does not cross any env-tag rect ----
    for (const c of cssConns) {
      const drawnRect = { left: c.lineRect.left, right: c.lineRect.right + 6, top: c.lineRect.top, bottom: c.lineRect.bottom };
      for (const tag of envTags) {
        const tagRect = rectOf(tag);
        if (intersect(drawnRect, tagRect)) {
          const { dx, dy } = intersectAmount(drawnRect, tagRect);
          if (dx > TOL.envTagConnectorCrossPx && dy > TOL.envTagConnectorCrossPx) {
            push('I5-connector-does-not-cross-envtag',
              \`CSS connector to \${c.targetTestid} crosses env-tag '\${(tag.textContent || '').trim()}' by \${dx.toFixed(1)}x\${dy.toFixed(1)} px.\`,
              { targetTestid: c.targetTestid, dx, dy });
          }
        }
      }
    }
    for (const c of svgConns) {
      for (const seg of c.segments) {
        for (const tag of envTags) {
          const tagRect = rectOf(tag);
          if (intersect(seg, tagRect)) {
            const { dx, dy } = intersectAmount(seg, tagRect);
            if (dx > TOL.envTagConnectorCrossPx && dy > TOL.envTagConnectorCrossPx) {
              push('I5-connector-does-not-cross-envtag',
                \`SVG connector segment crosses env-tag '\${(tag.textContent || '').trim()}' by \${dx.toFixed(1)}x\${dy.toFixed(1)} px.\`,
                { dx, dy });
            }
          }
        }
      }
    }

    // ---- I6 - box content stays within parent box ----
    for (const box of boxes) {
      const boxRect = rectOf(box);
      const tid = box.getAttribute('data-testid');
      const tw = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.textContent && n.textContent.trim().length > 0) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      });
      let n;
      while ((n = tw.nextNode())) {
        const parent = n.parentElement;
        if (!parent) continue;
        const parentDisplay = getComputedStyle(parent).display;
        if (parentDisplay === 'none') continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (range.detach) range.detach();
        if (r.width === 0 && r.height === 0) continue;
        const tol = TOL.boxContentClipPx;
        if (r.left < boxRect.left - tol ||
            r.right > boxRect.right + tol ||
            r.top < boxRect.top - tol ||
            r.bottom > boxRect.bottom + tol) {
          push('I6-box-content-not-clipped',
            \`Text inside \${tid} escapes the box: text=(\${r.left.toFixed(1)},\${r.top.toFixed(1)},\${r.right.toFixed(1)},\${r.bottom.toFixed(1)}) box=(\${boxRect.left.toFixed(1)},\${boxRect.top.toFixed(1)},\${boxRect.right.toFixed(1)},\${boxRect.bottom.toFixed(1)}) text='\${(n.textContent || '').trim().slice(0, 40)}'.\`,
            { boxTestid: tid });
        }
      }
    }

    return { violations };
  })()`;
}

test.describe('SPA visual invariants - 12 (view, layout) combinations', () => {
  for (const view of harnessConfig.views) {
    for (const layout of harnessConfig.layouts) {
      test(`${view} x ${layout}`, async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        await page.getByTestId(`view-option-${view}`).click();
        await page.getByTestId(`layout-option-${layout}`).click();

        await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', view);
        await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', layout);

        // Settle: at least one stage box visible, then two paint frames
        // for sub-pixel rounding + connector geometry recompute.
        await page.locator("[data-testid^='stage-box-']").first().waitFor({ state: 'visible', timeout: 10_000 });
        await page.evaluate(
          () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );

        const evaluated = (await page.evaluate(evaluateInvariantsScript(view))) as {
          violations: InvariantViolation[];
        };

        // Soft assertions so every combination runs even if earlier ones
        // fail - we want the full violations report on every invocation.
        expect
          .soft(
            evaluated.violations,
            `(${view} x ${layout}) invariant violations:\n${evaluated.violations
              .map((v) => `  - [${v.invariantId}] ${v.message}`)
              .join('\n')}`,
          )
          .toEqual([]);
      });
    }
  }
});
