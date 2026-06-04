/**
 * deployment.model — deriveBoxState unit tests.
 *
 * Spec: docs/design/components.md §6 Box States
 *
 * Critical regression: failure with no last_successful must yield 's-fail-last'
 * (NOT 's-running-only'). See bug fix: deriveBoxState failure branch.
 */
import { deriveBoxState, DeploymentEvent, MatrixSlot } from './deployment.model';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkEvent(status: 'success' | 'failure' | 'in-progress'): DeploymentEvent {
  return {
    id:            'evt-1',
    deployment_id: 'dep-1',
    service:       'svc-a',
    environment:   'production',
    status,
    happened_at:   '2026-06-04T10:00:00Z',
  };
}

function mkSlot(overrides: Partial<MatrixSlot> & { status: 'success' | 'failure' | 'in-progress' }): MatrixSlot {
  const { status, ...rest } = overrides;
  return {
    current: mkEvent(status),
    ...rest,
  };
}

// ── S1: success ───────────────────────────────────────────────────────────────

describe('deriveBoxState — S1 success', () => {
  it('returns s-success when current.status === "success"', () => {
    expect(deriveBoxState(mkSlot({ status: 'success' }))).toBe('s-success');
  });

  it('returns s-success regardless of last_successful presence', () => {
    const slot = mkSlot({ status: 'success', last_successful: mkEvent('success') });
    expect(deriveBoxState(slot)).toBe('s-success');
  });
});

// ── S4: failure → always s-fail-last (the bug fix) ────────────────────────────

describe('deriveBoxState — S4 failure', () => {
  it('returns s-fail-last when status === "failure" AND last_successful is present', () => {
    const slot = mkSlot({ status: 'failure', last_successful: mkEvent('success') });
    expect(deriveBoxState(slot)).toBe('s-fail-last');
  });

  it('returns s-fail-last when status === "failure" AND last_successful is ABSENT (bug fix)', () => {
    // Previously returned 's-running-only' — must now return 's-fail-last'.
    const slot = mkSlot({ status: 'failure' });
    expect(deriveBoxState(slot)).toBe('s-fail-last');
    expect(deriveBoxState(slot)).not.toBe('s-running-only');
  });

  it('returns s-fail-last regardless of prev_failed when status === "failure"', () => {
    expect(deriveBoxState(mkSlot({ status: 'failure', prev_failed: true }))).toBe('s-fail-last');
    expect(deriveBoxState(mkSlot({ status: 'failure', prev_failed: false }))).toBe('s-fail-last');
  });
});

// ── S2: in-progress + last_successful, no prev_failed ────────────────────────

describe('deriveBoxState — S2 in-progress + last_successful', () => {
  it('returns s-run-last when in-progress, last_successful present, prev_failed absent', () => {
    const slot = mkSlot({ status: 'in-progress', last_successful: mkEvent('success') });
    expect(deriveBoxState(slot)).toBe('s-run-last');
  });

  it('returns s-run-last when in-progress, last_successful present, prev_failed false', () => {
    const slot = mkSlot({ status: 'in-progress', last_successful: mkEvent('success'), prev_failed: false });
    expect(deriveBoxState(slot)).toBe('s-run-last');
  });
});

// ── S3: in-progress + last_successful + prev_failed ──────────────────────────

describe('deriveBoxState — S3 in-progress + last_successful + prev_failed', () => {
  it('returns s-run-fail-last when in-progress, last_successful present, prev_failed true', () => {
    const slot = mkSlot({ status: 'in-progress', last_successful: mkEvent('success'), prev_failed: true });
    expect(deriveBoxState(slot)).toBe('s-run-fail-last');
  });
});

// ── S5: in-progress, no last_successful, no prev_failed ──────────────────────

describe('deriveBoxState — S5 in-progress only', () => {
  it('returns s-running-only when in-progress, no last_successful, no prev_failed', () => {
    const slot = mkSlot({ status: 'in-progress' });
    expect(deriveBoxState(slot)).toBe('s-running-only');
  });

  it('returns s-running-only when in-progress, no last_successful, prev_failed false', () => {
    const slot = mkSlot({ status: 'in-progress', prev_failed: false });
    expect(deriveBoxState(slot)).toBe('s-running-only');
  });
});

// ── S6: in-progress, no last_successful, prev_failed ─────────────────────────

describe('deriveBoxState — S6 in-progress + prev_failed only', () => {
  it('returns s-run-fail-only when in-progress, no last_successful, prev_failed true', () => {
    const slot = mkSlot({ status: 'in-progress', prev_failed: true });
    expect(deriveBoxState(slot)).toBe('s-run-fail-only');
  });
});

// ── Exhaustive: s-running-only is NOT reachable via failure status ─────────────

describe('deriveBoxState — s-running-only is never returned for failure', () => {
  it('failure without last_successful does NOT return s-running-only', () => {
    const result = deriveBoxState(mkSlot({ status: 'failure' }));
    expect(result).not.toBe('s-running-only');
  });

  it('failure with last_successful does NOT return s-running-only', () => {
    const result = deriveBoxState(mkSlot({ status: 'failure', last_successful: mkEvent('success') }));
    expect(result).not.toBe('s-running-only');
  });
});
