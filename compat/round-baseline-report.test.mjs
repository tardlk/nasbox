// SPDX-License-Identifier: GPL-3.0-only
// Owned synthetic inputs; no network, JVM, Android, Docker, or services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { freezeCatalog } from '../scripts/compat/freeze-catalog.mjs';
import { canonical, normalizeManifest } from '../scripts/container/jar-matrix-probe.mjs';
import { roundBaselineReport, roundBaselineMarkdown } from '../scripts/compat/round-baseline-report.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const semanticHash = value => hash(JSON.stringify(canonical(value)));
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const SECRET = 'private-source-secret-48772';
const LIMITS = { loadMs: 90000, initMs: 10000, callMs: 10000, artifactMs: 150000, closeMs: 5000, jvmMs: 90000, maxHomeSites: 1 };
const failure = (category, code) => ({ category, type: 'java.lang.Exception', fingerprint: hash(category), ...(code ? { failureCodes: [code] } : {}), message: SECRET });
const apiLabel = value => value.length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(value) ? 'sha256:' + hash(value) : value;
const extHash = source => hash(typeof source.ext === 'string' ? source.ext : JSON.stringify(source.ext ?? ''));

async function fixture(t, { api = 'https://private.invalid/api?token=' + SECRET, failures = 0, partial = false } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'tvbox-round-report-test-')), capture = join(base, 'capture'), run = join(base, 'run');
  t.after(() => rm(base, { recursive: true, force: true }));
  await Promise.all([mkdir(join(capture, 'captures', 'fixture'), { recursive: true }), mkdir(join(capture, 'artifacts'), { recursive: true }), mkdir(join(run, 'manifests'), { recursive: true }), mkdir(join(run, 'output'), { recursive: true })]);
  const mainBytes = Buffer.from('owned main artifact bytes'), invalidBytes = Buffer.from('owned invalid artifact bytes');
  const id = hash(mainBytes), invalidId = hash(invalidBytes), url = 'https://private.invalid/jar?token=' + SECRET;
  const sources = [
    { key: SECRET, api: 'csp_Fixture', type: 3, ext: SECRET },
    { key: SECRET + '-second', api: 'csp_Fixture', type: 3, ext: { private: SECRET } },
    { key: SECRET + '-third', api, type: 3, ext: 'another-' + SECRET },
  ];
  const config = { globals: { spider: url }, sites: [...sources,
    { key: 'helper', api: 'https://private.invalid/helper.js', type: 3, ext: SECRET, jar: 'https://private.invalid/helper.jar' },
    { key: 'missing', api: 'csp_Missing', type: 3, ext: SECRET, jar: 'https://private.invalid/missing?token=' + SECRET },
  ] };
  const configFile = 'captures/fixture/config.json';
  await json(join(capture, configFile), config);
  const entry = { id: 'fixture', publicName: SECRET, parseSuccess: true, configFile, configSha256: hash(await readFile(join(capture, configFile))), responses: [] };
  const artifacts = [
    { id, sha256: id, jarPath: 'artifacts/' + id + '.jar', bytes: mainBytes.length, role: 'main', roles: ['main'], sites: sources },
    { id: invalidId, sha256: invalidId, jarPath: 'artifacts/' + invalidId + '.jar', bytes: invalidBytes.length, role: 'site', roles: ['site'], sites: [] },
  ];
  const input = { schemaVersion: 1, limits: LIMITS, artifacts };
  await Promise.all([
    writeFile(join(capture, artifacts[0].jarPath), mainBytes), writeFile(join(capture, artifacts[1].jarPath), invalidBytes),
    writeFile(join(capture, 'index.html'), '<html>owned fixture</html>'), writeFile(join(capture, 'list.txt'), SECRET), json(join(capture, 'site-config.json'), { private: SECRET }),
    json(join(capture, 'inventory.json'), { entries: [entry] }), json(join(capture, 'captures/fixture/metadata.json'), entry),
    json(join(capture, 'input-manifest.json'), input),
    json(join(capture, 'artifact-inventory.json'), { artifacts: artifacts.map((artifact, index) => ({ ...artifact, inspection: { ok: index === 0 } })), retrievals: [
      { role: 'main', signature: url, ok: true, sha256: id, bytes: mainBytes.length },
      { role: 'site', signature: 'https://private.invalid/helper.jar', ok: true, sha256: invalidId, bytes: invalidBytes.length },
      { role: 'site', signature: 'https://private.invalid/missing?token=' + SECRET, ok: false, error: { code: 'JAR_HTTP_404', message: SECRET } },
    ] }),
  ]);
  if (failures || partial) {
    const catalog = { entries: [entry] };
    for (let index = 0; index < failures; index++) {
      const captureId = 'failure-' + index;
      await mkdir(join(capture, 'captures', captureId));
      const failed = { id: captureId, publicName: SECRET, parseSuccess: false, responses: [] };
      await json(join(capture, 'captures', captureId, 'metadata.json'), failed);
      catalog.entries.push(failed);
    }
    if (partial) {
      await mkdir(join(capture, 'captures', 'partial'));
      const partialConfigFile = 'captures/partial/partial-config.json';
      await json(join(capture, partialConfigFile), config);
      const partialEntry = { id: 'partial', publicName: SECRET, parseSuccess: false, responses: [], partialConfigFile,
        partialConfigSha256: hash(await readFile(join(capture, partialConfigFile))) };
      await json(join(capture, 'captures/partial/metadata.json'), partialEntry);
      catalog.entries.push(partialEntry);
    }
    await json(join(capture, 'inventory.json'), catalog);
  }
  const freeze = await freezeCatalog({ directory: capture });
  const runnerSha256 = freeze.scripts.find(script => script.file === 'scripts/container/jar-matrix-probe.mjs').sha256;
  const plan = { schemaVersion: 1, limits: LIMITS, images: { old: 'sha256:' + hash('old image'), final: 'sha256:' + hash('final image') },
    runnerSha256, inputManifestSha256: hash(await readFile(join(capture, 'input-manifest.json'))), freezeSha256: hash(await readFile(join(capture, 'freeze.json'))), cases: [] };
  const reports = {};
  for (const [index, artifact] of artifacts.entries()) {
    const manifest = { schemaVersion: 1, inputRoot: '/input', helperLoadValidation: true, limits: LIMITS, artifacts: [artifact] };
    const file = 'manifests/case-' + String(index).padStart(3, '0') + '.json';
    await json(join(run, file), manifest);
    const manifestBytesSha256 = hash(await readFile(join(run, file)));
    plan.cases.push({ index, id: artifact.id, manifest: file, manifestBytesSha256, role: artifact.role, validZip: index === 0, shard: index });
    const limits = normalizeManifest(manifest, { inputRoot: '/input' }).limits;
    const main = index === 0;
    const sites = main ? [
      { api: 'csp_Fixture', extSha256: extHash(sources[0]), sourceKey: SECRET, init: { ok: true },
        homeContent: { ok: true, bytes: 20, sha256: hash('home bytes'), semanticSha256: hash('home semantic'), fields: 1, emptyObject: false, hasContent: true, classes: 1, list: null, filterGroups: null, rawBody: SECRET },
        categoryContent: { ok: false, error: failure('invalid-json') } },
      { api: apiLabel(sources[2].api), extSha256: extHash(sources[2]), init: { ok: false, error: failure('network') } },
    ] : [];
    const row = { id: artifact.id, role: artifact.role, chosenRole: artifact.role, limits, sites,
      input: { sha256: artifact.sha256, bytes: artifact.bytes }, load: main ? { loaded: true } : { loaded: false, error: failure('execution', 'ZIP_INVALID') },
      loadValidation: { attempted: true, status: main ? 'loaded' : 'failed', trigger: main ? 'main-load' : 'site-helper-synthetic-class' },
      executionIdentity: { runnerSha256, inputSha256: semanticHash({ expectedJarSha256: artifact.sha256, role: artifact.role, helperLoadValidation: true, sites: artifact.sites }), limitsSha256: semanticHash(limits) },
      unattempted: main ? [{ api: 'csp_Fixture', extSha256: extHash(sources[1]), reason: 'variant-budget' }] : [],
      observations: { readyApis: 999, attemptedApis: 999, homesWithContent: 999, private: SECRET },
      cleanup: { closed: true, workerExited: true, temporaryDataRemoved: true, parentTemporaryDataRemoved: true }, private: SECRET };
    for (const name of ['old', 'final']) {
      const report = { schemaVersion: 1, runnerSha256, manifestBytesSha256, manifestSha256: semanticHash(manifest), limitsSha256: semanticHash(limits),
        host: { platform: 'linux', architecture: 'x64', private: SECRET }, artifacts: [structuredClone(row)], observations: { readyApis: 888 }, cleanup: { temporaryDataRemoved: true } };
      const prefix = name + '-' + String(index).padStart(3, '0');
      reports[prefix] = report;
      await json(join(run, 'output', prefix + '.json'), report);
      await json(join(run, 'output', prefix + '.inspect.json'), [{ Id: hash(prefix), Image: plan.images[name], State: { Running: false, Status: 'exited', ExitCode: 0, OOMKilled: false }, Config: { User: '10001', Env: [SECRET], Labels: { private: SECRET } } }]);
      await writeFile(join(run, 'output', prefix + '.exit.txt'), '0\n');
    }
  }
  await json(join(run, 'plan.json'), plan);
  return { base, capture, run, plan, reports, id, invalidId,
    async changeReport(prefix, change) { const report = reports[prefix]; change(report); await json(join(run, 'output', prefix + '.json'), report); },
    async changePlan(change) { change(plan); await json(join(run, 'plan.json'), plan); },
  };
}

