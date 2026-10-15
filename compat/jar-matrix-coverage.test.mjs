// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFailure, isJarSource, probeJarArtifact, summarizeMatrix } from '../scripts/container/jar-matrix-probe.mjs';

async function input(t, sites) {
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-matrix-coverage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const jarPath = join(directory, 'owned.jar');
  await writeFile(jarPath, 'owned synthetic bytes');
  return { directory, artifact: { id: 'coverage', jarPath, sites, limits: { artifactMs: 1000, loadMs: 100, closeMs: 30, callMs: 100 } } };
}
function runtime({ load = async () => ({ loaded: true }), gets = [] } = {}) {
  return () => ({
    request: async () => ({ enabled: false }), getDiagnostics: () => ({ stderr: '' }),
    loadMain: load, setModules: async () => {},
    getCSP: async source => { gets.push(source); return { token: 'private', ready: true, className: 'fixture.Spider' }; },
    call: async () => '{}', close: async () => {},
  });
}
const source = (key, api, ext = '') => ({ key, api, ext, type: 3 });

test('bare API matches the actual JAR route while JS and Python remain excluded', async t => {
  const sites = [source('bare', 'XPathGuard'), source('prefix', 'csp_Fixture'), source('js', 'https://fixture.invalid/a.js?x=1'), source('py', 'https://fixture.invalid/a.py')];
  assert.deepEqual(sites.map(isJarSource), [true, true, false, false]);
  const { directory, artifact } = await input(t, sites), gets = [];
  const report = await probeJarArtifact(artifact, { inputRoot: directory, runtimeFactory: runtime({ gets }) });
  assert.deepEqual(gets.map(value => value.api), ['XPathGuard', 'csp_Fixture']);
  assert.equal(report.uniqueApis, 2);
  assert.equal(report.uniqueVariants, 2);
  assert.equal(report.skippedNonJarSources, 2);
  assert.equal(report.allUnattemptedVariants, 0);
});

test('load failure retains every API/ext denominator without calling it budget exhaustion', async t => {
  const { directory, artifact } = await input(t, [source('a', 'Bare', 'first'), source('b', 'Bare', 'second'), source('c', 'csp_Third'), source('duplicate', 'Bare', 'first')]);
  const report = await probeJarArtifact(artifact, { inputRoot: directory, runtimeFactory: runtime({ load: async () => ({ loaded: false, failure: 'ZIP_INVALID private-url' }) }) });
  assert.equal(report.uniqueApis, 2);
  assert.equal(report.uniqueVariants, 3);
  assert.equal(report.duplicateSources, 1);
  assert.equal(report.allUnattemptedVariants, 3);
  assert.equal(report.unattemptedLoadFailure, 3);
  assert.equal(report.budgetSkipped, 0);
  assert.equal(report.unattempted.every(row => row.reason === 'load-failure'), true);
  assert.deepEqual(report.load.error.failureCodes, ['ZIP_INVALID']);
  assert.equal(JSON.stringify(report).includes('private-url'), false);
  const summary = summarizeMatrix([report]);
  assert.equal(summary.allUnattemptedVariants, 3);
  assert.equal(summary.unattemptedLoadFailure, 3);
  assert.equal(summary.budgetSkipped, 0);
});

test('load timeout retains variant denominator and counts a budget skip', async t => {
  const { directory, artifact } = await input(t, [source('a', 'Bare'), source('b', 'Bare', 'other')]);
  artifact.limits.loadMs = 10;
  const report = await probeJarArtifact(artifact, { inputRoot: directory, runtimeFactory: runtime({ load: () => new Promise(() => {}) }) });
  assert.equal(report.error.category, 'timeout');
  assert.equal(report.allUnattemptedVariants, 2);
  assert.equal(report.budgetSkipped, 2);
  assert.equal(report.unattemptedLoadFailure, 0);
  assert.equal(report.cleanup.closed, true);
});

test('failure evidence uses a fixed code whitelist and does not infer unknown conversion reasons', () => {
  const failure = classifyFailure(new Error('DUPLICATE_DEX_CLASS and ZIP_INVALID secret-token'));
  assert.deepEqual(failure.failureCodes, ['DUPLICATE_DEX_CLASS', 'ZIP_INVALID']);
  assert.equal(JSON.stringify(failure).includes('secret-token'), false);
  assert.equal(classifyFailure(new Error('unknown conversion failure')).failureCodes, undefined);
  assert.deepEqual(classifyFailure(new Error('java.util.zip.ZipException: zip END header not found')).failureCodes, ['ZIP_INVALID']);
});

test('first site init includes cold artifact load budget while later init keeps the smaller deadline', async t => {
  const { directory, artifact } = await input(t, [source('first', 'Bare'), source('second', 'OtherBare')]);
  artifact.role = 'site';
  Object.assign(artifact.limits, { initMs: 10, loadMs: 100, jvmMs: 100 });
  let calls = 0;
  const runtimeFactory = () => ({
    request: async () => ({ enabled: false }), getDiagnostics: () => ({ stderr: '' }),
    registerJar: async () => {}, getState: async () => ({ jar: { loaderCount: 1 } }),
    setModules: async () => {}, close: async () => {}, call: async () => '{}',
    getCSP: async () => {
      calls++;
      if (calls === 2) return new Promise(() => {});
      await new Promise(done => setTimeout(done, 25));
      return { token: 'private', ready: true, className: 'fixture.Spider' };
    },
  });
  const report = await probeJarArtifact(artifact, { inputRoot: directory, runtimeFactory });
  assert.equal(report.load.loaded, true);
  assert.equal(report.sites[0].init.ok, true);
  assert.equal(report.sites[0].init.includesArtifactLoad, true);
  assert.equal(report.sites[0].init.usedBudgetMs, 100);
  assert.equal(report.sites[1].init.ok, false);
  assert.equal(report.sites[1].init.includesArtifactLoad, false);
  assert.equal(report.sites[1].init.usedBudgetMs, 10);
  assert.equal(report.sites[1].init.error.category, 'timeout');
  assert.equal(report.cleanup.closed, true);
});
