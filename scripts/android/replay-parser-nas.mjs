// SPDX-License-Identifier: GPL-3.0-only
// Replays captured raw bytes through the deployed config core, without network.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfigCore, createConfigCore } from '../../backend/config-core/index.mjs';
import { prepareSubscription } from '../../backend/subscription/prepare.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function replay({ input, index, raw, android, manifestSha256, built }) {
  if (sha(raw) !== input.rawSha256) throw new Error('INPUT_CHECKSUM: raw bytes differ');
  const meta = android.report;
  if (meta?.configIndex !== index || meta.manifestSha256 !== manifestSha256 || meta.rawSha256 !== input.rawSha256 || meta.apiUrlSha256 !== sha(input.apiUrl) || meta.idSha256 !== sha(input.id)) throw new Error('INPUT_CHECKSUM: ART result differs from captured launch input');
  const preferences = android.preferencesBefore;
  if (!preferences || ['homeApi','defaultParse','liveApiUrl'].some(key => typeof preferences[key] !== 'string')) throw new Error('INPUT_SCHEMA: original selection preferences missing');
  const report = { schemaVersion: 1, configIndex: index, manifestSha256, idSha256: sha(input.id), apiUrlSha256: sha(input.apiUrl), rawSha256: input.rawSha256, rawBytes: raw.length,
    scope: 'NAS fixed-byte replay using deployed prepareSubscription and full config parser. No network or script execution.',
    preferenceScope: 'Original observed homeApi, defaultParse and liveApiUrl are restored before each fresh worker; other host preferences use defaults.', cleanup: {} };
  const result = { report, input, preferencesBefore: preferences };
  let core, phase = 'start';
  try {
    core = createConfigCore({ built, timeoutMs: 30000, maxBytes: 16 * 1024 * 1024 });
    phase = 'restoreObservedPreferences';
    const seeded = await core.query({ operation: 'state', state: preferences });
    if (!seeded.ok) throw Object.assign(new Error('Preference restoration failed'), { errorType: seeded.errorType });
    phase = 'originalFetchPreparation';
    const prepared = await prepareSubscription(input.apiUrl, raw.toString('utf8'), { core });
    if (typeof prepared.text !== 'string') throw new Error('Prepared configuration is not a string');
    result.requestUrl = prepared.requestUrl;
    result.preparedText = prepared.text;
    report.requestUrlSha256 = sha(prepared.requestUrl);
    report.configSha256 = sha(prepared.text);
    report.configBytes = Buffer.byteLength(prepared.text);
    if (input.configSha256 && input.configSha256 !== report.configSha256) throw new Error('INPUT_CHECKSUM: prepared configuration differs');
    phase = 'originalParseJson';
    const started = Date.now();
    const parsed = await core.query({ operation: 'full', url: input.apiUrl, text: prepared.text });
    report.parseMs = Date.now() - started;
    if (!parsed.ok) throw Object.assign(new Error('Core protocol-level parse failure'), { errorType: parsed.errorType, partialSites: parsed.partialSites });
    const value = parsed.value;
    if (typeof value.accepted !== 'boolean' || !value.config || !Array.isArray(value.config.sites)) throw new Error('Malformed core full result');
    // FullConfig returns mutations up to the original failure boundary. Preserve
    // that partial state even when accepted=false; do not retry a different mode.
    report.accepted = value.accepted;
    result.normalized = { globals: value.config.globals, sites: value.config.sites };
    result.sourceRows = value.config.sites;
    result.globals = value.config.globals;
    result.flags = value.config.flags;
    result.fullConfig = value.config;
    report.sourceCount = value.config.sites.length;
    report.partialSnapshot = !value.accepted;
    if (!value.accepted) {
      report.errorPhase = phase;
      report.failureKind = 'originalOperationFailure';
      report.error = { type: value.errorType, fingerprint: sha(value.errorType || 'unknown') };
    } else report.completed = true;
    const state = await core.query({ operation: 'state' });
    if (state.ok) result.preferencesAfter = state.value;
  } catch (error) {
    report.accepted = false;
    report.errorPhase = phase;
    report.failureKind = String(error.message).startsWith('INPUT_') ? 'inputFailure' : 'originalOperationFailure';
    report.error = { type: error.errorType || error.name || 'Error', fingerprint: sha(String(error.message || error)) };
    if (/timed out|timeout/i.test(String(error.message))) report.timedOut = true;
    if (core && phase === 'originalParseJson') {
      try {
        const state = await core.query({ operation: 'fullState' });
        if (state.ok) { result.normalized = { globals: state.value.globals, sites: state.value.sites }; result.fullConfig = state.value; report.partialSnapshot = true; }
      } catch { /* Preserve the primary error; missing partial state is explicit. */ }
    }
  } finally {
    if (core) {
      try { await core.close(); report.cleanup.workerClosed = true; }
      catch (error) { report.cleanup.workerClosed = false; report.cleanup.errorType = error.name; }
    }
    report.phase = report.completed ? 'complete' : phase;
  }
  return result;
}

