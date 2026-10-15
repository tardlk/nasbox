// SPDX-License-Identifier: GPL-3.0-only
// Prepare private, pinned NAS run inputs offline. Never connects or starts Docker.
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCatalogFreeze } from './freeze-catalog.mjs';
import { canonical, normalizeManifest } from '../container/jar-matrix-probe.mjs';

const SELF = fileURLToPath(import.meta.url), REPOSITORY = resolve(dirname(SELF), '../..');
const RUNNER = 'scripts/container/jar-matrix-probe.mjs';
const SHA = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/;
const REMOTE = /^\/tmp\/tvbox-frozen-round1\.[A-Za-z0-9]{6,32}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const semanticHash = value => hash(JSON.stringify(canonical(value)));
const assert = (condition, code) => { if (!condition) throw new Error('PREPARE_' + code); };
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const BASELINE_LIMITS = Object.freeze({ loadMs: 90000, initMs: 10000, callMs: 10000,
  artifactMs: 150000, closeMs: 5000, jvmMs: 90000, maxHomeSites: 1 });

async function noSymlinks(path, { missingLeaf = false } = {}) {
  assert(typeof path === 'string' && path.length > 0 && !path.includes('\0'), 'PATH');
  const absolute = resolve(path), parts = absolute.split(sep).filter(Boolean);
  let current = sep;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) { if (missingLeaf && error.code === 'ENOENT' && index === parts.length - 1) return absolute; throw error; }
    assert(!info.isSymbolicLink(), 'SYMLINK');
    if (index < parts.length - 1) assert(info.isDirectory(), 'PATH');
  }
  return absolute;
}

const ledger = (item, mode, status, reason = undefined) => JSON.stringify({ case: item.index, mode, status, ...(reason ? { reason } : {}) });
const stemOf = (item, mode) => mode + '-' + String(item.index).padStart(3, '0');

function shardScript(plan, shard, token) {
  const rows = plan.cases.filter(item => item.shard === shard), lines = [
    '#!/usr/bin/env bash', '# Generated offline. Every container ID belongs to this exact run.',
    'set -eu', 'umask 077', 'd=' + plan.remoteRoot, 'active=""',
    'cleanup() {',
    '  if [ -n "$active" ]; then docker rm -f "$active" >/dev/null 2>&1 || true; fi',
    '}',
    'trap cleanup EXIT', "trap 'exit 130' INT", "trap 'exit 143' HUP TERM",
    'test -d "$d/output" && test ! -L "$d/output"',
    'mkdir "$d/output/.shard-' + shard + '.started"',
    // Setup initializes all states before dispatch, so even an unstarted shard
    // has an explicit not-tested entry for every planned old/final execution.
  ];
  for (const item of rows) for (const mode of ['old', 'final']) {
    const stem = stemOf(item, mode), name = 'tvbox-frozen-' + token + '-' + stem;
    const state = '$d/output/' + stem + '.state.json';
    lines.push(
      'printf \'%s\\n\' \'' + ledger(item, mode, 'started') + '\' > "' + state + '"',
      'active=""',
      'if ! active=$(docker create --name ' + name + ' --user 10001:10001 --read-only --tmpfs /tmp:rw,exec,nosuid,nodev,size=384m --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 2g --cpus 1 -v "$d/input:/input:ro" -v "$d/run:/run:ro" -v "$d/output:/output:rw" -v "$d/run/jar-matrix-probe.mjs:/opt/tvbox/scripts/container/jar-matrix-probe.mjs:ro" --entrypoint node ' + plan.images[mode] + ' scripts/container/jar-matrix-probe.mjs --manifest /run/' + item.manifest + ' --output /output/' + stem + '.json --jsonl /output/' + stem + '.jsonl 2> "$d/output/' + stem + '.create.log"); then',
      '  printf \'%s\\n\' \'' + ledger(item, mode, 'not-tested', 'container-create-failed') + '\' > "' + state + '"',
      '  exit 1',
      'fi',
      // Never remove a pre-existing same-name container: active is assigned only
      // from this create call's stdout and must be a full Docker container ID.
      'if ! [[ "$active" =~ ^[a-f0-9]{64}$ ]]; then active=""; exit 1; fi',
      'printf \'%s\\n\' "$active" > "$d/output/' + stem + '.cid"',
      'set +e',
      'timeout -s TERM -k 5s 175s docker start -a "$active" > "$d/output/' + stem + '.log" 2>&1',
      'result=$?', 'set -e',
      'printf \'%s\\n\' "$result" > "$d/output/' + stem + '.command-exit.txt"',
      'printf \'%s\\n\' "$result" > "$d/output/' + stem + '.exit.txt"',
      'running=$(docker inspect --format \'{{.State.Running}}\' "$active")',
      'if [ "$running" = true ]; then',
      '  docker kill "$active" >/dev/null',
      '  docker wait "$active" > "$d/output/' + stem + '.wait.txt"',
      'fi',
      'docker inspect "$active" > "$d/output/' + stem + '.inspect.json"',
      'docker rm "$active" >/dev/null', 'active=""',
      'if [ -s "$d/output/' + stem + '.json" ]; then',
      '  printf \'%s\\n\' \'' + ledger(item, mode, 'reported') + '\' > "' + state + '"',
      'else',
      '  printf \'%s\\n\' \'' + ledger(item, mode, 'unreported', 'runner-produced-no-report') + '\' > "' + state + '"',
      'fi',
      'printf \'{"case":' + item.index + ',"mode":"' + mode + '","exit":%s}\\n\' "$result" >> "$d/output/progress-' + shard + '.jsonl"',
    );
  }
  lines.push('touch "$d/output/shard-' + shard + '.done"');
  return lines.join('\n') + '\n';
}

