/**
 * ComponentEventFeed unit tests.
 *
 * Verifies the RxJS Subject fan-out semantics required by §4.9:
 * - publish() delivers frames to subscribers of frames$.
 * - Multiple concurrent subscribers each receive every published frame (fan-out).
 * - A late subscriber receives ONLY post-subscription frames (no replay — hot Subject).
 */

import { ComponentEventFeed, ComponentEventFrame } from '../src/control/component-event-feed';

describe('ComponentEventFeed', () => {
  let feed: ComponentEventFeed;

  beforeEach(() => {
    feed = new ComponentEventFeed();
  });

  describe('publish() delivers to a single subscriber', () => {
    it('delivers a frame published after subscription', () => {
      const received: ComponentEventFrame[] = [];
      feed.frames$.subscribe(f => received.push(f));

      const frame: ComponentEventFrame = { id: 'abc', type: 'component', data: '{"id":"abc"}' };
      feed.publish(frame);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(frame);
    });

    it('delivers multiple consecutive frames in order', () => {
      const received: ComponentEventFrame[] = [];
      feed.frames$.subscribe(f => received.push(f));

      const f1: ComponentEventFrame = { type: 'component', data: '{"id":"1"}' };
      const f2: ComponentEventFrame = { type: 'component', data: '{"id":"2"}' };
      feed.publish(f1);
      feed.publish(f2);

      expect(received).toHaveLength(2);
      expect(received[0]).toEqual(f1);
      expect(received[1]).toEqual(f2);
    });
  });

  describe('fan-out to multiple concurrent subscribers', () => {
    it('delivers every frame to each concurrent subscriber', () => {
      const received1: ComponentEventFrame[] = [];
      const received2: ComponentEventFrame[] = [];
      const received3: ComponentEventFrame[] = [];

      feed.frames$.subscribe(f => received1.push(f));
      feed.frames$.subscribe(f => received2.push(f));
      feed.frames$.subscribe(f => received3.push(f));

      const frame: ComponentEventFrame = { type: 'component', data: '{"state":"running"}' };
      feed.publish(frame);

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      expect(received3).toHaveLength(1);
      expect(received1[0]).toEqual(frame);
      expect(received2[0]).toEqual(frame);
      expect(received3[0]).toEqual(frame);
    });

    it('delivers all frames to all subscribers when multiple frames are published', () => {
      const received1: ComponentEventFrame[] = [];
      const received2: ComponentEventFrame[] = [];

      feed.frames$.subscribe(f => received1.push(f));
      feed.frames$.subscribe(f => received2.push(f));

      feed.publish({ type: 'component', data: '{"id":"1"}' });
      feed.publish({ type: 'component', data: '{"id":"2"}' });

      expect(received1).toHaveLength(2);
      expect(received2).toHaveLength(2);
    });
  });

  describe('no replay — late subscriber receives only post-subscription frames', () => {
    it('late subscriber does not receive frames published before it subscribed', () => {
      const earlyFrames: ComponentEventFrame[] = [];
      const lateFrames: ComponentEventFrame[] = [];

      feed.frames$.subscribe(f => earlyFrames.push(f));

      // Publish a frame before the late subscriber joins.
      feed.publish({ type: 'component', data: '{"id":"pre"}' });

      // Late subscriber joins after the first frame was published.
      feed.frames$.subscribe(f => lateFrames.push(f));

      // Publish a second frame — both subscribers should receive this one.
      feed.publish({ type: 'component', data: '{"id":"post"}' });

      expect(earlyFrames).toHaveLength(2);   // received both frames
      expect(lateFrames).toHaveLength(1);    // only the post-subscription frame
      expect(lateFrames[0].data).toContain('"post"');
    });

    it('late subscriber receives zero frames when no frames are published after it subscribes', () => {
      feed.publish({ type: 'component', data: '{"id":"early"}' });

      const lateFrames: ComponentEventFrame[] = [];
      feed.frames$.subscribe(f => lateFrames.push(f));

      // No further publishes.
      expect(lateFrames).toHaveLength(0);
    });
  });

  describe('frames without a type are published verbatim', () => {
    it('publishes a frame without type without modification', () => {
      const received: ComponentEventFrame[] = [];
      feed.frames$.subscribe(f => received.push(f));

      feed.publish({ data: '{"ping":true}' });

      expect(received).toHaveLength(1);
      expect(received[0].type).toBeUndefined();
    });
  });
});
