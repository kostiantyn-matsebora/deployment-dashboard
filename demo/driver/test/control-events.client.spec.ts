import { ControlEventsClient } from '../src/control/control-events.client';

const BASE_URL     = 'http://localhost:3002';
const API_KEY      = 'api-secret';
const COMPONENT_ID = 'demo-driver';
const RESET_ID     = '01J9F4WZK3W9G2T6X4QH3DKQF6';

function makeClient(mockFetch: jest.Mock, componentId = COMPONENT_ID) {
  return new ControlEventsClient(BASE_URL, API_KEY, componentId, mockFetch as any);
}

describe('ControlEventsClient', () => {
  describe('postResetAck', () => {
    it('POSTs to /api/control/events', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postResetAck(RESET_ID);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/control/events`,
        expect.any(Object),
      );
    });

    it('uses POST method', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postResetAck(RESET_ID);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    });

    it('sends X-Api-Key header', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postResetAck(RESET_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Api-Key']).toBe(API_KEY);
    });

    it('sends X-Component-Id: demo-driver', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postResetAck(RESET_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Component-Id']).toBe(COMPONENT_ID);
    });

    it('sends X-Correlation-Id matching the reset id', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postResetAck(RESET_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Correlation-Id']).toBe(RESET_ID);
    });

    it('sends correct event_type=reset-ack and state=paused', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postResetAck(RESET_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.event_type).toBe('reset-ack');
      expect(body.state).toBe('paused');
    });

    it('does NOT include payload.reset_id in the body', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postResetAck(RESET_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload?.reset_id).toBeUndefined();
    });

    it('includes occurred_at as a valid ISO string', async () => {
      const before = new Date().toISOString();
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postResetAck(RESET_ID);
      const after = new Date().toISOString();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.occurred_at >= before).toBe(true);
      expect(body.occurred_at <= after).toBe(true);
    });

    it('uses the componentId from constructor (COMPONENT_ID env)', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch, 'custom-driver').postResetAck(RESET_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Component-Id']).toBe('custom-driver');
    });

    it('does not throw on network error — logs and swallows', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network'));
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(makeClient(mockFetch).postResetAck(RESET_ID)).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });
  });

  describe('postRecoverAck (#423, D18)', () => {
    it('POSTs to /api/control/events', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRecoverAck(RESET_ID);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/control/events`,
        expect.any(Object),
      );
    });

    it('uses POST method', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRecoverAck(RESET_ID);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    });

    it('sends correct event_type=recover-ack and state=paused (distinct from reset-ack)', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRecoverAck(RESET_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.event_type).toBe('recover-ack');
      expect(body.state).toBe('paused');
    });

    it('sends X-Api-Key and X-Component-Id headers', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRecoverAck(RESET_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Api-Key']).toBe(API_KEY);
      expect(headers['X-Component-Id']).toBe(COMPONENT_ID);
    });

    it('sends X-Correlation-Id matching the correlation id', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRecoverAck(RESET_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Correlation-Id']).toBe(RESET_ID);
    });

    it('includes occurred_at as a valid ISO string', async () => {
      const before = new Date().toISOString();
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRecoverAck(RESET_ID);
      const after = new Date().toISOString();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.occurred_at >= before).toBe(true);
      expect(body.occurred_at <= after).toBe(true);
    });

    it('does not throw on network error — logs and swallows', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network'));
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(makeClient(mockFetch).postRecoverAck(RESET_ID)).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });
  });

  describe('postStatusRunning', () => {
    it('sends event_type=status and state=running', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postStatusRunning(RESET_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.event_type).toBe('status');
      expect(body.state).toBe('running');
    });

    it('does NOT include payload.reset_id in the body', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postStatusRunning(RESET_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload?.reset_id).toBeUndefined();
    });

    it('sends X-Api-Key and X-Component-Id headers', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postStatusRunning(RESET_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Api-Key']).toBe(API_KEY);
      expect(headers['X-Component-Id']).toBe(COMPONENT_ID);
    });

    it('sends X-Correlation-Id matching the reset id', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postStatusRunning(RESET_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Correlation-Id']).toBe(RESET_ID);
    });
  });

  describe('postRunStart', () => {
    const RUN_ID = 'run-00000000-1111-2222-3333-444444444444';

    it('sends event_type=status and state=running', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRunStart(RUN_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.event_type).toBe('status');
      expect(body.state).toBe('running');
    });

    it('does NOT include payload.run_id in the body', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRunStart(RUN_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload?.run_id).toBeUndefined();
    });

    it('includes payload.detail when provided', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRunStart(RUN_ID, 'ingest demo started');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload.detail).toBe('ingest demo started');
    });

    it('omits payload entirely when detail is not provided', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRunStart(RUN_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload).toBeUndefined();
    });

    it('sends X-Correlation-Id matching the runId', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRunStart(RUN_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Correlation-Id']).toBe(RUN_ID);
    });

    it('sends X-Api-Key and X-Component-Id headers', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRunStart(RUN_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Api-Key']).toBe(API_KEY);
      expect(headers['X-Component-Id']).toBe(COMPONENT_ID);
    });

    it('distinct run ids produce distinct X-Correlation-Id values', async () => {
      const RUN_ID_2  = 'run-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      const client    = makeClient(mockFetch);
      await client.postRunStart(RUN_ID);
      await client.postRunStart(RUN_ID_2);
      const corr1 = mockFetch.mock.calls[0][1].headers['X-Correlation-Id'];
      const corr2 = mockFetch.mock.calls[1][1].headers['X-Correlation-Id'];
      expect(corr1).toBe(RUN_ID);
      expect(corr2).toBe(RUN_ID_2);
      expect(corr1).not.toBe(corr2);
    });
  });

  describe('postRunComplete', () => {
    const RUN_ID = 'run-00000000-1111-2222-3333-444444444444';

    it('sends event_type=status and state=idle', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRunComplete(RUN_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.event_type).toBe('status');
      expect(body.state).toBe('idle');
    });

    it('does NOT include payload.run_id in the body', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRunComplete(RUN_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload?.run_id).toBeUndefined();
    });

    it('sends X-Correlation-Id matching the runId', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postRunComplete(RUN_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Correlation-Id']).toBe(RUN_ID);
    });

    it('run-start and run-complete for same runId share the correlation id', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      const client    = makeClient(mockFetch);
      await client.postRunStart(RUN_ID, 'ingest started');
      await client.postRunComplete(RUN_ID);
      const corrStart    = mockFetch.mock.calls[0][1].headers['X-Correlation-Id'];
      const corrComplete = mockFetch.mock.calls[1][1].headers['X-Correlation-Id'];
      expect(corrStart).toBe(RUN_ID);
      expect(corrComplete).toBe(RUN_ID);
    });
  });
});
