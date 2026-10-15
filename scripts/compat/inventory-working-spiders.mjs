// SPDX-License-Identifier: GPL-3.0-only
// Static ZIP/DEX declarations only. Never loads or invokes captured classes.
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dexInventory, zipEntries } from './artifact-inspect.mjs';
import { verifyCatalogFreeze } from './freeze-catalog.mjs';

const SELF = fileURLToPath(import.meta.url), BASE = 'Lcom/github/catvod/crawler/Spider;', PREFIX = 'Lcom/github/catvod/spider/';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identity = value => sha(JSON.stringify(canonical(value)));
const check = (value, code) => { if (!value) throw new Error('SPIDER_INVENTORY_' + code); };
const hashPattern = /^[a-f0-9]{64}$/;
const symbol = value => typeof value === 'string' && value.length <= 320 && /^[\p{L}\p{N}_/$;()<>.[\]-]+$/u.test(value) ? value : 'sha256:' + sha(String(value));
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };

export const businessContracts = Object.freeze([
  { id: 'home', name: 'homeContent', descriptor: '(Z)Ljava/lang/String;', group: 'home' },
  { id: 'recommendations', name: 'homeVideoContent', descriptor: '()Ljava/lang/String;', group: 'home' },
  { id: 'category', name: 'categoryContent', descriptor: '(Ljava/lang/String;Ljava/lang/String;ZLjava/util/HashMap;)Ljava/lang/String;', group: 'category' },
  { id: 'detail', name: 'detailContent', descriptor: '(Ljava/util/List;)Ljava/lang/String;', group: 'detail' },
  { id: 'search', name: 'searchContent', descriptor: '(Ljava/lang/String;Z)Ljava/lang/String;', group: 'search' },
  { id: 'searchPaged', name: 'searchContent', descriptor: '(Ljava/lang/String;ZLjava/lang/String;)Ljava/lang/String;', group: 'search' },
  { id: 'player', name: 'playerContent', descriptor: '(Ljava/lang/String;Ljava/lang/String;Ljava/util/List;)Ljava/lang/String;', group: 'player' },
]);

/** Bounded declarations parser; code bodies are never interpreted. */
export function inspectSpiderDex(bytes) {
  const checkedInventory = dexInventory(bytes);
  const range = (offset, size) => check(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(size) && size >= 0 && offset + size <= bytes.length, 'DEX_RANGE');
  const u32 = offset => { range(offset, 4); return bytes.readUInt32LE(offset); };
  const u16 = offset => { range(offset, 2); return bytes.readUInt16LE(offset); };
  for (const [countOffset, dataOffset, stride, limit] of [[56, 60, 4, 1000000], [64, 68, 4, 65536],
    [72, 76, 12, 65536], [80, 84, 8, 65536], [88, 92, 8, 65536], [96, 100, 32, 65536]]) {
    const count = u32(countOffset); check(count <= limit, 'DEX_COUNT'); range(u32(dataOffset), count * stride);
  }
  const uleb = cursor => {
    let result = 0;
    for (let index = 0; index < 5; index++) {
      range(cursor[0], 1); const value = bytes[cursor[0]++];
      check(index < 4 || !(value & 0xf0), 'DEX_ULEB');
      result += (value & 127) * 2 ** (index * 7);
      if (!(value & 128)) return result;
    }
    throw new Error('SPIDER_INVENTORY_DEX_ULEB');
  };
  const strings = Array.from({ length: u32(56) }, (_, index) => {
    const cursor = [u32(u32(60) + index * 4)]; uleb(cursor);
    const end = bytes.indexOf(0, cursor[0]); check(end >= 0, 'DEX_STRING');
    return bytes.toString('utf8', cursor[0], end);
  });
  const type = index => { check(index < u32(64), 'DEX_TYPE'); return strings[u32(u32(68) + index * 4)]; };
  const proto = index => {
    check(index < u32(72), 'DEX_PROTO');
    const offset = u32(76) + index * 12, parameters = u32(offset + 8), count = parameters ? u32(parameters) : 0;
    check(count <= 65536, 'DEX_PARAMETER_COUNT'); if (parameters) range(parameters + 4, count * 2);
    return '(' + Array.from({ length: count }, (_, item) => type(u16(parameters + 4 + item * 2))).join('') + ')' + type(u32(offset + 4));
  };
  const method = index => {
    check(index < u32(88), 'DEX_METHOD'); const offset = u32(92) + index * 8, stringIndex = u32(offset + 4);
    check(stringIndex < strings.length, 'DEX_STRING_INDEX');
    return { owner: type(u16(offset)), name: strings[stringIndex], descriptor: proto(u16(offset + 2)) };
  };
  const classes = [];
  for (let index = 0; index < u32(96); index++) {
    const offset = u32(100) + index * 32, superIndex = u32(offset + 8), data = u32(offset + 24);
    const cls = { descriptor: type(u32(offset)), superClass: superIndex === 0xffffffff ? null : type(superIndex), access: u32(offset + 4), methods: [] };
    if (data) {
      const cursor = [data], fieldCounts = [uleb(cursor), uleb(cursor)], methodCounts = [uleb(cursor), uleb(cursor)];
      for (const count of fieldCounts) {
        check(count <= u32(80), 'DEX_FIELD_COUNT'); let fieldIndex = 0;
        for (let item = 0; item < count; item++) { fieldIndex += uleb(cursor); uleb(cursor); check(fieldIndex < u32(80), 'DEX_FIELD'); }
      }
      for (const count of methodCounts) {
        check(count <= u32(88), 'DEX_METHOD_COUNT'); let methodIndex = 0;
        for (let item = 0; item < count; item++) {
          methodIndex += uleb(cursor); const access = uleb(cursor), codeOffset = uleb(cursor), value = method(methodIndex);
          check(value.owner === cls.descriptor, 'DEX_METHOD_OWNER');
          if (codeOffset) { range(codeOffset, 16); range(codeOffset + 16, u32(codeOffset + 12) * 2); }
          cls.methods.push({ name: value.name, descriptor: value.descriptor, access, codePresent: codeOffset > 0, native: !!(access & 0x100) });
        }
      }
    }
    classes.push(cls);
  }
  return { version: checkedInventory.version, classCount: classes.length, classes };
}

