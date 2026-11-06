// A tiny stand-in for the GitHub REST API, for testing CI-only checks offline.
//   node test/mock-github.mjs <port> <routes.json>
// routes.json maps "path?query" (or just "path") to the JSON to return. It is re-read on every
// request, so a test can rewrite it between cases. Unknown paths return 404.
import { createServer } from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';

const [port, file] = process.argv.slice(2);
// Any method: GET for the GitHub API, POST for the OpenRouter chat completion stand-in.
createServer((req, res) => {
  // POST bodies (the verify prompt) are appended to <routes.json>.requests for tests to inspect.
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      appendFileSync(`${file}.requests`, body + '\n');
      answer(req, res);
    });
    return;
  }
  answer(req, res);
}).listen(Number(port), '127.0.0.1');

function answer(req, res) {
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
}
