// SPDX-License-Identifier: GPL-3.0-only
// Synthetic private ART observations only; no provider/runtime/service execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildWorkingFollowups, prepareWorkingFollowups, buildWorkingNASFollowups, prepareWorkingNASFollowups, workingFollowupSlots } from '../scripts/compat/prepare-working-followups.mjs';
import { loaderContextOf, officialOracleApkSha256 } from '../scripts/android/loader-context.mjs';
import { prepareWorkingSourceCases } from '../scripts/container/working-source-probe.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const SECRET = 'FOLLOWUP_PRIVATE_749';
const label = value => /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(value) ? 'sha256:' + sha(value) : value;
function call(slot, value, { status = 'nonempty', params = [] } = {}) {
  const method = new Map(workingFollowupSlots).get(slot), metadata = { method, discoveryStep: slot, status, success: !['failed', 'timeout', 'not-tested'].includes(status) };
  if (value !== undefined) metadata.response = { sha256: sha(value), bytes: Buffer.byteLength(value) };
  return { method, params, metadata, ...(value !== undefined ? { value } : {}) };
}
function fixture(calls = [call('home', undefined, { status: 'timeout', params: [true] })], { diagnostic = false, context = false } = {}) {
  const site = { key: 'source-' + SECRET, api: 'csp_Owned', ext: SECRET, extSha256: sha(SECRET), caseIdentitySha256: sha('source scenario') };
  if (context) {
    site.jar = 'https://owned.invalid/site.jar?token=' + SECRET;
    site.loaderContext = { role: 'site', signature: site.jar };
    if (diagnostic) {
      site.originalMissingContext = { originalBindingId: sha('binding'), reason: 'original-main-not-captured', mainSignatureSha256: sha('missing main') };
      site.originalMissingContextSha256 = sha('missing context');
    } else site.loaderContext.main = { signature: 'https://owned.invalid/main.jar?token=' + SECRET, sha256: sha('main'), jarPath: 'main.jar', jarUrl: 'http://127.0.0.1:18765/main.jar' };
  }
  const artifact = { id: sha('jar'), sha256: sha('jar'), jarPath: 'owned.jar', jarUrl: 'http://127.0.0.1:18765/owned.jar', sites: [site] };
  const plan = { schemaVersion: 1, businessDiscovery: true, artStatePolicy: 'fresh-app-data', ...(diagnostic ? { standaloneDiagnostic: true } : {}), artifacts: [artifact] };
  const manifestSha256 = sha(JSON.stringify(plan));
  const report = { schemaVersion: 1, artifactIndex: 0, siteIndex: 0, manifestSha256, jarSha256: artifact.sha256, id: artifact.id,
    api: label(site.api), siteKey: label(site.key), extSha256: sha(site.ext), loaderMode: 'main', loadSuccess: true, initSuccess: true, completed: false, timedOut: true,
    applicationStatePolicy: 'fresh-app-data', calls: calls.map(value => structuredClone(value.metadata)),
    ...(context ? { ...loaderContextOf(artifact, site).identity, jarBytesVerified: true, ...(site.loaderContext.main ? { mainJarBytesVerified: true } : {}), targetApkSha256: officialOracleApkSha256, symbolMapSha256: sha('symbol map') } : {}) };
  return { plan, results: [{ report, privateCalls: calls }], manifestSha256 };
}
const build = f => buildWorkingFollowups(f.plan, f.results, { manifestSha256: f.manifestSha256 });
const sites = result => result.plan.artifacts.flatMap(artifact => artifact.sites);

test('home timeout yields isolated no-argument and controlled-search cases without fabricated category/detail/player inputs', () => {
  const f = fixture(), before = JSON.stringify(f), result = build(f), selected = sites(result);
  assert.deepEqual(selected.map(site => site.followup.discoveryStep), ['home-video', 'search', 'search-page1']);
  assert.deepEqual(selected.map(site => site.calls[0].params), [[], ['测试', false], ['测试', false, '1']]);
  assert.ok(selected.every(site => site.calls.length === 1 && site.key === f.plan.artifacts[0].sites[0].key && site.ext === SECRET));
  assert.ok(selected.every(site => site.followup.parentCaseId === '0-0' && site.followup.outstandingReason === 'parent-timeout-left-method-unexecuted'));
  assert.equal(result.publicMetadata.summary.controlledKeywordFollowups, 2);
  assert.deepEqual(result.plan.unexecuted.map(row => row.discoveryStep), ['category-page1', 'category-page2', 'category-filter', 'detail', 'search-detail', 'player']);
  assert.ok(result.plan.unexecuted.every(row => row.status === 'not-tested'));
  assert.equal(JSON.stringify(f), before);assert.equal(JSON.stringify(result.publicMetadata).includes(SECRET), false);
});

