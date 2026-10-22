import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

test('HTTP smoke rejects correct counts when the collection layout stylesheet is missing', async () => {
  // Deliberately synthetic HTTP response: this tests the checker, not D1 or Astro.
  const server = createServer((_request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(`<html><body>Physical manga copies 177 Unique series 38 Acquisition dates 55
      EN 167 JP 9 KR 1 172 dated copies 5 unknown dates 97 acquisition notes
      Kodansha 76 VIZ Media 42 Yen Press 33
      0 personal CDs 4 demonstration CDs (excluded from personal totals)</body></html>`);
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await assert.rejects(promisify(execFile)(process.execPath,
      ['scripts/smoke-stage1.ts', '--url', `http://127.0.0.1:${address.port}`]), /Collection layout CSS must be included/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
