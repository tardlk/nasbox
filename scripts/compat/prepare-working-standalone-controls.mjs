// SPDX-License-Identifier: GPL-3.0-only
// Derive NAS-only controls from verified original-context ART argument captures.
// Captured classes are never loaded, initialized or invoked by this preparer.
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLoaderIdentity, loaderContextOf, officialOracleApkSha256 } from '../android/loader-context.mjs';
import { workingSourceScenarioIdentity } from './prepare-working-source-plan.mjs';
import { validateWorkingCalls } from '../container/working-source-probe.mjs';

const SELF = fileURLToPath(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identity = value => sha(JSON.stringify(canonical(value)));
const check = (value, code) => { if (!value) throw new Error('STANDALONE_CONTROL_' + code); };
const hashPattern = /^[a-f0-9]{64}$/;
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const originalLabel = value => {
  const text = String(value ?? '');
  return text.length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text) ? 'sha256:' + sha(text) : text;
};
const apiLabel = value => typeof value === 'string' && /^[\w.$]+$/.test(value) && value.length <= 240 ? value : 'sha256:' + sha(String(value));
const classLabel = value => typeof value === 'string' && /^[\w.$]+$/.test(value) && value.length <= 240 ? value : undefined;

/** Validates captured provenance before exposing exact arguments as owned plan calls. */
export function validatedParentControlCalls({ parentManifestSha256, artifact, site, artifactIndex, siteIndex, result } = {}) {
  const report = result?.report;
  check(hashPattern.test(parentManifestSha256) && report?.schemaVersion === 1 && report.manifestSha256 === parentManifestSha256
    && report.artifactIndex === artifactIndex && report.siteIndex === siteIndex && report.jarSha256 === artifact.sha256
    && report.id === originalLabel(artifact.id) && report.api === originalLabel(site.api) && report.siteKey === originalLabel(site.key)
    && report.extSha256 === sha(site.ext) && report.targetApkSha256 === officialOracleApkSha256
    && hashPattern.test(report.symbolMapSha256), 'ART_IDENTITY');
  assertLoaderIdentity(report, artifact, site);
  check(Array.isArray(result.privateCalls) && Array.isArray(report.calls) && result.privateCalls.length === report.calls.length, 'ART_CALLS');
  const validated = validateWorkingCalls(result.privateCalls);
  const calls = result.privateCalls.map((call, index) => {
    check(identity(call.metadata) === identity(report.calls[index]) && call.method === report.calls[index].method, 'ART_CALL_METADATA');
    check(['nonempty', 'empty', 'not-implemented', 'invalid-json', 'network', 'failed', 'timeout', 'not-tested'].includes(call.metadata?.status), 'ART_CALL_STATUS');
    const response = call.metadata?.response;
    if (response) check(typeof call.value === 'string' && response.sha256 === sha(call.value) && response.bytes === Buffer.byteLength(call.value), 'ART_RESPONSE_HASH');
    const metadata = {};
    if (typeof call.metadata?.discoveryStep === 'string' && /^[a-z0-9-]{1,40}$/.test(call.metadata.discoveryStep)) metadata.discoveryStep = call.metadata.discoveryStep;
    if (validated[index].skip) metadata.status = 'not-tested';
    const provenance = call.metadata?.methodProvenance;
    if (provenance) {
      const safe = {};
      for (const field of ['declaringClass', 'baseSpiderClass']) if (classLabel(provenance[field])) safe[field] = provenance[field];
      for (const field of ['inheritedBaseDefault', 'baseDelegatingOverload']) if (typeof provenance[field] === 'boolean') safe[field] = provenance[field];
      if (Object.keys(safe).length) metadata.methodProvenance = safe;
    }
    return { method: call.method, params: structuredClone(call.params), metadata };
  });
  return { calls, parametersSha256: identity(calls.map(call => ({ method: call.method, params: call.params,
    notTested: call.metadata.status === 'not-tested', discoveryStep: call.metadata.discoveryStep || null }))) };
}

