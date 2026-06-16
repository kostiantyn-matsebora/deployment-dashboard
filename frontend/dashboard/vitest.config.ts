import { defineConfig } from 'vitest/config';
import path             from 'path';

/**
 * Vitest runner config — referenced by angular.json `runnerConfig`.
 *
 * Primary purpose: alias @swimlane/ngx-graph to a lightweight stub so the
 * real dagre/webcola layout engine is never loaded in the jsdom test
 * environment (it causes a fatal V8 heap OOM that kills the worker).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@swimlane/ngx-graph': path.resolve(
        __dirname,
        'src/testing/ngx-graph.stub.ts',
      ),
    },
  },
});
