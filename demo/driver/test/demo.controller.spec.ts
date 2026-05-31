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
            startIngest:  jest.fn(),
            stopIngest:   jest.fn(),
            getEmitStatus: jest.fn(),
            setEmit:      jest.fn(),
            resetApi:     jest.fn(),
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

  // ── Scenarios list (legacy) ───────────────────────────────────────────────

  describe('GET /demo/scenarios', () => {
    it('wraps scenario names in items array', () => {
      service.getScenarios.mockReturnValue(['demo-set', 'custom']);
      expect(controller.scenarios()).toEqual({ items: ['demo-set', 'custom'] });
    });
  });

  // ── Run / Stop (legacy) ───────────────────────────────────────────────────

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

  describe('POST /demo/scenarios/:name/stop', () => {
    it('returns failed state after stop', () => {
      const failed = idle({ state: 'failed', scenario: 'demo-set' });
      service.stop.mockReturnValue(failed);
      const result = controller.stop('demo-set');
      expect(result.state).toBe('failed');
      expect(service.stop).toHaveBeenCalledWith('demo-set');
    });
  });

  // ── Reset (driver state) ──────────────────────────────────────────────────

  describe('POST /demo/reset', () => {
    it('returns idle status with zeroed counters', () => {
      service.reset.mockReturnValue(idle());
      const result = controller.reset();
      expect(result).toEqual(idle());
    });
  });

  // ── Ingest ────────────────────────────────────────────────────────────────

  describe('POST /demo/ingest', () => {
    it('calls service.startIngest with the request body', async () => {
      service.startIngest.mockResolvedValue(running());
      const result = await controller.ingest({ dataset: 'demo', reset: false });
      expect(service.startIngest).toHaveBeenCalledWith({ dataset: 'demo', reset: false });
      expect(result.state).toBe('running');
    });

    it('passes random dataset options', async () => {
      service.startIngest.mockResolvedValue(running());
      await controller.ingest({ dataset: 'random', count: 30, delay_ms: 100 });
      expect(service.startIngest).toHaveBeenCalledWith({ dataset: 'random', count: 30, delay_ms: 100 });
    });

    it('accepts empty body (all defaults)', async () => {
      service.startIngest.mockResolvedValue(idle());
      await controller.ingest({});
      expect(service.startIngest).toHaveBeenCalledWith({});
    });

    it('throws NotFoundException when no demo scenario is available', async () => {
      service.startIngest.mockRejectedValue(new Error('No demo scenario available'));
      await expect(controller.ingest({ dataset: 'demo' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is idempotent — returns running status when already running', async () => {
      service.startIngest.mockResolvedValue(running());
      const first  = await controller.ingest({ dataset: 'demo' });
      const second = await controller.ingest({ dataset: 'demo' });
      expect(first.state).toBe('running');
      expect(second.state).toBe('running');
    });
  });

  describe('POST /demo/ingest/stop', () => {
    it('calls service.stopIngest and returns updated status', () => {
      const failed = idle({ state: 'failed', scenario: 'demo-set' });
      service.stopIngest.mockReturnValue(failed);
      const result = controller.ingestStop();
      expect(service.stopIngest).toHaveBeenCalled();
      expect(result.state).toBe('failed');
    });
  });

  // ── Live Emission ─────────────────────────────────────────────────────────

  describe('GET /demo/emit', () => {
    it('returns emit status from service', () => {
      service.getEmitStatus.mockReturnValue({ emitting: false });
      expect(controller.getEmit()).toEqual({ emitting: false });
    });

    it('reflects live state when enabled', () => {
      service.getEmitStatus.mockReturnValue({ emitting: true });
      expect(controller.getEmit()).toEqual({ emitting: true });
    });
  });

  describe('POST /demo/emit', () => {
    it('enables emission when enabled=true', () => {
      service.setEmit.mockReturnValue({ emitting: true });
      const result = controller.postEmit({ enabled: true });
      expect(service.setEmit).toHaveBeenCalledWith(true);
      expect(result).toEqual({ emitting: true });
    });

    it('disables emission when enabled=false', () => {
      service.setEmit.mockReturnValue({ emitting: false });
      const result = controller.postEmit({ enabled: false });
      expect(service.setEmit).toHaveBeenCalledWith(false);
      expect(result).toEqual({ emitting: false });
    });

    it('passes undefined (toggle) when enabled is omitted', () => {
      service.setEmit.mockReturnValue({ emitting: true });
      controller.postEmit({});
      expect(service.setEmit).toHaveBeenCalledWith(undefined);
    });
  });

  // ── API Reset ─────────────────────────────────────────────────────────────

  describe('POST /demo/api-reset', () => {
    it('returns ok=true on successful reset', async () => {
      service.resetApi.mockResolvedValue({ ok: true, http_status: 204 });
      const result = await controller.apiReset();
      expect(result).toEqual({ ok: true, http_status: 204 });
    });

    it('returns ok=false when target returns 401', async () => {
      service.resetApi.mockResolvedValue({ ok: false, http_status: 401 });
      const result = await controller.apiReset();
      expect(result.ok).toBe(false);
      expect(result.http_status).toBe(401);
    });

    it('returns ok=false with http_status=0 on network error', async () => {
      service.resetApi.mockResolvedValue({ ok: false, http_status: 0 });
      const result = await controller.apiReset();
      expect(result.ok).toBe(false);
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

      expect(controller.status().state).toBe('running');
      expect(controller.status().state).toBe('done');
    });
  });
});
