// SPDX-License-Identifier: GPL-3.0-only
// Offline complete configured-source selection. Original frozen inputs are immutable.
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCatalogFreeze } from './freeze-catalog.mjs';
import { buildRoleFixturePlan } from '../android/prepare-role-fixtures.mjs';
import { loaderContextOf } from '../android/loader-context.mjs';

const SELF = fileURLToPath(import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identity = value => sha(JSON.stringify(canonical(value)));
const check = (condition, code) => { if (!condition) throw new Error('WORKING_PLAN_' + code); };
const hashPattern = /^[a-f0-9]{64}$/;
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const safeApi = value => typeof value === 'string' && /^[\w.$]+$/.test(value) && value.length <= 240 ? value : 'sha256:' + sha(String(value));

export const workingMethodSelection = Object.freeze({
  schemaVersion: 1,
  methods: Object.freeze([
    { method: 'homeContent', scenario: 'categories-and-filters', argumentSource: 'owned boolean true' },
    { method: 'homeVideoContent', scenario: 'home-recommendations', argumentSource: 'no arguments' },
    { method: 'categoryContent', scenario: 'first-category-page-1', argumentSource: 'first usable category ID returned by homeContent, page 1, no selected filter' },
    { method: 'categoryContent', scenario: 'first-category-page-2', argumentSource: 'same returned category ID, page 2, no selected filter' },
    { method: 'categoryContent', scenario: 'first-category-filter', argumentSource: 'first usable nonempty filter value returned for the selected category; record not-tested when absent' },
    { method: 'detailContent', scenario: 'first-returned-detail', argumentSource: 'first usable vod_id returned by category or recommendation; record not-tested when absent' },
    { method: 'searchContent', scenario: 'search-two-arguments', argumentSource: 'query derived from returned title, quick=false; record not-tested when absent' },
    { method: 'searchContent', scenario: 'search-three-arguments', argumentSource: 'same query, quick=false, page 1; record not-tested when absent' },
    { method: 'playerContent', scenario: 'first-returned-playback-parse', argumentSource: 'first usable flag and episode ID returned by detail, empty VIP flags; no decoding/player execution; record not-tested when absent' },
  ]),
  rule: 'Selection policy only. Execution must record actual arguments privately, response/error metadata publicly, and unmet prerequisites as not-tested; no synthetic provider API/ext/category/detail/playback identifiers.',
});

function selectionOf(selection) {
  check(selection && Array.isArray(selection.sha256) && selection.sha256.length > 0
    && selection.sha256.every(value => typeof value === 'string' && hashPattern.test(value)), 'SELECTION');
  check(new Set(selection.sha256).size === selection.sha256.length, 'DUPLICATE_SELECTION');
  return selection.sha256;
}

function contextIdentity(binding) {
  return { role: binding.role, signature: binding.signature,
    main: binding.role === 'site' && binding.main?.signature ? { signature: binding.main.signature, sha256: binding.main.artifactSha256 || null } : null };
}

function reference(binding) {
  return { bindingId: binding.id, captureId: binding.captureId, configSha256: binding.configSha256,
    sourceKey: binding.sourceKey, publicName: binding.publicName, partial: binding.partial };
}

function publicMissing(row) {
  return { sha256: row.sha256, reason: row.reason,
    ...(row.bindingId ? { bindingId: row.bindingId } : {}), ...(row.role ? { role: row.role } : {}),
    ...(row.loaderContextSha256 ? { loaderContextSha256: row.loaderContextSha256 } : {}),
    ...(row.mainArtifactSha256 ? { mainArtifactSha256: row.mainArtifactSha256 } : {}),
    ...(row.configSha256 ? { configSha256: row.configSha256 } : {}),
    ...(row.captureId ? { captureIdSha256: sha(row.captureId) } : {}),
    ...(row.sourceKey ? { sourceKeySha256: sha(row.sourceKey) } : {}) };
}

export function workingSourceScenarioIdentity(artifact, site, { originalBinding } = {}) {
  check(hashPattern.test(artifact?.sha256) && typeof site?.api === 'string' && typeof site.key === 'string'
    && typeof site.ext === 'string' && hashPattern.test(site.executionExtSha256) && sha(site.ext) === site.executionExtSha256, 'SCENARIO_SCHEMA');
  const loaderContext = loaderContextOf(artifact, site).identity;
  let diagnosticOriginalContext;
  if (site.originalMissingContext) {
    const binding = originalBinding;
    check(binding && binding.id === site.bindingId && binding.id === site.originalMissingContext.originalBindingId
      && binding.artifactSha256 === artifact.sha256 && binding.api === site.api && binding.source?.api === site.api
      && binding.sourceKey === site.key && binding.source?.key === site.key && binding.source.ext === site.ext
      && binding.executionExtSha256 === site.executionExtSha256 && binding.role === 'site'
      && binding.signature === site.jar && binding.signature === site.loaderContext.signature
      && binding.main?.signature && !binding.main.retrievalOk && !site.loaderContext.main
      && site.originalMissingContext.reason === 'original-main-not-captured'
      && site.originalMissingContext.mainSignatureSha256 === sha(binding.main.signature)
      && site.originalMissingContextSha256 === identity(contextIdentity(binding)), 'SCENARIO_DIAGNOSTIC_BINDING');
    diagnosticOriginalContext = contextIdentity(binding);
  }
  return identity({ sha256: artifact.sha256, loaderContext, api: site.api,
    executionExtSha256: site.executionExtSha256, sourceKey: site.key,
    ...(diagnosticOriginalContext ? { diagnosticOriginalContext } : {}) });
}

function plannedSite(original, binding, sha256, diagnostic = null) {
  const site = { ...original };
  for (const field of ['methodSelection', 'methodSelectionSha256', 'coverage', 'sourceScenarioSha256', 'selectedContexts', 'limits', 'runtimeOptions',
    'originalMissingContext', 'originalMissingContextSha256', 'businessDiscovery']) delete site[field];
  Object.assign(site, { methodSelectionSha256: identity(workingMethodSelection), references: [reference(binding)] });
  if (diagnostic) {
    site.originalMissingContext = { mainSignatureSha256: sha(binding.main.signature), originalBindingId: binding.id, reason: diagnostic };
    site.originalMissingContextSha256 = identity(contextIdentity(binding));
  }
  const caseIdentitySha256 = workingSourceScenarioIdentity({ sha256 }, site, { originalBinding: binding });
  Object.assign(site, { caseIdentitySha256, sourceScenarioSha256: caseIdentitySha256 });
  return site;
}

function publicCases(artifacts, diagnostics = false) {
  return artifacts.flatMap(artifact => artifact.sites.map(site => ({ sha256: artifact.sha256, caseIdentitySha256: site.caseIdentitySha256,
    loaderContextSha256: site.loaderContextSha256, role: site.loaderContext.role,
    mainArtifactSha256: site.loaderContext.main?.sha256 || null, api: safeApi(site.api), sourceKeySha256: sha(site.key),
    executionExtSha256: site.executionExtSha256, canonicalExtSha256: site.canonicalExtSha256,
    referenceCount: site.references.length, bindingIds: site.references.map(row => row.bindingId),
    ...(diagnostics ? { originalMissingContext: site.originalMissingContext, originalMissingContextSha256: site.originalMissingContextSha256 } : {}) })));
}

/** Pure preparation; call prepareWorkingSourcePlan for byte-verified disk input. */
export function buildWorkingSourcePlan(freeze, selection, { base = 'http://127.0.0.1:18765', includeStandaloneDiagnostics = false } = {}) {
  const selected = selectionOf(selection);
  check(typeof includeStandaloneDiagnostics === 'boolean', 'DIAGNOSTIC_FLAG');
  check(freeze?.schemaVersion === 1 && hashPattern.test(freeze.inputSetSha256)
    && Array.isArray(freeze.artifacts) && Array.isArray(freeze.bindings), 'FREEZE_SCHEMA');
  const artifacts = [], unexecuted = [], inventory = [];
  for (const sha256 of selected) {
    const artifact = freeze.artifacts.find(row => row.sha256 === sha256);
    const bindings = freeze.bindings.filter(row => row.artifactSha256 === sha256 && row.kind === 'jar-csp');
    // One input binding at a time prevents the older role-fixture helper's API/ext
    // deduplication from discarding a different original source key.
    const cases = new Map();
    const candidates = bindings.length ? bindings : [null];
    for (const binding of candidates) {
      const { plan } = buildRoleFixturePlan({ ...freeze, bindings: binding ? [binding] : [] }, { sha256: [sha256] }, { base, allContexts: true });
      unexecuted.push(...plan.unexecuted);
      for (const original of plan.artifacts[0]?.sites || []) {
        const site = plannedSite(original, binding, sha256);
        const caseIdentitySha256 = site.caseIdentitySha256;
        if (cases.has(caseIdentitySha256)) { cases.get(caseIdentitySha256).references.push(reference(binding)); continue; }
        // The role helper owns identity/provenance fields. This planner additionally
        // owns all method-policy fields, so similarly named provider fields cannot
        // inject execution instructions or a forged coverage claim.
        cases.set(caseIdentitySha256, site);
      }
    }
    if (cases.size) artifacts.push({ id: sha256, sha256, jarPath: artifact.jarPath,
      jarUrl: base.replace(/\/+$/, '') + '/artifacts/' + sha256 + '.jar', sites: [...cases.values()] });
    const contextSet = new Set(bindings.map(binding => identity(contextIdentity(binding))));
    const scenarioSet = new Set(bindings.map(binding => identity([sha256, contextIdentity(binding), binding.api, binding.executionExtSha256, binding.sourceKey])));
    inventory.push({ sha256, captured: !!artifact, validContent: artifact?.validContent === true,
      configuredBindings: bindings.length, configuredApis: new Set(bindings.map(row => row.api)).size,
      configuredExecutionExts: new Set(bindings.map(row => row.executionExtSha256)).size,
      configuredSourceKeys: new Set(bindings.map(row => row.sourceKey)).size,
      configuredSignatures: new Set(bindings.map(row => row.signature)).size,
      configuredLoaderContexts: contextSet.size, configuredSourceScenarios: scenarioSet.size,
      roles: [...new Set(bindings.map(row => row.role))].sort(), executableCases: cases.size,
      unexecutedBindings: unexecuted.filter(row => row.sha256 === sha256).length });
  }
  const allSites = artifacts.flatMap(row => row.sites);
  const metadata = { sourceInputSetSha256: freeze.inputSetSha256, sourceFilesSha256: freeze.filesSha256,
    selectionSha256: identity(selection), methodSelectionSha256: identity(workingMethodSelection),
    selectionRule: 'Every original configured source binding for selected SHA256. Distinct source keys remain separate. Only exact SHA/role/signature/main-context/API/execution-ext/source-key duplicates merge, retaining all references.',
    sourceKeyRule: 'source.key is preserved byte-for-byte in each independent scenario; sourceKey-dependent cache/site behavior is not assumed equivalent.',
    classScope: 'Configured executable bindings only. Unreferenced classes inside a JAR are outside this plan and are not counted as tested scripts.',
    budgets: { ...freeze.limits }, scope: 'Prepared inputs only; no execution or business-success evidence.' };
  const plan = { schemaVersion: 1, businessDiscovery: true, metadata, methodSelection: structuredClone(workingMethodSelection), artifacts, inventory, unexecuted, deferred: [] };
  let diagnosticPlan;
  if (includeStandaloneDiagnostics) {
    const diagnosticArtifacts = new Map();
    for (const missing of unexecuted.filter(row => row.reason === 'original-main-not-captured')) {
      const binding = freeze.bindings.find(row => row.id === missing.bindingId);
      check(binding && binding.role === 'site' && binding.main?.signature, 'DIAGNOSTIC_BINDING');
      // Explicitly bounded diagnosis of a site JAR without its unavailable main.
      // This never changes the original plan or counts as original coexistence.
      const standalone = { ...binding, main: { signature: '', retrievalOk: false, artifactSha256: null } };
      const { plan: prepared } = buildRoleFixturePlan({ ...freeze, bindings: [standalone] }, { sha256: [missing.sha256] }, { base, allContexts: true });
      for (const artifact of prepared.artifacts) {
        if (!diagnosticArtifacts.has(artifact.sha256)) diagnosticArtifacts.set(artifact.sha256, { ...artifact, sites: [] });
        const target = diagnosticArtifacts.get(artifact.sha256);
        for (const original of artifact.sites) {
          const site = plannedSite(original, binding, artifact.sha256, missing.reason);
          const prior = target.sites.find(row => row.caseIdentitySha256 === site.caseIdentitySha256);
          if (prior) prior.references.push(reference(binding)); else target.sites.push(site);
        }
      }
    }
    diagnosticPlan = { schemaVersion: 1, businessDiscovery: true, standaloneDiagnostic: true,
      metadata: { ...metadata, scope: 'Explicit standalone diagnostic only: original configured main is unavailable. Results must never backfill original coexistence/business success.' },
      methodSelection: structuredClone(workingMethodSelection), artifacts: [...diagnosticArtifacts.values()], unexecuted: [], deferred: [] };
  }
  const publicMetadata = { schemaVersion: 1, inputSetSha256: freeze.inputSetSha256, filesSha256: freeze.filesSha256,
    selectionSha256: metadata.selectionSha256, metadataSha256: identity(metadata), methodSelectionSha256: metadata.methodSelectionSha256,
    summary: { selectedArtifacts: selected.length, executableArtifacts: artifacts.length,
      configuredBindings: inventory.reduce((sum, row) => sum + row.configuredBindings, 0),
      configuredSourceScenarios: inventory.reduce((sum, row) => sum + row.configuredSourceScenarios, 0),
      cases: allSites.length, mainCases: allSites.filter(row => row.loaderContext.role === 'main').length,
      siteCases: allSites.filter(row => row.loaderContext.role === 'site').length,
      unexecutedBindings: unexecuted.length, deferredVariants: 0 },
    selectionRule: metadata.selectionRule, sourceKeyRule: metadata.sourceKeyRule, classScope: metadata.classScope,
    scope: metadata.scope, inventory,
    cases: publicCases(artifacts), missing: unexecuted.map(publicMissing),
    standaloneDiagnostics: { enabled: includeStandaloneDiagnostics,
      scope: 'Separate standalone diagnostics; original-main-missing bindings remain unexecuted in the original-context plan.',
      artifacts: diagnosticPlan?.artifacts.length || 0,
      cases: diagnosticPlan ? publicCases(diagnosticPlan.artifacts, true) : [] } };
  return { plan, publicMetadata, ...(diagnosticPlan ? { diagnosticPlan } : {}) };
}

async function newOutput(directory, capture) {
  const path = resolve(directory);
  check(!contained(capture, path) && !contained(path, capture), 'OUTPUT_OVERLAPS_CAPTURE');
  const parts = relative(resolve('/'), path).split(sep);
  let cursor = resolve('/');
  for (const part of parts) {
    cursor = join(cursor, part);
    const info = await lstat(cursor).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    check(!info || info.isDirectory() && !info.isSymbolicLink(), 'OUTPUT_PATH');
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  check(await realpath(path) === path && (await readdir(path)).length === 0, 'OUTPUT_NOT_EMPTY');
  await chmod(path, 0o700);
  return path;
}

export async function prepareWorkingSourcePlan({ directory, selection, selectionPath, out, base, includeStandaloneDiagnostics = false } = {}) {
  const verified = await verifyCatalogFreeze({ directory });
  const capture = await realpath(resolve(directory));
  const freeze = JSON.parse(await readFile(join(capture, 'freeze.json'), 'utf8'));
  check(freeze.inputSetSha256 === verified.inputSetSha256, 'FREEZE_IDENTITY');
  const selectionBytes = selectionPath ? await readFile(resolve(selectionPath)) : Buffer.from(JSON.stringify(selection));
  const requested = selectionPath ? JSON.parse(selectionBytes) : selection;
  const prepared = buildWorkingSourcePlan(freeze, requested, { base, includeStandaloneDiagnostics });
  const after = await verifyCatalogFreeze({ directory });
  check(after.inputSetSha256 === verified.inputSetSha256, 'FREEZE_IDENTITY');
  const output = await newOutput(out, capture);
  const planBytes = Buffer.from(JSON.stringify(prepared.plan, null, 2) + '\n');
  const diagnosticBytes = prepared.diagnosticPlan ? Buffer.from(JSON.stringify(prepared.diagnosticPlan, null, 2) + '\n') : null;
  const pins = { ...prepared.publicMetadata, planSha256: sha(planBytes), selectionFileSha256: sha(selectionBytes),
    ...(diagnosticBytes ? { diagnosticPlanSha256: sha(diagnosticBytes) } : {}),
    preparerSha256: sha(await readFile(SELF)),
    rolePreparerSha256: sha(await readFile(join(dirname(SELF), '../android/prepare-role-fixtures.mjs'))),
    loaderContextHelperSha256: sha(await readFile(join(dirname(SELF), '../android/loader-context.mjs'))),
    freezeFileSha256: sha(await readFile(join(capture, 'freeze.json'))) };
  await writeFile(join(output, 'oracle-plan.json'), planBytes, { flag: 'wx', mode: 0o600 });
  if (diagnosticBytes) await writeFile(join(output, 'diagnostic-plan.json'), diagnosticBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(join(output, 'working-source-pins.json'), JSON.stringify(pins, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { plan: prepared.plan, ...(prepared.diagnosticPlan ? { diagnosticPlan: prepared.diagnosticPlan } : {}), pins, output };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/compat/prepare-working-source-plan.mjs --directory PRIVATE_FREEZE --selection PRIVATE_SELECTION_JSON --out NEW_EMPTY_PRIVATE_OUTPUT [--base http://127.0.0.1:18765] [--include-standalone-diagnostics]\nAll configured source-key/API/ext/original-loader scenarios are selected; missing original mains remain unexecuted. Explicit standalone diagnostics are separate. No network or execution.\n');
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--include-standalone-diagnostics') { check(!Object.hasOwn(options, name), 'CLI_ARGUMENT'); options[name] = true; continue; }
    check(['--directory', '--selection', '--out', '--base'].includes(name) && args[index + 1] && !Object.hasOwn(options, name), 'CLI_ARGUMENT');
    options[name] = args[++index];
  }
  check(options['--directory'] && options['--selection'] && options['--out'], 'CLI_USAGE');
  const { pins } = await prepareWorkingSourcePlan({ directory: options['--directory'], selectionPath: options['--selection'], out: options['--out'], base: options['--base'], includeStandaloneDiagnostics: !!options['--include-standalone-diagnostics'] });
  process.stdout.write(JSON.stringify({ ...pins.summary, inputSetSha256: pins.inputSetSha256, planSha256: pins.planSha256 }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: /^(?:WORKING_PLAN|ROLE_FIXTURE|FREEZE)_[A-Z_]+$/.test(error.message) ? error.message : 'WORKING_PLAN_INPUT_OR_IO', errorSha256: sha(String(error.message)) }) + '\n');
  process.exitCode = 1;
});
