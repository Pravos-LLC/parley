// Builds dist/cli.mjs (one self-contained file, which `parley init` vendors as the CI checker)
// and dist/ui (the prebuilt local UI). Skips the UI when vite is not installed.
import { build } from 'esbuild';
import { chmodSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(join(root, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: [join(root, 'src/cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: join(root, 'dist/cli.mjs'),
  banner: { js: '#!/usr/bin/env node\n// parley (https://github.com/Pravos-LLC/parley), Apache-2.0. Built file; edit src/ instead.\nimport { createRequire as __parleyRequire } from "node:module"; const require = __parleyRequire(import.meta.url);' },
  logLevel: 'warning',
});
chmodSync(join(root, 'dist/cli.mjs'), 0o755);
const vite = join(root, 'node_modules/vite/bin/vite.js');
if (existsSync(vite) && existsSync(join(root, 'ui/index.html'))) {
  execFileSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { cwd: join(root, 'ui'), stdio: 'inherit' });
}
console.log('built dist/cli.mjs' + (existsSync(join(root, 'dist/ui/index.html')) ? ' and dist/ui' : ''));
