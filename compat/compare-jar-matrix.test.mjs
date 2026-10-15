// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { compareJarMatrices } from '../scripts/compat/compare-jar-matrix.mjs';
const sha = text => createHash('sha256').update(text).digest('hex');
const id = sha('jar');
const manifest = { artifacts: [{ id, sha256: id, bytes: 3, roles: ['main'], sites: [{ api: 'csp_A', ext: 'one', extSha256: sha('"one"') }, { api: 'csp_A', ext: 'two' }] }] };
const pass = (sites = [], load = { loaded: true }) => ({ artifacts: [{ id, input: { sha256: id }, load, sites, cleanup: {}, observations: {} }] });
const row = (ext, init) => ({ api: 'csp_A', extSha256: sha(ext), init });
test('pairs exact ext variants without treating increased coverage as regression', () => {
 const report = compareJarMatrices(manifest, pass([row('one', { ok: true })]), pass([row('two', { ok: true })]));
 assert.equal(report.summary.initCandidateRegressions, 0);
 assert.equal(report.artifacts[0].variants[0].new.init, 'unknown');
 assert.equal(report.artifacts[0].variants[1].old.init, 'unknown');
 assert.equal(report.artifacts[0].variants[0].captureExtSha256, sha('"one"'));
});
test('distinguishes timeout unknown from failed-to-ready improvement', () => {
 const report = compareJarMatrices(manifest, pass([row('one', { ok: false }), row('two', { ok: true })]), pass([row('one', { ok: true }), row('two', { ok: false, error: { category: 'timeout' } })]));
 assert.equal(report.summary.initImprovements, 1);
 assert.equal(report.summary.initCandidateRegressions, 0);
});
test('rejects different artifact bytes, unknown variant and duplicate result', () => {
 assert.throws(() => compareJarMatrices(manifest, { artifacts: [{ id, input: { sha256: sha('wrong') }, sites: [] }] }, pass()), /checksum/);
 assert.throws(() => compareJarMatrices(manifest, pass([row('other', { ok: true })]), pass()), /variant/);
 const duplicated = pass(); duplicated.artifacts.push(duplicated.artifacts[0]);
 assert.throws(() => compareJarMatrices(manifest, duplicated, pass()), /duplicate/);
});
test('records live response differences without inferring a candidate regression', () => {
 const a = row('one', { ok: true }), b = row('one', { ok: true });
 a.homeContent = { ok: true, hasContent: true, sha256: sha('first'), semanticSha256: sha('first') };
 b.homeContent = { ok: true, hasContent: true, sha256: sha('second'), semanticSha256: sha('second') };
 const report = compareJarMatrices(manifest, pass([a]), pass([b]));
 assert.equal(report.summary.liveHomeSemanticDifferences, 1);
 assert.equal(report.artifacts[0].variants[0].homeTransition, 'same');
});
test('matches redacted API identity without publishing the original URL', () => {
 const api = 'https://example.invalid/api?token=private';
 const input = { artifacts: [{ id, sha256: id, sites: [{ api, ext: '' }] }] };
 const before = pass([{ api: 'sha256:' + sha(api), extSha256: sha(''), init: { ok: false } }]);
 const after = pass([{ api: 'sha256:' + sha(api), extSha256: sha(''), init: { ok: true } }]);
 const report = compareJarMatrices(input, before, after);
 assert.equal(report.summary.initImprovements, 1);
 assert.ok(!JSON.stringify(report).includes('token=private'));
});
test('keeps load timeout unknown instead of an apparent load regression', () => {
 const report = compareJarMatrices(manifest, pass(), pass([], { loaded: false, error: { category: 'timeout' } }));
 assert.equal(report.artifacts[0].newLoad, 'unknown');
 assert.equal(report.summary.loadCandidateRegressions.length, 0);
});
test('rejects duplicate exact variants and successful reports without verified input bytes', () => {
 assert.throws(() => compareJarMatrices(manifest, pass([row('one', { ok: true }), row('one', { ok: false })]), pass()), /Duplicate execution variant/);
 const unchecked = pass(); delete unchecked.artifacts[0].input;
 assert.throws(() => compareJarMatrices(manifest, unchecked, pass()), /verified input checksum/);
});
test('keeps network unavailability unknown and publishes only known observation fields', () => {
 const before = pass([row('one', { ok: true })]);
 const after = pass([row('one', { ok: false, error: { category: 'network' } })]);
 after.artifacts[0].observations = { attemptedApis: 1, secret: 'token=private' };
 after.artifacts[0].unattempted = [{ api: 'csp_A', extSha256: sha('two'), reason: 'token=private' }];
 const report = compareJarMatrices(manifest, before, after);
 assert.equal(report.summary.initCandidateRegressions, 0);
 assert.deepEqual(report.artifacts[0].observations.new, { attemptedApis: 1 });
 assert.equal(report.artifacts[0].variants[1].new.unattemptedReason, 'unknown');
 assert.ok(!JSON.stringify(report).includes('token=private'));
});
test('counts explicit load exceptions while keeping startup failures unknown', () => {
 const before = pass(); delete before.artifacts[0].load;
 before.artifacts[0].error = { stage: 'load', category: 'native-binding' };
 let report = compareJarMatrices(manifest, before, pass());
 assert.equal(report.summary.loadImprovements.length, 1);
 before.artifacts[0].error.stage = 'start';
 report = compareJarMatrices(manifest, before, pass());
 assert.equal(report.artifacts[0].oldLoad, 'unknown');
});
test('rejects unattempted identities outside the capture or conflicting with an attempt', () => {
 const outside = pass(); outside.artifacts[0].unattempted = [{ api: 'csp_A', extSha256: sha('other'), reason: 'artifact-budget' }];
 assert.throws(() => compareJarMatrices(manifest, outside, pass()), /not present/);
 const duplicate = pass([row('one', { ok: true })]); duplicate.artifacts[0].unattempted = [{ api: 'csp_A', extSha256: sha('one'), reason: 'artifact-budget' }];
 assert.throws(() => compareJarMatrices(manifest, duplicate, pass()), /Conflicting/);
});