test('remaining categories, filters, detail and playback parameters derive only from exact parent responses', () => {
  const home = JSON.stringify({ class: [{ type_name: 'invalid first' }, { type_id: 'real-tid' }], list: [{ vod_id: 'real-video', vod_name: SECRET }],
    filters: { 'real-tid': [{ key: 'area', value: [{ v: '' }, { v: 'real-area' }] }, { key: 'year', value: [{ v: 2026 }] }] } });
  const f = fixture([call('home', home), call('home-video', undefined, { status: 'timeout' })]);
  const result = build(f), bySlot = new Map(sites(result).map(site => [site.followup.discoveryStep, site.calls[0].params]));
  assert.deepEqual(bySlot.get('category-page1'), ['real-tid', '1', true, {}]);
  assert.deepEqual(bySlot.get('category-page2'), ['real-tid', '2', true, {}]);
  assert.deepEqual(bySlot.get('category-filter'), ['real-tid', '1', true, { area: 'real-area', year: '2026' }]);
  assert.deepEqual(bySlot.get('detail'), [['real-video']]);
  assert.deepEqual(bySlot.get('search'), [SECRET, false]);
  assert.equal(bySlot.has('player'), false);
  assert.equal(JSON.stringify(result.publicMetadata).includes(SECRET), false);
});

test('search timeout does not retry the timed-out method and preserves real opaque playback IDs', () => {
  const detail = JSON.stringify({ list: [{ vod_play_from: 'bad$$$real-flag', vod_play_url: 'invalid$$$E1$https://owned.invalid/media$a?token=' + SECRET + '#E2$second' }] });
  const f = fixture([call('home', '{}'), call('detail', detail), call('search', undefined, { status: 'timeout', params: [SECRET, false] })]);
  const result = build(f), selected = sites(result), bySlot = new Map(selected.map(site => [site.followup.discoveryStep, site.calls[0].params]));
  assert.equal(bySlot.has('search'), false);
  assert.deepEqual(bySlot.get('search-page1'), [SECRET, false, '1']);
  assert.deepEqual(bySlot.get('player'), ['real-flag', 'https://owned.invalid/media$a?token=' + SECRET, []]);
  assert.equal(JSON.stringify(result.publicMetadata).includes('owned.invalid'), false);
});

test('original main/site context and standalone missing-main diagnosis remain separate and unchanged', () => {
  for (const diagnostic of [false, true]) {
    const f = fixture(undefined, { context: true, diagnostic }), original = f.plan.artifacts[0].sites[0], result = build(f);
    assert.equal(result.plan.standaloneDiagnostic === true, diagnostic);
    for (const site of sites(result)) {
      assert.equal(site.jar, original.jar);assert.deepEqual(site.loaderContext, original.loaderContext);
      assert.deepEqual(site.originalMissingContext, original.originalMissingContext);
      assert.equal(site.followup.contextScope, diagnostic ? 'standalone-diagnostic-original-main-missing' : 'original-loader-context');
      assert.equal(site.calls[0].metadata.discoveryStep, site.followup.discoveryStep);
    }
    assert.equal(JSON.stringify(result.publicMetadata).includes(SECRET), false);
  }
});

test('completed ten-slot cases require no supplements even when their completed business calls failed or were not-tested', () => {
  const f = fixture(workingFollowupSlots.map(([slot]) => call(slot, undefined, { status: slot === 'home' ? 'failed' : 'not-tested' })));
  Object.assign(f.results[0].report, { completed: true, timedOut: false });
  const result = build(f);
  assert.equal(result.publicMetadata.summary.eligibleParentCases, 0);assert.equal(result.plan.artifacts.length, 0);assert.equal(result.plan.unexecuted.length, 0);
});

test('identity mismatches, malformed slots, altered raw values, missing final parent cases and duplicate results are rejected', () => {
  for (const field of ['manifestSha256', 'jarSha256', 'extSha256', 'api', 'siteKey']) {
    const f = fixture();f.results[0].report[field] = 'changed';assert.throws(() => build(f), /PARENT_IDENTITY/);
  }
  const changed = fixture([call('home', '{"class":[]}')]);changed.results[0].privateCalls[0].value = '{}';
  assert.throws(() => build(changed), /PARENT_RESPONSE_HASH/);
  const metadata = fixture();metadata.results[0].privateCalls[0].metadata.discoveryStep = 'private-slot';
  assert.throws(() => build(metadata), /PARENT_CALLS/);
  const duplicate = fixture();duplicate.results.push(duplicate.results[0]);assert.throws(() => build(duplicate), /UNKNOWN_OR_DUPLICATE_CASE/);
  const missing = fixture();missing.results = [];assert.throws(() => build(missing), /INCOMPLETE_PARENT_RESULTS/);
});

