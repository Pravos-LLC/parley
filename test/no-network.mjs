// Preloaded into every parley process the tests start (NODE_OPTIONS=--import ...). Any request
// to a host other than this machine is refused and logged to $PARLEY_NET_LOG, so the suites
// never reach GitHub or OpenRouter, and a test can prove it.
import { appendFileSync } from 'node:fs';

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') return realFetch(input, init);
  if (process.env.PARLEY_NET_LOG) appendFileSync(process.env.PARLEY_NET_LOG, `${url.host}\n`);
  throw new Error(`network call blocked in tests: ${url.host}`);
};