test('round report validates frozen identities, recomputes counters, separates invalid content and removes all private fields', async t => {
  const f = await fixture(t), report = await roundBaselineReport(f);
  assert.equal(report.capture.downloadFailures, 1);
  assert.equal(report.capture.failedWithoutConfigSubscriptions, 0);
  assert.equal(report.capture.invalidDownloadedContent.length, 1);
  assert.deepEqual(report.summary.final.validArtifactLoads, { loaded: 1 });
  assert.deepEqual(report.summary.final.invalidContentLoads, { failed: 1 });
  assert.equal(report.summary.final.attemptedApis, 2);
  assert.equal(report.summary.final.readyApis, 1);
  assert.equal(report.summary.final.unattemptedVariants, 1);
  assert.equal(report.summary.final.methods.homeContent.nonempty, 1);
  assert.equal(report.summary.final.methods.categoryContent['invalid-json'], 1);
  assert.equal(report.summary.final.initStates.network, 1);
  assert.equal(report.artifacts[0].manifestBytesSha256, f.plan.cases[0].manifestBytesSha256);
  assert.equal(report.artifacts[0].shard, 0);
  assert.equal(report.coverage.completeArtifactExecution, true);
  assert.equal(report.coverage.allExtVariantsExhaustive, false);
  assert.equal(JSON.stringify(report).includes(SECRET), false);
  assert.equal(JSON.stringify(report).includes('https://'), false);
  assert.equal(JSON.stringify(report).includes('"Config":'), false);
  assert.match(roundBaselineMarkdown(report), /并未穷举/);
});

