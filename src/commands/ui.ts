// parley ui: a local, read-only view of the ledger. It serves only to this machine, loads no
// remote fonts or scripts, and answers only requests addressed to 127.0.0.1 or localhost (so a
// web page cannot reach it by rebinding its own hostname). It sends no CORS headers.

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger } from '../lib/ledger.js';

const here = dirname(fileURLToPath(import.meta.url));
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };

export function uiCommand(args: string[]): Promise<number> {
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const repo = opt('--repo') ?? process.cwd();
  const port = Number(opt('--port') ?? 4317);
  const host = opt('--host') ?? '127.0.0.1';
  const root = [join(here, 'ui'), join(here, '..', 'dist', 'ui')].find((d) => existsSync(join(d, 'index.html')));
  if (!root) {
    console.error('The UI is not built. Run `npm run build` in the parley package.');
    return Promise.resolve(1);
  }
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${host}:${port}`].map((h) => h.toLowerCase()));
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) console.warn(`Warning: --host ${host} is not a loopback address. Anyone who can reach it can read your agreements and transcripts.`);
  const server = createServer((req, res) => {
    // DNS rebinding guard: the Host header must name this server; a cross-site Origin is refused.
    const hostHeader = String(req.headers.host ?? '').toLowerCase();
    const origin = req.headers.origin;
    if (!allowed.has(hostHeader) || (origin !== undefined && !allowed.has(origin.replace(/^https?:\/\//, '').toLowerCase()))) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden: parley ui only answers requests to 127.0.0.1 or localhost.');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/ledger') {
      try {
        const ledger = buildLedger(repo);
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(ledger));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }
    const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, rel);
    if (!file.startsWith(root) || !existsSync(file)) file = join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.log(`parley ui: http://${host}:${port}  (repo: ${repo})  Ctrl+C to stop.`);
    });
    process.on('SIGINT', () => {
      server.close();
      resolve(0);
    });
  });
}
