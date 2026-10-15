// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { catalogReport } from '../scripts/compat/catalog-report.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const ID = digest('captured decoded JAR');
const SECRET = 'PRIVATE_SOURCE_BODY_4d018b11';
const PRIVATE_URL = 'https://private.invalid/spider.jar?token=' + SECRET;
const PRIVATE_LABEL = 'Bearer ' + SECRET;
const writeJson = (path, value) => writeFile(path, JSON.stringify(value));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-catalog-report-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const references = [
    { publicName: PRIVATE_LABEL, partial: false, kind: 'jar-csp' },
    { publicName: '公开目录', partial: false, kind: 'jar-csp' },
    { publicName: '部分解析目录', partial: true, kind: 'jar-csp' },
  ];
  const sites = [
    { key: 'first', api: 'csp_Example', ext: SECRET, extSha256: digest(SECRET), referenceCount: 2 },
    { key: 'second', api: 'csp_Example', ext: { private: SECRET }, extSha256: digest('second ext'), referenceCount: 1 },
  ];
  const manifest = { schemaVersion: 1, inputRoot: '/private-input', artifacts: [
    { id: ID, sha256: ID, jarPath: 'artifacts/' + ID + '.jar', role: 'main', sites },
  ] };
  const inventory = {
    entries: [
      { id: 'accepted', publicName: PRIVATE_LABEL, parseSuccess: true, sourceCount: 4, configSha256: digest('accepted config') },
      { id: 'partial', publicName: '部分解析目录', parseSuccess: false, partial: true, partialSourceCount: 3,
        partialConfigSha256: digest('partial config'), partialErrorType: 'java.lang.IndexOutOfBoundsException' },
    ], summary: { sourceReferences: 4 }, customCatalog: { ok: false, candidates: 0 },
  };
  const artifactInventory = {
    summary: { requestedSignatures: 3, sourceReferences: 3, sourceVariants: 2 },
    retrievals: [
      { signature: PRIVATE_URL, role: 'main', ok: true, sha256: ID, bytes: 123, md5Matches: true, siteReferences: 2, references: references.slice(0, 2) },
      { signature: 'https://mirror.invalid/a.jar', role: 'site', ok: true, sha256: ID, bytes: 123, md5Matches: null, siteReferences: 1, references: references.slice(2) },
      { signature: 'https://missing.invalid/a.jar', role: 'site', ok: false, siteReferences: 1, references: [], error: { code: 'JAR_HTTP_404', message: PRIVATE_URL } },
    ],
    artifacts: [{ id: ID, sha256: ID, bytes: 123, role: 'main', roles: ['main', 'site'], references,
      sourceReferences: 3, sourceVariants: 2, inspection: { ok: true, entries: 1, expandedBytes: 200,
        classFiles: 1, dexClasses: 0, dex: [], native: [], protectedPayloads: [] } }],
  };
  await Promise.all([
    writeFile(join(directory, 'index.html'), '<html>catalog fixture</html>'),
    writeJson(join(directory, 'site-config.json'), { apiDomains: [] }),
    writeFile(join(directory, 'list.txt'), 'fixture.json|20261015|123B|https://public.invalid/config'),
    writeJson(join(directory, 'inventory.json'), inventory),
    writeJson(join(directory, 'artifact-inventory.json'), artifactInventory),
    writeJson(join(directory, 'input-manifest.json'), manifest),
  ]);
  let nextPass = 0;
  return {
    directory, manifest,
    async pass(raw, options = {}) {
      const path = join(directory, 'pass-' + nextPass++ + '.json');
      await writeJson(path, raw);
      return { name: options.name || 'test-pass', path, ...options };
    },
  };
}

function executionArtifact(overrides = {}) {
  return { id: ID, role: 'main', chosenRole: 'main', sourceCount: 2,
    input: { bytes: 123, sha256: ID }, load: { loaded: true }, cleanup: { closed: true, temporaryDataRemoved: true },
    sites: [{ sourceKey: 'first', api: 'csp_Example', extSha256: digest(SECRET), init: { ok: true } }],
    observations: { attemptedApis: 1, readyApis: 1, homes: 0, homesWithContent: 0,
      categories: 0, categoriesWithContent: 0, details: 0, detailsWithContent: 0 }, ...overrides };
}

function executionReport(artifacts = [executionArtifact()]) {
  return { schemaVersion: 1, date: '2026-10-15T00:00:00.000Z', host: { platform: 'linux', architecture: 'x64' },
    manifestSha256: digest('canonical captured manifest'), artifacts,
    observations: { artifacts: artifacts.length }, cleanup: { temporaryDataRemoved: true } };
}

