import assert from 'node:assert/strict';
import { request } from 'node:http';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:8788' } } });
const url = new URL(values.url!);
assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Stage 1 smoke checks require a local HTTP server');
const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
assert.equal(response.status, 200, 'Seeded collection page must render');
assert.equal(response.headers.get('cache-control'), 'private, no-store');
assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
const html = await response.text();
const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
for (const pattern of [
  /Physical manga copies 177/, /Unique series 38/, /Acquisition dates 55/,
  /EN 167 JP 9 KR 1/, /172 dated copies.*5 unknown dates.*97 acquisition notes/,
  /Kodansha 76/, /VIZ Media 42/, /Yen Press 33/,
  /0 personal CDs.*4 demonstration CDs \(excluded from personal totals\)/,
]) assert.match(text, pattern);
assert.ok(!html.includes('first b&amp;n manga trip'), 'Private acquisition note text must not be embedded in the counts page');
const cssPaths = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/gi)].map(match => match[1]!);
const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]!);
assert.ok(cssPaths.length > 0 || inlineStyles.some(css => /grid-template-columns/.test(css)),
  'Collection layout CSS must be included as a stylesheet or inline styles');
for (const path of cssPaths) {
  const asset = new URL(path, url);
  assert.equal(asset.origin, url.origin);
  const css = await fetch(asset, { signal: AbortSignal.timeout(20_000) });
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') ?? '', /text\/css/);
  assert.match(await css.text(), /grid-template-columns/);
}
// Node's fetch does not reliably send an overridden Host. Use the HTTP client
// to exercise the nonlocal-host boundary on the actual local runtime.
await new Promise<void>((resolve, reject) => {
  const probe = request(url, { headers: { Host: 'stage1-host-check.invalid' } }, denied => {
    let body = '';
    denied.setEncoding('utf8');
    denied.on('data', chunk => { body += chunk; });
    denied.on('error', reject);
    denied.on('end', () => {
      try {
        assert.ok([403, 503].includes(denied.statusCode ?? 0), 'Nonlocal Host must be rejected');
        assert.ok(!body.includes('Physical manga copies'), 'Denied responses must not contain collection counts');
        if (denied.statusCode === 503) assert.equal(denied.headers['cache-control'], 'private, no-store');
        resolve();
      } catch (error) { reject(error); }
    });
  });
  probe.setTimeout(20_000, () => probe.destroy(new Error('Nonlocal Host probe timed out')));
  probe.on('error', reject);
  probe.end();
});
console.log(`Stage 1 HTTP smoke passed at ${url.origin}: D1 counts, React SSR, sample exclusion, privacy headers, nonlocal Host rejection and ${cssPaths.length} CSS assets.`);
