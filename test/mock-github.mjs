// A tiny stand-in for the GitHub REST API, for testing CI-only checks offline.
//   node test/mock-github.mjs <port> <routes.json>
// routes.json maps "path?query" (or just "path") to the JSON to return. It is re-read on every
// request, so a test can rewrite it between cases. Unknown paths return 404.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const [port, file] = process.argv.slice(2);
createServer((req, res) => {
  let routes = {};
  try {
    routes = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  const url = req.url ?? '/';
  const path = url.split('?')[0];
  const hit = url in routes ? routes[url] : path in routes ? routes[path] : undefined;
  if (hit === undefined) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"message":"Not Found"}');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(hit));
}).listen(Number(port), '127.0.0.1');
