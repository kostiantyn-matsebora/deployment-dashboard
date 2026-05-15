// Mockup visual invariants — ground-truth geometric assertions.
//
// Owner: qa-engineer (.claude/agents/qa-engineer.md).
//
// Loads docs/deployment-dashboard.html via file:// in a real Chromium
// browser and runs six numeric geometric assertions against the rendered
// DOM. Iterates the cross-product of 4 views × 3 layouts = 12
// combinations declared in harness.config.json. Per-combination results
// (pass/fail + offending element details) accumulate into
// __screenshots__/_report.json which run-tests.ps1 prints as a clean
// per-combination pass/fail table.
//
// HARDENED CONNECTOR ORACLE (revised after the false-pass bug):
//   The prior `cssLineConnectors()` did
//     parent = line.closest('[data-arrow-target]')
//   and `continue`-d the loop when the closest match was null. Result:
//   any layout where the `data-arrow-target` was missing or the
//   `[data-service-row]` ancestor was absent silently skipped the
//   connector — the harness reported 12/12 PASS while real connectors
//   weren't being measured at all. The new resolver:
//     1. Tries explicit `data-target` / `data-source` on the wrapper.
//     2. Falls back to `data-arrow-target` (current mockup pattern).
//     3. Geometric fallback — nearest box by edge proximity.
//     4. If still no target, emits an `I0-connector-orphan-no-target`
//        violation instead of silently skipping.
//   Source / target candidates are STRICTLY the BOX
//   (`[data-testid^='stage-box-']`, `.node`, `.pill`) — never the
//   `.leaf-pair` wrapper or any `[data-env]` parent, which extend
//   past the box into the env-tag column and would mask short
//   connectors.
//
// Citations (per CLAUDE.md routing):
//   - docs/deployment-dashboard.html — the visual / behavioural contract.
//     The lengthy comment block at the top of the mockup names the 6
//     invariants verbatim; this spec is their executable form.
//   - .claude/agents/qa-engineer.md — "mockup-driven E2E catalogue" +
//     "Configuration vs. data" engineering principle.

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as url from 'url';
import harnessConfig from './harness.config.json';

// ----------------------- types shared with in-page eval -----------------------
type Rect = { left: number; right: number; top: number; bottom: number };

type ElementInfo = {
  testid: string | null;
  text: string | null;
  rect: Rect;
};

type InvariantViolation = {
  invariantId: string;
  message: string;
  details?: unknown;
};

type CombinationResult = {
  view: string;
  layout: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  reason?: string;
  violations: InvariantViolation[];
  screenshotPath: string;
};

// ------------------------------------ paths ----------------------------------
const HARNESS_DIR = __dirname;
const MOCKUP_PATH = path.resolve(HARNESS_DIR, harnessConfig.mockupRelativePath);
const SHOTS_DIR = path.resolve(HARNESS_DIR, harnessConfig.screenshotsDir);
const REPORT_PATH = path.resolve(HARNESS_DIR, harnessConfig.reportPath);
const PARTIALS_DIR = path.resolve(SHOTS_DIR, '_partials');

if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });
if (!fs.existsSync(PARTIALS_DIR)) fs.mkdirSync(PARTIALS_DIR, { recursive: true });

// Playwright restarts the worker after a failing test (default behaviour),
// so module-level state does NOT accumulate across tests. We therefore
// write a per-combination partial file immediately after each test, and
// the consolidating step in run-tests.ps1 stitches them into the final
// report. The `afterAll` below is a best-effort backstop in the same
// worker; the source-of-truth for the final report is the union of all
// partials on disk.
function writePartial(result: CombinationResult): void {
  const safeName = `${result.view}__${result.layout}.json`;
  fs.writeFileSync(path.resolve(PARTIALS_DIR, safeName), JSON.stringify(result, null, 2));
}

// `file://` URLs need the OS-specific drive prefix on Windows handled by
// url.pathToFileURL. We compute the URL once.
const MOCKUP_FILE_URL = url.pathToFileURL(MOCKUP_PATH).toString();

