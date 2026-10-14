import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, sha256 } from '../scripts/compat/reference.mjs';
import { verifyPlatformReference } from '../scripts/compat/platform-reference.mjs';
import { buildOracle, queryOracle } from '../scripts/compat/oracle.mjs';
import { createConfigCore, ConfigParseError } from '../backend/config-core/index.mjs';
import { runLoadScenario } from '../scripts/compat/load-runner.mjs';

const built = buildOracle();
const observations = {};
const actual = {};
for (const dataset of ['vod', 'vod-load']) {
  const input = readFileSync(resolve(root, `compat/fixtures/${dataset}-inputs.json`));
  const captured = JSON.parse(readFileSync(resolve(root, `compat/fixtures/${dataset}-observations.json`), 'utf8'));
  observations[dataset] = captured;
  const reference = queryOracle(captured.cases.map(item => item.request), built);
  if (dataset === 'vod') {
    const core = createConfigCore();
    try { actual[dataset] = await Promise.all(captured.cases.map(item => core.query(item.request))); }
    finally { await core.close(); }
  } else {
    actual[dataset] = [];
    for (const item of captured.cases) actual[dataset].push({ ok: true, value: await runLoadScenario(item.request) });
  }
  test(`${dataset} captured inputs keep their hashes and expected observations`, () => {
    assert.equal(sha256(input), captured.inputSha256);
    assert.deepEqual(JSON.parse(input), captured.cases.map(({ expected, ...item }) => item));
  });
  for (const [index, item] of captured.cases.entries()) test(`VOD source/backend parity: ${item.id}`, () => {
    assert.deepEqual(reference[index], item.expected, 'original selected source prefix');
    assert.deepEqual(actual[dataset][index], item.expected, 'independent backend');
  });
}
const value = id => actual.vod[observations.vod.cases.findIndex(item => item.id === id)].value;
const config = id => value(id).config;
test('ParseBean retains original method bodies with only its DefaultConfig import adapted', () => {
  const verified = verifyPlatformReference();
  const relative = 'app/src/main/java/com/github/tvbox/osc/bean/ParseBean.java';
  const source = readFileSync(resolve(verified.extra, relative), 'utf8');
  const runtime = readFileSync(resolve(root, 'backend/config-core/src/com/github/tvbox/osc/bean/ParseBean.java'), 'utf8');
  assert.equal(runtime, source.replace('import com.github.tvbox.osc.util.DefaultConfig;', 'import tvbox.config.DefaultConfig;'));
});
test('first duplicate home retains the original bean, then persisted key resolves the replacement on reimport', () => {
  assert.equal(config('vod/duplicate-first-home').home.api, 'csp_A');
  assert.equal(config('vod/duplicate-first-home').sites[0].api, 'csp_Last');
  assert.equal(config('vod/duplicate-reimport-home').home.api, 'csp_Last');
});
test('empty site list retains old home; absent push_agent resolves a synthetic source', () => {
  assert.equal(config('vod/empty-sites-stale-home').home.key, 'b');
  assert.deepEqual(config('vod/empty-sites-stale-home').sites, []);
  assert.equal(config('vod/push-agent-home').home.type, -1);
  assert.equal(config('vod/real-push-agent-overrides').home.type, 3);
});
test('super parse insertion and stale selected objects follow original behavior across imports', () => {
  assert.equal(config('vod/super-default').defaultParse.name, '超级解析');
  const stale = config('vod/missing-selected-name-stale-default');
  assert.equal(stale.defaultParse.name, 'P');
  assert.ok(stale.parses.every(parse => !parse.isDefault));
  assert.equal(config('vod/no-parses-stale-default').defaultParse.name, 'P');
  assert.equal(config('vod/duplicate-parse-last-selected').defaultParse.url, 'last');
});
test('proxy getters and ext query encoding retain original raw/mixed URL behavior and base64 padding', () => {
  const proxy = config('vod/proxy-parse-ext').defaultParse;
  assert.equal(proxy.effectiveUrl, 'http://nas.invalid:8899/proxy?https://p.invalid/?id=1');
  assert.equal(proxy.mixedUrl, 'proxy://https://p.invalid/?cat_ext=eyJhIjoxfQ==&id=1');
  assert.equal(config('vod/mix-question-at-zero').defaultParse.mixedUrl, '?url=x');
});
test('search sources include all nonzero searchable values and retain insertion order', () => {
  assert.deepEqual(value('vod/search-first').map(site => site.key), ['a', 'c']);
  assert.deepEqual(value('vod/search-reused'), value('vod/search-first'));
});
test('public parseVod exposes expanded partial state on failure and recovers on the next import', async () => {
  const core = createConfigCore();
  try {
    await assert.rejects(core.parseVod('{sites:[{key:"a",type:3,api:"csp_A"}],spider:"new.jar",parses:null}'), error => {
      assert.ok(error instanceof ConfigParseError);
      assert.equal(error.partialConfig.globals.spider, 'new.jar');
      assert.equal(error.partialConfig.home.key, 'a');
      assert.equal(error.partialSites.length, 1);
      return true;
    });
    assert.equal((await core.parseVod('{sites:[]}')).scope, 'vod-prefix');
  } finally { await core.close(); }
});