async function diskFixture(t) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'tvbox-working-followup-'));t.after(() => rm(directory, { recursive: true, force: true }));
  const artDirectory = join(directory, 'art'), planPath = join(directory, 'parent-plan.json'), out = join(directory, 'out');
  await mkdir(artDirectory);
  const f = fixture();
  // The disk manifest byte hash, not the pure fixture serialization hash, binds execution.
  const planBytes = Buffer.from(JSON.stringify(f.plan, null, 2) + '\n');f.results[0].report.manifestSha256 = sha(planBytes);
  await writeFile(planPath, planBytes);await writeFile(join(artDirectory, '0-0-private.json'), JSON.stringify(f.results[0]));
  return { directory, artDirectory, planPath, out };
}

test('disk preparation pins exact private ART bytes, emits private plans and never overwrites prior execution', async t => {
  const f = await diskFixture(t), parent = await readFile(join(f.artDirectory, '0-0-private.json'));
  const result = await prepareWorkingFollowups(f);
  assert.equal(result.pins.planSha256, sha(await readFile(join(f.out, 'oracle-plan.json'))));
  assert.equal(result.pins.evidenceFiles[0].sha256, sha(parent));assert.equal(result.pins.summary.executableFollowups, 3);
  assert.equal((await stat(f.out)).mode & 0o777, 0o700);assert.equal((await stat(join(f.out, 'oracle-plan.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(join(f.artDirectory, '0-0-private.json')), parent);
  await assert.rejects(prepareWorkingFollowups(f), /OUTPUT_NOT_EMPTY/);
  await assert.rejects(prepareWorkingFollowups({ ...f, out: join(f.artDirectory, 'nested') }), /OUTPUT_OVERLAPS_INPUT/);
  const link = join(f.directory, 'linked');await symlink(f.out, link);
  await assert.rejects(prepareWorkingFollowups({ ...f, out: join(link, 'nested') }), /OUTPUT_PATH/);
});

test('CLI reports only aggregate counts and pins, without raw source/response data or paths', async t => {
  const f = await diskFixture(t), result = spawnSync(process.execPath, ['scripts/compat/prepare-working-followups.mjs', '--plan', f.planPath, '--art', f.artDirectory, '--out', f.out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);assert.equal(JSON.parse(result.stdout).executableFollowups, 3);
  assert.equal(result.stdout.includes(SECRET), false);assert.equal(result.stdout.includes(f.directory), false);
});

const semantic = value => sha(JSON.stringify(Array.isArray(value) ? value.map(canonical) : canonical(value)));
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
function nasFixture({ diagnostic = false } = {}) {
  const calls = [
    call('home', '{"class":[{"type_id":"real-tid"}]}', { params: [true] }),
    call('home-video', '{"list":[]}', { status: 'empty', params: [] }),
    call('category-page1', '{"list":[{"vod_id":"real-id"}]}', { params: ['real-tid', '1', true, {}] }),
    call('category-page2', undefined, { status: 'not-tested' }),
    call('search', undefined, { status: 'failed', params: [SECRET, false] }),
    call('player', '{"url":"https://owned.invalid/media?token=' + SECRET + '"}', { params: ['real-flag', SECRET, []] }),
  ];
  const f = fixture(calls, { context: true, diagnostic });
  Object.assign(f.results[0].report, { completed: true, timedOut: false });
  const rows = calls.map((value, index) => {
    const metadata = { method: value.method, discoveryStep: value.metadata.discoveryStep, slot: value.metadata.discoveryStep,
      status: index === 0 ? 'timeout' : 'not-tested', ...(index === 0 ? { paramsSha256: semantic(value.params) } : {}) };
    return { method: value.method, slot: metadata.slot, params: index === 0 ? value.params : [], metadata };
  });
  const raw = { input: { artifact: structuredClone(f.plan.artifacts[0]), site: structuredClone(f.plan.artifacts[0].sites[0]) },
    report: { ...structuredClone(f.results[0].report), calls: rows.map(row => row.metadata), siteKeySha256: sha(f.plan.artifacts[0].sites[0].key),
      mode: 'replay', parameterSource: 'exact-art-replay', artSymbolMapSha256: sha('symbol map'), caseIdentitySha256: sha('source scenario'),
      ...(diagnostic ? { standaloneDiagnostic: true, originalMissingContextSha256: sha('missing context') } : {}) }, privateCalls: rows };
  const bundle = { schemaVersion: 1, manifestSha256: f.manifestSha256, runnerSha256: sha('NAS executed runner'), cases: [raw] };
  return { ...f, bundles: [bundle], nas: raw };
}
const buildNAS = f => buildWorkingNASFollowups(f.plan, f.results, f.bundles, { manifestSha256: f.manifestSha256 });

test('NAS timeout supplements only ready post-timeout slots with exact previously attempted ART parameters', () => {
  const f = nasFixture(), before = JSON.stringify(f), result = buildNAS(f), selected = sites(result);
  assert.deepEqual(selected.map(site => site.followup.discoveryStep), ['home-video', 'category-page1', 'search', 'player']);
  assert.deepEqual(selected.map(site => site.calls[0].params), [[], ['real-tid', '1', true, {}], [SECRET, false], ['real-flag', SECRET, []]]);
  assert.equal(result.publicMetadata.summary.excludedARTNotAttempted, 1);
  assert.equal(result.plan.unexecuted[0].discoveryStep, 'category-page2');
  assert.equal(result.plan.followupOf.executionMode, 'discover-with-explicit-calls');
  for (const site of selected) {
    assert.equal(site.calls.length, 1);assert.deepEqual(site.loaderContext, f.plan.artifacts[0].sites[0].loaderContext);
    assert.equal(site.followup.parameterSource, 'exact-parent-art-call');assert.match(site.followup.parentNASBundleSha256, /^[a-f0-9]{64}$/);
    assert.equal(site.followup.parentARTParamsSha256, semantic(site.calls[0].params));
    assert.equal(site.calls[0].metadata.discoveryStep, site.followup.discoveryStep);
  }
  assert.equal(JSON.stringify(f), before);assert.equal(JSON.stringify(result.publicMetadata).includes(SECRET), false);
});

test('NAS supplements exclude load/init failures and do not revisit methods attempted before timeout', () => {
  const notReady = nasFixture();notReady.nas.report.initSuccess = false;
  assert.equal(buildNAS(notReady).publicMetadata.summary.executableFollowups, 0);
  const clean = nasFixture();clean.nas.report.calls[0].status = 'empty';
  assert.equal(buildNAS(clean).publicMetadata.summary.executableFollowups, 0);
  const before = nasFixture();
  const row = before.nas.privateCalls[1];row.params = [];row.metadata.status = 'empty';row.metadata.paramsSha256 = semantic([]);
  before.nas.report.calls[0].status = 'empty';before.nas.report.calls[0].paramsSha256 = semantic([true]);
  before.nas.report.calls[2].status = 'timeout';before.nas.privateCalls[2].params = ['real-tid', '1', true, {}];before.nas.report.calls[2].paramsSha256 = semantic(before.nas.privateCalls[2].params);
  assert.deepEqual(sites(buildNAS(before)).map(site => site.followup.discoveryStep), ['search', 'player']);
});

test('NAS supplement identity validation rejects mismatched source context, manifest, ART arguments and tampered responses', () => {
  for (const change of [
    f => { f.bundles[0].manifestSha256 = sha('other manifest'); },
    f => { f.nas.input.site.key = 'another-source'; },
    f => { f.nas.report.caseIdentitySha256 = sha('other scenario'); },
    f => { f.nas.privateCalls[0].params = [false]; },
    f => { f.nas.report.mainJarSha256 = sha('other main'); },
    f => { f.results[0].privateCalls[1].params = ['illegal-home-video-argument']; },
  ]) {
    const f = nasFixture();change(f);assert.throws(() => buildNAS(f), /WORKING_FOLLOWUP_|INPUT_CHECKSUM/);
  }
  const missing = nasFixture();missing.bundles = [];assert.throws(() => buildNAS(missing), /INCOMPLETE_NAS_RESULTS/);
  const duplicate = nasFixture();duplicate.bundles.push(duplicate.bundles[0]);assert.throws(() => buildNAS(duplicate), /NAS_UNKNOWN_OR_DUPLICATE_CASE/);
});

test('NAS standalone supplements retain frozen-source metadata and never become original-main evidence', () => {
  const f = nasFixture({ diagnostic: true });f.plan.metadata = { sourceInputSetSha256: sha('freeze identity') };
  const result = buildNAS(f);
  assert.equal(result.plan.standaloneDiagnostic, true);assert.deepEqual(result.plan.metadata, f.plan.metadata);
  assert.ok(sites(result).every(site => site.followup.contextScope === 'standalone-diagnostic-original-main-missing'
    && site.originalMissingContext.reason === 'original-main-not-captured' && !site.loaderContext.main));
});

test('standalone ART and NAS supplement plans prepare with the original captured freeze identity', async t => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'tvbox-followup-loader-'));t.after(() => rm(directory, { recursive: true, force: true }));
  const f = nasFixture({ diagnostic: true }), sourceInputSetSha256 = sha('retained freeze identity');
  f.plan.metadata = { sourceInputSetSha256, sourceFilesSha256: sha('retained input files') };
  const bindingId = f.plan.artifacts[0].sites[0].originalMissingContext.originalBindingId;
  f.plan.artifacts[0].sites[0].bindingId = bindingId;f.nas.input.site.bindingId = bindingId;
  f.nas.input.artifact = structuredClone(f.plan.artifacts[0]);
  // Regenerate the byte-bound parent fixture pins after adding the actual plan
  // metadata that the NAS case preparer requires for standalone diagnostics.
  f.manifestSha256 = sha(JSON.stringify(f.plan));f.results[0].report.manifestSha256 = f.manifestSha256;
  f.bundles[0].manifestSha256 = f.manifestSha256;f.nas.report.manifestSha256 = f.manifestSha256;
  const freeze = { schemaVersion: 1, inputSetSha256: sourceInputSetSha256, bindings: [{ id: bindingId, role: 'site' }] };
  await writeFile(join(directory, 'freeze.json'), JSON.stringify(freeze));
  // ART followup: a timeout leaves slots outstanding. NAS followup: the same
  // complete ART calls were attempted but NAS home timed out independently.
  const artParent = structuredClone(f);artParent.results[0].report.completed = false;artParent.results[0].report.timedOut = true;
  const generated = [build(artParent).plan, buildNAS(f).plan];
  for (const [index, plan] of generated.entries()) {
    assert.deepEqual(plan.metadata, f.plan.metadata);assert.equal(plan.standaloneDiagnostic, true);
    const planPath = join(directory, 'supplement-' + index + '.json');await writeFile(planPath, JSON.stringify(plan));
    const prepared = await prepareWorkingSourceCases(planPath, { inputRoot: directory });
    assert.equal(prepared.plan.metadata.sourceInputSetSha256, sourceInputSetSha256);
    assert.ok(prepared.cases.length > 0);assert.ok(prepared.cases.every(entry => entry.standaloneDiagnostic === true && entry.originalBinding.id === bindingId));
  }
});

test('NAS supplement CLI pins exact ART/NAS files and preserves prior reports', async t => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'tvbox-nas-followup-'));t.after(() => rm(directory, { recursive: true, force: true }));
  const artDirectory = join(directory, 'art'), nasCasesDirectory = join(directory, 'nas'), planPath = join(directory, 'parent-plan.json'), out = join(directory, 'out');
  await mkdir(artDirectory);await mkdir(nasCasesDirectory);
  const f = nasFixture(), planBytes = Buffer.from(JSON.stringify(f.plan, null, 2) + '\n'), manifestSha256 = sha(planBytes);
  f.results[0].report.manifestSha256 = manifestSha256;f.bundles[0].manifestSha256 = manifestSha256;f.nas.report.manifestSha256 = manifestSha256;
  const artBytes = Buffer.from(JSON.stringify(f.results[0])), nasBytes = Buffer.from(JSON.stringify(f.bundles[0]));
  await writeFile(planPath, planBytes);await writeFile(join(artDirectory, '0-0-private.json'), artBytes);await writeFile(join(nasCasesDirectory, 'case-000-private.json'), nasBytes);
  const command = spawnSync(process.execPath, ['scripts/compat/prepare-working-followups.mjs', '--plan', planPath, '--art', artDirectory, '--nas-cases-dir', nasCasesDirectory, '--out', out], { encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);assert.equal(JSON.parse(command.stdout).executableFollowups, 4);assert.equal(command.stdout.includes(SECRET), false);
  const pins = JSON.parse(await readFile(join(out, 'pins.json')));
  assert.deepEqual(pins.evidenceFiles.map(file => file.sha256), [sha(artBytes), sha(nasBytes)]);
  assert.equal(pins.cases[0].parentNASBundleSha256, sha(nasBytes));assert.equal(pins.cases[0].parentARTPrivateResultSha256, sha(artBytes));
  assert.equal((await stat(join(out, 'oracle-plan.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(join(nasCasesDirectory, 'case-000-private.json')), nasBytes);
  await assert.rejects(prepareWorkingNASFollowups({ planPath, artDirectory, nasCasesDirectory, out }), /OUTPUT_NOT_EMPTY/);
});