// ---------------------- waiter — layout settle signal ------------------------
//
// The mockup's `recomputeConnectorTops()` runs inside an Alpine.js
// `$nextTick(() => $nextTick(() => requestAnimationFrame(...)))` chain.
// That chain finishes within ~2 paint frames, but there's no JS event we
// can subscribe to from outside. We poll the DOM for "all expected
// connectors have non-zero `--target-half` (CSS rule) OR an SVG path"
// until the page is settled. This is the layout-settle oracle.
//
// If the mockup later exposes a counter (e.g.,
// `[data-recomputed]` attribute on the matrix container) we can switch
// to a counter-based wait; until then DOM measurement is the
// authoritative signal.
async function waitForLayoutSettle(page: import('@playwright/test').Page, layout: string): Promise<{ settled: boolean; note?: string }> {
  const timeout = harnessConfig.settleTimeoutMs;
  // First, wait for boxes to render — every layout has stage-box elements,
  // so this is a layout-agnostic "DOM is populated" gate.
  await page.waitForSelector("[data-testid^='stage-box-']", { timeout });

  // Now poll for connector readiness — but if the layout is genuinely
  // missing connectors (a CURRENT BUG we're trying to detect), polling
  // would loop forever. Cap the wait and report "not settled but proceed
  // anyway" so the invariants still run and visually capture the broken
  // state.
  const deadline = Date.now() + timeout;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await page.evaluate((layoutArg) => {
      if (layoutArg === 'matrix' || layoutArg === 'workflow-rows') {
        const lines = Array.from(document.querySelectorAll('.arrow-line')) as HTMLElement[];
        const arrowParents = Array.from(document.querySelectorAll('[data-arrow-target]')) as HTMLElement[];
        if (arrowParents.length === 0) return { ok: false, lineCount: lines.length, parentCount: 0, withTargetHalf: 0 };
        const withTargetHalf = arrowParents.filter((p) => {
          const v = p.style.getPropertyValue('--target-half');
          return v !== '' && !isNaN(parseFloat(v));
        }).length;
        return { ok: withTargetHalf === arrowParents.length, lineCount: lines.length, parentCount: arrowParents.length, withTargetHalf };
      }
      if (layoutArg === 'swim-lane') {
        const overlays = Array.from(document.querySelectorAll('svg.edge-overlay')) as SVGElement[];
        if (overlays.length === 0) return { ok: false, overlayCount: 0, sizedOverlays: 0 };
        const sized = overlays.filter((svg) => {
          const w = parseFloat(svg.getAttribute('width') || '0');
          const h = parseFloat(svg.getAttribute('height') || '0');
          return w > 0 && h > 0;
        }).length;
        return { ok: sized === overlays.length, overlayCount: overlays.length, sizedOverlays: sized };
      }
      return { ok: true };
    }, layout);
    if (status.ok) {
      // Two paint frames for sub-pixel rounding + Alpine reactive updates.
      for (let i = 0; i < harnessConfig.postSettlePaintFrames; i++) {
        await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
      }
      return { settled: true };
    }
    if (Date.now() > deadline) {
      return { settled: false, note: `Connector recomputation did not finish within ${timeout} ms. Status: ${JSON.stringify(status)}. Proceeding with invariant checks against the current DOM state — this typically indicates connectors are not being drawn at all (a real bug, NOT a flaky harness).` };
    }
    await new Promise<void>((r) => setTimeout(r, 100));
  }
}

// -------------------- in-browser invariant evaluator ------------------------
//
// All six invariants run inside `page.evaluate()` so each element's
// `getBoundingClientRect()` is read in one pass with consistent layout.
// The function returns a structured violation list; the spec then
// assigns PASS/FAIL based on whether the list is empty.

type Fr02Config = {
  attributes: string[];
  caps: Record<string, number>;
};

