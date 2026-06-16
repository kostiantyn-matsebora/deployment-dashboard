import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run in node environment — pure logic tests; no DOM or browser API required.
    // Browser-API boundary (storage, notifications, action) is only in background.ts,
    // which is NOT imported by tests.  Pure modules (filter, badge, notifications, time)
    // have zero browser-API dependencies.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
