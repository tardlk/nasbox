// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planJarSource, decodeImageJar } from '../backend/spider-runtime/artifact-source.mjs';
import { runArtifactRoutesOracle } from '../scripts/compat/artifact-routes-oracle.mjs';

const routes = JSON.parse(readFileSync(new URL('./fixtures/artifact-routes.json', import.meta.url))).cases;
const images = JSON.parse(readFileSync(new URL('./fixtures/image-jar.json', import.meta.url))).cases;
// All short combinations exercise the decoder's states: alphabet values, pad,
// and ignored characters. Outcomes come from original Android code each run.
const matrix = [{ id: 'base64-state-empty', body: 'ABCDEFGH**' }];
let tails = [''];
for (let length = 1; length <= 4; length++) {
  tails = tails.flatMap(tail => ['A', '/', '=', '!'].map(character => tail + character));
  matrix.push(...tails.map((tail, index) => ({ id: `base64-state-${length}-${index}`, body: 'ABCDEFGH**' + tail })));
}
const original = runArtifactRoutesOracle([...routes, ...images, ...matrix]);
const observations = new Map(original.rows.map(row => [row.id, row]));

test('34 artifact route fixtures agree with fresh unchanged Android methods and explicit service bindings', () => {
  for (const input of routes) {
    const observed = observations.get(input.id);
    assert.equal(observed.errorType, undefined, input.id);
    for (const [key, value] of Object.entries(input.expected)) assert.equal(observed[key], value, input.id + ' original ' + key);
    assert.equal(observed.loads, input.expected.kind === 'unsupported' ? 0 : 1, input.id + ' original loader count');
  }
});

test('Linux route planner preserves original main/site dispatch, replacements, clan address and source identity', () => {
  for (const input of routes) {
    const observed = observations.get(input.id);
    const actual = planJarSource(input.source, { role: input.role, ...(input.localAddress ? { localAddress: input.localAddress } : {}) });
    assert.equal(actual.source, input.source, input.id + ' source identity');
    assert.equal(actual.kind, input.plannerKind || observed.kind, input.id + ' route');
    if (input.plannerKind === 'unsupported') {
      // Main Android loadJar sends these raw strings to its HTTP downloader;
      // Linux rejects before transport rather than inventing a local route.
      assert.equal(observed.kind, 'http', input.id);
      assert.equal(observed.requestUrl, input.source, input.id);
      continue;
    }
    for (const key of ['requestUrl', 'path']) assert.equal(actual[key], observed[key], input.id + ' ' + key);
  }
});

function assertImage(input) {
  const observed = observations.get(input.id), body = Buffer.from(input.body, 'utf8');
  if (observed.errorType) {
    assert.equal(observed.errorType, 'IllegalArgumentException', input.id + ' original exception');
    assert.throws(() => decodeImageJar(body), error => error.code === 'IMAGE_JAR_BASE64_INVALID', input.id);
  } else {
    const actual = decodeImageJar(body);
    assert.equal(Buffer.isBuffer(actual), true, input.id + ' output bytes');
    assert.equal(actual.toString('hex'), observed.hex, input.id);
    assert.equal(actual.length, observed.bytes, input.id + ' decoded length');
  }
}

test('20 image JAR vectors match the fresh original marker finder and AOSP Base64.DEFAULT', () => {
  for (const input of images) {
    const observed = observations.get(input.id);
    if (input.expectedError) assert.equal(observed.errorType, input.expectedError, input.id + ' fixture');
    else assert.equal(observed.hex, input.expectedHex, input.id + ' fixture');
    assertImage(input);
  }
});

test('341 short Base64 state combinations match original AOSP decoding, including skipped characters and padding failures', () => {
  assert.equal(matrix.length, 341);
  for (const input of matrix) assertImage(input);
});