async function main() {
  const [planArg, rawArg, artArg, outputArg] = process.argv.slice(2);
  if (!outputArg) throw new Error('Usage: node replay-parser-nas.mjs PLAN RAW_DIRECTORY ART_PRIVATE_DIRECTORY OUTPUT_DIRECTORY');
  const planPath = resolve(planArg), rawDirectory = resolve(rawArg), artDirectory = resolve(artArg), output = resolve(outputArg);
  const planBytes = await readFile(planPath), plan = JSON.parse(planBytes), manifestSha256 = sha(planBytes);
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.configs)) throw new Error('INPUT_SCHEMA: expected configs array');
  const built = buildConfigCore();
  await mkdir(output, { recursive: true, mode: 0o700 });
  const pinFiles = ['backend/config-core/index.mjs','backend/config-core/runtime.json','backend/subscription/prepare.mjs','backend/config-core/src/tvbox/config/ConfigWorker.java','backend/config-core/src/tvbox/config/ConfigParser.java','backend/config-core/src/tvbox/config/FullConfig.java'];
  const runPins = { schemaVersion: 1, manifestSha256, replayScriptSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    modules: Object.fromEntries(await Promise.all(pinFiles.map(async name => [name, sha(await readFile(join(root, name)))]))),
    builtConfigWorkerSha256: sha(await readFile(join(built.build, 'tvbox/config/ConfigWorker.class'))),
    environment: { platform: process.platform, arch: process.arch, node: process.version }, inputs: [], startedAt: new Date().toISOString() };
  for (const [index, input] of plan.configs.entries()) {
    if (typeof input.id !== 'string' || typeof input.apiUrl !== 'string' || !hashPattern.test(input.rawSha256)) throw new Error('INPUT_SCHEMA: malformed config');
    const [raw, artBytes] = await Promise.all([readFile(join(rawDirectory, index + '.bin')), readFile(join(artDirectory, 'result-' + index + '.json'))]);
    if (raw.length > 16 * 1024 * 1024) throw new Error('INPUT_SIZE: raw body too large');
    runPins.inputs.push({ configIndex: index, rawSha256: sha(raw), rawBytes: raw.length, originalArtPrivateSha256: sha(artBytes) });
    const result = await replay({ input, index, raw, android: JSON.parse(artBytes), manifestSha256, built });
    await writeFile(join(output, 'result-' + index + '.json'), JSON.stringify(result) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(result.report));
  }
  runPins.completedAt = new Date().toISOString();
  await writeFile(join(output, 'run-pins.json'), JSON.stringify(runPins, null, 2) + '\n', { mode: 0o600 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ errorType: error.name, fingerprint: sha(String(error.message || error)) })); process.exitCode = 1;
});
