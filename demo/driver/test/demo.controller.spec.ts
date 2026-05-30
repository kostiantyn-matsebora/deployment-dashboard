import { Test, TestingModule } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { NotFoundException } from '@nestjs/common';
import { DemoController } from '../src/demo/demo.controller';
import { DemoService } from '../src/demo/demo.service';
import { RunnerStatus } from '../src/scenarios/scenario-runner';

const idle = (overrides: Partial<RunnerStatus> = {}): RunnerStatus => ({
  scenario:     null,
  state:        'idle',
  events_total: 0,
  events_sent:  0,
  errors:       0,
  started_at:   null,
  finished_at:  null,
  ...overrides,
});

const running = (): RunnerStatus => idle({
  state:        'running',
  scenario:     'demo-set',
  events_total: 47,
});

const done = (): RunnerStatus => ({
  scenario:     'demo-set',
  state:        'done',
  events_total: 47,
  events_sent:  47,
  errors:       0,
  started_at:   '2026-01-01T00:00:00Z',
  finished_at:  '2026-01-01T00:01:00Z',
});

describe('DemoController', () => {
  let controller: DemoController;
  let service: jest.Mocked<Omit<DemoService, 'stream$'>> & { stream$: Subject<unknown> };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DemoController],
      providers: [
        {
          provide: DemoService,
          useValue: {
            getStatus:    jest.fn(),
            getScenarios: jest.fn(),
            start:        jest.fn(),
            stop:         jest.fn(),
            reset:        jest.fn(),
            stream$:      new Subject(),
          },
        },
      ],
    }).compile();

    controller = module.get(DemoController);
    service    = module.get(DemoService) as any;
  });

  // ── Status ────────────────────────────────────────────────────────────────

  describe('GET /demo/status', () => {
    it('returns DemoStatus from service', () => {
      service.getStatus.mockReturnValue(idle());
      expect(controller.status()).toEqual(idle());
    });
  });

  // ── Scenarios list ────────────────────────────────────────────────────────

  describe('GET /demo/scenarios', () => {
    it('wraps scenario names in items array', () => {
      service.getScenarios.mockReturnValue(['demo-set', 'custom']);
      expect(controller.scenarios()).toEqual({ items: ['demo-set', 'custom'] });
    });
  });

  // ── Run ───────────────────────────────────────────────────────────────────

  describe('POST /demo/scenarios/:name/run', () => {
    it('transitions idle → running', async () => {
      service.start.mockResolvedValue(running());
      const result = await controller.run('demo-set', {});
      expect(service.start).toHaveBeenCalledWith('demo-set', undefined);
      expect(result.state).toBe('running');
    });

    it('passes delay_ms from request body', async () => {
      service.start.mockResolvedValue(running());
      await controller.run('demo-set', { delay_ms: 500 });
      expect(service.start).toHaveBeenCalledWith('demo-set', 500);
    });

    it('is idempotent — calling run twice invokes start twice (service owns idempotency)', async () => {
      service.start.mockResolvedValue(running());
      await controller.run('demo-set', {});
      await controller.run('demo-set', {});
      expect(service.start).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundException when scenario not found', async () => {
      service.start.mockRejectedValue(new Error("Scenario 'nope' not found"));
      await expect(controller.run('nope', {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── Stop ──────────────────────────────────────────────────────────────────

  describe('POST /demo/scenarios/:name/stop', () => {
    it('returns failed state after stop', () => {
      const failed = idle({ state: 'failed', scenario: 'demo-set' });
      service.stop.mockReturnValue(failed);
      const result = controller.stop('demo-set');
      expect(result.state).toBe('failed');
      expect(service.stop).toHaveBeenCalledWith('demo-set');
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────────────

  describe('POST /demo/reset', () => {
    it('returns idle status with zeroed counters', () => {
      service.reset.mockReturnValue(idle());
      const result = controller.reset();
      expect(result).toEqual(idle());
    });
  });

  // ── State machine via service ──────────────────────────────────────────────

  describe('idle → running → done lifecycle', () => {
    it('follows expected state progression', async () => {
      service.getStatus
        .mockReturnValueOnce(idle())
        .mockReturnValueOnce(running())
        .mockReturnValueOnce(done());

      expect(controller.status().state).toBe('idle');

      service.start.mockResolvedValue(running());
      const afterRun = await controller.run('demo-set', {});
      expect(afterRun.state).toBe('running');

      // Simulate polling until done
      expect(controller.status().state).toBe('running');
      expect(controller.status().state).toBe('done');
    });
  });
});