function setupScript(plan) {
  const lines = [
    '#!/usr/bin/env bash', '# Run only after uploading the owned input.tar.gz and run.tar.gz to remoteRoot.',
    '# This file contains no host or credential. Nothing downloads or installs tools.',
    'set -eu', 'umask 077', 'd=' + plan.remoteRoot,
    'for tool in bash docker timeout tar sha256sum find chmod chown nohup; do command -v "$tool" >/dev/null; done',
    'test -d "$d" && test ! -L "$d"',
    'test -f "$d/input.tar.gz" && test ! -L "$d/input.tar.gz"',
    'test -f "$d/run.tar.gz" && test ! -L "$d/run.tar.gz"',
    'test ! -e "$d/input" && test ! -e "$d/run" && test ! -e "$d/output"',
    'chown 0:10001 "$d"', 'chmod 750 "$d"',
    'mkdir "$d/input" "$d/run" "$d/output"',
    'tar --no-same-owner -xzf "$d/input.tar.gz" -C "$d/input"',
    'tar --no-same-owner -xzf "$d/run.tar.gz" -C "$d/run"',
    // Archives must be created only from these locally validated regular trees.
    // Do not follow or grant permissions through links from a modified archive.
    'if find "$d/input" "$d/run" -type l -print -quit | read -r _; then exit 1; fi',
    'if find "$d/input" "$d/run" ! -type f ! -type d -print -quit | read -r _; then exit 1; fi',
    '(cd "$d/input" && sha256sum -c "$d/run/input-files.sha256")',
    '(cd "$d/run" && sha256sum -c run-files.sha256)',
    'find "$d/input" "$d/run" -type d -exec chown 0:10001 {} +',
    'find "$d/input" "$d/run" -type d -exec chmod 750 {} +',
    'find "$d/input" "$d/run" -type f -exec chown 0:10001 {} +',
    'find "$d/input" "$d/run" -type f -exec chmod 640 {} +',
    'chown 10001:10001 "$d/output"', 'chmod 700 "$d/output"',
  ];
  for (const item of plan.cases) for (const mode of ['old', 'final']) {
    lines.push('printf \'%s\\n\' \'' + ledger(item, mode, 'not-tested', 'shard-not-reached') + '\' > "$d/output/' + stemOf(item, mode) + '.state.json"');
  }
  for (let shard = 0; shard < plan.shards; shard++) lines.push(
    'nohup bash "$d/run/shard-' + shard + '.sh" > "$d/shard-' + shard + '.log" 2>&1 < /dev/null &',
    'printf \'%s\\n\' "$!" > "$d/shard-' + shard + '.pid"',
  );
  return lines.join('\n') + '\n';
}

