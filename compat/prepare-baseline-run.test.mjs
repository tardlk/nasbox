// SPDX-License-Identifier: GPL-3.0-only
// Owned fixtures only; generated shell and Docker commands are never executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { freezeCatalog, verifyCatalogFreeze } from '../scripts/compat/freeze-catalog.mjs';
import { prepareBaselineRun, BASELINE_LIMITS } from '../scripts/compat/prepare-baseline-run.mjs';
import { roundBaselineReport } from '../scripts/compat/round-baseline-report.mjs';
import { canonical } from '../scripts/container/jar-matrix-probe.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const semanticHash = value => hash(JSON.stringify(canonical(value)));
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const SECRET = 'owned-private-prepare-input-527471';
const OLD = 'sha256:' + hash('old-image'), FINAL = 'sha256:' + hash('final-image');

async function fixture(t) {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'tvbox-prepare-baseline-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const capture = join(base, 'capture'), out = join(base, 'prepared');
  await mkdir(join(capture, 'captures', 'synthetic'), { recursive: true });
  await mkdir(join(capture, 'artifacts'));
  const data = [Buffer.from('owned valid fixture'), Buffer.from('owned invalid fixture')];
  const urls = ['https://fixture.invalid/main?token=' + SECRET, 'https://fixture.invalid/site?token=' + SECRET];
  const sites = [
    { key: 'main', type: 3, api: 'csp_Fixture', ext: SECRET },
    { key: 'site', type: 3, api: 'csp_Second', ext: { z: SECRET, a: 1 }, jar: urls[1] },
  ];
  const config = { globals: { spider: urls[0] }, sites }, configFile = 'captures/synthetic/config.json';
  await json(join(capture, configFile), config);
  const entry = { id: 'synthetic', publicName: 'Owned fixture', parseSuccess: true, configFile,
    configSha256: hash(await readFile(join(capture, configFile))), responses: [] };
  const artifacts = data.map((bytes, index) => ({ id: hash(bytes), sha256: hash(bytes), bytes: bytes.length, role: index ? 'site' : 'main',
    jarPath: 'artifacts/' + hash(bytes) + '.jar', sites: [sites[index]], inspection: { ok: index === 0 } }));
  await Promise.all([
    ...artifacts.map((artifact, index) => writeFile(join(capture, artifact.jarPath), data[index])),
    writeFile(join(capture, 'index.html'), '<html>owned</html>'), writeFile(join(capture, 'list.txt'), 'owned'),
    json(join(capture, 'site-config.json'), {}), json(join(capture, 'inventory.json'), { entries: [entry] }),
    json(join(capture, 'captures/synthetic/metadata.json'), entry), json(join(capture, 'input-manifest.json'), { schemaVersion: 1, artifacts }),
    json(join(capture, 'artifact-inventory.json'), { artifacts, retrievals: artifacts.map((artifact, index) => ({ role: artifact.role, signature: urls[index], ok: true, sha256: artifact.sha256, bytes: artifact.bytes })) }),
  ]);
  const freeze = await freezeCatalog({ directory: capture });
  return { base, capture, out, freeze, artifacts, options: { capture, out, oldImage: OLD, finalImage: FINAL, remoteRoot: '/tmp/tvbox-frozen-round1.AbC123' } };
}

