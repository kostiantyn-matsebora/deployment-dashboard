import { Test, TestingModule } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { NotFoundException } from '@nestjs/common';
import { DemoController } from '../src/demo/demo.controller';
import { DemoService, DemoStatus } from '../src/demo/demo.service';
import { RunnerStatus } from '../src/scenarios/scenario-runner';
import { Response } from 'express';
import { ControlFeed } from '../src/control/control-feed';
import { ControlEventsReadClient } from '../src/control/control-events-read.client';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const idle = (overrides: Partial<DemoStatus> = {}): DemoStatus => ({
  scenario:     null,
  state:        'idle',
  events_total: 0,
  events_sent:  0,
  errors:       0,
  started_at:   null,
  finished_at:  null,
  reset_state:  'idle',
  reset_id:     null,
  ...overrides,
});

const running = (): DemoStatus => idle({
  state:        'running',
  scenario:     'demo-set',
  events_total: 47,
});

const done = (): DemoStatus => ({
  scenario:     'demo-set',
  state:        'done',
  events_total: 47,
  events_sent:  47,
  errors:       0,
  started_at:   '2026-01-01T00:00:00Z',
  finished_at:  '2026-01-01T00:01:00Z',
  reset_state:  'idle',
  reset_id:     null,
});

const blocked = (): DemoStatus => idle({
  state:       'blocked',
  reset_state: 'blocked',
  reset_id:    '01J9F4WZK3W9G2T6X4QH3DKQF6',
});

/** Build a minimal mock Express Response for testing guardNotBlocked. */
function makeMockRes(overrides: Partial<Response> = {}): Response {
  const headers: Record<string, string> = {};
  let _headersSent = false;
  const res: Partial<Response> = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json:   jest.fn().mockImplementation(() => { _headersSent = true; return res as Response; }),
    setHeader: jest.fn().mockImplementation((k: string, v: string) => { headers[k] = v; return res as Response; }),
    ...overrides,
  };
  Object.defineProperty(res, 'headersSent', {
    get: () => _headersSent,
    configurable: true,
  });
  return res as Response;
}

/**
 * Build a minimal mock SSE Express Response for testing streaming endpoints.
 * Captures write() calls so tests can inspect emitted chunks.
 */