test('catalog report keeps signature, artifact, variant, API and repeated pass denominators distinct', async t => {
  const f = await fixture(t);
  const first = await f.pass(executionReport([executionArtifact({ load: { loaded: false }, sites: [],
    observations: { attemptedApis: 0, readyApis: 0 }, error: { category: 'timeout' } })]), { name: 'phase-one', runnerSha256: digest('old runner') });
  const second = await f.pass(executionReport([executionArtifact({ observations: { attemptedApis: 1, readyApis: 1, homes: 1, homesWithContent: 1 } })]),
    { name: 'phase-two', runnerSha256: digest('new runner') });
  const report = await catalogReport(f.directory, [first, second]);
  assert.deepEqual([report.catalog.entries, report.catalog.accepted, report.catalog.partial], [2, 1, 1]);
  assert.deepEqual([report.catalog.acceptedSourceReferences, report.catalog.partialSourceReferences], [4, 3]);
  assert.deepEqual([report.retrieval.requestedSignatures, report.retrieval.successful, report.retrieval.failed], [3, 2, 1]);
  assert.deepEqual(report.retrieval.advertisedMd5, { matched: 1, mismatched: 0, unavailable: 1 });
  assert.deepEqual([report.inventory.artifacts, report.inventory.sourceVariants, report.inventory.sourceReferences], [1, 2, 3]);
  assert.equal(report.artifacts[0].uniqueApis, 1);
  assert.equal(report.artifacts[0].partialSubscriptionReferences, 1);
  assert.equal(report.execution.uniqueArtifactsAttempted, 1);
  assert.equal(report.artifacts[0].execution.attempts, 2);
  assert.equal(report.execution.loadedAtLeastOnce, 1);
  assert.equal(report.execution.homeWithContentAtLeastOnce, 1);
  assert.equal(report.execution.allAcquiredArtifactsAttempted, true);
  assert.deepEqual(report.artifacts[0].execution.failures, ['timeout']);
  assert.deepEqual(report.passes.map(pass => pass.runnerSha256), [digest('old runner'), digest('new runner')]);
});

test('catalog report emits hashes and metadata while dropping unrelated response and input payloads', async t => {
  const f = await fixture(t);
  const raw = executionReport([executionArtifact({ privateSourceText: SECRET,
    sites: [{ sourceKey: 'first', api: 'csp_Example', extSha256: digest(SECRET), init: { ok: true }, privateResponseBody: SECRET }] })]);
  raw.privateInputManifest = f.manifest;
  const report = await catalogReport(f.directory, [await f.pass(raw)]);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(serialized.includes(PRIVATE_URL), false);
  assert.equal(serialized.includes('/private-input'), false);
  assert.match(report.catalog.entryResults[0].publicName, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.retrieval.retrievals[0].signatureSha256, digest(PRIVATE_URL));
  assert.equal(report.passes[0].artifacts[0].privateSourceText, undefined);
  assert.equal(report.passes[0].artifacts[0].sites[0].privateResponseBody, undefined);
  assert.equal(report.catalog.inputHashes.length, 6);
});

test('catalog report rejects input manifests and explicit captured source bodies in execution passes', async t => {
  const f = await fixture(t);
  await assert.rejects(catalogReport(f.directory, [await f.pass(f.manifest)]), /Expected matrix execution report/);
  for (const privateField of ['ext', 'jar', 'jarPath', 'signature']) {
    const artifact = executionArtifact();
    artifact.sites[0][privateField] = SECRET;
    await assert.rejects(catalogReport(f.directory, [await f.pass(executionReport([artifact]))]), /must not include captured source bodies/);
  }
  await assert.rejects(catalogReport(f.directory, [await f.pass(executionReport([executionArtifact({ jarPath: PRIVATE_URL })]))]), /Expected metadata execution artifact/);
});

test('catalog report rejects unknown, duplicate and mismatched artifact identities before counting attempts', async t => {
  const f = await fixture(t);
  const unknown = executionArtifact({ id: digest('uncaptured artifact') });
  await assert.rejects(catalogReport(f.directory, [await f.pass(executionReport([unknown]))]), /Unknown or duplicate execution artifact identity/);
  await assert.rejects(catalogReport(f.directory, [await f.pass(executionReport([executionArtifact(), executionArtifact()]))]), /Unknown or duplicate execution artifact identity/);
  const mismatch = executionArtifact({ input: { bytes: 123, sha256: digest('different downloaded bytes') } });
  await assert.rejects(catalogReport(f.directory, [await f.pass(executionReport([mismatch]))]), /Execution input hash differs/);
});

test('valid JSON responses without class or list content do not count as content success', async t => {
  const f = await fixture(t);
  const emptyJson = { ok: true, bytes: 2, sha256: digest('{}'), emptyObject: true, hasContent: false, classes: null, list: null };
  const artifact = executionArtifact({ sites: [{ sourceKey: 'first', api: 'csp_Example', extSha256: digest(SECRET),
    init: { ok: true }, homeContent: emptyJson, categoryContent: emptyJson, detailContent: emptyJson }],
    observations: { attemptedApis: 1, readyApis: 1, homes: 1, homesWithContent: 0,
      categories: 1, categoriesWithContent: 0, details: 1, detailsWithContent: 0 } });
  const report = await catalogReport(f.directory, [await f.pass(executionReport([artifact]))]);
  assert.equal(report.execution.loadedAtLeastOnce, 1);
  assert.equal(report.execution.readyAtLeastOnce, 1);
  assert.equal(report.execution.homeWithContentAtLeastOnce, 0);
  assert.equal(report.execution.categoryWithContentAtLeastOnce, 0);
  assert.equal(report.execution.detailWithContentAtLeastOnce, 0);
  assert.equal(report.passes[0].artifacts[0].observations.homes, 1);
  assert.equal(report.passes[0].artifacts[0].sites[0].homeContent.ok, true);
  assert.equal(report.artifacts[0].sourceVariants, 2);
  assert.equal(report.passes[0].artifacts[0].observations.attemptedApis, 1);
});
