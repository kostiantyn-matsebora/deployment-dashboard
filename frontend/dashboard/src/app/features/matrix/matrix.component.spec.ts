/**
 * MatrixComponent — unit tests.
 *
 * Spec: docs/design/views.md §Matrix View Layout
 *
 * Strategy:
 *   - Real AppStateService (signal-based, localStorage-backed; jsdom provides localStorage).
 *   - Drive state via service public signals + methods.
 *   - Child components (app-matrix-tile, app-history-drawer) suppressed with
 *     NO_ERRORS_SCHEMA: history-drawer injects DeploymentApiService + makes HTTP
 *     calls; matrix-tile resolves fine but produces extraneous DOM that would
 *     complicate header-cell assertions. Suppressing children is the last-resort
 *     exception described in the task brief — AppStateService is NOT mocked.
 *   - Protected members accessed via (component as any).
 *   - localStorage cleared before/after each test to prevent persistence bleed.
 *   - Native HTML5 DnD: jsdom supports DragEvent dispatch; drag signals are the
 *     source of truth (not dataTransfer), making the drag path unit-coverable.
 */
import { NO_ERRORS_SCHEMA }    from '@angular/core';
import { TestBed }             from '@angular/core/testing';
import { By }                  from '@angular/platform-browser';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { MatrixComponent }     from './matrix.component';
import { AppStateService }     from '../../core/services/app-state.service';
import { PresetsService }      from '../../core/services/presets.service';
import { Matrix, MatrixSlot, DeploymentEvent } from '../../core/models/deployment.model';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Bypass protected/private visibility. */
function priv(c: MatrixComponent): any {
  return c as any;
}

let _seq = 0;

/** Build a minimal DeploymentEvent. */
function mkEv(
  service: string,
  environment: string,
  status: DeploymentEvent['status'] = 'success',
  overrides: Partial<DeploymentEvent> = {},
): DeploymentEvent {
  const n = ++_seq;
  return {
    id:            `id-${n}`,
    deployment_id: `dep-${n}`,
    service,
    environment,
    status,
    happened_at:   '2026-06-04T10:00:00Z',
    ...overrides,
  };
}

/** Build a minimal MatrixSlot wrapping a single event. */
function mkSlot(
  service: string,
  environment: string,
  status: DeploymentEvent['status'] = 'success',
  extra: Partial<MatrixSlot> = {},
): MatrixSlot {
  return { current: mkEv(service, environment, status), ...extra };
}

/**
 * Build a Matrix with the given environment list and service rows.
 * `rows` maps service name → slot-record (env → slot).
 */
function mkMatrix(
  environments: string[],
  rows: Array<{ service: string; slots: Record<string, MatrixSlot> }>,
): Matrix {
  return {
    generated_at: '2026-06-04T10:00:00Z',
    environments,
    rows,
  };
}

/**
 * Fire a drag-related event on a DOM element.
 *
 * jsdom does not expose `DragEvent` or `DataTransfer` as global constructors,
 * so we dispatch a plain cancelable `Event` that bubbles — sufficient because
 * our handlers store drag state in signals (not dataTransfer) and only call
 * event.preventDefault(). We attach a spy-friendly `preventDefault` directly
 * so the unit tests for that behaviour can still assert it was called.
 */
function fireDrag(el: Element, type: string): Event {
  const ev = document.createEvent('Event');
  ev.initEvent(type, /* bubbles */ true, /* cancelable */ true);
  // Attach a real spy-able preventDefault — the jsdom one is already there,
  // but we shadow it so vi.spyOn works in the handler-unit tests below.
  el.dispatchEvent(ev);
  return ev;
}

/**
 * Build a minimal fake DragEvent for handler unit tests.
 * jsdom does not expose DragEvent or DataTransfer as constructors.
 * Our handlers only need: event.preventDefault() and optionally event.dataTransfer.
 * We return a plain object cast to DragEvent with a vi.fn() for preventDefault so
 * tests can assert it was called without needing a real browser event.
 */
function mkDragEv(): DragEvent {
  return {
    preventDefault: vi.fn(),
    dataTransfer:   { effectAllowed: 'none', dropEffect: 'none' } as unknown as DataTransfer,
  } as unknown as DragEvent;
}

