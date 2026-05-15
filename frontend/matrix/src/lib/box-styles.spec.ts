import {
  FIXTURE_ENVIRONMENTS,
  FIXTURE_MATRIX,
  FIXTURE_SERVICES,
  type SlotState
} from '@dd/shared';
import { getBoxClass, getTooltip } from './box-styles';

function slot(service: string, env: string): SlotState | null {
  return FIXTURE_MATRIX[service]?.[env] ?? null;
}

describe('getBoxClass', () => {
  it('returns the empty-slot class string when no slot is present', () => {
    expect(getBoxClass(null, null)).toContain('border-dashed');
    expect(getBoxClass(null, null)).toContain('bg-gray-50');
  });

  it('applies green palette for success', () => {
    const cls = getBoxClass(slot('service-b', 'dev'), null);
    expect(cls).toContain('border-green-300');
    expect(cls).toContain('bg-green-50');
    expect(cls).toContain('cursor-pointer');
  });

  it('applies red palette for failure', () => {
    const cls = getBoxClass(slot('service-b', 'qa'), null);
    expect(cls).toContain('border-red-300');
    expect(cls).toContain('bg-red-50');
  });

  it('applies orange palette + pulse-border for in-progress', () => {
    const cls = getBoxClass(slot('service-a', 'dev'), null);
    expect(cls).toContain('border-orange-400');
    expect(cls).toContain('bg-orange-50');
    expect(cls).toContain('in-progress-box');
  });

  it('amber-rings when the hovered version matches current.version', () => {
    const cls = getBoxClass(slot('service-a', 'qa'), 'v2.3.0');
    expect(cls).toContain('ring-amber-400');
  });

  it('amber-rings when the hovered version matches lastSuccessful.version', () => {
    const cls = getBoxClass(slot('service-a', 'dev'), 'v2.3.1');
    expect(cls).toContain('ring-amber-400');
  });

  it('does not ring when the hovered version is unrelated', () => {
    const cls = getBoxClass(slot('service-b', 'dev'), 'v9.9.9');
    expect(cls).not.toContain('ring-amber-400');
  });
});

describe('getTooltip', () => {
  it('uses the not-deployed text for empty slots', () => {
    const env = FIXTURE_ENVIRONMENTS.find(e => e.id === 'qahotfix')!;
    const svc = FIXTURE_SERVICES.find(s => s.id === 'service-a')!;
    expect(getTooltip(svc, env, null)).toBe('Service A — not deployed to QAHOTFIX');
  });

  it('includes version, formatted dt, actor and run number for populated slots', () => {
    const env = FIXTURE_ENVIRONMENTS.find(e => e.id === 'dev')!;
    const svc = FIXTURE_SERVICES.find(s => s.id === 'service-a')!;
    const t = getTooltip(svc, env, slot('service-a', 'dev'));
    expect(t).toContain('v2.3.2');
    expect(t).toContain('john.doe');
    expect(t).toContain('#1251');
  });
});