const originalContext = binding => ({ role: binding.role, signature: binding.signature,
  main: binding.role === 'site' && binding.main?.signature ? { signature: binding.main.signature, sha256: binding.main.artifactSha256 || null } : null });
const scenario = binding => identity([binding.artifactSha256, originalContext(binding), binding.api, binding.executionExtSha256, binding.sourceKey]);
const apiClass = api => PREFIX + (api.includes('csp_') ? api.split('csp_')[1] : api).replaceAll('.', '/') + ';';

function bindingReference(binding) {
  return { bindingId: binding.id, configSha256: binding.configSha256, captureIdSha256: sha(binding.captureId),
    sourceKeySha256: sha(binding.sourceKey), role: binding.role, signatureSha256: sha(binding.signature),
    executionExtSha256: binding.executionExtSha256, canonicalExtSha256: binding.canonicalExtSha256,
    originalConfigurationScenarioSha256: scenario(binding),
    mainSignatureSha256: binding.role === 'site' && binding.main?.signature ? sha(binding.main.signature) : null,
    mainArtifactSha256: binding.role === 'site' && binding.main?.signature ? binding.main.artifactSha256 || null : null,
    originalMainCaptured: binding.role !== 'site' || !binding.main?.signature || binding.main.retrievalOk === true };
}

