/**
 * Playwright global setup for the extension E2E suite.
 *
 * Builds the unpacked MV3 extension before any test runs.
 * Output: frontend/extension/dist (self-contained, loadable by Chromium).
 *
 * Strategy:
 *   1. Resolve the extension root relative to this file (works in both the main
 *      checkout and in git worktrees, since the relative path is the same).
 *   2. If node_modules is absent (e.g. in a worktree), run npm install first.
 *   3. Run npm run build to produce dist/.
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export default function globalSetup(): void {
  // __dirname is testing/e2e/tests/extension — resolve up 4 levels to repo root,
  // then into frontend/extension.
  const extensionRoot = path.resolve(__dirname, '../../../../frontend/extension');
  const nodeModules = path.join(extensionRoot, 'node_modules');
  const distDir = path.join(extensionRoot, 'dist');
  const manifestPath = path.join(distDir, 'manifest.json');

  // Install deps if missing (happens in a fresh git worktree).
  if (!fs.existsSync(nodeModules)) {
    console.log('[global-setup] Installing extension dependencies…');
    execSync('npm install', {
      cwd: extensionRoot,
      stdio: 'inherit',
    });
  }

  console.log('[global-setup] Building extension at', extensionRoot);
  execSync('npm run build', {
    cwd: extensionRoot,
    stdio: 'inherit',
  });

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `[global-setup] Extension build succeeded but dist/manifest.json is missing at ${manifestPath}`,
    );
  }

  console.log('[global-setup] Extension built at', distDir);
}