test('offline preparation pins two private cases and emits a plan accepted by the strict reporter without execution', async t => {
  const f = await fixture(t), before = await readFile(join(f.capture, 'freeze.json'));
  const result = await prepareBaselineRun(f.options), plan = JSON.parse(await readFile(join(f.out, 'plan.json'), 'utf8'));
  assert.equal(result.cases, 2); assert.equal(result.shards, 3); assert.equal(result.startsServices, false);
  assert.deepEqual(plan.limits, BASELINE_LIMITS);
  assert.deepEqual(plan.images, { old: OLD, final: FINAL });
  assert.equal(plan.freezeSha256, hash(before));
  assert.equal(plan.inputManifestSha256, hash(await readFile(join(f.capture, 'input-manifest.json'))));
  assert.equal(plan.runnerSha256, hash(await readFile(join(f.out, 'jar-matrix-probe.mjs'))));
  assert.equal(plan.generator.sha256, hash(await readFile('scripts/compat/prepare-baseline-run.mjs')));
  assert.equal(plan.privateInputPins.length, 2);
  for (const [index, item] of plan.cases.entries()) {
    assert.equal(item.index, index); assert.equal(item.shard, index % 3);
    assert.equal(item.manifest, 'manifests/case-' + String(index).padStart(3, '0') + '.json');
    const bytes = await readFile(join(f.out, item.manifest)), manifest = JSON.parse(bytes);
    assert.equal(item.manifestBytesSha256, hash(bytes));
    assert.equal(item.manifestSemanticSha256, semanticHash(manifest));
    assert.equal(manifest.inputRoot, '/input'); assert.equal(manifest.helperLoadValidation, true);
    assert.deepEqual(manifest.artifacts, [f.artifacts[index]]);
    assert.equal(item.validZip, index === 0);
    assert.equal((await lstat(join(f.out, item.manifest))).mode & 0o777, 0o600);
  }
  const report = await roundBaselineReport({ capture: f.capture, run: f.out });
  assert.equal(report.summary.old.executionReports, 0);
  assert.equal(report.summary.final.expectedVariants, 2);
  assert.deepEqual(report.summary.final.loadStates, { 'not-tested': 2 });
  assert.deepEqual(await readFile(join(f.capture, 'freeze.json')), before);
  assert.equal((await verifyCatalogFreeze({ directory: f.capture })).ok, true);
  assert.equal((await lstat(f.out)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(join(f.out, 'output')), []);
});

test('generated shells contain bounded adjacent old/final commands, exact CID cleanup, confinement and explicit unexecuted ledger', async t => {
  const f = await fixture(t); await prepareBaselineRun({ ...f.options, shards: 1 });
  const script = await readFile(join(f.out, 'shard-0.sh'), 'utf8'), setup = await readFile(join(f.out, 'setup-remote.sh'), 'utf8');
  for (const flag of ['--user 10001:10001', '--read-only', '--tmpfs /tmp:rw,exec,nosuid,nodev,size=384m', '--cap-drop ALL', '--security-opt no-new-privileges', '--pids-limit 256', '--memory 2g', '--cpus 1', 'timeout -s TERM -k 5s 175s docker start -a', 'docker inspect "$active"', 'docker rm "$active"', 'docker rm -f "$active"', '^[a-f0-9]{64}$']) assert.ok(script.includes(flag), flag);
  assert.ok(script.indexOf('--output /output/old-000.json') < script.indexOf('--output /output/final-000.json'));
  assert.ok(script.indexOf('--output /output/final-000.json') < script.indexOf('--output /output/old-001.json'));
  assert.ok(script.includes('.command-exit.txt'));
  assert.ok(script.includes('.exit.txt'));
  for (const state of ['started', 'not-tested', 'reported', 'unreported']) assert.ok(script.includes('"status":"' + state + '"'));
  assert.ok(setup.includes('"reason":"shard-not-reached"'));
  assert.ok(setup.includes('old-000.state.json') && setup.includes('final-001.state.json'));
  assert.ok(setup.includes('sha256sum -c "$d/run/input-files.sha256"'));
  assert.ok(setup.includes('sha256sum -c run-files.sha256'));
  assert.ok(setup.includes('chmod 640') && setup.includes('chmod 750') && setup.includes('chmod 700 "$d/output"'));
  assert.ok(!/curl|wget|apt-get|npm install|docker system prune|docker container prune|docker image prune/.test(setup + script));
  assert.ok(!(setup + script).includes(SECRET)); assert.ok(!(setup + script).includes('https://'));
  assert.equal((await lstat(join(f.out, 'setup-remote.sh'))).mode & 0o777, 0o700);
  const pins = (await readFile(join(f.out, 'run-files.sha256'), 'utf8')).trim().split('\n');
  for (const line of pins) { const [sha256, file] = line.split('  '); assert.equal(hash(await readFile(join(f.out, file))), sha256); }
});

test('preparation rejects shell injection, unsafe remote paths, image tags, malformed shards and overlapping output before writes', async t => {
  const f = await fixture(t);
  for (const changes of [
    { remoteRoot: '/tmp/tvbox-frozen-round1.AbC123;touch /tmp/oops' }, { remoteRoot: '/tmp/tvbox-frozen-round1.$(touch-x)' },
    { remoteRoot: '/tmp/other.AbC123' }, { remoteRoot: '/tmp/tvbox-frozen-round1.abc/../owned' },
    { remoteRoot: '/tmp/tvbox-frozen-round1.a\nB1234' }, { oldImage: 'latest' }, { finalImage: FINAL + ';id' },
    { oldImage: FINAL }, { shards: 0 }, { shards: 17 }, { shards: 1.5 },
    { out: f.capture }, { out: join(f.capture, 'output') }, { out: f.base },
  ]) await assert.rejects(prepareBaselineRun({ ...f.options, ...changes }), /PREPARE_/);
  await assert.rejects(lstat(f.out), { code: 'ENOENT' });
});

test('preparation rejects nonempty directories and symbolic links; empty owned output is permitted', async t => {
  const f = await fixture(t);
  await mkdir(f.out); await writeFile(join(f.out, 'keep.txt'), 'unrelated');
  await assert.rejects(prepareBaselineRun(f.options), /PREPARE_OUTPUT_NOT_EMPTY/);
  assert.equal(await readFile(join(f.out, 'keep.txt'), 'utf8'), 'unrelated');
  await rm(f.out, { recursive: true });
  await symlink(f.capture, f.out);
  await assert.rejects(prepareBaselineRun(f.options), /PREPARE_SYMLINK/);
  await rm(f.out);
  await symlink(f.capture, join(f.base, 'linked-capture'));
  await assert.rejects(prepareBaselineRun({ ...f.options, capture: join(f.base, 'linked-capture') }), /PREPARE_SYMLINK/);
  await symlink(f.base, join(f.base, 'linked-parent'));
  await assert.rejects(prepareBaselineRun({ ...f.options, out: join(f.base, 'linked-parent', 'output') }), /PREPARE_SYMLINK/);
  await mkdir(f.out);
  await prepareBaselineRun(f.options);
  await assert.rejects(prepareBaselineRun(f.options), /PREPARE_OUTPUT_NOT_EMPTY/);
});

test('changed frozen bytes, unpinned runner and unsafe checksum filenames are rejected without output', async t => {
  const f = await fixture(t);
  await writeFile(join(f.capture, 'list.txt'), 'changed');
  await assert.rejects(prepareBaselineRun(f.options), /FREEZE_INPUT_CHANGED/);
  await assert.rejects(lstat(f.out), { code: 'ENOENT' });
  const g = await fixture(t);
  const freeze = JSON.parse(await readFile(join(g.capture, 'freeze.json')));
  // The altered metadata is rehashed to isolate the preparation runner-pin check.
  freeze.scripts.find(row => row.file === 'scripts/container/jar-matrix-probe.mjs').sha256 = hash('different runner');
  freeze.inputSetSha256 = semanticHash(Object.fromEntries(Object.entries(freeze).filter(([key]) => !['inputSetSha256', 'runs'].includes(key))));
  await json(join(g.capture, 'freeze.json'), freeze);
  await assert.rejects(prepareBaselineRun(g.options), /PREPARE_RUNNER_NOT_FROZEN/);
  await assert.rejects(lstat(g.out), { code: 'ENOENT' });
  const h = await fixture(t);
  await rm(join(h.capture, 'freeze.json'));
  await writeFile(join(h.capture, 'ambiguous name.txt'), 'owned');
  await freezeCatalog({ directory: h.capture });
  await assert.rejects(prepareBaselineRun(h.options), /PREPARE_CHECKSUM_PATH/);
  await assert.rejects(lstat(h.out), { code: 'ENOENT' });
});

test('CLI reports only hashes and controlled errors without revealing private paths or inputs', async t => {
  const f = await fixture(t);
  const args = ['scripts/compat/prepare-baseline-run.mjs', '--capture', f.capture, '--out', f.out, '--old-image', OLD, '--final-image', FINAL, '--remote-root', f.options.remoteRoot];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).cases, 2);
  assert.equal(result.stdout.includes(SECRET), false); assert.equal(result.stdout.includes(f.capture), false);
  const bad = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stderr).code, 'PREPARE_OUTPUT_NOT_EMPTY');
  assert.equal(bad.stderr.includes(SECRET), false); assert.equal(bad.stderr.includes(f.out), false);
});
