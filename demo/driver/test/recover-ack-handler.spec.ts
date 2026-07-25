import { RecoverAckHandler } from '../src/control/recover-ack-handler';
import { ControlEventsClient } from '../src/control/control-events.client';

const CORRELATION_ID = '01J9G5A1B2C3D4E5F6G7H8J9K0';

function makeEventsClient(): jest.Mocked<ControlEventsClient> {
  return {
    postRecoverAck:    jest.fn().mockResolvedValue(undefined),
    postStatusRunning: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ControlEventsClient>;
}

describe('RecoverAckHandler (#423, D18)', () => {
  describe('onRecoverInitiated', () => {
    it('posts a recover-ack via the registered events client', async () => {
      const handler = new RecoverAckHandler();
      const client  = makeEventsClient();
      handler.registerEventsClient(client);

      await handler.onRecoverInitiated(CORRELATION_ID);

      expect(client.postRecoverAck).toHaveBeenCalledWith(CORRELATION_ID);
    });

    it('does not throw when no events client is registered', async () => {
      const handler = new RecoverAckHandler();
      await expect(handler.onRecoverInitiated(CORRELATION_ID)).resolves.toBeUndefined();
    });
  });

  describe('onRecoverStarted', () => {
    it('is a no-op — does not call the events client', () => {
      const handler = new RecoverAckHandler();
      const client  = makeEventsClient();
      handler.registerEventsClient(client);

      handler.onRecoverStarted(CORRELATION_ID);

      expect(client.postRecoverAck).not.toHaveBeenCalled();
      expect(client.postStatusRunning).not.toHaveBeenCalled();
    });
  });

  describe('onRecoverCompleted', () => {
    it('posts a running status via postStatusRunning (reused event_type)', async () => {
      const handler = new RecoverAckHandler();
      const client  = makeEventsClient();
      handler.registerEventsClient(client);

      await handler.onRecoverCompleted(CORRELATION_ID);

      expect(client.postStatusRunning).toHaveBeenCalledWith(CORRELATION_ID);
    });

    it('does not throw when no events client is registered', async () => {
      const handler = new RecoverAckHandler();
      await expect(handler.onRecoverCompleted(CORRELATION_ID)).resolves.toBeUndefined();
    });
  });

  describe('isolation from ResetCoordinator state', () => {
    it('never touches reset/block state — the class has no such concept', () => {
      const handler = new RecoverAckHandler();
      // RecoverAckHandler exposes only the recover-* handlers and the events
      // client registration — no resetState/resetId/blocked surface at all.
      expect((handler as unknown as { resetState?: unknown }).resetState).toBeUndefined();
      expect((handler as unknown as { stopWork?: unknown }).stopWork).toBeUndefined();
      expect((handler as unknown as { unblockWork?: unknown }).unblockWork).toBeUndefined();
    });
  });
});
