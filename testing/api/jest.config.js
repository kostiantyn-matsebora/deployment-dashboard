/** @type {import('jest').Config} */
module.exports = {
  preset:          'ts-jest',
  testEnvironment: 'node',
  testMatch:       ['**/tests/**/*.spec.ts'],
  // Integration tests drive a real stack (ingest loops, SSE waits, emission).
  testTimeout:     120_000,
  globals: {
    'ts-jest': {
      // HTTP response bodies are dynamic JSON — type-checking .json() return
      // values as `unknown` throughout test assertions is noise, not safety.
      diagnostics: false,
    },
  },
};