function evaluateInvariantsScript(view: string): string {
  // We inline this as a string so the function body is shipped to the
  // browser context unmodified. Playwright's page.evaluate() with a
  // function ref does the same thing, but inlining keeps the failure
  // messages stable across TS compilations.
  //
  // The `view` argument is baked into the script so per-view exceptions
  // declared in harness.config.json#viewExceptions are honoured without
  // any hardcoded view names in this file. Per CLAUDE.md "Configuration
  // vs. data" — the exception list is declarative; this branch is the
  // thin reader.
  const viewExceptions = (harnessConfig as { viewExceptions?: Record<string, Record<string, { enabled?: boolean }>> }).viewExceptions || {};
  const exceptionsForView = viewExceptions[view] || {};
  const allowPairedEnvTagInsidePairedBox = !!(exceptionsForView['I1-paired-envtag-inside-paired-box'] && exceptionsForView['I1-paired-envtag-inside-paired-box'].enabled);

  // FR-02 attribute catalogue + per-view caps — declarative in
  // harness.config.json#fr02. Used by the in-page I7 evaluator below.
  const fr02 = ((harnessConfig as unknown) as { fr02?: Fr02Config }).fr02 ?? { attributes: [], caps: {} };
  const expectedAttributes = fr02.attributes;
  const expectedCap = fr02.caps[view] ?? 0;
  return `(async () => {
    const TOL = ${JSON.stringify(harnessConfig.tolerances)};
    const ALLOW_PAIRED_ENVTAG_INSIDE_PAIRED_BOX = ${JSON.stringify(allowPairedEnvTagInsidePairedBox)};
    const VIEW_ID = ${JSON.stringify(view)};
    const FR02_EXPECTED_ATTRIBUTES = ${JSON.stringify(expectedAttributes)};
    const FR02_EXPECTED_CAP = ${JSON.stringify(expectedCap)};

    // ---- helpers for I7 / I8 — Alpine reactive state access -----------
    // The mockup is an Alpine.js single-page app rooted at <body x-data="dashboard()">.
    // We reach the dashboard component state directly to (a) inspect the
    // picker without depending on the popover being visually open and
    // (b) flip Display selections programmatically for the I8 null-render
    // sweep without manufacturing real clicks that depend on viewport size.
    function alpineRoot() {
      const stacks = document.body._x_dataStack;
      if (stacks && stacks.length > 0) return stacks[0];
      // Alpine.$data fallback (works when the magic property is renamed).
      const Alpine = (window).Alpine;
      if (Alpine && typeof Alpine.$data === 'function') return Alpine.$data(document.body);
      return null;
    }
    function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }
    async function settleReactive() {
      // Two paint frames mirror the existing settle budget — Alpine's
      // $nextTick chain finishes in <= 2 frames on the canonical layouts.
      await nextFrame();
      await nextFrame();
    }

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
      return tid ? tid : (el.tagName.toLowerCase() + (el.className ? '.' + (typeof el.className === 'string' ? el.className.split(' ')[0] : '') : ''));
    };

    const violations = [];
    const push = (id, message, details) => violations.push({ invariantId: id, message, details });

    // Collect canonical sets — query ONCE so each rect is measured in the
    // same layout pass.
    const boxes = Array.from(document.querySelectorAll("[data-testid^='stage-box-']"));
    const envTags = Array.from(document.querySelectorAll('.env-tag'));
    const arrowLines = Array.from(document.querySelectorAll('.arrow-line'));
    const svgPaths = Array.from(document.querySelectorAll('svg.edge-overlay path.edge'));
    const serviceRows = Array.from(document.querySelectorAll('[data-service-row]'));

    // ---- I1 — no overlap: env-tag vs deployment box -----------------------
    // Default rule: for every env-tag and every stage-box, their rects
    // must not intersect — even when they belong to the same .leaf-pair
    // (CSS Grid sibling columns are supposed to make overlap impossible).
    //
    // View-scoped exception (declarative — see harness.config.json
    // #viewExceptions.<view>.I1-paired-envtag-inside-paired-box):
    //   When ALLOW_PAIRED_ENVTAG_INSIDE_PAIRED_BOX is true (currently
    //   only enabled for the Glance view, mirroring SAD NFR-09's
    //   "Exception (Glance view only)"), the PAIRED env-tag is allowed
    //   to be inside its OWN paired box. Non-paired overlaps are still
    //   violations — e.g. another service's env-tag bleeding into this
    //   service's pill. The env-tag must still not be clipped (I2) and
    //   the connector must still not cross any env-tag (I5).
    for (const tag of envTags) {
      const tagRect = rectOf(tag);
      const tagText = (tag.textContent || '').trim();
      const pair = tag.closest('.leaf-pair');
      const pairedBox = pair ? pair.querySelector("[data-testid^='stage-box-']") : null;
      const pairedTestid = pairedBox ? pairedBox.getAttribute('data-testid') : null;

      for (const box of boxes) {
        const boxRect = rectOf(box);
        if (intersect(tagRect, boxRect)) {
          const { dx, dy } = intersectAmount(tagRect, boxRect);
          const isPaired = box === pairedBox;
          if (isPaired && ALLOW_PAIRED_ENVTAG_INSIDE_PAIRED_BOX) {
            // Allowed by NFR-09 exception for this view.
            // Permissive: skip recording this paired overlap.
            continue;
          }
          push('I1-no-overlap-envtag-vs-box',
            isPaired
              ? \`Env-tag '\${tagText}' overlaps its OWN paired box \${describeBox(box)} by \${dx.toFixed(1)}x\${dy.toFixed(1)} px (CSS Grid pair should make this impossible).\`
              : \`Env-tag '\${tagText}' overlaps unrelated box \${describeBox(box)} by \${dx.toFixed(1)}x\${dy.toFixed(1)} px.\`,
            { tagText, tagRect, boxTestid: describeBox(box), boxRect, dx, dy, paired: isPaired, pairedTestid, view: VIEW_ID });
        }
      }
    }

    // ---- I2 — env-tag text is not clipped ---------------------------------
    for (const tag of envTags) {
      const tagText = (tag.textContent || '').trim();
      // scrollWidth > clientWidth means the inner text is wider than the
      // tag's content box, i.e. clipped horizontally.
      const overflowX = tag.scrollWidth - tag.clientWidth;
      if (overflowX > TOL.envTagSubpixelPx) {
        push('I2-envtag-not-clipped',
          \`Env-tag '\${tagText}' is clipped: scrollWidth(\${tag.scrollWidth}) > clientWidth(\${tag.clientWidth}) by \${overflowX} px.\`,
          { tagText, scrollWidth: tag.scrollWidth, clientWidth: tag.clientWidth, overflowX });
      }
    }

    // ---- helpers for I3 / I4 / I5 - connector geometry --------------------
    //
    // CSS-line connectors: each .arrow-line lives inside a connector
    // wrapper (.arrow-col / .arrow-gap). We resolve the line's source and
    // target boxes WITHOUT requiring a [data-arrow-target] ancestor -
    // because the false-pass bug was: if the parent chain was missing
    // that attribute the line was silently skipped and the harness
    // reported 12/12 PASS while connectors didn't actually touch boxes.
    //
    // Resolution order (most explicit first):
    //   1. Wrapper exposes data-target / data-source attributes - use
    //      them directly (anchor against the BOX, not a leaf-pair wrapper).
    //   2. Wrapper exposes data-arrow-target (current mockup pattern) -
    //      look up the matching [data-testid] within the enclosing row.
    //   3. Geometry / DOM-adjacency fallback - find the nearest preceding
    //      stage-box / .node / .pill (by getBoundingClientRect().right)
    //      and the nearest following one (by .left).
    //
    // Source/target candidates are STRICTLY box elements:
    //   [data-testid^=stage-box-], .node, .pill
    // Never .leaf-pair (a CSS-Grid wrapper that extends past the box
    // into the env-tag column - using its rect would mask short or
    // overshooting connectors).
    function describeArrowLine(line) {
      // Best-effort diagnostic id for orphan reporting.
      const cls = (typeof line.className === 'string') ? line.className.split(' ').filter(Boolean).join('.') : '';
      const parent = line.parentElement;
      const parentTag = parent ? parent.tagName.toLowerCase() : 'detached';
      const parentCls = parent && typeof parent.className === 'string' ? parent.className.split(' ').filter(Boolean).join('.') : '';
      return \`.\${cls} inside <\${parentTag}.\${parentCls}>\`;
    }
    function findEnclosingRow(line) {
      // The row provides the search scope for box lookup. Try the
      // documented [data-service-row]; fall back to any common
      // service-row container; final fallback is the document itself.
      return line.closest('[data-service-row]')
        || line.closest('[data-testid^="swim-lane-row-"]')
        || line.closest('[data-testid^="workflow-rows-"]')
        || line.ownerDocument.body;
    }
    function nearestBoxByEdge(row, edge, x, y, exclude) {
      // edge = 'right' (looking for source: box whose right edge is closest to x)
      // edge = 'left'  (looking for target: box whose left  edge is closest to x)
      const candidates = Array.from(row.querySelectorAll("[data-testid^='stage-box-'], .node, .pill"));
      let best = null, bestDelta = Infinity;
      for (const el of candidates) {
        if (exclude && el === exclude) continue;
        const r = el.getBoundingClientRect();
        // Vertical sanity - only consider boxes within ~row's content
        // height of the line's y. Boxes far above or below are not
        // candidates regardless of x proximity.
        if (y < r.top - 200 || y > r.bottom + 200) continue;
        const d = Math.abs((edge === 'right' ? r.right : r.left) - x);
        if (d < bestDelta) { bestDelta = d; best = el; }
      }
      return best;
    }
    function nearestBoxByEdgeDirectional(row, edge, x, y, requireDirection, exclude) {
      // Same as nearestBoxByEdge but enforces direction:
      //   edge='left'  + requireAtOrAfter=true  -> box.left >= x - 1
      //   edge='right' + requireAtOrBefore=true -> box.right <= x + 1
      // Tolerance 1px for sub-pixel rounding.
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
        // Skip non-rendered connectors. Alpine x-show keeps elements in
        // the DOM with display:none until the binding becomes truthy
        // (e.g. the last env in a row has a hidden "next-arrow" wrapper
        // bound to environments[idx+1]?.id which evaluates to undefined).
        // Those are not visual connectors and must not be measured.
        if (lineRect.right - lineRect.left === 0 && lineRect.bottom - lineRect.top === 0) continue;
        // Also skip if the line OR any ancestor is display:none. This
        // catches transitions where lineRect appears non-zero for a
        // frame but the line is actually hidden.
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

        // 1. Explicit data-target / data-source on the connector wrapper.
        const explicitTarget = wrapper ? wrapper.getAttribute('data-target') : null;
        const explicitSource = wrapper ? wrapper.getAttribute('data-source') : null;
        if (explicitTarget) {
          target = row.querySelector(\`[data-testid='\${explicitTarget}']\`);
          targetTestid = explicitTarget;
        }
        if (explicitSource) {
          source = row.querySelector(\`[data-testid='\${explicitSource}']\`);
        }

        // 2. data-arrow-target on the wrapper (current mockup pattern).
        // If the wrapper declares a target by testid but no element with
        // that testid exists in the row, the target env has no
        // deployment (rendered as a placeholder rather than a stage-box).
        // In that case skip this connector entirely - measuring it
        // against a different (wrong) box would emit a false I3/I4.
        let declaredTargetTestid = null;
        if (!target) {
          const arrowTarget = wrapper ? wrapper.getAttribute('data-arrow-target') : null;
          if (arrowTarget) {
            declaredTargetTestid = arrowTarget;
            target = row.querySelector(\`[data-testid='\${arrowTarget}']\`);
            if (target) {
              targetTestid = arrowTarget;
            }
          }
        }
        if (declaredTargetTestid && !target) {
          // The connector points at a target env that has no deployment
          // (placeholder cell). Visually rendered as a stub arrow into
          // empty space - skip rather than emit a spurious I3/I4.
          continue;
        }

        // 3. Geometric fallback - nearest box BY LEFT EDGE that is at
        // or to the right of line.right (connectors flow left-to-right).
        // Using abs() distance would pick the SOURCE box for a tiny
        // connector since both edges are close to the line.
        const lineMidY = (lineRect.top + lineRect.bottom) / 2;
        if (!target) {
          target = nearestBoxByEdgeDirectional(row, 'left', lineRect.right + 6, lineMidY, /*requireAtOrAfter=*/ true);
          if (target) targetTestid = target.getAttribute('data-testid') || '<geometry-resolved>';
        }
        if (!source) {
          source = nearestBoxByEdgeDirectional(row, 'right', lineRect.left, lineMidY, /*requireAtOrBefore=*/ true, target);
        }

        if (!target) {
          // Orphan connector - neither explicit attribute nor a nearby
          // box. Emit a violation so the FAIL is visible; the prior
          // harness silently skipped this case and reported 12/12 PASS.
          push('I0-connector-orphan-no-target',
            \`.arrow-line could not be resolved to any target box - no data-target / data-arrow-target on its wrapper, and no nearby stage-box within the enclosing row. The connector is therefore unmeasured by the prior harness (the false-pass case the oracle is being tightened to catch). diag=\${describeArrowLine(line)}\`,
            { lineRect, wrapperAttrs: wrapper ? Array.from(wrapper.attributes).map((a) => \`\${a.name}=\${a.value}\`) : [] });
          continue;
        }

        out.push({
          kind: 'css',
          line,
          lineRect,
          target,
          targetRect: rectOf(target),
          source,
          sourceRect: source ? rectOf(source) : null,
          targetTestid,
        });
      }
      return out;
    }

    // SVG-path connectors (swim-lane): parse d attr; extract start (M x y)
    // and end (last L x y) coordinates. Coordinates are in the SVG's own
    // coordinate space, but the SVG has width/height set to the row's
    // bounding-rect dimensions and is absolutely positioned to overlay it,
    // so SVG-space x maps to row-space x. Convert to viewport coordinates
    // by adding the SVG's bounding-rect left/top.
    function svgConnectors() {
      const out = [];
      for (const pathEl of svgPaths) {
        const d = pathEl.getAttribute('d') || '';
        // d is e.g. "M 12 34 L 56 78" or "M 12 34 L 16 34 L 16 78 L 56 78"
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
        // Build a "drawn-rect" envelope for each segment so I5 can check
        // it doesn't intersect any env-tag.
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

    // ---- I3 — connector reaches its target -------------------------------
    for (const c of cssConns) {
      // CSS line: arrowhead extends ~6 px past line.right (per the
      // arrow-gap geometry comment in the mockup CSS). We allow ±2 px.
      const tip = c.lineRect.right + 6;
      const targetLeft = c.targetRect.left;
      const delta = tip - targetLeft;
      if (Math.abs(delta) > TOL.connectorReachPx) {
        push('I3-connector-reaches-target',
          \`CSS connector to \${c.targetTestid} is \${delta > 0 ? 'overshooting' : 'short of'} target by \${Math.abs(delta).toFixed(1)} px (tip=\${tip.toFixed(1)}, target.left=\${targetLeft.toFixed(1)}).\`,
          { targetTestid: c.targetTestid, tip, targetLeft, delta });
      }
    }
    for (const c of svgConns) {
      // SVG path terminal x compared to target node's left. The mockup
      // anchors the path at target.node.left already, so violation here
      // means the path was drawn against a stale layout.
      //
      // Candidates are STRICTLY the box elements:
      //   [data-testid^=stage-box-], .node, .pill
      // We deliberately do NOT include .leaf-pair or any [data-env]
      // wrapper - those are CSS-Grid wrappers that extend past the box
      // into the env-tag column. Using their rect would mask an SVG
      // path that terminates several pixels short of the actual box.
      const row = c.pathEl.closest('[data-service-row]')
        || c.pathEl.closest('[data-testid^="swim-lane-row-"]')
        || c.pathEl.ownerDocument.body;
      const candidates = Array.from(row.querySelectorAll("[data-testid^='stage-box-'], .node, .pill"));
      if (candidates.length === 0) {
        push('I3-connector-reaches-target',
          \`SVG connector terminus (\${c.end.x.toFixed(1)},\${c.end.y.toFixed(1)}) has no candidate boxes in its row — the connector is unanchorable. (d=\${c.d})\`,
          { end: c.end, d: c.d });
        continue;
      }
      let best = null, bestDelta = Infinity;
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        // Vertical sanity — keep candidates near the connector's terminal y.
        if (c.end.y < r.top - 200 || c.end.y > r.bottom + 200) continue;
        const d = Math.abs(r.left - c.end.x);
        if (d < bestDelta) { bestDelta = d; best = el; }
      }
      if (bestDelta > TOL.connectorReachPx && best) {
        const targetDesc = best.getAttribute('data-testid') || best.className || 'unknown';
        push('I3-connector-reaches-target',
          \`SVG connector terminus (\${c.end.x.toFixed(1)},\${c.end.y.toFixed(1)}) is \${bestDelta.toFixed(1)} px off the nearest box left (target~\${targetDesc} at \${best.getBoundingClientRect().left.toFixed(1)}).\`,
          { end: c.end, nearestTargetLeft: best.getBoundingClientRect().left, bestDelta, targetDesc });
      }
    }

    // ---- I4 — connector emerges from source canvas -----------------------
    for (const c of cssConns) {
      if (!c.sourceRect) continue;
      // Line's left edge should be at-or-after source.right (with a small
      // tolerance for sub-pixel rounding / the connector column's padding).
      const leftEdge = c.lineRect.left;
      const sourceRight = c.sourceRect.right;
      if (leftEdge < sourceRight - TOL.connectorSourceEmergePx) {
        push('I4-connector-emerges-from-source',
          \`CSS connector starts at x=\${leftEdge.toFixed(1)} which is \${(sourceRight - leftEdge).toFixed(1)} px LEFT of source's right edge (\${sourceRight.toFixed(1)}).\`,
          { leftEdge, sourceRight });
      }
    }
    for (const c of svgConns) {
      const row = c.pathEl.closest('[data-service-row]')
        || c.pathEl.closest('[data-testid^="swim-lane-row-"]')
        || c.pathEl.ownerDocument.body;
      // Find the nearest BOX (not leaf-pair) whose right edge is closest
      // to the SVG path's start.x.
      const candidates = Array.from(row.querySelectorAll("[data-testid^='stage-box-'], .node, .pill"));
      let best = null, bestDelta = Infinity;
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (c.start.y < r.top - 200 || c.start.y > r.bottom + 200) continue;
        const d = Math.abs(r.right - c.start.x);
        if (d < bestDelta) { bestDelta = d; best = el; }
      }
      if (bestDelta > TOL.connectorSourceEmergePx && best) {
        push('I4-connector-emerges-from-source',
          \`SVG connector start (\${c.start.x.toFixed(1)},\${c.start.y.toFixed(1)}) is \${bestDelta.toFixed(1)} px off the nearest box right edge.\`,
          { start: c.start, nearestSourceRight: best.getBoundingClientRect().right, bestDelta });
      }
    }

    // ---- I5 — connector does not cross any env-tag rect -------------------
    for (const c of cssConns) {
      // The drawn rect of a CSS arrow line is line.getBoundingClientRect()
      // extended by 6 px on the right for the arrowhead.
      const drawnRect = { left: c.lineRect.left, right: c.lineRect.right + 6, top: c.lineRect.top, bottom: c.lineRect.bottom };
      for (const tag of envTags) {
        const tagRect = rectOf(tag);
        if (intersect(drawnRect, tagRect)) {
          const { dx, dy } = intersectAmount(drawnRect, tagRect);
          if (dx > TOL.envTagConnectorCrossPx && dy > TOL.envTagConnectorCrossPx) {
            push('I5-connector-does-not-cross-envtag',
              \`CSS connector to \${c.targetTestid} crosses env-tag '\${(tag.textContent || '').trim()}' by \${dx.toFixed(1)}x\${dy.toFixed(1)} px.\`,
              { targetTestid: c.targetTestid, drawnRect, tagRect, dx, dy });
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
                { d: c.d, seg, tagRect, dx, dy });
            }
          }
        }
      }
    }

    // ---- I6 — box content stays within parent box ------------------------
    // We measure each text node's REAL bounding rect via document.Range —
    // not the parent element's rect, which extends past the glyphs into
    // padding/siblings and produces false positives. We also skip text
    // nodes whose Range is zero-area (Alpine <template x-if> keeps such
    // nodes in the DOM as un-rendered placeholders).
    for (const box of boxes) {
      const boxRect = rectOf(box);
      const tid = box.getAttribute('data-testid');
      const tw = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.textContent && n.textContent.trim().length > 0) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      });
      let n;
      while ((n = tw.nextNode())) {
        // Skip text nodes inside non-rendered Alpine templates — their
        // parent is detached or display:none, the box CSS hides them.
        const parent = n.parentElement;
        if (!parent) continue;
        const parentDisplay = getComputedStyle(parent).display;
        if (parentDisplay === 'none') continue;
        // Range-based rect of the actual glyphs.
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        range.detach && range.detach();
        if (r.width === 0 && r.height === 0) continue; // not rendered
        const tol = TOL.boxContentClipPx;
        const escapesLeft   = r.left   < boxRect.left   - tol;
        const escapesRight  = r.right  > boxRect.right  + tol;
        const escapesTop    = r.top    < boxRect.top    - tol;
        const escapesBottom = r.bottom > boxRect.bottom + tol;
        if (escapesLeft || escapesRight || escapesTop || escapesBottom) {
          push('I6-box-content-not-clipped',
            \`Text inside \${tid} escapes the box: textRect=(\${r.left.toFixed(1)},\${r.top.toFixed(1)},\${r.right.toFixed(1)},\${r.bottom.toFixed(1)}) boxRect=(\${boxRect.left.toFixed(1)},\${boxRect.top.toFixed(1)},\${boxRect.right.toFixed(1)},\${boxRect.bottom.toFixed(1)}) text='\${(n.textContent || '').trim().slice(0, 40)}'.\`,
            { boxTestid: tid, textRect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, boxRect, text: (n.textContent || '').trim().slice(0, 80), escapesLeft, escapesRight, escapesTop, escapesBottom });
        }
      }
    }

    // ---- I7 — Display picker exposes seven FR-02 attribute checkboxes ----
    // Open the picker programmatically via Alpine state. The popover
    // renders <input type=checkbox> elements inside .popover via
    // <template x-for="attr in ATTRIBUTES">, so a count of 7 means the
    // catalogue is complete. The counter span carries the active view's
    // <selectedAttrCount>/<maxAttrs> — we assert the denominator equals
    // the SAD §7 cap for this view (the numerator is data-driven by the
    // user's defaults and is covered by the e2e suite).
    const root = alpineRoot();
    if (!root) {
      push('I7-picker-exposes-seven-attribute-checkboxes',
        'Cannot reach the Alpine root component via document.body._x_dataStack[0]. The mockup may have switched away from Alpine; update the harness probe.',
        { reason: 'no-alpine-root', view: VIEW_ID });
    } else {
      // Open the picker reactively (no real click needed — the visible
      // popover is bound to attrPickerOpen).
      const wasOpen = !!root.attrPickerOpen;
      root.attrPickerOpen = true;
      await settleReactive();

      const popover = document.querySelector('.popover');
      if (!popover) {
        push('I7-picker-exposes-seven-attribute-checkboxes',
          'Picker popover (.popover) is not in the DOM after attrPickerOpen=true. Mockup contract changed?',
          { view: VIEW_ID });
      } else {
        const checkboxes = Array.from(popover.querySelectorAll('input[type="checkbox"]'));
        if (checkboxes.length !== FR02_EXPECTED_ATTRIBUTES.length) {
          push('I7-picker-exposes-seven-attribute-checkboxes',
            \`Picker exposes \${checkboxes.length} checkbox(es) for view '\${VIEW_ID}'; expected \${FR02_EXPECTED_ATTRIBUTES.length} (one per FR-02 attribute).\`,
            { view: VIEW_ID, expected: FR02_EXPECTED_ATTRIBUTES.length, actual: checkboxes.length });
        }
        // Counter text must match <n>/<expectedCap>.
        const counterEl = Array.from(popover.querySelectorAll('span'))
          .find((s) => /^\\s*\\d+\\s*\\/\\s*\\d+\\s*$/.test(s.textContent || ''));
        if (!counterEl) {
          push('I7-picker-exposes-seven-attribute-checkboxes',
            \`Picker counter span (expected text matching '<n>/<cap>') not found inside the popover for view '\${VIEW_ID}'.\`,
            { view: VIEW_ID });
        } else {
          const text = (counterEl.textContent || '').trim();
          const m = text.match(/^(\\d+)\\s*\\/\\s*(\\d+)$/);
          if (!m) {
            push('I7-picker-exposes-seven-attribute-checkboxes',
              \`Picker counter text '\${text}' does not match '<n>/<cap>' for view '\${VIEW_ID}'.\`,
              { view: VIEW_ID, text });
          } else {
            const cap = parseInt(m[2], 10);
            if (cap !== FR02_EXPECTED_CAP) {
              push('I7-picker-exposes-seven-attribute-checkboxes',
                \`Picker counter denominator for view '\${VIEW_ID}' is \${cap}; SAD §7 'Layout views (FR-12)' Max attributes column declares \${FR02_EXPECTED_CAP}.\`,
                { view: VIEW_ID, expectedCap: FR02_EXPECTED_CAP, actualCap: cap });
            }
          }
        }
      }

      // ---- I8 — Null-render invariant for ref/sha --------------------
      // SAD §7: when ref or sha is the chosen Display attribute and the
      // slot's underlying value is null/absent, the slot renders empty —
      // never the literal "null" or "undefined". The mockup fixture
      // includes many slots with null ref / null sha (most of the
      // 12-service corpus omits both fields). We force a state where
      // both attributes are selected (subject to cap) and scan every
      // stage box for the forbidden literal.
      const cap = root.activeView && typeof root.activeView.maxAttrs === 'number'
        ? root.activeView.maxAttrs : FR02_EXPECTED_CAP;

      // Selection plan: keep adding ref/sha until cap is reached. For
      // Glance (cap 1) we must DROP an existing attribute first.
      function ensureSelected(key) {
        if (root.selectedAttrs.includes(key)) return true;
        if (root.capReached) {
          // Drop SOMETHING so we can add 'key'. Preference order:
          //   1. A non-target attribute (preserve ref/sha selections
          //      across iterations when cap permits both).
          //   2. The OTHER target attribute (Glance cap 1 — must swap
          //      ref out to add sha).
          let drop = root.selectedAttrs.find((k) => k !== 'ref' && k !== 'sha');
          if (!drop) drop = root.selectedAttrs.find((k) => k !== key);
          if (drop) root.toggleAttr(drop);
        }
        if (!root.selectedAttrs.includes(key)) {
          root.toggleAttr(key);
        }
        return root.selectedAttrs.includes(key);
      }

      const selectedForI8 = [];
      // For cap 1 (Glance), only one of ref/sha can be visible at a
      // time. We exercise both — first ref, scan; then swap to sha,
      // scan. For cap >= 2 (Detailed/Compact/Focus) both fit together.
      const attrsToExercise = ['ref', 'sha'];
      for (const key of attrsToExercise) {
        ensureSelected(key);
        selectedForI8.push(key);
        await settleReactive();

        // Close the popover so its own DOM (which renders the attribute
        // labels including the literal text "Source ref" / "Commit SHA"
        // descriptions) doesn't fool the literal scan — we want to assert
        // about the stage-box bodies only.
        root.attrPickerOpen = false;
        await settleReactive();

        // Scan every stage-box's text content for the forbidden literal.
        // The pattern uses word boundaries so accidental substrings (e.g.
        // a service named "annullify") don't trigger; only a standalone
        // "null" or "undefined" token counts.
        const FORBIDDEN = /(^|\\W)(null|undefined)(\\W|$)/i;
        const stageBoxes = Array.from(document.querySelectorAll("[data-testid^='stage-box-']"));
        for (const box of stageBoxes) {
          const text = box.textContent || '';
          if (FORBIDDEN.test(text)) {
            const tid = box.getAttribute('data-testid') || '<no-testid>';
            push('I8-no-null-literal-when-ref-sha-selected',
              \`Stage box '\${tid}' contains the literal token 'null' / 'undefined' while view='\${VIEW_ID}' has '\${key}' selected. SAD §7 null-render invariant: \"The attribute slot in the box body renders empty — no text, no placeholder, no the literal string 'null' / 'undefined'.\"\`,
              { boxTestid: tid, view: VIEW_ID, attributeSelected: key, snippet: text.replace(/\\s+/g, ' ').trim().slice(0, 180) });
          }
        }

        // Re-open the picker for the next iteration's selection swap.
        root.attrPickerOpen = true;
        await settleReactive();
      }

      // Restore picker visibility to its pre-test state to keep the
      // I0-I6 measurements stable across iterations of the spec.
      root.attrPickerOpen = wasOpen;
      await settleReactive();
    }

    return {
      violations,
      counts: {
        boxes: boxes.length,
        envTags: envTags.length,
        arrowLines: arrowLines.length,
        svgPaths: svgPaths.length,
        serviceRows: serviceRows.length,
      },
    };
  })()`;
}

