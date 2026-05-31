import { ResetCoordinator, ResetParticipant } from '../src/control/reset-coordinator';
import { ControlEventsClient } from '../src/control/control-events.client';

const RESET_ID = '01J9F4WZK3W9G2T6X4QH3DKQF6';

function makeCoordinator(): ResetCoordinator {
  return new ResetCoordinator();
}

function makeParticipant(): jest.Mocked<ResetParticipant> {
  return {
    stopWork:    jest.fn(),
    unblockWork: jest.fn(),
  };
}

function makeEventsClient(): jest.Mocked<ControlEventsClient> {
  return {
    postResetAck:      jest.fn().mockResolvedValue(undefined),
    postStatusRunning: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ControlEventsClient>;
}

describe('ResetCoordinator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts in idle reset_state', () => {
      const coord = makeCoordinator();
      expect(coord.resetState).toBe('idle');
      expect(coord.resetId).toBeNull();
    });
  });

  describe('onResetInitiated', () => {
    it('transitions to blocked and records reset_id', async () => {
      const coord       = makeCoordinator();
      const participant = makeParticipant();
      const client      = makeEventsClient();
      coord.registerParticipant(participant);
      coord.registerEventsClient(client);

      await coord.onResetInitiated(RESET_ID);

      expect(coord.resetState).toBe('blocked');
      expect(coord.resetId).toBe(RESET_ID);
    });

    it('calls participant.stopWork()', async () => {
      const coord       = makeCoordinator();
      const participant = makeParticipant();
      coord.registerParticipant(participant);
      coord.registerEventsClient(makeEventsClient());

      await coord.onResetInitiated(RESET_ID);

      expect(participant.stopWork).toHaveBeenCalledTimes(1);
    });

    it('posts reset-ack with the correct reset_id', async () => {
      const coord  = makeCoordinator();
      const client = makeEventsClient();
      coord.registerParticipant(makeParticipant());
      coord.registerEventsClient(client);

      await coord.onResetInitiated(RESET_ID);

      expect(client.postResetAck).toHaveBeenCalledWith(RESET_ID);
    });

    it('is idempotent — duplicate reset-initiated is ignored', async () => {
      const coord  = makeCoordinator();
      const client = makeEventsClient();
      const participant = makeParticipant();
      coord.registerParticipant(participant);
      coord.registerEventsClient(client);

      await coord.onResetInitiated(RESET_ID);
      await coord.onResetInitiated(RESET_ID);

      // Only one ack posted.
      expect(client.postResetAck).toHaveBeenCalledTimes(1);
    });
  });

  describe('onResetStarted', () => {
    it('is a no-op — state stays blocked, no ack posted', async () => {
      const coord  = makeCoordinator();
      const client = makeEventsClient();
      coord.registerParticipant(makeParticipant());
      coord.registerEventsClient(client);

      await coord.onResetInitiated(RESET_ID);
      client.postResetAck.mockClear();

      coord.onResetStarted(RESET_ID);

      expect(coord.resetState).toBe('blocked');
      expect(client.postResetAck).not.toHaveBeenCalled();
    });
  });

  describe('onResetCompleted', () => {
    it('transitions to idle and clears reset_id', async () => {
      const coord = makeCoordinator();
      coord.registerParticipant(makeParticipant());
      coord.registerEventsClient(makeEventsClient());

      await coord.onResetInitiated(RESET_ID);
      await coord.onResetCompleted(RESET_ID);

      expect(coord.resetState).toBe('idle');
      expect(coord.resetId).toBeNull();
    });

    it('calls participant.unblockWork()', async () => {
      const coord       = makeCoordinator();
      const participant = makeParticipant();
      coord.registerParticipant(participant);
      coord.registerEventsClient(makeEventsClient());

      await coord.onResetInitiated(RESET_ID);
      await coord.onResetCompleted(RESET_ID);

      expect(participant.unblockWork).toHaveBeenCalledTimes(1);
    });

    it('posts status/running with the reset_id', async () => {
      const coord  = makeCoordinator();
      const client = makeEventsClient();
      coord.registerParticipant(makeParticipant());
      coord.registerEventsClient(client);

      await coord.onResetInitiated(RESET_ID);
      await coord.onResetCompleted(RESET_ID);

      expect(client.postStatusRunning).toHaveBeenCalledWith(RESET_ID);
    });

    it('does NOT auto-restart work (no stopWork call after completed)', async () => {
      const coord       = makeCoordinator();
      const participant = makeParticipant();
      coord.registerParticipant(participant);
      coord.registerEventsClient(makeEventsClient());

      await coord.onResetInitiated(RESET_ID);
      participant.stopWork.mockClear();

      await coord.onResetCompleted(RESET_ID);

      expect(participant.stopWork).not.toHaveBeenCalled();
    });

    it('is a no-op when not in blocked state', async () => {
      const coord  = makeCoordinator();
      const client = makeEventsClient();
      coord.registerParticipant(makeParticipant());
      coord.registerEventsClient(client);

      // No reset-initiated first.
      await coord.onResetCompleted(RESET_ID);

      expect(client.postStatusRunning).not.toHaveBeenCalled();
      expect(coord.resetState).toBe('idle');
    });
  });

  describe('RESET_GATE_MAX_TTL_MS safety unblock', () => {
    it('auto-unblocks when no reset-completed arrives within gate TTL', async () => {
      process.env.RESET_GATE_MAX_TTL_MS = '5000';

      const coord       = makeCoordinator();
      const participant = makeParticipant();
      const client      = makeEventsClient();
      coord.registerParticipant(participant);
      coord.registerEventsClient(client);

      await coord.onResetInitiated(RESET_ID);
      expect(coord.resetState).toBe('blocked');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Advance past the TTL.
      await jest.advanceTimersByTimeAsync(5001);

      expect(coord.resetState).toBe('idle');
      expect(participant.unblockWork).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('safety-unblocking'),
      );

      // Does NOT post running event on safety unblock.
      expect(client.postStatusRunning).not.toHaveBeenCalled();

      warnSpy.mockRestore();
      delete process.env.RESET_GATE_MAX_TTL_MS;
    });

    it('does NOT fire safety unblock when reset-completed arrives in time', async () => {
      process.env.RESET_GATE_MAX_TTL_MS = '5000';

      const coord  = makeCoordinator();
      const client = makeEventsClient();
      coord.registerParticipant(makeParticipant());
      coord.registerEventsClient(client);

      await coord.onResetInitiated(RESET_ID);
      await coord.onResetCompleted(RESET_ID);

      // Advance past what would have been the safety TTL.
      await jest.advanceTimersByTimeAsync(6000);

      // Still only one postStatusRunning call (from the real reset-completed).
      expect(client.postStatusRunning).toHaveBeenCalledTimes(1);
      expect(coord.resetState).toBe('idle');

      delete process.env.RESET_GATE_MAX_TTL_MS;
    });
  });
});