test('missing execution bundles remain explicitly not tested and do not count as failed', async t => {
  const f = await fixture(t);
  await Promise.all(['.json', '.inspect.json', '.exit.txt'].map(suffix => rm(join(f.run, 'output/final-000' + suffix))));
  const report = await roundBaselineReport(f);
  assert.equal(report.coverage.completeArtifactExecution, false);
  assert.equal(report.coverage.completeValidLoadAttempts, false);
  assert.deepEqual(report.summary.final.validArtifactLoads, { 'not-tested': 1 });
  assert.equal(report.artifacts[0].final.observations.unattemptedVariants, 3);
  assert.equal(report.failurePriority[0].cluster, 'unresolved-coverage');
});

test('all missing execution bundles preserve the full API/ext denominator while counting no ready APIs', async t => {
  const f = await fixture(t);
  for (const name of ['old', 'final']) for (const index of [0, 1]) {
    await Promise.all(['.json', '.inspect.json', '.exit.txt'].map(suffix => rm(join(f.run, 'output', name + '-' + String(index).padStart(3, '0') + suffix))));
  }
  const report = await roundBaselineReport(f);
  for (const name of ['old', 'final']) {
    const summary = report.summary[name];
    assert.equal(summary.executionReports, 0);
    assert.equal(summary.expectedApis, 2);
    assert.equal(summary.expectedVariants, 3);
    assert.equal(summary.readyApis, 0);
    assert.equal(summary.attemptedApis, 0);
    assert.equal(summary.unattemptedApis, 2);
    assert.equal(summary.unattemptedVariants, 3);
    assert.deepEqual(summary.initStates, { 'not-tested': 3 });
    assert.deepEqual(summary.loadStates, { 'not-tested': 2 });
  }
});

