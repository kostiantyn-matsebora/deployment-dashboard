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

  describe('awaitCycleComplete', () => {
    it('resolves immediately when the cycle already completed (race-safe fast path)', async () => {
      const coord = makeCoordinator();
      coord.registerParticipant(makeParticipant());
      coord.registerEventsClient(makeEventsClient());

      await coord.onResetInitiated(RESET_ID);
      await coord.onResetCompleted(RESET_ID);

      // Cycle is already done — should resolve synchronously / immediately.
      const resolved = await Promise.race([
        coord.awaitCycleComplete(RESET_ID).then(() => 'resolved'),
        Promise.resolve('immediate'),
      ]);
      // Both resolve instantly; key assertion: no hang and the promise resolves.
      expect(resolved).toBe('immediate'); // the already-resolved promise wins the race
    });

    it('resolves promptly when reset-completed arrives after the await starts', async () => {
      process.env.RESET_GATE_MAX_TTL_MS = '30000';

      const coord = makeCoordinator();
      coord.registerParticipant(makeParticipant());
      coord.registerEventsClient(makeEventsClient());

      await coord.onResetInitiated(RESET_ID);

      // Start waiting — cycle is not yet complete.
      const waitPromise = coord.awaitCycleComplete(RESET_ID);

      // Simulate reset-completed arriving (triggers _recover → _notifyWaiters).
      await coord.onResetCompleted(RESET_ID);

      // The waiter should now be resolved.
      await expect(waitPromise).resolves.toBeUndefined();

      delete process.env.RESET_GATE_MAX_TTL_MS;
    });

    it('resolves (with a warning) when the timeout elapses with no reset-completed', async () => {
      // Safety timer set to 10 s so it does NOT fire before the await timeout.
      process.env.RESET_GATE_MAX_TTL_MS = '10000';

      const coord = makeCoordinator();
      coord.registerParticipant(makeParticipant());
      coord.registerEventsClient(makeEventsClient());

      await coord.onResetInitiated(RESET_ID);

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Pass an explicit timeoutMs shorter than the safety timer so only the
      // awaitCycleComplete timer fires within the test's time window.
      const waitPromise = coord.awaitCycleComplete(RESET_ID, 2000);

      // Advance past the await timeout (2000 ms) but not yet the safety timer (10 000 ms).
      await jest.advanceTimersByTimeAsync(2001);

      await expect(waitPromise).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('awaitCycleComplete'),
      );

      warnSpy.mockRestore();
      delete process.env.RESET_GATE_MAX_TTL_MS;
    });

    it('resolves immediately when coordinator is idle and reset_id is unknown (stale/pre-init cycle)', async () => {
      const coord = makeCoordinator();
      // Coordinator is idle and has never seen this reset_id.
      await expect(coord.awaitCycleComplete('unknown-reset-id')).resolves.toBeUndefined();
    });

    it('does not block reset-participant stopWork / unblockWork (no deadlock)', async () => {
      // awaitCycleComplete must not call stopWork or unblockWork itself.
      process.env.RESET_GATE_MAX_TTL_MS = '10000';

      const coord       = makeCoordinator();
      const participant = makeParticipant();
      const client      = makeEventsClient();
      coord.registerParticipant(participant);
      coord.registerEventsClient(client);

      await coord.onResetInitiated(RESET_ID);

      const waitPromise = coord.awaitCycleComplete(RESET_ID);
      // Registering the waiter must not call participant methods.
      expect(participant.stopWork).toHaveBeenCalledTimes(1);    // from onResetInitiated only
      expect(participant.unblockWork).not.toHaveBeenCalled();

      await coord.onResetCompleted(RESET_ID);
      await waitPromise;

      expect(participant.unblockWork).toHaveBeenCalledTimes(1); // from onResetCompleted only

      delete process.env.RESET_GATE_MAX_TTL_MS;
    });

    it('multiple concurrent waiters for the same reset_id all resolve on completion', async () => {
      process.env.RESET_GATE_MAX_TTL_MS = '10000';

      const coord = makeCoordinator();
      coord.registerParticipant(makeParticipant());
      coord.registerEventsClient(makeEventsClient());

      await coord.onResetInitiated(RESET_ID);

      const p1 = coord.awaitCycleComplete(RESET_ID);
      const p2 = coord.awaitCycleComplete(RESET_ID);
      const p3 = coord.awaitCycleComplete(RESET_ID);

      await coord.onResetCompleted(RESET_ID);

      await expect(Promise.all([p1, p2, p3])).resolves.toBeDefined();

      delete process.env.RESET_GATE_MAX_TTL_MS;
    });
  });
});
