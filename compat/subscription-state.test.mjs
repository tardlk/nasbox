import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, sha256 } from '../scripts/compat/reference.mjs';
import { buildOracle, queryOracle } from '../scripts/compat/oracle.mjs';
import { createConfigCore } from '../backend/config-core/index.mjs';
import { runLoadScenario } from '../scripts/compat/load-runner.mjs';

const built = buildOracle();
for (const dataset of ['state', 'load']) {
  const input = readFileSync(resolve(root, `compat/fixtures/${dataset}-inputs.json`));
  const observations = JSON.parse(readFileSync(resolve(root, `compat/fixtures/${dataset}-observations.json`), 'utf8'));
  const expected = queryOracle(observations.cases.map(item => item.request), built);
  let actual;
  if (dataset === 'state') {
    const core = createConfigCore();
    try { actual = await Promise.all(observations.cases.map(item => core.query(item.request))); }
    finally { await core.close(); }
  } else {
    actual = [];
    for (const item of observations.cases) actual.push({ ok: true, value: await runLoadScenario(item.request) });
  }
  test(`${dataset} observations retain their captured input hash`, () => {
    assert.equal(sha256(input), observations.inputSha256);
    assert.deepEqual(JSON.parse(input), observations.cases.map(({ expected, ...item }) => item));
  });
  for (const [index, item] of observations.cases.entries()) {
    test(`source/backend state parity: ${item.id}`, () => {
      assert.deepEqual(expected[index], item.expected, 'original-source observation');
      assert.deepEqual(actual[index], item.expected, 'production state/loader result');
      if (Object.hasOwn(item, 'knownValue')) assert.deepEqual(actual[index].value, item.knownValue);
    });
  }
  if (dataset === 'state') {
    test('history retains existing position, caps a normal list, and preserves upstream oversized-list quirk', () => {
      const get = id => actual[observations.cases.findIndex(item => item.id === id)].value;
      assert.deepEqual(get('history/existing-api-not-promoted').apiHistory, ['one', 'https://a.invalid/tv', 'two']);
      assert.equal(get('history/capped-30').apiHistory.length, 30);
      assert.equal(get('history/removes-only-index-30').apiHistory.length, 35);
    });
  } else {
    test('fresh parse failure does not fall back to old cache; fetch failure does', () => {
      const get = id => actual[observations.cases.findIndex(item => item.id === id)].value;
      assert.deepEqual(get('load/network-parse-failure-no-fallback').results, [{ ok: false, message: '配置解析失败' }]);
      assert.equal(get('load/offline-cache-fallback').results[0].ok, true);
      assert.equal(get('load/collection-cache-forces-child-network').events[0].kind, 'fetch');
      assert.equal(get('load/collection-cache-forces-child-network').events[0].url, 'https://b.invalid/tv');
    });
  }
}