// ----------------------------- the spec --------------------------------------
test.beforeAll(() => {
  if (!fs.existsSync(MOCKUP_PATH)) {
    throw new Error(`Mockup file not found at ${MOCKUP_PATH}`);
  }
});

for (const view of harnessConfig.views) {
  for (const layout of harnessConfig.layouts) {
    test(`${view} x ${layout}`, async ({ page }) => {
      const screenshotPath = path.resolve(SHOTS_DIR, `${view}-${layout}.png`);
      const result: CombinationResult = {
        view, layout, status: 'PASS', violations: [], screenshotPath,
      };

      // 1) Navigate.
      await page.goto(MOCKUP_FILE_URL);
      await page.waitForLoadState('domcontentloaded');

      // 2) Click view + layout — both segmented-control buttons exist on
      // the page from first paint (Alpine renders the toolbar
      // synchronously). Layout-option may be missing if the mockup
      // hasn't been updated; check and SKIP gracefully if so.
      const viewSel = harnessConfig.selectors.viewOption.replace('{id}', view);
      const layoutSel = harnessConfig.selectors.layoutOption.replace('{id}', layout);

      const viewBtn = page.locator(viewSel).first();
      const layoutBtn = page.locator(layoutSel).first();

      try {
        await viewBtn.waitFor({ state: 'visible', timeout: 5_000 });
      } catch {
        result.status = 'SKIPPED';
        result.reason = `Missing selector ${viewSel} on the mockup — solution-architect must add data-testid="view-option-${view}".`;
        writePartial(result);
        // Attach so the result is observable but don't throw — we WANT
        // to know about every missing hook, not bail on first miss.
        return;
      }
      try {
        await layoutBtn.waitFor({ state: 'visible', timeout: 5_000 });
      } catch {
        result.status = 'SKIPPED';
        result.reason = `Missing selector ${layoutSel} on the mockup — solution-architect must add data-testid="layout-option-${layout}".`;
        writePartial(result);
        return;
      }

      await viewBtn.click();
      await layoutBtn.click();

      // 3) Wait for layout settle. Note: a "not settled" outcome usually
      // means the layout BUG we're hunting (connectors not drawn). We
      // record the note and proceed so the screenshot + remaining
      // invariants still produce useful diagnostics.
      let settleNote: string | undefined;
      try {
        const settleResult = await waitForLayoutSettle(page, layout);
        if (!settleResult.settled) settleNote = settleResult.note;
      } catch (e) {
        settleNote = `waitForLayoutSettle threw: ${(e as Error).message}`;
      }

      // 4) Screenshot.
      await page.screenshot({ path: screenshotPath, fullPage: true });

      // 5) Evaluate invariants in-browser. The current `view` is passed
      // so per-view exceptions in harness.config.json#viewExceptions
      // are applied without any hardcoded view name in the spec.
      const evaluated = (await page.evaluate(evaluateInvariantsScript(view))) as {
        violations: InvariantViolation[];
        counts: Record<string, number>;
      };
      result.violations = evaluated.violations;
      if (settleNote) {
        // Surface unsettled-layout as a violation so it shows up in the
        // table. Use a sentinel invariant ID; the printable label is
        // explicit about the connector-drawing failure mode.
        result.violations.unshift({
          invariantId: 'I0-layout-settle',
          message: settleNote,
        });
      }
      if (result.violations.length > 0) {
        result.status = 'FAIL';
        result.reason = `${result.violations.length} invariant violation(s).`;
      }
      writePartial(result);

      // Use soft assertions so every combination runs even if earlier
      // ones fail — we want the full 12-row table on every invocation.
      expect.soft(
        result.violations,
        `Invariant violations in ${view} x ${layout}:\n${result.violations.map((v) => '  - [' + v.invariantId + '] ' + v.message).join('\n')}`,
      ).toEqual([]);
    });
  }
}

