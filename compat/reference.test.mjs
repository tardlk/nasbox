import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, verifyReference, sha256 } from '../scripts/compat/reference.mjs';
import { buildOracle, queryOracle, extractMethod } from '../scripts/compat/oracle.mjs';
import { queryWinbox, compareResult } from '../scripts/compat/compare.mjs';

const observations = JSON.parse(readFileSync(resolve(root, 'compat/fixtures/config-observations.json'), 'utf8'));
const input = readFileSync(resolve(root, 'compat/fixtures/config-inputs.json'));
const built = buildOracle();
const results = queryOracle(observations.cases.map(item => item.request), built);

test('upstream source and captured inputs retain their recorded hashes', () => {
  assert.equal(verifyReference().commit, observations.baseline);
  assert.equal(sha256(input), observations.inputSha256);
  assert.deepEqual(JSON.parse(input), observations.cases.map(({ expected, ...item }) => item));
});
test('method extraction handles braces in strings, characters and comments', () => {
  const source = `void probe() { String s = "}"; char c = '{'; /* } */ // {\n if (true) {} } void next() {}`;
  assert.equal(extractMethod(source, 'void probe('), source.slice(0, source.indexOf(' void next')));
});
for (const [index, item] of observations.cases.entries()) {
  test(`upstream observation: ${item.id}`, () => assert.deepEqual(results[index], item.expected));
}
test('independent contract: Gson null string uses fallback', () => {
  assert.equal(observations.cases.find(item => item.id === 'safe/null').expected.value.string, 'fallback');
});
test('independent contract: Gson boolean is not an integer', () => {
  assert.equal(observations.cases.find(item => item.id === 'safe/boolean-true').expected.value.int, 17);
});
test('independent contract: list conversion stops at first failed element', () => {
  assert.deepEqual(observations.cases.find(item => item.id === 'safe/array-null-middle').expected.value.list, ['one']);
});
test('independent contract: raw site timeout is separate from effective timeout', () => {
  const item = observations.cases.find(item => item.id === 'sites/defaults');
  assert.equal(item.expected.value[0].timeout, 0);
  assert.equal(item.expected.value[0].playTimeoutSeconds, 15);
});
test('independent contract: duplicate source key replaces value in insertion position', () => {
  const item = observations.cases.find(item => item.id === 'sites/duplicate-keys');
  assert.deepEqual(item.expected.value.map(site => site.key), ['a', 'b']);
  assert.equal(item.expected.value[0].api, 'csp_Replacement');
});
test('comparison exposes known Win-Box differences instead of masking them', () => {
  for (const id of ['safe/null', 'safe/boolean-true', 'safe/array-null-middle', 'sites/defaults', 'sites/duplicate-keys', 'fix/global-replacement']) {
    const item = observations.cases.find(item => item.id === id);
    assert.equal(compareResult(item.expected, queryWinbox(item.request)).equal, false, id);
  }
});
