import { ControlEventsClient } from '../src/control/control-events.client';

const BASE_URL     = 'http://localhost:3000';
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

    it('sends correct event_type=reset-ack and state=paused', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postResetAck(RESET_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.event_type).toBe('reset-ack');
      expect(body.state).toBe('paused');
    });

    it('includes payload.reset_id matching the provided reset_id', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postResetAck(RESET_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload.reset_id).toBe(RESET_ID);
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

  describe('postStatusRunning', () => {
    it('sends event_type=status and state=running', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postStatusRunning(RESET_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.event_type).toBe('status');
      expect(body.state).toBe('running');
    });

    it('includes payload.reset_id', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postStatusRunning(RESET_ID);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload.reset_id).toBe(RESET_ID);
    });

    it('sends X-Api-Key and X-Component-Id headers', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
      await makeClient(mockFetch).postStatusRunning(RESET_ID);
      const { headers } = mockFetch.mock.calls[0][1];
      expect(headers['X-Api-Key']).toBe(API_KEY);
      expect(headers['X-Component-Id']).toBe(COMPONENT_ID);
    });
  });
});