test('capture distinguishes accepted, partial and failed subscriptions without mutating frozen input', async t => {
  const f = await fixture(t, { failures: 2, partial: true });
  const report = await roundBaselineReport(f);
  assert.equal(report.capture.catalogEntries, 4);
  assert.equal(report.capture.acceptedSubscriptions, 1);
  assert.equal(report.capture.partialSubscriptions, 1);
  assert.equal(report.capture.failedWithoutConfigSubscriptions, 2);
  assert.match(roundBaselineMarkdown(report), /无配置失败 2 项/);
});

test('ordinary JAR API names pair with runner labels while public output hashes arbitrary names', async t => {
  const f = await fixture(t, { api: 'PlainNamedSpider' }), report = await roundBaselineReport(f);
  assert.equal(report.summary.final.attemptedApis, 2);
  assert.equal(report.artifacts[0].final.variants.find(row => row.apiSha256 === hash('PlainNamedSpider')).api, 'sha256:' + hash('PlainNamedSpider'));
});

test('different Docker image, running container, user, or exit bundle cannot certify a run', async t => {
  for (const change of [row => { row.Image = 'sha256:' + hash('wrong'); }, row => { row.State.Running = true; }, row => { row.Config.User = '0'; }, row => { row.State.ExitCode = 137; }]) {
    const f = await fixture(t), path = join(f.run, 'output/final-000.inspect.json'), value = JSON.parse(await readFile(path));
    change(value[0]); await json(path, value);
    await assert.rejects(roundBaselineReport(f), /ROUND_DOCKER_/);
  }
  const f = await fixture(t);
  await writeFile(join(f.run, 'output/final-000.exit.txt'), '1\n');
  await assert.rejects(roundBaselineReport(f), /ROUND_DOCKER_/);
});

test('reports must match runner, manifest byte and semantic hashes, budgets, and artifact execution identity', async t => {
  for (const change of [
    report => { report.runnerSha256 = hash('wrong runner'); },
    report => { report.manifestBytesSha256 = hash('wrong bytes'); },
    report => { report.manifestSha256 = hash('wrong semantics'); },
    report => { report.limitsSha256 = hash('wrong limits'); },
    report => { report.artifacts[0].executionIdentity.inputSha256 = hash('wrong ext or role'); },
    report => { report.artifacts[0].limits.initMs++; },
    report => { report.artifacts[0].input.bytes++; },
  ]) {
    const f = await fixture(t); await f.changeReport('final-000', change);
    await assert.rejects(roundBaselineReport(f), /ROUND_(?:REPORT_IDENTITY|EXECUTION_)/);
  }
});

test('case index, complete artifact coverage, selected role, validity and pinned manifest cannot be changed', async t => {
  for (const change of [
    plan => { plan.cases[0].index = 1; }, plan => { plan.cases[0].manifest = 'manifests/case-0.json'; },
    plan => { plan.cases.pop(); }, plan => { plan.cases[1].id = plan.cases[0].id; },
    plan => { plan.cases[0].role = 'site'; }, plan => { plan.cases[0].validZip = false; },
    plan => { plan.freezeSha256 = hash('different freeze'); },
  ]) { const f = await fixture(t); await f.changePlan(change); await assert.rejects(roundBaselineReport(f), /ROUND_(?:PLAN_|CASE_)/); }
  const f = await fixture(t), path = join(f.run, f.plan.cases[0].manifest), value = JSON.parse(await readFile(path));
  value.artifacts[0].sites[0].ext = 'mutated-' + SECRET;
  await json(path, value);
  await f.changePlan(plan => { plan.cases[0].manifestBytesSha256 = hash(Buffer.from(JSON.stringify(value, null, 2) + '\n')); });
  await assert.rejects(roundBaselineReport(f), /ROUND_CASE_MANIFEST_SEMANTIC/);
});