/** All arguments are data; shell templates interpolate only validated tokens. */
export async function prepareBaselineRun({ capture, out, oldImage, finalImage, remoteRoot, shards = 3 } = {}) {
  assert(IMAGE.test(oldImage) && IMAGE.test(finalImage) && oldImage !== finalImage, 'IMAGE');
  assert(typeof remoteRoot === 'string' && REMOTE.test(remoteRoot), 'REMOTE_ROOT');
  assert(Number.isSafeInteger(shards) && shards >= 1 && shards <= 16, 'SHARDS');
  const captureRoot = await noSymlinks(capture), outRoot = await noSymlinks(out, { missingLeaf: true });
  assert(!contained(captureRoot, outRoot) && !contained(outRoot, captureRoot), 'OUTPUT_OVERLAP');
  const outInfo = await lstat(outRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (outInfo) assert(outInfo.isDirectory() && (await readdir(outRoot)).length === 0, 'OUTPUT_NOT_EMPTY');
  const verified = await verifyCatalogFreeze({ directory: captureRoot });
  const [freezeBytes, inputBytes, runnerBytes, generatorBytes] = await Promise.all([
    readFile(join(captureRoot, 'freeze.json')), readFile(join(captureRoot, 'input-manifest.json')),
    readFile(join(REPOSITORY, RUNNER)), readFile(SELF),
  ]);
  const freeze = JSON.parse(freezeBytes), input = JSON.parse(inputBytes), runnerSha256 = hash(runnerBytes);
  const runnerPin = freeze.scripts.find(row => row.file === RUNNER);
  assert(runnerPin?.sha256 === runnerSha256 && runnerPin.bytes === runnerBytes.length, 'RUNNER_NOT_FROZEN');
  const inputPin = freeze.files.find(row => row.file === 'input-manifest.json');
  assert(inputPin?.sha256 === hash(inputBytes) && inputPin.bytes === inputBytes.length, 'INPUT_PIN');
  assert(Array.isArray(input.artifacts) && input.artifacts.length <= 1000 && input.artifacts.length === freeze.artifacts.length, 'INPUT_SCHEMA');
  normalizeManifest(input, { inputRoot: '/input' });
  const limits = { ...BASELINE_LIMITS }, plan = {
    schemaVersion: 1, createdAt: new Date().toISOString(), limits, images: { old: oldImage, final: finalImage },
    runnerSha256, inputManifestSha256: hash(inputBytes), freezeSha256: hash(freezeBytes),
    inputSetSha256: verified.inputSetSha256, remoteRoot, shards,
    generator: { file: 'scripts/compat/prepare-baseline-run.mjs', sha256: hash(generatorBytes), bytes: generatorBytes.length },
    runnerSnapshot: { file: 'jar-matrix-probe.mjs', sha256: runnerSha256, bytes: runnerBytes.length },
    privateInputPins: [{ file: 'freeze.json', sha256: hash(freezeBytes), bytes: freezeBytes.length },
      { file: 'input-manifest.json', sha256: hash(inputBytes), semanticSha256: semanticHash(input), bytes: inputBytes.length }],
    execution: { outerSeconds: 175, terminateGraceSeconds: 5, selectedRolePerArtifact: true,
      exitSemantics: { command: '*.command-exit.txt', legacyCommand: '*.exit.txt', container: '*.inspect.json State.ExitCode' },
      stateFiles: 'output/<old|final>-NNN.state.json', archives: ['input.tar.gz', 'run.tar.gz'] }, cases: [],
  };
  const files = new Map([['jar-matrix-probe.mjs', { bytes: runnerBytes, mode: 0o600 }]]), seen = new Set();
  for (const [index, artifact] of input.artifacts.entries()) {
    const frozen = freeze.artifacts.find(row => row.sha256 === artifact.id);
    assert(SHA.test(artifact.id) && artifact.id === artifact.sha256 && !seen.has(artifact.id) && frozen
      && ['main', 'site'].includes(artifact.role) && frozen.roles.includes(artifact.role), 'ARTIFACT_IDENTITY');
    seen.add(artifact.id);
    const manifest = { schemaVersion: 1, inputRoot: '/input', limits, helperLoadValidation: true, artifacts: [artifact] };
    const normalized = normalizeManifest(manifest, { inputRoot: '/input' });
    assert(normalized.artifacts[0].helperLoadValidation === true
      && semanticHash(normalized.artifacts[0].limits) === semanticHash(normalized.limits), 'ARTIFACT_BUDGET_OVERRIDE');
    const file = 'manifests/case-' + String(index).padStart(3, '0') + '.json', bytes = jsonBytes(manifest);
    files.set(file, { bytes, mode: 0o600 });
    plan.cases.push({ index, manifest: file, manifestBytesSha256: hash(bytes), manifestSemanticSha256: semanticHash(manifest),
      id: artifact.id, role: artifact.role, validZip: frozen.validContent, shard: index % shards });
  }
  const token = hash(remoteRoot + '\0' + plan.freezeSha256 + '\0' + oldImage + '\0' + finalImage).slice(0, 12);
  for (let shard = 0; shard < shards; shard++) files.set('shard-' + shard + '.sh', { bytes: Buffer.from(shardScript(plan, shard, token)), mode: 0o700 });
  // sha256sum's line format is generated only for safe frozen paths. Refuse
  // ambiguous filenames instead of adding shell quoting to checksum manifests.
  const inputPins = [...freeze.files, { file: 'freeze.json', sha256: plan.freezeSha256 }];
  for (const pin of inputPins) assert(typeof pin.file === 'string' && /^[A-Za-z0-9_./-]+$/.test(pin.file)
    && pin.file.split('/').every(part => part && part !== '.' && part !== '..') && SHA.test(pin.sha256), 'CHECKSUM_PATH');
  files.set('input-files.sha256', { bytes: Buffer.from(inputPins.map(pin => pin.sha256 + '  ' + pin.file).join('\n') + '\n'), mode: 0o600 });
  files.set('plan.json', { bytes: jsonBytes(plan), mode: 0o600 });
  files.set('setup-remote.sh', { bytes: Buffer.from(setupScript(plan)), mode: 0o700 });
  const checksumBytes = Buffer.from([...files].map(([file, value]) => hash(value.bytes) + '  ' + file).join('\n') + '\n');
  files.set('run-files.sha256', { bytes: checksumBytes, mode: 0o600 });
  // Revalidate before the first output write; inputRoot is never modified.
  await verifyCatalogFreeze({ directory: captureRoot });
  await noSymlinks(outRoot, { missingLeaf: true });
  if (!outInfo) await mkdir(outRoot, { mode: 0o700 });
  else assert((await readdir(outRoot)).length === 0, 'OUTPUT_NOT_EMPTY');
  await chmod(outRoot, 0o700);
  await mkdir(join(outRoot, 'manifests'), { mode: 0o700 });
  await mkdir(join(outRoot, 'output'), { mode: 0o700 });
  for (const [file, value] of files) await writeFile(join(outRoot, file), value.bytes, { flag: 'wx', mode: value.mode });
  return { schemaVersion: 1, cases: plan.cases.length, shards, runnerSha256, generatorSha256: plan.generator.sha256,
    freezeSha256: plan.freezeSha256, inputManifestSha256: plan.inputManifestSha256, planSha256: hash(files.get('plan.json').bytes),
    generatedFiles: files.size, startsServices: false };
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  try {
    const args = process.argv.slice(2), options = {};
    assert(args.length % 2 === 0, 'CLI');
    for (let index = 0; index < args.length; index += 2) {
      assert(['--capture', '--out', '--old-image', '--final-image', '--remote-root', '--shards'].includes(args[index]) && !Object.hasOwn(options, args[index]), 'CLI');
      options[args[index]] = args[index + 1];
    }
    assert(['--capture', '--out', '--old-image', '--final-image', '--remote-root'].every(key => options[key]), 'CLI');
    const result = await prepareBaselineRun({ capture: options['--capture'], out: options['--out'], oldImage: options['--old-image'],
      finalImage: options['--final-image'], remoteRoot: options['--remote-root'], shards: options['--shards'] === undefined ? 3 : Number(options['--shards']) });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, code: /^PREPARE_[A-Z_]+$/.test(error.message) ? error.message : 'PREPARE_IO_OR_SCHEMA', errorSha256: hash(String(error.message)) }) + '\n');
    process.exitCode = 1;
  }
}