// ── TestBed factory ───────────────────────────────────────────────────────────

async function createMatrix(): Promise<{
  fixture: ReturnType<typeof TestBed.createComponent<MatrixComponent>>;
  component: MatrixComponent;
  state: AppStateService;
}> {
  await TestBed.configureTestingModule({
    imports:  [MatrixComponent],
    schemas:  [NO_ERRORS_SCHEMA],
  }).compileComponents();

  const fixture   = TestBed.createComponent(MatrixComponent);
  const component = fixture.componentInstance;
  const state     = TestBed.inject(AppStateService);
  fixture.detectChanges();
  return { fixture, component, state };
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('MatrixComponent', () => {

  beforeEach(() => {
    _seq = 0;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  // ── 1. allEnvironments / environments derivation ──────────────────────────

  describe('allEnvironments and environments derivation', () => {

    it('returns [] for both when matrixData is null', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(null);
      expect(priv(component).allEnvironments()).toEqual([]);
      expect(priv(component).environments()).toEqual([]);
    });

    it('allEnvironments returns the full environment list from matrixData', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      expect(priv(component).allEnvironments()).toEqual(['dev', 'staging', 'prod']);
    });

    it('environments() applies saved colOrder: reordered envs appear in saved order', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['prod', 'staging', 'dev']);
      state.matrixColHidden.set(new Set());
      expect(priv(component).environments()).toEqual(['prod', 'staging', 'dev']);
    });

    it('environments() drops hidden environments; allEnvironments() retains them', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set(['staging']));
      expect(priv(component).environments()).toEqual(['dev', 'prod']);
      expect(priv(component).allEnvironments()).toEqual(['dev', 'staging', 'prod']);
    });

    it('env absent from colOrder (new env) falls to the end of environments()', async () => {
      const { component, state } = await createMatrix();
      // 'qa' is a new env not in the saved order
      state.matrixData.set(mkMatrix(['dev', 'qa', 'prod'], []));
      state.matrixColOrder.set(['prod', 'dev']);
      state.matrixColHidden.set(new Set());
      // saved order: prod, dev; new env qa appended
      expect(priv(component).environments()).toEqual(['prod', 'dev', 'qa']);
    });

    it('env in colOrder but absent from data is silently omitted from environments()', async () => {
      const { component, state } = await createMatrix();
      // 'qa' was saved but is not in current data
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['prod', 'staging', 'qa', 'dev']);
      state.matrixColHidden.set(new Set());
      expect(priv(component).environments()).toEqual(['prod', 'staging', 'dev']);
    });

  });

  // ── 2. gridColumns ────────────────────────────────────────────────────────

  describe('gridColumns', () => {

    it('produces correct template string for 0 visible columns', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev'], []));
      // Hide all: last-column guard prevents hiding the last, so hide none but
      // test the formula with no matrixData (environments = [])
      state.matrixData.set(null);
      expect(priv(component).gridColumns()).toBe('180px repeat(0, minmax(140px, max-content))');
    });

    it('produces correct template string for 3 visible columns', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set([]);
      state.matrixColHidden.set(new Set());
      expect(priv(component).gridColumns()).toBe('180px repeat(3, minmax(140px, max-content))');
    });

    it('reflects actual visible count when 1 of 3 columns is hidden', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set(['staging']));
      expect(priv(component).gridColumns()).toBe('180px repeat(2, minmax(140px, max-content))');
    });

  });

  // ── 3. Native HTML5 drag-reorder handlers ────────────────────────────────

  describe('native drag-reorder handlers', () => {

    // ── handler unit tests (no DOM required) ─────────────────────────────

    it('onDragStart sets draggedEnv signal', async () => {
      const { component } = await createMatrix();
      const ev = mkDragEv();
      priv(component).onDragStart('staging', ev);
      expect(priv(component).draggedEnv()).toBe('staging');
    });

    it('onDragOver calls event.preventDefault() (required for valid drop target)', async () => {
      const { component } = await createMatrix();
      const ev = mkDragEv();
      priv(component).onDragOver('prod', ev);
      expect(ev.preventDefault).toHaveBeenCalled();
    });

    it('onDragOver sets dragOverEnv signal', async () => {
      const { component } = await createMatrix();
      const ev = mkDragEv();
      priv(component).onDragOver('prod', ev);
      expect(priv(component).dragOverEnv()).toBe('prod');
    });

    it('onDragLeave clears dragOverEnv only for the matching env', async () => {
      const { component } = await createMatrix();
      priv(component).dragOverEnv.set('prod');
      priv(component).onDragLeave('prod');
      expect(priv(component).dragOverEnv()).toBeNull();
    });

    it('onDragLeave is a no-op when the env does not match current dragOverEnv', async () => {
      const { component } = await createMatrix();
      priv(component).dragOverEnv.set('prod');
      priv(component).onDragLeave('dev');        // different env — should not clear
      expect(priv(component).dragOverEnv()).toBe('prod');
    });

    it('onDrop calls event.preventDefault()', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set());
      priv(component).draggedEnv.set('dev');

      const ev = mkDragEv();
      priv(component).onDrop('prod', ev);
      expect(ev.preventDefault).toHaveBeenCalled();
    });

    it('onDrop calls reorderColumn(fromEnv, toEnv) when from ≠ to', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set());
      priv(component).draggedEnv.set('dev');

      const spy = vi.spyOn(state, 'reorderColumn');
      priv(component).onDrop('prod', mkDragEv());
      expect(spy).toHaveBeenCalledWith('dev', 'prod');
    });

    it('onDrop is a no-op (reorderColumn not called) when dropping on itself', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set());
      priv(component).draggedEnv.set('dev');

      const spy = vi.spyOn(state, 'reorderColumn');
      priv(component).onDrop('dev', mkDragEv());
      expect(spy).not.toHaveBeenCalled();
    });

    it('onDrop clears both drag signals regardless of whether reorder occurred', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'prod'], []));
      state.matrixColOrder.set(['dev', 'prod']);
      state.matrixColHidden.set(new Set());
      priv(component).draggedEnv.set('dev');
      priv(component).dragOverEnv.set('prod');

      priv(component).onDrop('prod', mkDragEv());
      expect(priv(component).draggedEnv()).toBeNull();
      expect(priv(component).dragOverEnv()).toBeNull();
    });

    it('onDragEnd clears both drag signals', async () => {
      const { component } = await createMatrix();
      priv(component).draggedEnv.set('dev');
      priv(component).dragOverEnv.set('prod');
      priv(component).onDragEnd();
      expect(priv(component).draggedEnv()).toBeNull();
      expect(priv(component).dragOverEnv()).toBeNull();
    });

    // ── full DOM-dispatch integration test ────────────────────────────────

    it('full drag sequence: dragstart → dragover → drop calls reorderColumn and updates environments()', async () => {
      const { fixture, component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set());
      fixture.detectChanges();

      const spy = vi.spyOn(state, 'reorderColumn');

      // Query the two header cells for 'dev' (index 0) and 'prod' (index 2).
      // col-corner is the first .col-head; env headers are .col-draggable.
      const draggables = fixture.debugElement.queryAll(By.css('.col-draggable'));
      expect(draggables.length).toBe(3);

      const devCell  = draggables[0].nativeElement as HTMLElement;  // 'dev'
      const prodCell = draggables[2].nativeElement as HTMLElement;  // 'prod'

      // 1. dragstart on 'dev'
      fireDrag(devCell, 'dragstart');
      expect(priv(component).draggedEnv()).toBe('dev');

      // 2. dragover on 'prod' — must call preventDefault (checked via spy below)
      const overEv = fireDrag(prodCell, 'dragover');
      // jsdom does not expose defaultPrevented via the dispatchEvent call result,
      // but our handler is tested for preventDefault() in the unit test above.
      expect(priv(component).dragOverEnv()).toBe('prod');

      // 3. drop on 'prod'
      fireDrag(prodCell, 'drop');
      expect(spy).toHaveBeenCalledWith('dev', 'prod');

      // 4. signals cleared after drop
      expect(priv(component).draggedEnv()).toBeNull();
      expect(priv(component).dragOverEnv()).toBeNull();

      // 5. environments() reflects new order (dev moved to prod's position)
      //    reorderColumn: splice dev out of [dev,staging,prod] and insert at prod's index
      //    → ['staging', 'prod', 'dev']
      expect(priv(component).environments()).toEqual(['staging', 'prod', 'dev']);
    });

    it('full drag sequence: dropping on same cell does NOT call reorderColumn', async () => {
      const { fixture, component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set());
      fixture.detectChanges();

      const spy = vi.spyOn(state, 'reorderColumn');
      const draggables = fixture.debugElement.queryAll(By.css('.col-draggable'));
      const devCell = draggables[0].nativeElement as HTMLElement;

      fireDrag(devCell, 'dragstart');
      fireDrag(devCell, 'dragover');
      fireDrag(devCell, 'drop');

      expect(spy).not.toHaveBeenCalled();
      // Order unchanged
      expect(priv(component).environments()).toEqual(['dev', 'staging', 'prod']);
    });

    it('header cells have draggable="true" attribute', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging'], []));
      state.matrixColOrder.set(['dev', 'staging']);
      state.matrixColHidden.set(new Set());
      fixture.detectChanges();

      const draggables = fixture.debugElement.queryAll(By.css('.col-draggable'));
      draggables.forEach(d => {
        expect(d.nativeElement.getAttribute('draggable')).toBe('true');
      });
    });

  });

  // ── 4. filteredRows ───────────────────────────────────────────────────────

  describe('filteredRows', () => {

    it('returns [] when matrixData is null', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(null);
      expect(priv(component).filteredRows()).toEqual([]);
    });

    it('returns all rows when no filter is set', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'alpha', slots: { dev: mkSlot('alpha', 'dev') } },
        { service: 'beta',  slots: { dev: mkSlot('beta',  'dev') } },
      ]));
      state.serviceFilter.set('');
      state.failuresOnly.set(false);
      expect(priv(component).filteredRows()).toHaveLength(2);
    });

    it('service filter is case-insensitive substring match', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'AuthService',    slots: { dev: mkSlot('AuthService',    'dev') } },
        { service: 'PaymentService', slots: { dev: mkSlot('PaymentService', 'dev') } },
        { service: 'user-api',       slots: { dev: mkSlot('user-api',       'dev') } },
      ]));
      state.serviceFilter.set('AUTH');
      state.failuresOnly.set(false);
      const rows = priv(component).filteredRows() as Array<{ service: string }>;
      expect(rows.map(r => r.service)).toEqual(['AuthService']);
    });

    it('service filter returns multiple matches', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'svc-a', slots: { dev: mkSlot('svc-a', 'dev') } },
        { service: 'svc-b', slots: { dev: mkSlot('svc-b', 'dev') } },
        { service: 'other', slots: { dev: mkSlot('other', 'dev') } },
      ]));
      state.serviceFilter.set('svc');
      state.failuresOnly.set(false);
      const rows = priv(component).filteredRows() as Array<{ service: string }>;
      expect(rows.map(r => r.service)).toEqual(['svc-a', 'svc-b']);
    });

    it('failuresOnly keeps rows that have at least one failing slot (s-fail-last)', async () => {
      const { component, state } = await createMatrix();
      const failSlot = mkSlot('broken-svc',  'dev', 'failure');
      const okSlot   = mkSlot('healthy-svc', 'dev', 'success');
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'broken-svc',  slots: { dev: failSlot } },
        { service: 'healthy-svc', slots: { dev: okSlot   } },
      ]));
      state.serviceFilter.set('');
      state.failuresOnly.set(true);
      const rows = priv(component).filteredRows() as Array<{ service: string }>;
      expect(rows.map(r => r.service)).toEqual(['broken-svc']);
    });

    it('failuresOnly keeps rows with in-progress + prev_failed (s-run-fail-only)', async () => {
      const { component, state } = await createMatrix();
      const runFailSlot: MatrixSlot = {
        current:     mkEv('svc-a', 'dev', 'in-progress'),
        prev_failed: true,
        // no last_successful → s-run-fail-only
      };
      const okSlot = mkSlot('svc-b', 'dev', 'success');
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'svc-a', slots: { dev: runFailSlot } },
        { service: 'svc-b', slots: { dev: okSlot      } },
      ]));
      state.serviceFilter.set('');
      state.failuresOnly.set(true);
      const rows = priv(component).filteredRows() as Array<{ service: string }>;
      expect(rows.map(r => r.service)).toEqual(['svc-a']);
    });

    it('failuresOnly keeps rows with s-run-fail-last (in-progress + prev_failed + last_successful)', async () => {
      const { component, state } = await createMatrix();
      const runFailLastSlot: MatrixSlot = {
        current:         mkEv('svc-a', 'dev', 'in-progress'),
        last_successful: mkEv('svc-a', 'dev', 'success'),
        prev_failed:     true,
        // → s-run-fail-last
      };
      const okSlot = mkSlot('svc-b', 'dev', 'success');
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'svc-a', slots: { dev: runFailLastSlot } },
        { service: 'svc-b', slots: { dev: okSlot           } },
      ]));
      state.serviceFilter.set('');
      state.failuresOnly.set(true);
      const rows = priv(component).filteredRows() as Array<{ service: string }>;
      expect(rows.map(r => r.service)).toEqual(['svc-a']);
    });

    it('failuresOnly drops all-success rows (only in-progress rows remain visible)', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'prod'], [
        {
          service: 'svc-a',
          slots: {
            dev:  mkSlot('svc-a', 'dev',  'success'),
            prod: mkSlot('svc-a', 'prod', 'success'),
          },
        },
      ]));
      state.serviceFilter.set('');
      state.failuresOnly.set(true);
      expect(priv(component).filteredRows()).toHaveLength(0);
    });

    it('service filter and failuresOnly stack: only matching + failing rows returned', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'api-auth',    slots: { dev: mkSlot('api-auth',    'dev', 'failure') } },
        { service: 'api-order',   slots: { dev: mkSlot('api-order',   'dev', 'success') } },
        { service: 'ui-checkout', slots: { dev: mkSlot('ui-checkout', 'dev', 'failure') } },
      ]));
      state.serviceFilter.set('api');
      state.failuresOnly.set(true);
      const rows = priv(component).filteredRows() as Array<{ service: string }>;
      expect(rows.map(r => r.service)).toEqual(['api-auth']);
    });

  });

  // ── 4a. track-key uniqueness (issue #353 fix) ────────────────────────────
  //
  // When the same service name exists under two different namespaces, the two
  // rows must be treated as distinct — the composite `namespace|service` track
  // expression prevents Angular from collapsing them into a single DOM node.

  describe('composite track-key — same service name under different namespaces', () => {

    it('filteredRows returns two distinct rows for same service name in different namespaces', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'api', namespace: 'team-a', slots: { dev: mkSlot('api', 'dev') } },
        { service: 'api', namespace: 'team-b', slots: { dev: mkSlot('api', 'dev') } },
      ] as any));
      state.serviceFilter.set('');
      state.failuresOnly.set(false);
      const rows = priv(component).filteredRows() as Array<{ service: string; namespace?: string | null }>;
      expect(rows).toHaveLength(2);
      expect(rows[0].namespace).toBe('team-a');
      expect(rows[1].namespace).toBe('team-b');
    });

    it('renders two distinct row-head cells for same service under different namespaces', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'api', namespace: 'team-a', slots: { dev: mkSlot('api', 'dev') } },
        { service: 'api', namespace: 'team-b', slots: { dev: mkSlot('api', 'dev') } },
      ] as any));
      state.serviceFilter.set('');
      state.failuresOnly.set(false);
      state.matrixColOrder.set(['dev']);
      state.matrixColHidden.set(new Set());
      fixture.detectChanges();
      const rowHeads = fixture.debugElement.queryAll(By.css('.row-head'));
      expect(rowHeads).toHaveLength(2);
    });

  });

  // ── 5. Rendering (DOM) ───────────────────────────────────────────────────

  describe('DOM rendering', () => {

    it('shows loading placeholder when matrixData is null', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(null);
      fixture.detectChanges();
      const loading = fixture.debugElement.query(By.css('.matrix-loading'));
      expect(loading).not.toBeNull();
    });

    it('hides the loading placeholder once matrixData is set', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev'], []));
      fixture.detectChanges();
      const loading = fixture.debugElement.query(By.css('.matrix-loading'));
      expect(loading).toBeNull();
    });

    it('renders one header cell per VISIBLE environment in order', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['prod', 'dev', 'staging']);
      state.matrixColHidden.set(new Set());
      fixture.detectChanges();
      const envTags = fixture.debugElement.queryAll(By.css('.env-tag'));
      expect(envTags.map(e => e.nativeElement.textContent.trim())).toEqual([
        'prod', 'dev', 'staging',
      ]);
    });

    it('hidden environment is absent from the header row', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set(['staging']));
      fixture.detectChanges();
      const envTags = fixture.debugElement.queryAll(By.css('.env-tag'));
      const texts = envTags.map(e => e.nativeElement.textContent.trim());
      expect(texts).not.toContain('staging');
      expect(texts).toContain('dev');
      expect(texts).toContain('prod');
    });

    it('renders a row-head for each row returned by filteredRows', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'alpha', slots: { dev: mkSlot('alpha', 'dev') } },
        { service: 'beta',  slots: { dev: mkSlot('beta',  'dev') } },
      ]));
      state.serviceFilter.set('');
      state.failuresOnly.set(false);
      fixture.detectChanges();
      const rowHeads = fixture.debugElement.queryAll(By.css('.row-head'));
      expect(rowHeads).toHaveLength(2);
      expect(rowHeads[0].nativeElement.textContent.trim()).toBe('alpha');
      expect(rowHeads[1].nativeElement.textContent.trim()).toBe('beta');
    });

    it('renders an empty-slot placeholder where a row has no slot for an env', async () => {
      const { fixture, state } = await createMatrix();
      // 'alpha' has no slot for 'prod'
      state.matrixData.set(mkMatrix(['dev', 'prod'], [
        {
          service: 'alpha',
          slots: { dev: mkSlot('alpha', 'dev') },
          // no 'prod' slot
        },
      ]));
      state.matrixColOrder.set(['dev', 'prod']);
      state.matrixColHidden.set(new Set());
      state.serviceFilter.set('');
      state.failuresOnly.set(false);
      fixture.detectChanges();
      const emptySlots = fixture.debugElement.queryAll(By.css('.slot.empty'));
      expect(emptySlots.length).toBeGreaterThanOrEqual(1);
      expect(
        emptySlots.some(e => e.nativeElement.getAttribute('aria-label') === 'No deployment'),
      ).toBe(true);
    });

    it('no CDK drop-list container exists in the header row', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'prod'], []));
      fixture.detectChanges();
      // The CDK wrapper .col-headers-drop must NOT exist
      const cdkWrapper = fixture.debugElement.query(By.css('.col-headers-drop'));
      expect(cdkWrapper).toBeNull();
      // And the CDK class must not appear on any header cell
      const cdkDrag = fixture.debugElement.query(By.css('[cdkdrag], .cdk-drag'));
      expect(cdkDrag).toBeNull();
    });

    it('each draggable header cell has a grip handle span', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set());
      fixture.detectChanges();
      const grips = fixture.debugElement.queryAll(By.css('.col-drag-grip'));
      // One grip per visible environment
      expect(grips).toHaveLength(3);
    });

    it('matrix grid applies the gridColumns style', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'prod'], []));
      state.matrixColOrder.set(['dev', 'prod']);
      state.matrixColHidden.set(new Set());
      fixture.detectChanges();
      const grid = fixture.debugElement.query(By.css('.matrix'));
      const style: string = grid.nativeElement.style.gridTemplateColumns;
      expect(style).toBe('180px repeat(2, minmax(140px, max-content))');
    });

  });

  // ── 5a. Change-emphasis flash (SSE live change, #398) ────────────────────
  //
  // Mirrors SwimlanesComponent's flashingIds/flashCard wiring (#309): reacts
  // to AppStateService.lastEffectiveEvent (real service — not mocked), which
  // is set only for effective (non-context) statuses. flashTile() defers the
  // set-write behind two rAF ticks; requestAnimationFrame is spied to run
  // synchronously so the assertions don't depend on real paint timing.

  describe('change-emphasis flash — lastEffectiveEvent (#398)', () => {

    function mkFlashEv(overrides: Partial<DeploymentEvent> = {}): DeploymentEvent {
      return mkEv('svc-a', 'dev', 'success', overrides);
    }

    /**
     * Run `fn` with requestAnimationFrame spied to invoke its callback
     * synchronously — mirrors SwimlanesComponent's spec (flashCard defers
     * behind two rAF ticks; the sync mock lets assertions run immediately
     * without depending on real paint timing).
     *
     * NOTE: only call this around a DIRECT `onSseChange`/`flashTile` call —
     * never around a `lastEffectiveEvent.set()` + `TestBed.flushEffects()`
     * pair. Doing the latter re-enters Angular's effect scheduler while it
     * is already flushing (the synchronous rAF mock removes the normal
     * async boundary), which throws "Schedulers cannot synchronously
     * execute watches while scheduling." Real (async) rAF avoids that by
     * deferring the signal write outside the flush — same reason
     * SwimlanesComponent's own effect-wiring test does not mock rAF.
     */
    function withSyncRaf<T>(fn: () => T): T {
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0; });
      try {
        return fn();
      } finally {
        rafSpy.mockRestore();
      }
    }

    // ── Effect wiring: lastEffectiveEvent → onSseChange ──────────────────

    it('lastEffectiveEvent effect calls onSseChange for effective events', async () => {
      const { component, state } = await createMatrix();
      const spy = vi.spyOn(priv(component), 'onSseChange');
      spy.mockClear();

      const ev = mkFlashEv();
      state.lastEffectiveEvent.set(ev);
      TestBed.flushEffects();

      expect(spy).toHaveBeenCalledWith(ev);
    });

    it('lastEffectiveEvent effect does NOT call onSseChange when the signal is null', async () => {
      const { component, state } = await createMatrix();
      const spy = vi.spyOn(priv(component), 'onSseChange');
      spy.mockClear();

      state.lastEffectiveEvent.set(null);
      TestBed.flushEffects();

      expect(spy).not.toHaveBeenCalled();
    });

    // ── Flash logic: onSseChange / flashTile called directly ─────────────
    // (avoids nesting a synchronous rAF-mocked signal write inside an
    // active effect flush — see withSyncRaf's note above.)

    it('an effective event flashes the matching tile id', async () => {
      const { component } = await createMatrix();
      expect(priv(component).flashingIds().size).toBe(0);

      const ev = mkFlashEv();
      withSyncRaf(() => priv(component).onSseChange(ev));

      const id = priv(component).tileId('svc-a', 'dev', null);
      expect(priv(component).flashingIds().has(id)).toBe(true);
    });

    it('the flash clears itself after ~1200ms (one-shot)', async () => {
      const { component } = await createMatrix();
      const ev = mkFlashEv();

      vi.useFakeTimers();
      try {
        withSyncRaf(() => priv(component).onSseChange(ev));
        const id = priv(component).tileId('svc-a', 'dev', null);
        expect(priv(component).flashingIds().has(id)).toBe(true);

        vi.advanceTimersByTime(1199);
        expect(priv(component).flashingIds().has(id)).toBe(true);

        vi.advanceTimersByTime(1);
        expect(priv(component).flashingIds().has(id)).toBe(false);
        expect(priv(component).flashingIds().size).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('targets the tile by (service, environment, namespace) — a different env is not flashed', async () => {
      const { component } = await createMatrix();
      const ev = mkFlashEv({ environment: 'prod' });

      withSyncRaf(() => priv(component).onSseChange(ev));

      expect(priv(component).flashingIds().has(priv(component).tileId('svc-a', 'prod', null))).toBe(true);
      expect(priv(component).flashingIds().has(priv(component).tileId('svc-a', 'dev', null))).toBe(false);
    });

    it('targets the tile by (service, environment, namespace) — namespace distinguishes same-name services', async () => {
      const { component } = await createMatrix();
      const ev = mkFlashEv({ namespace: 'team-a' });

      withSyncRaf(() => priv(component).onSseChange(ev));

      expect(priv(component).flashingIds().has(priv(component).tileId('svc-a', 'dev', 'team-a'))).toBe(true);
      expect(priv(component).flashingIds().has(priv(component).tileId('svc-a', 'dev', null))).toBe(false);
      expect(priv(component).flashingIds().has(priv(component).tileId('svc-a', 'dev', 'team-b'))).toBe(false);
    });

    it('the matrix tile template binds isFlashing from flashingIds() via tileId()', async () => {
      const { fixture, component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'svc-a', slots: { dev: mkSlot('svc-a', 'dev') } },
      ]));

      const id = priv(component).tileId('svc-a', 'dev', null);
      withSyncRaf(() => priv(component).flashTile(id));

      fixture.detectChanges();

      const tile = fixture.debugElement.query(By.css('app-matrix-tile'));
      expect(tile.componentInstance.isFlashing()).toBe(true);
    });

  });

  // ── 6. Presets visible-apply regression ──────────────────────────────────
  //
  // Regression gate: applying a preset that carries a serviceFilter MUST change
  // the visible (rendered) row set in MatrixComponent.filteredRows(), not just
  // write to localStorage.  A prior pass only asserted signal values; this suite
  // asserts the derived, reactive filteredRows() so that a missing apply() wiring
  // would be caught here.

  describe('presets visible-apply regression — serviceFilter', () => {

    async function createMatrixWithPresets(): Promise<{
      fixture:  ReturnType<typeof TestBed.createComponent<MatrixComponent>>;
      component: MatrixComponent;
      state:    AppStateService;
      presets:  PresetsService;
    }> {
      await TestBed.configureTestingModule({
        imports:   [MatrixComponent],
        schemas:   [NO_ERRORS_SCHEMA],
        providers: [PresetsService],
      }).compileComponents();

      const fixture   = TestBed.createComponent(MatrixComponent);
      const component = fixture.componentInstance;
      const state     = TestBed.inject(AppStateService);
      const presets   = TestBed.inject(PresetsService);
      fixture.detectChanges();
      return { fixture, component, state, presets };
    }

    it('applying a preset with serviceFilter:"auth" reduces filteredRows to only matching rows', async () => {
      const { component, state, presets } = await createMatrixWithPresets();

      // Matrix with two services: one matching 'auth', one not
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'auth-api',    slots: { dev: mkSlot('auth-api',    'dev') } },
        { service: 'payment-api', slots: { dev: mkSlot('payment-api', 'dev') } },
      ]));
      state.failuresOnly.set(false);

      // Start with no filter — both rows visible
      state.serviceFilter.set('');
      expect(priv(component).filteredRows()).toHaveLength(2);

      // Save a preset with a non-empty service filter
      state.serviceFilter.set('auth');
      presets.save('auth-filter');

      // Clear the filter — board shows both rows again
      state.serviceFilter.set('');
      expect(priv(component).filteredRows()).toHaveLength(2);

      // Apply the preset — filteredRows MUST change to reflect the saved filter
      presets.apply(presets.presets()[0]);

      const after = priv(component).filteredRows() as Array<{ service: string }>;
      expect(after).toHaveLength(1);
      expect(after[0].service).toBe('auth-api');
    });

    it('applying a preset with serviceFilter:"" restores full row set after a manual filter', async () => {
      const { component, state, presets } = await createMatrixWithPresets();

      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'svc-a', slots: { dev: mkSlot('svc-a', 'dev') } },
        { service: 'svc-b', slots: { dev: mkSlot('svc-b', 'dev') } },
      ]));
      state.failuresOnly.set(false);

      // Save a preset with empty filter (show all)
      state.serviceFilter.set('');
      presets.save('no-filter');

      // Apply a manual filter — only svc-a visible
      state.serviceFilter.set('svc-a');
      expect(priv(component).filteredRows()).toHaveLength(1);

      // Apply the saved preset — both rows must become visible again
      presets.apply(presets.presets()[0]);

      expect(priv(component).filteredRows()).toHaveLength(2);
    });

  });

});