/** Pure derivation. ART rows correspond to immutable parent artifact/site indexes. */
export function buildWorkingStandaloneControls(parent, artRows, { parentManifestSha256, onlyCases } = {}) {
  check(parent?.schemaVersion === 1 && Array.isArray(parent.artifacts) && parent.artifacts.length > 0
    && hashPattern.test(parentManifestSha256) && parent.standaloneDiagnostic !== true && parent.standaloneControl !== true, 'PARENT_PLAN');
  check(Array.isArray(artRows), 'ART_RESULTS');
  check(onlyCases === undefined || Array.isArray(onlyCases) && onlyCases.length > 0
    && onlyCases.every(value => /^\d+-\d+$/.test(value)) && new Set(onlyCases).size === onlyCases.length, 'CASE_SELECTION');
  const knownCases = new Set(parent.artifacts.flatMap((artifact, ai) => artifact.sites.map((site, si) => `${ai}-${si}`)));
  check(!onlyCases || onlyCases.every(value => knownCases.has(value)), 'UNKNOWN_CASE');
  const selectedCases = onlyCases ? new Set(onlyCases) : knownCases;
  const byCase = new Map();
  for (const row of artRows) {
    check(/^\d+-\d+$/.test(row?.caseId) && !byCase.has(row.caseId), 'ART_CASE_ID'); byCase.set(row.caseId, row);
  }
  const publicCases = [], artifacts = []; let expectedCases = 0;
  for (const [artifactIndex, artifact] of parent.artifacts.entries()) {
    check(hashPattern.test(artifact.sha256) && Array.isArray(artifact.sites), 'PARENT_ARTIFACT');
    const sites = [];
    for (const [siteIndex, original] of artifact.sites.entries()) {
      const caseId = `${artifactIndex}-${siteIndex}`;
      if (!selectedCases.has(caseId)) continue;
      expectedCases++; const context = loaderContextOf(artifact, original);
      check(context.role === 'site' && !context.legacy && context.main && !original.originalMissingContext, 'ORIGINAL_MAIN_REQUIRED');
      check(workingSourceScenarioIdentity(artifact, original) === original.caseIdentitySha256
        && original.sourceScenarioSha256 === original.caseIdentitySha256, 'PARENT_SCENARIO');
      const row = byCase.get(caseId); check(row && hashPattern.test(row.privateResultSha256), 'ART_CASE_MISSING');
      const validated = validatedParentControlCalls({ parentManifestSha256, artifact, site: original, artifactIndex, siteIndex, result: row.result });
      const site = structuredClone(original);
      for (const field of ['expectedLoaderIdentity', 'loaderContextSha256', 'caseIdentitySha256', 'sourceScenarioSha256', 'originalMissingContext',
        'originalMissingContextSha256', 'originalOmittedContext', 'standaloneDiagnostic', 'standaloneControl', 'calls', 'businessDiscovery', 'businessSearchKeyword']) delete site[field];
      site.loaderContext = { role: 'site', signature: context.signature };
      site.expectedLoaderIdentity = loaderContextOf(artifact, site).identity;
      site.loaderContextSha256 = identity(site.expectedLoaderIdentity);
      site.caseIdentitySha256 = workingSourceScenarioIdentity(artifact, site);
      site.sourceScenarioSha256 = site.caseIdentitySha256;
      site.standaloneDiagnostic = true;
      site.standaloneControl = true;
      site.originalOmittedContext = { mainArtifactSha256: context.main.sha256, mainSignatureSha256: sha(context.main.signature),
        parentLoaderContextSha256: original.loaderContextSha256, parentCaseIdentitySha256: original.caseIdentitySha256,
        parentCase: caseId, parentManifestSha256, reason: 'original-main-intentionally-omitted' };
      site.parentParametersSource = { source: 'captured-parent-art-original-context', privateResultSha256: row.privateResultSha256,
        parametersSha256: validated.parametersSha256, parentManifestSha256, parentCase: caseId,
        scope: 'Exact parent ART call arguments; omitted-main NAS control has a different loader context and is not exact ART/NAS loader parity.' };
      site.calls = validated.calls;
      site.controlCaseIdentitySha256 = identity({ parentCase: caseId, parentManifestSha256, parentCaseIdentitySha256: original.caseIdentitySha256,
        effectiveSourceScenarioSha256: site.caseIdentitySha256, parametersSha256: validated.parametersSha256 });
      const controlCase = `${artifacts.length}-${sites.length}`;
      sites.push(site);
      publicCases.push({ caseId: controlCase, parentCase: caseId, sha256: artifact.sha256, api: apiLabel(original.api), sourceKeySha256: sha(original.key),
        executionExtSha256: original.executionExtSha256, originalOmittedContext: site.originalOmittedContext,
        loaderContextSha256: site.loaderContextSha256, effectiveSourceScenarioSha256: site.caseIdentitySha256,
        controlCaseIdentitySha256: site.controlCaseIdentitySha256, parentParametersSource: site.parentParametersSource,
        plannedCallSlots: site.calls.length, executableCalls: site.calls.filter(call => call.metadata.status !== 'not-tested').length,
        parentNotTestedSlots: site.calls.filter(call => call.metadata.status === 'not-tested').length });
    }
    if (sites.length) artifacts.push({ ...artifact, sites });
  }
  check(expectedCases === byCase.size, 'ART_EXTRA_CASES');
  const metadata = { ...parent.metadata, parentManifestSha256,
    controlType: 'original-main-intentionally-omitted',
    selectionRule: 'Requested parent original-context case IDs in parent order; each remains a distinct independent omitted-main control with exact parent ART arguments.',
    scope: 'NAS-only standalone controls. Original main bytes were available but are intentionally omitted; never substitute control outcomes for original-context results.',
    parameterScope: 'Calls use exact parent ART arguments as explicit plan instructions. No ART claim is made for the altered loader context.',
    runnerCompatibility: 'Root standaloneControl marks intentional omission. Root standaloneDiagnostic is omitted because the frozen runner reserves it for genuinely unavailable original mains; each site is explicitly diagnostic and carries originalOmittedContext.' };
  const plan = { schemaVersion: 1, standaloneControl: true, businessDiscovery: false, metadata,
    ...(parent.nasBudgets ? { nasBudgets: structuredClone(parent.nasBudgets) } : {}),
    ...(parent.inputRoot ? { inputRoot: parent.inputRoot } : {}), artifacts, unexecuted: [], deferred: [] };
  const pins = { schemaVersion: 1, parentManifestSha256, sourceInputSetSha256: parent.metadata?.sourceInputSetSha256,
    scope: metadata.scope, parameterScope: metadata.parameterScope, runnerCompatibility: metadata.runnerCompatibility,
    summary: { artifacts: artifacts.length, cases: publicCases.length,
      plannedCallSlots: publicCases.reduce((sum, row) => sum + row.plannedCallSlots, 0),
      executableCalls: publicCases.reduce((sum, row) => sum + row.executableCalls, 0),
      parentNotTestedSlots: publicCases.reduce((sum, row) => sum + row.parentNotTestedSlots, 0) }, cases: publicCases };
  return { plan, pins };
}

