import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { buildOracle } from '../scripts/compat/oracle.mjs';
import { probeSubscription, unwrapSubscriptionBytes } from '../scripts/compat/subscription-probe.mjs';

const text = '{"sites":[{"key":"demo","type":3,"api":"csp_Demo"}]}';
// Wrapper can appear inside an image-like response, not only after its EOF.
const wrapped = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('Abc12345**' + Buffer.from(text).toString('base64'))]);
test('salt+base64 is found in binary response independently of declared MIME type', () => {
  assert.equal(unwrapSubscriptionBytes(wrapped).text, text);
});
test('a valid plain JSON object containing a marker is preserved before wrapper detection', () => {
  const plain = '{"sites":[],"ext":"Abc12345**eyJrIjoxfQ=="}';
  assert.equal(unwrapSubscriptionBytes(Buffer.from(plain)).text, plain);
});
test('subscription probe follows redirect, preserves UA, parses wrapper and reports metadata only', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, ua: request.headers['user-agent'] });
    if (request.url === '/tv') { response.writeHead(302, { Location: '/config' }); response.end(); }
    else { response.writeHead(200, { 'Content-Type': 'image/x-ms-bmp' }); response.end(wrapped); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/tv`;
    const result = await probeSubscription(url, { oracle: buildOracle() });
    assert.equal(result.sourceSites, 1);
    assert.equal(result.winboxSites, 1);
    assert.equal(result.backendSites, 1);
    assert.equal(result.backendPathComparison.equal, true);
    assert.equal(result.backendSiteComparison.equal, true);
    assert.equal(result.envelope, 'salt-base64');
    assert.equal(result.contentType, 'image/x-ms-bmp');
    assert.equal(result.siteComparison.status, 'different'); // raw timeout normalization differs
    assert.deepEqual(requests.map(request => request.path), ['/tv', '/config']);
    assert.ok(requests.every(request => request.ua === 'okhttp/3.12.11'));
    assert.ok(!JSON.stringify(result).includes('csp_Demo'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('oversized subscription responses are rejected and the temporary server stops', async () => {
  const server = createServer((request, response) => response.end(wrapped));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    await assert.rejects(probeSubscription(`http://127.0.0.1:${server.address().port}/`, { maxBytes: 4 }), /size limit/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
