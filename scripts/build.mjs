// Full build: tsc compiles src/main (and everything else, though renderer/
// preload .js outputs are overwritten by esbuild below), then assets are
// copied, then esbuild bundles the renderer entry points and preloads.
//
// R8 (controller ruling): tsc alone breaks at runtime — tsconfig emits
// CommonJS, so renderer .js files loaded via <script> (no nodeIntegration)
// hit `require`/`exports`, and sandboxed preloads cannot `require('../shared/ipc')`.
// esbuild bundles those into self-contained IIFE/CJS files instead.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function copyAssets() {
  const copies = [
    ['src/renderer/overlay/overlay.html', 'dist/renderer/overlay/overlay.html'],
    ['src/renderer/control/control.html', 'dist/renderer/control/control.html'],
  ];
  for (const [from, to] of copies) {
    const fromAbs = join(root, from);
    const toAbs = join(root, to);
    mkdirSync(dirname(toAbs), { recursive: true });
    cpSync(fromAbs, toAbs);
  }
}

async function bundleRenderers() {
  await esbuild.build({
    entryPoints: [join(root, 'src/renderer/overlay/overlay.ts')],
    outfile: join(root, 'dist/renderer/overlay/overlay.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
  });
  await esbuild.build({
    entryPoints: [join(root, 'src/renderer/control/control.ts')],
    outfile: join(root, 'dist/renderer/control/control.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
  });
}

async function bundlePreloads() {
  await esbuild.build({
    entryPoints: [join(root, 'src/preload/overlay-preload.ts')],
    outfile: join(root, 'dist/preload/overlay-preload.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });
  await esbuild.build({
    entryPoints: [join(root, 'src/preload/control-preload.ts')],
    outfile: join(root, 'dist/preload/control-preload.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });
}

run('npx tsc -p tsconfig.json');
copyAssets();
await bundleRenderers();
await bundlePreloads();
console.log('build complete');