/** Structural candidates, exact business signatures and their declaring classes. */
export function inventorySpiderClasses(classes, { bindings = [], sha256 } = {}) {
  const byClass = new Map();
  for (const cls of classes) { check(!byClass.has(cls.descriptor), 'DUPLICATE_CLASS'); byClass.set(cls.descriptor, cls); }
  const lineage = cls => {
    const chain = [], seen = new Set(); let current = cls;
    while (current) {
      check(!seen.has(current.descriptor), 'INHERITANCE_CYCLE'); seen.add(current.descriptor); chain.push(current.descriptor);
      if (current.descriptor === BASE) return { chain, reachesSpider: true };
      if (!current.superClass) return { chain, reachesSpider: false };
      if (current.superClass === BASE) return { chain: [...chain, BASE], reachesSpider: true };
      if (!byClass.has(current.superClass)) return { chain: [...chain, current.superClass], reachesSpider: false, unresolvedSuperClass: current.superClass };
      current = byClass.get(current.superClass);
    }
    return { chain, reachesSpider: false };
  };
  const configured = new Map();
  for (const binding of bindings) {
    check(typeof binding.api === 'string' && typeof binding.sourceKey === 'string', 'BINDING_SCHEMA');
    const descriptor = apiClass(binding.api);
    if (!configured.has(descriptor)) configured.set(descriptor, []);
    configured.get(descriptor).push(binding);
  }
  const descendants = classes.filter(cls => cls.descriptor !== BASE && lineage(cls).reachesSpider);
  const candidates = descendants.filter(cls => cls.descriptor.startsWith(PREFIX) && cls.access & 1 && !(cls.access & 0x600)
    && cls.methods.some(method => method.name === '<init>' && method.descriptor === '()V' && method.access & 1 && !(method.access & 8)));
  const rows = candidates.map(cls => {
    const ancestry = lineage(cls), references = configured.get(cls.descriptor) || [];
    const methods = Object.fromEntries(businessContracts.map(contract => {
      for (const descriptor of ancestry.chain) {
        if (descriptor === BASE) return [contract.id, { signature: contract.name + contract.descriptor,
          override: false, origin: 'base-spider-contract', declaringClass: BASE, implementationInspected: false }];
        const declared = byClass.get(descriptor)?.methods.find(method => method.name === contract.name && method.descriptor === contract.descriptor
          && method.access & 1 && !(method.access & 0xa));
        if (declared) return [contract.id, { signature: contract.name + contract.descriptor, override: true,
          origin: descriptor === cls.descriptor ? 'declared' : 'inherited', declaringClass: symbol(descriptor),
          codePresent: declared.codePresent, native: declared.native }];
      }
      return [contract.id, { signature: contract.name + contract.descriptor, override: false, origin: 'unresolved' }];
    }));
    const groups = origin => [...new Set(businessContracts.filter(contract => methods[contract.id].override
      && (!origin || methods[contract.id].origin === origin)).map(contract => contract.group))];
    return { class: symbol(cls.descriptor), apiCandidate: symbol('csp_' + cls.descriptor.slice(PREFIX.length, -1).replaceAll('/', '.')),
      superClass: symbol(cls.superClass), inheritance: ancestry.chain.map(symbol),
      publicConcreteZeroArgConstructor: true, nativeConstructor: cls.methods.some(method => method.name === '<init>' && method.descriptor === '()V' && method.native),
      configured: references.length > 0, configuredApis: [...new Set(references.map(binding => symbol(binding.api)))],
      configuredSourceScenarios: new Set(references.map(scenario)).size, references: references.map(bindingReference),
      extAvailability: references.length ? 'captured-configured-ext-by-hash' : 'unknown-no-original-binding',
      executionStatus: 'not-executed-by-this-static-inventory', declaredBusinessGroups: groups('declared'), effectiveBusinessGroups: groups(),
      declaredBusinessMethods: Object.keys(methods).filter(id => methods[id].origin === 'declared'),
      inheritedBusinessMethods: Object.keys(methods).filter(id => methods[id].origin === 'inherited'), methods,
      classification: groups('declared').length ? 'declares-business-overrides' : groups().length ? 'inherits-business-overrides' : 'no-business-overrides-observed',
      pagedSearchMayUseBaseTwoArgumentFallback: !methods.searchPaged.override && methods.search.override };
  }).sort((a, b) => a.class.localeCompare(b.class));
  const configuredApis = [...configured.entries()].map(([descriptor, references]) => ({
    class: symbol(descriptor), apis: [...new Set(references.map(binding => symbol(binding.api)))],
    classDeclared: byClass.has(descriptor), spiderInheritanceObserved: byClass.has(descriptor) && lineage(byClass.get(descriptor)).reachesSpider,
    publicConcreteZeroArgCandidate: rows.some(row => row.class === symbol(descriptor)),
    configuredSourceScenarios: new Set(references.map(scenario)).size, references: references.map(bindingReference),
  })).sort((a, b) => a.class.localeCompare(b.class));
  const configuredRows = rows.filter(row => row.configured), unconfigured = rows.filter(row => !row.configured);
  return { sha256, summary: { declaredClasses: classes.length, spiderDescendants: descendants.length,
    publicConcreteZeroArgCandidates: rows.length, configuredApis: configuredApis.reduce((sum, row) => sum + row.apis.length, 0),
    configuredBindings: bindings.length, configuredSourceScenarios: new Set(bindings.map(scenario)).size,
    configuredCandidateClasses: configuredRows.length, unconfiguredCandidates: unconfigured.length,
    unconfiguredDeclaringBusinessOverrides: unconfigured.filter(row => row.classification === 'declares-business-overrides').length,
    unconfiguredInheritingBusinessOverridesOnly: unconfigured.filter(row => row.classification === 'inherits-business-overrides').length,
    unconfiguredWithoutBusinessOverridesObserved: unconfigured.filter(row => row.classification === 'no-business-overrides-observed').length },
    configuredApis, candidates: rows };
}

