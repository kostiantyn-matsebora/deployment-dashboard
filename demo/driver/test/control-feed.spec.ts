/**
 * ControlFeed unit tests.
 *
 * Verifies the RxJS Subject fan-out semantics required by §4.8:
 * - publish() delivers frames to subscribers of frames$.
 * - Multiple concurrent subscribers each receive every published frame (fan-out).
 * - A late subscriber receives ONLY post-subscription frames (no replay — hot Subject).
 */

import { ControlFeed, ControlFrame } from '../src/control/control-feed';

describe('ControlFeed', () => {
  let feed: ControlFeed;

  beforeEach(() => {
    feed = new ControlFeed();
  });

  describe('publish() delivers to a single subscriber', () => {
    it('delivers a frame published after subscription', () => {
      const received: ControlFrame[] = [];
      feed.frames$.subscribe(f => received.push(f));

      const frame: ControlFrame = { id: 'abc', type: 'reset-initiated', data: '{"id":"abc"}' };
      feed.publish(frame);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(frame);
    });

    it('delivers multiple consecutive frames in order', () => {
      const received: ControlFrame[] = [];
      feed.frames$.subscribe(f => received.push(f));

      const f1: ControlFrame = { type: 'reset-initiated', data: '{"a":1}' };
      const f2: ControlFrame = { type: 'reset-completed', data: '{"b":2}' };
      feed.publish(f1);
      feed.publish(f2);

      expect(received).toHaveLength(2);
      expect(received[0]).toEqual(f1);
      expect(received[1]).toEqual(f2);
    });
  });

  describe('fan-out to multiple concurrent subscribers', () => {
    it('delivers every frame to each concurrent subscriber', () => {
      const received1: ControlFrame[] = [];
      const received2: ControlFrame[] = [];
      const received3: ControlFrame[] = [];

      feed.frames$.subscribe(f => received1.push(f));
      feed.frames$.subscribe(f => received2.push(f));
      feed.frames$.subscribe(f => received3.push(f));

      const frame: ControlFrame = { type: 'reset-started', data: '{"reset_id":"xyz"}' };
      feed.publish(frame);

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      expect(received3).toHaveLength(1);
      expect(received1[0]).toEqual(frame);
      expect(received2[0]).toEqual(frame);
      expect(received3[0]).toEqual(frame);
    });

    it('delivers all frames to all subscribers when multiple frames are published', () => {
      const received1: ControlFrame[] = [];
      const received2: ControlFrame[] = [];

      feed.frames$.subscribe(f => received1.push(f));
      feed.frames$.subscribe(f => received2.push(f));

      feed.publish({ type: 'reset-initiated', data: '{"id":"1"}' });
      feed.publish({ type: 'reset-completed', data: '{"reset_id":"1"}' });

      expect(received1).toHaveLength(2);
      expect(received2).toHaveLength(2);
    });
  });

  describe('no replay — late subscriber receives only post-subscription frames', () => {
    it('late subscriber does not receive frames published before it subscribed', () => {
      const earlyFrames: ControlFrame[] = [];
      const lateFrames: ControlFrame[] = [];

      feed.frames$.subscribe(f => earlyFrames.push(f));

      // Publish a frame before the late subscriber joins.
      feed.publish({ type: 'reset-initiated', data: '{"id":"pre"}' });

      // Late subscriber joins after the first frame was published.
      feed.frames$.subscribe(f => lateFrames.push(f));

      // Publish a second frame — both subscribers should receive this one.
      feed.publish({ type: 'reset-completed', data: '{"reset_id":"pre"}' });

      expect(earlyFrames).toHaveLength(2);   // received both frames
      expect(lateFrames).toHaveLength(1);    // only the post-subscription frame
      expect(lateFrames[0].type).toBe('reset-completed');
    });

    it('late subscriber receives zero frames when no frames are published after it subscribes', () => {
      feed.publish({ type: 'reset-initiated', data: '{"id":"early"}' });

      const lateFrames: ControlFrame[] = [];
      feed.frames$.subscribe(f => lateFrames.push(f));

      // No further publishes.
      expect(lateFrames).toHaveLength(0);
    });
  });

  describe('unknown types are published verbatim (forward-compat)', () => {
    it('publishes a frame with an unknown type without modification', () => {
      const received: ControlFrame[] = [];
      feed.frames$.subscribe(f => received.push(f));

      feed.publish({ type: 'future-unknown-type', data: '{"field":"value"}' });

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('future-unknown-type');
    });
  });
});