async function newOutput(directory, inputs) {
  const path = resolve(directory);
  for (const input of inputs) check(!contained(input, path) && !contained(path, input), 'OUTPUT_OVERLAPS_INPUT');
  let cursor = resolve('/');
  for (const part of relative(resolve('/'), path).split(sep)) {
    cursor = join(cursor, part); const info = await lstat(cursor).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    check(!info || info.isDirectory() && !info.isSymbolicLink(), 'OUTPUT_PATH');
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  check(await realpath(path) === path && (await readdir(path)).length === 0, 'OUTPUT_NOT_EMPTY'); await chmod(path, 0o700);
  return path;
}

export async function prepareWorkingStandaloneControls({ parentPlanPath, artResultsDir, out, onlyCases } = {}) {
  const parentPath = resolve(parentPlanPath), artRoot = await realpath(resolve(artResultsDir));
  const parentBytes = await readFile(parentPath), parent = JSON.parse(parentBytes), parentManifestSha256 = sha(parentBytes), artRows = [];
  for (const [artifactIndex, artifact] of parent.artifacts.entries()) for (const [siteIndex] of artifact.sites.entries()) {
    const caseId = `${artifactIndex}-${siteIndex}`;
    if (onlyCases && !onlyCases.includes(caseId)) continue;
    const path = join(artRoot, caseId + '-private.json'), info = await lstat(path);
    check(info.isFile() && !info.isSymbolicLink() && info.size <= 128 * 1024 * 1024, 'ART_RESULT_FILE');
    const bytes = await readFile(path); artRows.push({ caseId, result: JSON.parse(bytes), privateResultSha256: sha(bytes) });
  }
  const prepared = buildWorkingStandaloneControls(parent, artRows, { parentManifestSha256, onlyCases });
  check(sha(await readFile(parentPath)) === parentManifestSha256, 'PARENT_CHANGED');
  for (const row of artRows) check(sha(await readFile(join(artRoot, row.caseId + '-private.json'))) === row.privateResultSha256, 'ART_RESULT_CHANGED');
  const output = await newOutput(out, [dirname(parentPath), artRoot]), planBytes = Buffer.from(JSON.stringify(prepared.plan, null, 2) + '\n');
  const pins = { ...prepared.pins, planSha256: sha(planBytes), preparerSha256: sha(await readFile(SELF)),
    scenarioPreparerSha256: sha(await readFile(join(dirname(SELF), 'prepare-working-source-plan.mjs'))),
    workingSourceProbeSha256: sha(await readFile(join(dirname(SELF), '../container/working-source-probe.mjs'))) };
  await writeFile(join(output, 'oracle-plan.json'), planBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(join(output, 'standalone-control-pins.json'), JSON.stringify(pins, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { plan: prepared.plan, pins, output };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/compat/prepare-working-standalone-controls.mjs --parent-plan PRIVATE_ORIGINAL_PLAN --art-results PRIVATE_ORIGINAL_ART_RESULTS --out NEW_EMPTY_PRIVATE_OUTPUT [--only-cases 0-0,1-0]\nPrepares explicit-call NAS controls with available original mains intentionally omitted. No provider execution or network.\n'); return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index]; check(['--parent-plan', '--art-results', '--out', '--only-cases'].includes(name) && args[index + 1] && !Object.hasOwn(options, name), 'CLI_ARGUMENT'); options[name] = args[++index];
  }
  check(options['--parent-plan'] && options['--art-results'] && options['--out'], 'CLI_USAGE');
  const { pins } = await prepareWorkingStandaloneControls({ parentPlanPath: options['--parent-plan'], artResultsDir: options['--art-results'], out: options['--out'],
    ...(options['--only-cases'] ? { onlyCases: options['--only-cases'].split(',') } : {}) });
  process.stdout.write(JSON.stringify({ ...pins.summary, parentManifestSha256: pins.parentManifestSha256, planSha256: pins.planSha256 }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: /^(?:STANDALONE_CONTROL|INPUT_SCHEMA|INPUT_CHECKSUM)[A-Z_]*$/.test(error.message) ? error.message : 'STANDALONE_CONTROL_INPUT_OR_IO', errorSha256: sha(String(error.message)) }) + '\n'); process.exitCode = 1;
});
