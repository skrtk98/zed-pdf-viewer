import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const mediaDir = 'media';
const mupdfDist = fileURLToPath(new URL('./node_modules/mupdf/dist', import.meta.url));

for (const [src, dest] of [
  ['mupdf-wasm.wasm', 'mupdf.wasm'],
  ['mupdf.js', 'mupdf.js'],
  ['mupdf-wasm.js', 'mupdf-wasm.js'],
]) {
  fs.copyFileSync(path.join(mupdfDist, src), path.join(mediaDir, dest));
}

const commonOptions = { bundle: true, sourcemap: true, logLevel: 'info' };

await Promise.all([
  // Local server and launcher (Node.js)
  esbuild.build({
    ...commonOptions,
    entryPoints: ['src/cli.ts'],
    outfile: 'dist/cli.js',
    format: 'cjs',
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
  }),
  // Browser-side replacement for the VS Code webview host; loaded before viewer.js
  esbuild.build({
    ...commonOptions,
    entryPoints: ['src/host.ts'],
    outfile: 'media/host.js',
    format: 'iife',
    platform: 'browser',
  }),
  // Viewer and worker scripts: mupdf is loaded dynamically at runtime
  ...['viewer', 'worker'].map((name) => esbuild.build({
    ...commonOptions,
    entryPoints: [`src/${name}.ts`],
    outfile: `media/${name}.js`,
    format: 'esm',
    platform: 'browser',
    external: ['mupdf'],
  })),
]);
fs.chmodSync('dist/cli.js', 0o755);