test('unknown, duplicate, incomplete and conflicting API/ext evidence is rejected', async t => {
  for (const change of [
    row => { row.sites[0].extSha256 = hash('unknown ext'); },
    row => { row.sites.push(structuredClone(row.sites[0])); },
    row => { row.unattempted = []; },
    row => { row.unattempted[0] = { api: row.sites[0].api, extSha256: row.sites[0].extSha256, reason: 'artifact-budget' }; },
    row => { row.unattempted[0].reason = SECRET; },
    row => { row.sites[1].homeContent = row.sites[0].homeContent; },
    row => { row.sites[0].homeContent.hasContent = false; },
  ]) { const f = await fixture(t); await f.changeReport('final-000', report => change(report.artifacts[0])); await assert.rejects(roundBaselineReport(f), /ROUND_/); }
});

test('isolated timeout retains partial progress and reconstructs missing ext variants as untested', async t => {
  const f = await fixture(t);
  await f.changeReport('final-000', report => {
    const row = report.artifacts[0]; row.partialProgress = true; row.unattempted = [];
    row.sites = [{ api: row.sites[0].api, extSha256: row.sites[0].extSha256, init: { attempted: true } }];
    row.load = undefined; row.loadValidation = { attempted: true, status: 'timeout', trigger: 'main-load' };
    row.error = { stage: 'isolated-worker', ...failure('artifact-timeout') };
  });
  const report = await roundBaselineReport(f), final = report.artifacts[0].final;
  assert.equal(final.load.status, 'timeout');
  assert.equal(final.observations.attemptedApis, 1);
  assert.equal(final.observations.unattemptedVariants, 2);
  assert.equal(final.variants.filter(row => row.reason === 'worker-interrupted').length, 2);
  assert.equal(report.failurePriority[0].cluster, 'timeout');
});

test('final failure queue uses controlled protection/native codes and keeps timeout separate', async t => {
  for (const [code, category, cluster] of [['PROTECTED_INIT_UNBOUND', 'native-binding', 'protection'], ['NATIVE_GET_LOADER_NOT_READY', 'native-binding', 'native-loader'], [null, 'missing-class-or-member', 'general-execution']]) {
    const f = await fixture(t);
    await f.changeReport('final-000', report => {
      const row = report.artifacts[0]; row.load = { loaded: false, error: failure(category, code) }; row.loadValidation.status = 'failed';
      row.sites = []; row.unattempted = f.reports['old-000'].artifacts[0].sites.map(site => ({ api: site.api, extSha256: site.extSha256, reason: 'load-failure' })).concat(row.unattempted);
    });
    const report = await roundBaselineReport(f);
    assert.equal(report.failurePriority[0].cluster, cluster);
    assert.deepEqual(report.summary.candidateRegressions, [f.id]);
    assert.equal(JSON.stringify(report.failurePriority).includes(SECRET), false);
  }
});

test('network-only initialization failures stay outside the implementation failure cluster', async t => {
  const f = await fixture(t), report = await roundBaselineReport(f);
  assert.equal(report.failurePriority.length, 1);
  assert.equal(report.failurePriority[0].cluster, 'network-or-state');
  assert.equal(report.failurePriority[0].load, 'loaded');
});

async function interruptedBundle(f, { commandExit = 124, containerExit = 137, oom = false, events = [], removeReport = true, commandFile = true } = {}) {
  if (removeReport) await rm(join(f.run, 'output/final-000.json'));
  const inspectPath = join(f.run, 'output/final-000.inspect.json'), inspect = JSON.parse(await readFile(inspectPath));
  inspect[0].State.ExitCode = containerExit; inspect[0].State.OOMKilled = oom;
  await json(inspectPath, inspect);
  await writeFile(join(f.run, 'output/final-000.exit.txt'), commandExit + '\n');
  if (commandFile) await writeFile(join(f.run, 'output/final-000.command-exit.txt'), commandExit + '\n');
  if (events.length) await writeFile(join(f.run, 'output/final-000.jsonl'), events.map(value => JSON.stringify(value)).join('\n') + '\n');
}

