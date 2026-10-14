import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, sha256, verifyReference } from '../scripts/compat/reference.mjs';
import { verifyPlatformReference } from '../scripts/compat/platform-reference.mjs';
import { buildOracle, queryOracle } from '../scripts/compat/oracle.mjs';
import { createConfigCore } from '../backend/config-core/index.mjs';
import { prepareSubscription } from '../backend/subscription/prepare.mjs';

const input = readFileSync(resolve(root, 'compat/fixtures/subscription-inputs.json'));
const observations = JSON.parse(readFileSync(resolve(root, 'compat/fixtures/subscription-observations.json'), 'utf8'));
const built = buildOracle();
const requests = observations.cases.map(item => item.request);
const reference = queryOracle(requests, built);
const core = createConfigCore();
let actual;
try { actual = await Promise.all(requests.map(request => core.query(request))); }
finally { await core.close(); }

test('subscription inputs, AOSP snapshots and committed runtime helper copies retain their hashes', () => {
  assert.equal(sha256(input), observations.inputSha256);
  assert.deepEqual(JSON.parse(input), observations.cases.map(({ expected, ...item }) => item));
  const verified = verifyPlatformReference();
  // Source-only snapshots are verified above; selected runtime bodies have their own tests.
  for (const file of verified.manifest.files.filter(file => !file.sourceOnly)) {
    const path = file.path.replace(/^(?:libcore|frameworks-base)\//, '');
    assert.equal(sha256(readFileSync(resolve(root, 'backend/config-core/src', path))), file.sha256, path);
  }
  const tvbox = verifyReference();
  for (const path of ['app/src/main/java/com/github/tvbox/osc/util/AES.java', 'app/src/main/java/com/github/tvbox/osc/bean/SourceBean.java']) {
    const expected = tvbox.files.find(file => file.path === path);
    const target = path.replace('app/src/main/java/', 'backend/config-core/src/');
    assert.equal(sha256(readFileSync(resolve(root, target))), expected.sha256, target);
  }
});
for (const [index, item] of observations.cases.entries()) {
  test(`subscription source/backend parity: ${item.id}`, () => {
    assert.deepEqual(reference[index], item.expected, 'frozen source observation');
    assert.deepEqual(actual[index], item.expected, 'independent backend');
    if (Object.hasOwn(item, 'knownValue')) {
      assert.equal(actual[index].ok, true);
      assert.deepEqual(actual[index].value, item.knownValue, 'independent plaintext/known expectation');
    }
  });
}

test('preparation preserves upstream URL/decode/clan/relative-path order on the original raw text', async () => {
  const inputs = [
    { url: 'https://example.invalid/box/config', text: 'Abc12345**' + Buffer.from('{sites:[],spider:"./demo.jar"}').toString('base64') },
    { url: 'clan://192.0.2.5/box/config', text: '{sites:[],spider:"./demo.jar",ext:"file://a.txt"}' },
    { url: 'file:///box/config', text: '{sites:[],spider:"./demo.jar",ext:"file://a.txt"}' },
    { url: 'https://example.invalid/collection', text: '{urls:[{name:"One",url:"https://next.invalid/tv"}]}' },
    { url: 'https://example.invalid/config;pk;mykey', text: observations.cases.find(item => item.id === 'decode/ecb').request.text },
  ];
  const core = createConfigCore();
  try {
    for (const input of inputs) {
      const selected = queryOracle([{ operation: 'url', url: input.url }], built)[0];
      let decoded = queryOracle([{ operation: 'decode', text: input.text, key: selected.value.key }], built)[0];
      if (input.url.startsWith('clan')) decoded = queryOracle([{ operation: 'clanFix', url: input.url, text: decoded.value }], built)[0];
      const fixed = queryOracle([{ operation: 'fix', url: input.url, text: decoded.value }], built)[0];
      const lines = queryOracle([{ operation: 'collection', text: fixed.value }], built)[0];
      assert.deepEqual(await prepareSubscription(input.url, input.text, { core }), {
        requestUrl: selected.value.url, text: fixed.value, collectionLines: lines.value,
      });
    }
  } finally { await core.close(); }
});

test('preparation owns and closes its worker, reporting the original stage/error on invalid input', async () => {
  const prepared = await prepareSubscription('https://example.invalid/tv', '{sites:[]}');
  assert.deepEqual(prepared, { requestUrl: 'https://example.invalid/tv', text: '{sites:[]}', collectionLines: [] });
  await assert.rejects(prepareSubscription('https://example.invalid/tv;pk;', '{}'), error => {
    assert.equal(error.stage, 'url');
    assert.equal(error.errorType, 'java.lang.ArrayIndexOutOfBoundsException');
    return true;
  });
  await assert.rejects(prepareSubscription('https://example.invalid/tv;pk;mykey', 'not-hex'), error => {
    // Android AES returns null, then fetchConfigAsync's relative fix fails.
    assert.equal(error.stage, 'fix');
    assert.equal(error.errorType, 'java.lang.NullPointerException');
    return true;
  });
});
