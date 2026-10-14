import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from '../scripts/compat/reference.mjs';
import { buildOracle, queryOracle } from '../scripts/compat/oracle.mjs';
import { buildConfigCore, createConfigCore, ConfigParseError } from '../backend/config-core/index.mjs';

const observations = JSON.parse(readFileSync(resolve(root, 'compat/fixtures/config-observations.json'), 'utf8'));
const built = buildConfigCore();

test('independent backend matches all 65 frozen source-method observations, including failures and partial maps', async () => {
  const core = createConfigCore({ built });
  try {
    // Concurrent submissions must retain the same ordered session as the reference.
    const results = await Promise.all(observations.cases.map(item => core.query(item.request)));
    for (const [index, item] of observations.cases.entries()) assert.deepEqual(results[index], item.expected, item.id);
  } finally { await core.close(); }
});

test('backend matches a fresh original-source JVM on state transitions and extended Gson/path cases', async () => {
  const requests = [
    { operation: 'sites', text: "{sites:[{key:'old',type:3,api:'csp_Old'}]}" },
    { operation: 'sites', text: "{sites:[{key:'a',type:3,api:'csp_A'},{key:'b',type:null,api:'csp_B'}]}" },
    { operation: 'safe', text: '{value:[1e3,123456789012345678901234567890,null,3]}' },
    { operation: 'json', text: '{broken:}' },
    { operation: 'sites', text: "{sites:[{key:'a',type:3,api:'csp_First'},{key:'b',type:1,api:'x'},{key:'a',type:3,api:'csp_Last'}]}" },
    { operation: 'sites', text: '{sites:[{key:1e3,type:2147483648,api:[true],ext:{number:1e3}}]}' },
    { operation: 'sites', text: '{sites:[null]}' },
    { operation: 'sites', text: '{sites:[]}' },
    { operation: 'safe', text: '{value:"+12"}' },
    { operation: 'safe', text: '{value:"１２"}' },
    { operation: 'safe', text: '{value:1.234567890123456789e40}' },
    { operation: 'json', text: '{value:[1;;2]}' },
    { operation: 'trim', text: null },
    { operation: 'fix', url: 'clan://localhost/box/main.json', text: '{"api":"./demo.js"}', localAddress: 'http://nas.invalid:9980/' },
    { operation: 'fix', url: 'file:///box/../main.json', text: '{"api":"../demo.js","ext":"note./x"}' },
    { operation: 'fix', url: 'https://nas.invalid/a/b/config?key=1#fragment', text: '{"api":"../../demo.js"}' },
    { operation: 'fix', url: 'clan://no-path', text: '{"api":"./demo.js"}' },
  ];
  const expected = queryOracle(requests, buildOracle());
  const core = createConfigCore({ built });
  try {
    const actual = await Promise.all(requests.map(request => core.query(request)));
    for (const [index, result] of actual.entries()) assert.deepEqual(result, expected[index], JSON.stringify(requests[index]));
  } finally { await core.close(); }
});

test('public parseSites exposes Java error and partial map, then recovers on next configuration', async () => {
  const core = createConfigCore({ built });
  try {
    await assert.rejects(core.parseSites('{sites:[{key:"a",type:3,api:"csp_A"},{key:null,type:3,api:"csp_B"}]}'), error => {
      assert.ok(error instanceof ConfigParseError);
      assert.equal(error.errorType, 'java.lang.UnsupportedOperationException');
      assert.deepEqual(error.partialSites.map(site => site.key), ['a']);
      return true;
    });
    assert.deepEqual(await core.parseSites('{sites:[]}'), []);
  } finally { await core.close(); }
  await assert.rejects(core.parseSites('{sites:[]}'), /closed/);
});

test('oversized host requests reject without corrupting the next valid request', async () => {
  const core = createConfigCore({ built, maxBytes: 1024 });
  try {
    await assert.rejects(core.query({ operation: 'json', text: ' '.repeat(1024) }), /size limit/);
    assert.deepEqual(await core.parseSites('{sites:[]}'), []);
  } finally { await core.close(); }
});

test('worker startup failure rejects pending requests and close completes', async () => {
  const core = createConfigCore({ built: { ...built, java: resolve(root, '.cache/nonexistent-java-binary') } });
  try { await assert.rejects(core.parseSites('{sites:[]}'), /ENOENT/); }
  finally { await core.close(); }
});

test('oversized worker responses stop the worker and reject subsequent requests', async () => {
  const core = createConfigCore({ built, maxBytes: 200 });
  try {
    await assert.rejects(core.parseSites('{sites:[{key:"a",type:3,api:"csp_A"}]}'), /response exceeds size limit/);
    await assert.rejects(core.parseSites('{sites:[]}'), /response exceeds size limit/);
  } finally { await core.close(); }
});

test('separate workers isolate the explicitly supplied local control address', async () => {
  const first = createConfigCore({ built }), second = createConfigCore({ built });
  const request = { operation: 'fix', url: 'file:///box/config', text: '{"api":"./demo.js"}' };
  try {
    const changed = await first.query({ ...request, localAddress: 'http://custom.invalid/' });
    const unchanged = await second.query(request);
    // Upstream file:/// mapping preserves the doubled slash after file/.
    assert.match(changed.value, /http:\/\/custom.invalid\/file\/\/box\//);
    assert.match(unchanged.value, /http:\/\/127.0.0.1:9978\/file\/\/box\//);
  } finally { await Promise.all([first.close(), second.close()]); }
});