test('outer timeout command 124 and container 137 remain interrupted with distinct exits and no invented load attempt', async t => {
  const f = await fixture(t);
  await interruptedBundle(f);
  const report = await roundBaselineReport(f), final = report.artifacts[0].final;
  assert.equal(final.docker.commandExit, 124); assert.equal(final.docker.containerExit, 137);
  assert.equal(final.interrupted, true); assert.equal(final.interruption, 'outer-timeout');
  assert.equal(final.runnerReportPresent, false); assert.equal(final.tested, false);
  assert.equal(final.load.attempted, false); assert.equal(final.load.status, 'not-tested');
  assert.equal(final.observations.readyApis, 0); assert.equal(final.observations.unattemptedVariants, 3);
  assert.equal(report.coverage.completeValidLoadAttempts, false);
  assert.equal(report.coverage.completeArtifactExecution, false);
  assert.equal(report.summary.final.interruptedExecutions, 1);
});

test('OOM without a runner report remains untested and does not reject the whole frozen round', async t => {
  const f = await fixture(t);
  await interruptedBundle(f, { commandExit: 137, containerExit: 137, oom: true, commandFile: false });
  const report = await roundBaselineReport(f), final = report.artifacts[0].final;
  assert.equal(final.interruption, 'out-of-memory');
  assert.equal(final.docker.oomKilled, true);
  assert.equal(final.load.attempted, false);
  assert.equal(report.summary.final.validArtifactLoads['not-tested'], 1);
});

test('interrupted JSONL recovers only pinned input and actual load/init progress', async t => {
  const f = await fixture(t), row = f.reports['final-000'].artifacts[0];
  await interruptedBundle(f, { events: [
    { event: 'stage', artifact: f.id, stage: 'input', input: row.input, executionIdentity: row.executionIdentity },
    { event: 'stage', artifact: f.id, stage: 'load-attempt', loadValidation: { attempted: true, status: 'unknown', trigger: 'main-load' } },
    { event: 'stage', artifact: f.id, stage: 'load', load: { loaded: true }, loadValidation: row.loadValidation },
    { event: 'stage', artifact: f.id, stage: 'init-attempt', site: { api: row.sites[0].api, extSha256: row.sites[0].extSha256, init: { attempted: true } } },
    { event: 'stage', artifact: f.id, stage: 'init', site: { api: row.sites[0].api, extSha256: row.sites[0].extSha256, init: { ok: true } } },
  ] });
  const report = await roundBaselineReport(f), final = report.artifacts[0].final;
  assert.equal(final.inputVerified, true);
  assert.equal(final.load.attempted, true); assert.equal(final.load.status, 'loaded');
  assert.equal(final.observations.attemptedApis, 1); assert.equal(final.observations.readyApis, 1);
  assert.equal(final.observations.unattemptedVariants, 2);
  assert.equal(final.tested, false); assert.equal(final.partialProgress, true);
  assert.equal(report.coverage.completeValidLoadAttempts, true);
  assert.equal(report.coverage.completeArtifactExecution, false);
});

test('progress without verified input cannot count load or init attempts even after container termination', async t => {
  const f = await fixture(t), row = f.reports['final-000'].artifacts[0];
  await interruptedBundle(f, { events: [
    { event: 'stage', artifact: f.id, stage: 'load-attempt', loadValidation: { attempted: true, status: 'unknown', trigger: 'main-load' } },
    { event: 'stage', artifact: f.id, stage: 'load', load: { loaded: true }, loadValidation: row.loadValidation },
    { event: 'stage', artifact: f.id, stage: 'init', site: row.sites[0] },
  ] });
  const report = await roundBaselineReport(f), final = report.artifacts[0].final;
  assert.equal(final.load.attempted, false); assert.equal(final.load.status, 'not-tested');
  assert.equal(final.observations.attemptedApis, 0); assert.equal(final.observations.readyApis, 0);
  assert.equal(report.coverage.completeValidLoadAttempts, false);
});