export async function inventoryWorkingSpiders({ directory, selection, selectionPath, out } = {}) {
  const verified = await verifyCatalogFreeze({ directory }), capture = await realpath(resolve(directory));
  const freezeBytes = await readFile(join(capture, 'freeze.json')), freeze = JSON.parse(freezeBytes);
  const selectionBytes = selectionPath ? await readFile(resolve(selectionPath)) : Buffer.from(JSON.stringify(selection));
  const requested = selectionPath ? JSON.parse(selectionBytes) : selection;
  check(requested && Array.isArray(requested.sha256) && requested.sha256.length > 0
    && requested.sha256.every(value => hashPattern.test(value)) && new Set(requested.sha256).size === requested.sha256.length, 'SELECTION');
  const artifacts = [];
  for (const sha256 of requested.sha256) {
    const artifact = freeze.artifacts.find(row => row.sha256 === sha256);
    check(artifact?.validContent, 'SELECTED_ARTIFACT');
    const bytes = await readFile(join(capture, artifact.jarPath)); check(sha(bytes) === sha256, 'ARTIFACT_CHANGED');
    const entries = zipEntries(bytes), dex = entries.filter(entry => entry.name.endsWith('.dex')).map(entry => ({ name: entry.name, ...inspectSpiderDex(entry.read()) }));
    const result = inventorySpiderClasses(dex.flatMap(row => row.classes), { sha256,
      bindings: freeze.bindings.filter(row => row.artifactSha256 === sha256 && row.kind === 'jar-csp') });
    artifacts.push({ ...result, dex: dex.map(row => ({ name: symbol(row.name), classes: row.classCount })),
      classFilesNotInspected: entries.filter(entry => entry.name.endsWith('.class')).length,
      nativeLibraries: entries.filter(entry => entry.name.endsWith('.so')).length,
      guardedPayloadsNotInspected: entries.filter(entry => entry.name.endsWith('.guard')).length });
  }
  const after = await verifyCatalogFreeze({ directory }); check(verified.inputSetSha256 === after.inputSetSha256, 'FREEZE_CHANGED');
  const summary = Object.fromEntries(Object.keys(artifacts[0].summary).map(key => [key, artifacts.reduce((sum, artifact) => sum + artifact.summary[key], 0)]));
  const report = { schemaVersion: 1, inputSetSha256: verified.inputSetSha256, filesSha256: freeze.filesSha256,
    freezeFileSha256: sha(freezeBytes), selectionFileSha256: sha(selectionBytes), scannerSha256: sha(await readFile(SELF)),
    artifactInspectorSha256: sha(await readFile(join(dirname(SELF), 'artifact-inspect.mjs'))),
    scope: 'Static DEX declaration/inheritance inventory only; no captured class is loaded, initialized or invoked, and no network requests are performed.',
    interpretation: [
      'A public concrete zero-argument Spider subclass is only a structural candidate. Proxy, push, internal and helper classes may satisfy the same structure.',
      'Declared/inherited business override means a public nonstatic exact Spider-contract method declaration exists; no body semantics, endpoint availability or response correctness is established.',
      'Unconfigured candidates have unknown ext and are not executed. No empty or guessed ext is supplied.',
      'Configured source scenarios preserve source key, exact API/ext, role, full signature and original main context in identity hashes; source values remain private.',
      'Declarations in .class files or dynamically decrypted/loaded payloads are not inspected; missing ancestry outside this artifact cannot establish Spider inheritance.',
    ], contracts: businessContracts, summary: { artifacts: artifacts.length, ...summary }, artifacts };
  if (out) {
    const output = resolve(out); check(!contained(capture, output) && !contained(output, capture), 'OUTPUT_OVERLAPS_CAPTURE');
    let cursor = resolve('/');
    for (const part of relative(resolve('/'), dirname(output)).split(sep)) {
      cursor = join(cursor, part); const info = await lstat(cursor); check(info.isDirectory() && !info.isSymbolicLink(), 'OUTPUT_PATH');
    }
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
  }
  return report;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/compat/inventory-working-spiders.mjs --directory PRIVATE_FREEZE --selection PRIVATE_SELECTION_JSON --out NEW_PUBLIC_JSON\nStatic declarations and inheritance only; no provider code execution or network.\n'); return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index]; check(['--directory', '--selection', '--out'].includes(name) && args[index + 1] && !Object.hasOwn(options, name), 'CLI_ARGUMENT'); options[name] = args[++index];
  }
  check(options['--directory'] && options['--selection'] && options['--out'], 'CLI_USAGE');
  const report = await inventoryWorkingSpiders({ directory: options['--directory'], selectionPath: options['--selection'], out: options['--out'] });
  process.stdout.write(JSON.stringify({ inputSetSha256: report.inputSetSha256, ...report.summary }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: /^(?:SPIDER_INVENTORY|FREEZE)_[A-Z_]+$/.test(error.message) ? error.message : 'SPIDER_INVENTORY_INPUT_OR_IO', errorSha256: sha(String(error.message)) }) + '\n'); process.exitCode = 1;
});
