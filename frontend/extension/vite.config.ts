import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

// Multi-entry MV3 build.
// Each entry becomes a separate bundle — background service worker, popup, options page.
// Output goes to dist/ with hashed filenames disabled so manifest.json can reference
// predictable file paths (background.js, popup.html, options.html).
//
// Post-build plugin copies manifest.json + icons/* into dist/ so the directory is a
// self-contained loadable extension.

function copyExtensionStaticFiles(): import('vite').Plugin {
  return {
    name: 'copy-extension-static',
    closeBundle() {
      const root = __dirname;
      const distDir = join(root, 'dist');

      // manifest.json → dist/manifest.json
      copyFileSync(join(root, 'manifest.json'), join(distDir, 'manifest.json'));

      // icons/* → dist/icons/*
      const iconsDir = join(root, 'icons');
      const distIconsDir = join(distDir, 'icons');
      if (!existsSync(distIconsDir)) mkdirSync(distIconsDir, { recursive: true });
      for (const file of readdirSync(iconsDir)) {
        copyFileSync(join(iconsDir, file), join(distIconsDir, file));
      }

      // Flatten HTML outputs: move dist/src/popup/popup.html → dist/popup.html
      // and dist/src/options/options.html → dist/options.html
      const htmlMoves: Array<[string, string]> = [
        [join(distDir, 'src', 'popup', 'popup.html'), join(distDir, 'popup.html')],
        [join(distDir, 'src', 'options', 'options.html'), join(distDir, 'options.html')],
      ];
      for (const [src, dest] of htmlMoves) {
        if (existsSync(src)) copyFileSync(src, dest);
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/background.ts'),
        popup: resolve(__dirname, 'src/popup/popup.html'),
        options: resolve(__dirname, 'src/options/options.html'),
      },
      output: {
        // Predictable names so manifest.json can reference them without knowing hashes.
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [copyExtensionStaticFiles()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