test('confirmed load failure survives later outer timeout or OOM while interruption stays separate', async t => {
  for (const cause of [{ commandExit: 124 }, { commandExit: 137, oom: true }]) {
    const f = await fixture(t), row = f.reports['final-000'].artifacts[0];
    await interruptedBundle(f, { ...cause, events: [
      { event: 'stage', stage: 'input', artifact: f.id, input: row.input, executionIdentity: row.executionIdentity },
      { event: 'stage', stage: 'load-attempt', artifact: f.id, loadValidation: { attempted: true, status: 'unknown', trigger: 'main-load' } },
      { event: 'stage', stage: 'load', artifact: f.id, load: { loaded: false, error: failure('execution', 'JAR_LOAD_FAILED') }, loadValidation: { attempted: true, status: 'failed', trigger: 'main-load' } },
    ] });
    const report = await roundBaselineReport(f), final = report.artifacts[0].final;
    assert.equal(final.load.status, 'failed');
    assert.equal(final.load.attempted, true);
    assert.equal(final.interrupted, true);
    assert.equal(final.tested, false);
    assert.equal(final.interruption, cause.oom ? 'out-of-memory' : 'outer-timeout');
    assert.equal(report.coverage.completeArtifactExecution, false);
  }
});

test('all interrupted JSONL identities stay strict and conflicting exit files or ordinary missing bundles still fail', async t => {
  for (const change of [
    event => { event.input.sha256 = hash('wrong input'); },
    event => { event.executionIdentity.runnerSha256 = hash('wrong runner'); },
    event => { event.artifact = hash('wrong artifact'); },
  ]) {
    const f = await fixture(t), row = f.reports['final-000'].artifacts[0];
    const event = { event: 'stage', stage: 'input', artifact: f.id, input: structuredClone(row.input), executionIdentity: structuredClone(row.executionIdentity) };
    change(event); await interruptedBundle(f, { events: [event] });
    await assert.rejects(roundBaselineReport(f), /ROUND_PROGRESS_/);
  }
  const f = await fixture(t); await interruptedBundle(f);
  await writeFile(join(f.run, 'output/final-000.command-exit.txt'), '0\n');
  await assert.rejects(roundBaselineReport(f), /ROUND_COMMAND_EXIT_CONFLICT/);
  const g = await fixture(t); await rm(join(g.run, 'output/final-000.json'));
  await assert.rejects(roundBaselineReport(g), /ROUND_INCOMPLETE_EXECUTION_BUNDLE/);
});

test('CLI resolves output parent links and refuses two aliases of one target before writing', async t => {
  const f = await fixture(t), link = join(f.base, 'outside-link');
  await symlink(f.capture, link);
  const args = ['scripts/compat/round-baseline-report.mjs', '--capture', f.capture, '--run', f.run];
  const blocked = spawnSync(process.execPath, [...args, '--output', join(link, 'must-not-appear.json'), '--markdown', join(f.base, 'safe.md')], { encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stderr).code, 'ROUND_OUTPUT_INSIDE_CAPTURE');
  await assert.rejects(readFile(join(f.capture, 'must-not-appear.json')), { code: 'ENOENT' });
  const alias = join(f.base, 'outside-alias'); await symlink(f.base, alias);
  const collision = spawnSync(process.execPath, [...args, '--output', join(f.base, 'same.json'), '--markdown', join(alias, 'same.json')], { encoding: 'utf8' });
  assert.equal(collision.status, 1);
  assert.equal(JSON.parse(collision.stderr).code, 'ROUND_OUTPUT_TARGET_CONFLICT');
  await assert.rejects(readFile(join(f.base, 'same.json')), { code: 'ENOENT' });
});

test('changed frozen bytes stop reporting; CLI failures never emit private parser text or paths', async t => {
  const f = await fixture(t);
  await writeFile(join(f.capture, 'list.txt'), 'changed-' + SECRET);
  await assert.rejects(roundBaselineReport(f), /FREEZE_INPUT_CHANGED/);
  const output = join(f.base, 'public.json'), markdown = join(f.base, 'public.md');
  const result = spawnSync(process.execPath, ['scripts/compat/round-baseline-report.mjs', '--capture', f.capture, '--run', f.run, '--output', output, '--markdown', markdown], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes(SECRET), false);
  assert.equal(result.stderr.includes(f.capture), false);
  assert.equal(JSON.parse(result.stderr).code, 'ROUND_IO_OR_SCHEMA');
});