function makeSseRes(): Response & { _written: string[]; _closed: boolean; _closeHandler?: () => void } {
  const written: string[] = [];
  let closed = false;
  let closeHandler: (() => void) | undefined;

  const res: any = {
    _written: written,
    _closed: closed,
    setHeader:     jest.fn().mockReturnThis(),
    flushHeaders:  jest.fn(),
    write:         jest.fn().mockImplementation((chunk: string) => { written.push(chunk); }),
    end:           jest.fn().mockImplementation(() => { closed = true; }),
    on:            jest.fn().mockImplementation((event: string, cb: () => void) => {
      if (event === 'close') closeHandler = cb;
    }),
    // Expose close trigger for tests.
    simulateClose: () => { if (closeHandler) closeHandler(); },
  };
  Object.defineProperty(res, '_closeHandler', {
    get: () => closeHandler,
    configurable: true,
  });
  return res as Response & { _written: string[]; _closed: boolean; _closeHandler?: () => void };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('DemoController', () => {
  let controller: DemoController;
  let service: jest.Mocked<Omit<DemoService, 'stream$'>> & { stream$: Subject<unknown> };
  let controlFeed: ControlFeed;
  let eventsReadClient: jest.Mocked<ControlEventsReadClient>;

  beforeEach(async () => {
    // Use a real ControlFeed (real RxJS Subject) — no mock.
    controlFeed = new ControlFeed();

    eventsReadClient = {
      list: jest.fn(),
    } as unknown as jest.Mocked<ControlEventsReadClient>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DemoController],
      providers: [
        {
          provide: DemoService,
          useValue: {
            getStatus:             jest.fn(),
            getScenarios:          jest.fn(),
            start:                 jest.fn(),
            stop:                  jest.fn(),
            reset:                 jest.fn(),
            startIngest:           jest.fn(),
            stopIngest:            jest.fn(),
            getEmitStatus:         jest.fn(),
            setEmit:               jest.fn(),
            resetApi:              jest.fn(),
            isBlocked:             jest.fn().mockReturnValue(false),
            getRetryAfterSeconds:  jest.fn().mockReturnValue(90),
            stream$:               new Subject(),
          },
        },
        {
          provide: ControlFeed,
          useValue: controlFeed,
        },
        {
          provide: ControlEventsReadClient,
          useValue: eventsReadClient,
        },
      ],
    }).compile();

    controller = module.get(DemoController);
    service    = module.get(DemoService) as any;
  });

  // ── Status (never blocked) ────────────────────────────────────────────────

  describe('GET /demo/status', () => {
    it('returns DemoStatus from service', () => {
      service.getStatus.mockReturnValue(idle());
      expect(controller.status()).toEqual(idle());
    });

    it('returns blocked state when reset is in progress', () => {
      service.getStatus.mockReturnValue(blocked());
      const result = controller.status();
      expect(result.reset_state).toBe('blocked');
      expect(result.reset_id).toBe('01J9F4WZK3W9G2T6X4QH3DKQF6');
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
      const res = makeMockRes();
      await controller.run('demo-set', {}, res);
      expect(service.start).toHaveBeenCalledWith('demo-set', undefined);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ state: 'running' }));
    });

    it('passes delay_ms from request body', async () => {
      service.start.mockResolvedValue(running());
      const res = makeMockRes();
      await controller.run('demo-set', { delay_ms: 500 }, res);
      expect(service.start).toHaveBeenCalledWith('demo-set', 500);
    });

    it('throws NotFoundException when scenario not found', async () => {
      service.start.mockRejectedValue(new Error("Scenario 'nope' not found"));
      const res = makeMockRes();
      await expect(controller.run('nope', {}, res)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 503 while blocked', async () => {
      service.isBlocked.mockReturnValue(true);
      const res = makeMockRes();
      await controller.run('demo-set', {}, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(service.start).not.toHaveBeenCalled();
    });
  });

  describe('POST /demo/scenarios/:name/stop', () => {
    it('returns failed state after stop', () => {
      const failed = idle({ state: 'failed', scenario: 'demo-set' });
      service.stop.mockReturnValue(failed);
      const res = makeMockRes();
      controller.stop('demo-set', res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed' }));
    });

    it('returns 503 while blocked', () => {
      service.isBlocked.mockReturnValue(true);
      const res = makeMockRes();
      controller.stop('demo-set', res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(service.stop).not.toHaveBeenCalled();
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
      const res = makeMockRes();
      await controller.ingest({ dataset: 'demo', reset: false }, res);
      expect(service.startIngest).toHaveBeenCalledWith({ dataset: 'demo', reset: false });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ state: 'running' }));
    });

    it('returns 503 while blocked', async () => {
      service.isBlocked.mockReturnValue(true);
      const res = makeMockRes();
      await controller.ingest({ dataset: 'demo' }, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(service.startIngest).not.toHaveBeenCalled();
    });

    it('503 body has RFC 9457 shape with type .../reset-in-progress', async () => {
      service.isBlocked.mockReturnValue(true);
      const jsonCalls: unknown[] = [];
      const res = makeMockRes({
        json: jest.fn().mockImplementation((body: unknown) => { jsonCalls.push(body); return res as Response; }),
      } as Partial<Response>);
      await controller.ingest({ dataset: 'demo' }, res);
      const body = jsonCalls[0] as Record<string, unknown>;
      expect(body.type).toBe('https://deployment-dashboard/errors/reset-in-progress');
      expect(body.title).toBe('Reset in progress');
      expect(body.status).toBe(503);
    });

    it('503 response includes Retry-After header', async () => {
      service.isBlocked.mockReturnValue(true);
      service.getRetryAfterSeconds.mockReturnValue(90);
      const res = makeMockRes();
      await controller.ingest({ dataset: 'demo' }, res);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '90');
    });
  });

  describe('POST /demo/ingest/stop', () => {
    it('calls service.stopIngest and returns updated status', () => {
      const failed = idle({ state: 'failed', scenario: 'demo-set' });
      service.stopIngest.mockReturnValue(failed);
      const res = makeMockRes();
      controller.ingestStop(res);
      expect(service.stopIngest).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed' }));
    });

    it('returns 503 while blocked', () => {
      service.isBlocked.mockReturnValue(true);
      const res = makeMockRes();
      controller.ingestStop(res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(service.stopIngest).not.toHaveBeenCalled();
    });
  });

  // ── Live Emission ─────────────────────────────────────────────────────────

  describe('GET /demo/emit', () => {
    it('returns emit status from service', () => {
      service.getEmitStatus.mockReturnValue({ emitting: false });
      expect(controller.getEmit()).toEqual({ emitting: false });
    });
  });

  describe('POST /demo/emit', () => {
    it('enables emission when enabled=true', () => {
      service.setEmit.mockReturnValue({ emitting: true });
      const res = makeMockRes();
      controller.postEmit({ enabled: true }, res);
      expect(service.setEmit).toHaveBeenCalledWith(true);
      expect(res.json).toHaveBeenCalledWith({ emitting: true });
    });

    it('returns 503 while blocked', () => {
      service.isBlocked.mockReturnValue(true);
      const res = makeMockRes();
      controller.postEmit({}, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(service.setEmit).not.toHaveBeenCalled();
    });
  });

  // ── API Reset ─────────────────────────────────────────────────────────────

  describe('POST /demo/api-reset', () => {
    it('returns ok=true on successful reset', async () => {
      service.resetApi.mockResolvedValue({ ok: true, http_status: 202 });
      const res = makeMockRes();
      await controller.apiReset(res);
      expect(res.json).toHaveBeenCalledWith({ ok: true, http_status: 202 });
    });

    it('returns 503 while blocked', async () => {
      service.isBlocked.mockReturnValue(true);
      const res = makeMockRes();
      await controller.apiReset(res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(service.resetApi).not.toHaveBeenCalled();
    });
  });

  // ── GET /demo/status always answers (never blocked by the guard) ──────────

  describe('GET /demo/status is never blocked', () => {
    it('returns status even when isBlocked=true', () => {
      service.isBlocked.mockReturnValue(true);
      service.getStatus.mockReturnValue(blocked());
      // status() does NOT take a Response parameter — no guard applied.
      const result = controller.status();
      expect(result.reset_state).toBe('blocked');
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
      const res = makeMockRes();
      await controller.run('demo-set', {}, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ state: 'running' }));

      expect(controller.status().state).toBe('running');
      expect(controller.status().state).toBe('done');
    });
  });

  // ── GET /demo/control-stream ───────────────────────────────────────────────

  describe('GET /demo/control-stream', () => {
    it('sets SSE headers and calls flushHeaders', () => {
      const res = makeSseRes();
      controller.controlStream(res as unknown as Response);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.flushHeaders).toHaveBeenCalled();
    });

    it('writes frames published to ControlFeed after the connection opens', () => {
      const res = makeSseRes();
      controller.controlStream(res as unknown as Response);

      controlFeed.publish({ type: 'reset-initiated', data: '{"id":"reset-1","component":"*"}' });

      expect(res.write).toHaveBeenCalledWith('event: reset-initiated\n');
      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('{"id":"reset-1","component":"*"}'),
      );
    });

    it('writes the data line for frames without a type', () => {
      const res = makeSseRes();
      controller.controlStream(res as unknown as Response);

      controlFeed.publish({ data: '{"ping":true}' });

      // No event: line; only data: line.
      const written = (res.write as jest.Mock).mock.calls.map((c: any[]) => c[0] as string);
      expect(written.some((s: string) => s.startsWith('data:'))).toBe(true);
    });

    it('writes frames for unknown types (forward-compat)', () => {
      const res = makeSseRes();
      controller.controlStream(res as unknown as Response);

      controlFeed.publish({ type: 'future-type', data: '{"custom":true}' });

      expect(res.write).toHaveBeenCalledWith('event: future-type\n');
    });

    it('does NOT block when reset_state == blocked', () => {
      // Simulate blocked state — the guard should NOT apply to control-stream.
      service.isBlocked.mockReturnValue(true);

      const res = makeSseRes();
      // controlStream does not call guardNotBlocked — invoking it must NOT send a 503.
      expect(() => controller.controlStream(res as unknown as Response)).not.toThrow();
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      // status(503) must never be called.
      expect(res.status).toBeUndefined();
    });

    it('unsubscribes and removes the connection on client close', () => {
      const res = makeSseRes() as any;
      controller.controlStream(res as unknown as Response);

      // Publish once — received.
      controlFeed.publish({ type: 'reset-initiated', data: '{}' });
      const countBefore = (res.write as jest.Mock).mock.calls.length;

      // Simulate client disconnect.
      res.simulateClose();

      // Publish again — should NOT reach the closed connection.
      controlFeed.publish({ type: 'reset-completed', data: '{}' });
      expect((res.write as jest.Mock).mock.calls.length).toBe(countBefore);
    });
  });

  // ── GET /demo/control-events ───────────────────────────────────────────────

  describe('GET /demo/control-events', () => {
    it('proxies the read client and returns its body with the upstream status', async () => {
      const page = { items: [], next_cursor: null };
      eventsReadClient.list.mockResolvedValue({ status: 200, body: page });

      const res = makeMockRes();
      await controller.controlEvents({}, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(page);
    });

    it('mirrors a non-2xx upstream status to the caller', async () => {
      eventsReadClient.list.mockResolvedValue({
        status: 422,
        body: { type: 'about:blank', title: 'Unprocessable', status: 422 },
      });

      const res = makeMockRes();
      await controller.controlEvents({}, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('forwards whitelisted query params to the read client', async () => {
      eventsReadClient.list.mockResolvedValue({ status: 200, body: { items: [], next_cursor: null } });

      const res = makeMockRes();
      await controller.controlEvents(
        { component_id: 'demo-driver', event_type: 'reset-ack', limit: '10' },
        res as unknown as Response,
      );

      expect(eventsReadClient.list).toHaveBeenCalledWith(
        expect.objectContaining({ component_id: 'demo-driver', event_type: 'reset-ack', limit: '10' }),
      );
    });

    it('mirrors 502 (network error from read client) to the caller', async () => {
      eventsReadClient.list.mockResolvedValue({
        status: 502,
        body: { error: 'upstream network error' },
      });

      const res = makeMockRes();
      await controller.controlEvents({}, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(502);
    });

    it('does NOT block when reset_state == blocked', async () => {
      service.isBlocked.mockReturnValue(true);
      eventsReadClient.list.mockResolvedValue({ status: 200, body: { items: [], next_cursor: null } });

      const res = makeMockRes();
      await controller.controlEvents({}, res as unknown as Response);

      // Should proxy normally — no 503 guard.
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
