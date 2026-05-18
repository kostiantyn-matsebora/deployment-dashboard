// karma.conf.js — explicit reporters so cobertura.xml + lcov.info are emitted
// for CI artefact upload. Q8 of CR-0010 locks coverage report uploaded (no
// threshold for MVP-CI). The default @angular/build:karma builder emits
// HTML only.
//
// NOTE on @angular/build:karma behavior:
// When the Angular karmaConfig option is set, @angular/build:karma uses an
// EMPTY defaults object (see node_modules/@angular/build/src/builders/karma/
// application_builder.js:575-577) — the user file becomes solely responsible
// for frameworks, plugins, browsers, reporters. This file therefore mirrors
// getBuiltInKarmaConfig() (same builder, lines 594-632) and adds the cobertura
// + lcovonly reporters plus a no-sandbox launcher.
//
// Per-project subdir: extracted from `ng test <project>` argv so sequential
// runs land in `coverage/<project>/` instead of colliding at `coverage/`.
// CI uploads coverage/<project>/cobertura.xml per-project per matrix leg.
const path = require('path');

function detectProjectSubdir() {
  // Angular CLI invocation is `ng test <project> ...` — pick the first non-flag
  // arg after the `test` command. Fallback to '.' when unknown (single-project
  // workspaces or non-standard invocations).
  const argv = process.argv;
  const testIdx = argv.findIndex((a) => a === 'test');
  if (testIdx >= 0 && argv[testIdx + 1] && !argv[testIdx + 1].startsWith('-')) {
    return argv[testIdx + 1];
  }
  return '.';
}

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
    ],
    jasmineHtmlReporter: {
      suppressAll: true,
    },
    coverageReporter: {
      dir: path.join(__dirname, './coverage'),
      subdir: detectProjectSubdir(),
      reporters: [
        { type: 'html' },
        { type: 'cobertura', file: 'cobertura.xml' },
        { type: 'lcovonly', file: 'lcov.info' },
        { type: 'text-summary' },
      ],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['Chrome'],
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--headless', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
    restartOnFileChange: true,
  });
};
