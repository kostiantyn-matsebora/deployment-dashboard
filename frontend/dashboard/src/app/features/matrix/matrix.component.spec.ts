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
 */
import { NO_ERRORS_SCHEMA }    from '@angular/core';
import { TestBed }             from '@angular/core/testing';
import { By }                  from '@angular/platform-browser';
import { CdkDragDrop }        from '@angular/cdk/drag-drop';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { MatrixComponent }     from './matrix.component';
import { AppStateService }     from '../../core/services/app-state.service';
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

  // ── 3. onColDrop ──────────────────────────────────────────────────────────

  describe('onColDrop', () => {

    it('no-op when previousIndex === currentIndex (reorderColumn not called)', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set());

      const spy = vi.spyOn(state, 'reorderColumn');
      const event = { previousIndex: 1, currentIndex: 1 } as CdkDragDrop<string[]>;
      priv(component).onColDrop(event);
      expect(spy).not.toHaveBeenCalled();
    });

    it('calls reorderColumn with visible env names at the given indices', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set());

      const spy = vi.spyOn(state, 'reorderColumn');
      const event = { previousIndex: 0, currentIndex: 2 } as CdkDragDrop<string[]>;
      priv(component).onColDrop(event);
      // visible[0]='dev', visible[2]='prod'
      expect(spy).toHaveBeenCalledWith('dev', 'prod');
    });

    it('uses VISIBLE indices when some columns are hidden', async () => {
      const { component, state } = await createMatrix();
      // All 4 envs in data; 'staging' is hidden → visible = [dev, qa, prod]
      state.matrixData.set(mkMatrix(['dev', 'staging', 'qa', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'qa', 'prod']);
      state.matrixColHidden.set(new Set(['staging']));

      const spy = vi.spyOn(state, 'reorderColumn');
      // visible = ['dev', 'qa', 'prod']; drag index 0→1 means dev→qa
      const event = { previousIndex: 0, currentIndex: 1 } as CdkDragDrop<string[]>;
      priv(component).onColDrop(event);
      expect(spy).toHaveBeenCalledWith('dev', 'qa');
    });

    it('reorderColumn is called and environments() reflects new order', async () => {
      const { component, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'staging', 'prod'], []));
      state.matrixColOrder.set(['dev', 'staging', 'prod']);
      state.matrixColHidden.set(new Set());

      // drag 'dev' (index 0) to 'prod' position (index 2)
      const event = { previousIndex: 0, currentIndex: 2 } as CdkDragDrop<string[]>;
      priv(component).onColDrop(event);
      // After reorder: staging, prod, dev
      expect(priv(component).environments()).toEqual(['staging', 'prod', 'dev']);
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
        { service: 'AuthService',   slots: { dev: mkSlot('AuthService',   'dev') } },
        { service: 'PaymentService', slots: { dev: mkSlot('PaymentService', 'dev') } },
        { service: 'user-api',      slots: { dev: mkSlot('user-api',      'dev') } },
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
      const failSlot  = mkSlot('broken-svc',  'dev', 'failure');
      const okSlot    = mkSlot('healthy-svc', 'dev', 'success');
      state.matrixData.set(mkMatrix(['dev'], [
        { service: 'broken-svc',  slots: { dev: failSlot  } },
        { service: 'healthy-svc', slots: { dev: okSlot    } },
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
        { service: 'api-auth',   slots: { dev: mkSlot('api-auth',   'dev', 'failure') } },
        { service: 'api-order',  slots: { dev: mkSlot('api-order',  'dev', 'success') } },
        { service: 'ui-checkout', slots: { dev: mkSlot('ui-checkout', 'dev', 'failure') } },
      ]));
      state.serviceFilter.set('api');
      state.failuresOnly.set(true);
      const rows = priv(component).filteredRows() as Array<{ service: string }>;
      expect(rows.map(r => r.service)).toEqual(['api-auth']);
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

    it('cdkDropList is present on the header drop container', async () => {
      const { fixture, state } = await createMatrix();
      state.matrixData.set(mkMatrix(['dev', 'prod'], []));
      fixture.detectChanges();
      const dropList = fixture.debugElement.query(By.css('.col-headers-drop'));
      expect(dropList).not.toBeNull();
      // The cdkDropList directive attaches the cdk-drop-list class
      expect(dropList.nativeElement.classList.contains('cdk-drop-list')).toBe(true);
    });

    it('each draggable header cell has a cdkDrag grip handle', async () => {
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

});
