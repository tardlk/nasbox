// SPDX-License-Identifier: GPL-3.0-only
// Owned structural DEX fixtures only. No provider code execution or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freezeCatalog } from '../scripts/compat/freeze-catalog.mjs';
import { businessContracts, inspectSpiderDex, inventorySpiderClasses, inventoryWorkingSpiders } from '../scripts/compat/inventory-working-spiders.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const BASE = 'Lcom/github/catvod/crawler/Spider;', PREFIX = 'Lcom/github/catvod/spider/';
const SECRET = 'INVENTORY_PRIVATE_f41', SIGNATURE = 'https://provider.invalid/site.jar?token=' + SECRET;
const ctor = { name: '<init>', descriptor: '()V', access: 1, codePresent: true, native: false };
const contractMethod = (id, extra = {}) => ({ ...businessContracts.find(row => row.id === id), access: 1, codePresent: true, native: false, ...extra });
const cls = (name, superClass = BASE, methods = [], access = 1) => ({ descriptor: PREFIX + name + ';', superClass, access, methods: [ctor, ...methods] });
const bindings = key => ({ id: sha(key), artifactSha256: sha('artifact'), captureId: 'capture-' + key, configSha256: sha('config-' + key),
  sourceKey: key, api: 'csp_Child', executionExtSha256: sha(SECRET), canonicalExtSha256: sha(JSON.stringify(SECRET)), role: 'site', signature: SIGNATURE,
  main: { signature: SIGNATURE + '&main=1', retrievalOk: false, artifactSha256: null } });

test('structural candidates retain exact business overrides, inherited declaring classes and configured references', () => {
  const classes = [cls('Ancestor', BASE, [contractMethod('home'), contractMethod('search'), contractMethod('player', { native: true, codePresent: false })]),
    cls('Child', PREFIX + 'Ancestor;', [contractMethod('detail'), contractMethod('home', { access: 9 }), contractMethod('searchPaged', { access: 2 })]),
    cls('Proxy'), cls('WrongSignature', BASE, [{ name: 'homeContent', descriptor: '()Ljava/lang/String;', access: 1, codePresent: true }]),
    { ...cls('ExternalPackage', BASE, [contractMethod('home')]), descriptor: 'Lanother/package/ExternalPackage;' }];
  const first = bindings(SECRET), duplicate = { ...bindings('duplicate'), sourceKey: SECRET }, second = bindings('other-key');
  const report = inventorySpiderClasses(classes, { sha256: sha('artifact'), bindings: [first, duplicate, second] });
  assert.equal(report.summary.spiderDescendants, 5);
  assert.equal(report.summary.publicConcreteZeroArgCandidates, 4);
  assert.equal(report.summary.configuredApis, 1);
  assert.equal(report.summary.configuredBindings, 3);
  assert.equal(report.summary.configuredSourceScenarios, 2);
  const child = report.candidates.find(row => row.class === PREFIX + 'Child;');
  assert.equal(child.configured, true);
  assert.equal(child.references.length, 3);
  assert.equal(child.methods.home.declaringClass, PREFIX + 'Ancestor;');
  assert.equal(child.methods.home.origin, 'inherited', 'static method is not an override');
  assert.equal(child.methods.detail.origin, 'declared');
  assert.equal(child.methods.player.native, true);
  assert.equal(child.methods.player.codePresent, false);
  assert.equal(child.methods.searchPaged.override, false, 'private method is not an override');
  assert.equal(child.pagedSearchMayUseBaseTwoArgumentFallback, true);
  assert.deepEqual(child.declaredBusinessGroups, ['detail']);
  assert.deepEqual(child.effectiveBusinessGroups, ['home', 'detail', 'search', 'player']);
  assert.equal(report.candidates.find(row => row.class === PREFIX + 'Proxy;').classification, 'no-business-overrides-observed');
  assert.equal(report.candidates.find(row => row.class === PREFIX + 'WrongSignature;').methods.home.override, false);
  for (const secret of [SECRET, SIGNATURE, 'capture-other-key', 'other-key']) assert.equal(JSON.stringify(report).includes(secret), false);
});

test('nonpublic, abstract, interface and nonzero-argument constructors are not independent candidates; unresolved ancestry is not inferred', () => {
  const nonzero = cls('NeedsArguments'); nonzero.methods = [{ ...ctor, descriptor: '(Ljava/lang/String;)V' }];
  const noPublicCtor = cls('PrivateCtor'); noPublicCtor.methods = [{ ...ctor, access: 2 }];
  const report = inventorySpiderClasses([cls('Public'), cls('Hidden', BASE, [], 0), cls('Abstract', BASE, [], 0x401),
    cls('Interface', BASE, [], 0x201), nonzero, noPublicCtor, cls('ExternalBase', 'Lunavailable/Base;')]);
  assert.equal(report.summary.spiderDescendants, 6);
  assert.equal(report.summary.publicConcreteZeroArgCandidates, 1);
  assert.equal(report.candidates[0].apiCandidate, 'csp_Public');
  assert.equal(report.candidates[0].extAvailability, 'unknown-no-original-binding');
  assert.equal(report.candidates[0].executionStatus, 'not-executed-by-this-static-inventory');
  assert.throws(() => inventorySpiderClasses([cls('CycleA', PREFIX + 'CycleB;'), cls('CycleB', PREFIX + 'CycleA;')]), /INHERITANCE_CYCLE/);
  assert.throws(() => inventorySpiderClasses([cls('Same'), cls('Same')]), /DUPLICATE_CLASS/);
});

const uleb = value => { const values = []; do { const part = value & 127; value = Math.floor(value / 128); values.push(part | (value ? 128 : 0)); } while (value); return Buffer.from(values); };
/** Minimal owned declaration tables, not an executable or checksum-valid DEX. */
function structuralDex(classes) {
  const parseDescriptor = descriptor => {
    const [parameters, result] = descriptor.slice(1).split(')');
    return { parameters: parameters.match(/\[*L[^;]+;|\[*[ZBCSIJFD]/g) || [], result };
  };
  const methods = classes.flatMap(row => row.methods.map(method => ({ ...method, owner: row.descriptor })))
    .sort((a, b) => (a.owner + a.name + a.descriptor).localeCompare(b.owner + b.name + b.descriptor));
  const protos = [...new Set(methods.map(row => row.descriptor))];
  const types = [...new Set(classes.flatMap(row => [row.descriptor, row.superClass]).filter(Boolean)
    .concat(protos.flatMap(value => { const p = parseDescriptor(value); return [...p.parameters, p.result]; })))];
  const strings = [...new Set([...types, ...methods.map(row => row.name)])];
  const stringOffset = 112, typeOffset = stringOffset + strings.length * 4, protoOffset = typeOffset + types.length * 4,
    methodOffset = protoOffset + protos.length * 12, classOffset = methodOffset + methods.length * 8;
  const header = Buffer.alloc(classOffset + classes.length * 32), chunks = [header]; let length = header.length;
  const append = bytes => { const offset = length; chunks.push(bytes); length += bytes.length; return offset; };
  const align = () => { if (length % 4) append(Buffer.alloc(4 - length % 4)); };
  header.write('dex\n035\0');
  for (const [countAt, offsetAt, values, offset] of [[56,60,strings,stringOffset],[64,68,types,typeOffset],[72,76,protos,protoOffset],[88,92,methods,methodOffset],[96,100,classes,classOffset]]) {
    header.writeUInt32LE(values.length, countAt); header.writeUInt32LE(offset, offsetAt);
  }
  strings.forEach((value, index) => header.writeUInt32LE(append(Buffer.concat([uleb(value.length), Buffer.from(value), Buffer.from([0])])), stringOffset + index * 4));
  types.forEach((value, index) => header.writeUInt32LE(strings.indexOf(value), typeOffset + index * 4));
  protos.forEach((value, index) => {
    const p = parseDescriptor(value), offset = protoOffset + index * 12;
    header.writeUInt32LE(types.indexOf(p.result), offset + 4);
    if (p.parameters.length) { align(); const data = Buffer.alloc(4 + p.parameters.length * 2); data.writeUInt32LE(p.parameters.length); p.parameters.forEach((type, i) => data.writeUInt16LE(types.indexOf(type), 4 + i * 2)); header.writeUInt32LE(append(data), offset + 8); }
  });
  methods.forEach((method, index) => {
    const offset = methodOffset + index * 8; header.writeUInt16LE(types.indexOf(method.owner), offset);
    header.writeUInt16LE(protos.indexOf(method.descriptor), offset + 2); header.writeUInt32LE(strings.indexOf(method.name), offset + 4);
  });
  const codeOffsets = new Map();
  methods.forEach((method, index) => { if (method.codePresent) { align(); const code = Buffer.alloc(18); code.writeUInt32LE(1, 12); code.writeUInt16LE(0x0e, 16); codeOffsets.set(index, append(code)); } });
  classes.forEach((row, index) => {
    const offset = classOffset + index * 32; header.writeUInt32LE(types.indexOf(row.descriptor), offset); header.writeUInt32LE(row.access, offset + 4);
    header.writeUInt32LE(row.superClass ? types.indexOf(row.superClass) : 0xffffffff, offset + 8);
    const ownedMethods = methods.map((method, i) => ({ ...method, index: i })).filter(method => method.owner === row.descriptor);
    const encoded = [uleb(0), uleb(0), uleb(ownedMethods.length), uleb(0)]; let previous = 0;
    for (const method of ownedMethods) { encoded.push(uleb(method.index - previous), uleb(method.access), uleb(codeOffsets.get(method.index) || 0)); previous = method.index; }
    header.writeUInt32LE(append(Buffer.concat(encoded)), offset + 24);
  });
  return Buffer.concat(chunks);
}

test('bounded DEX reader extracts declared method signatures, class access and native flags without executing bytes', () => {
  const definitions = [cls('Native', BASE, [contractMethod('player', { native: true, access: 0x101, codePresent: false })]),
    cls('Child', PREFIX + 'Native;', [contractMethod('home'), contractMethod('searchPaged')])];
  const bytes = structuralDex(definitions), result = inspectSpiderDex(bytes);
  assert.equal(result.classCount, 2);
  const native = result.classes.find(row => row.descriptor === PREFIX + 'Native;');
  assert.equal(native.superClass, BASE);
  assert.equal(native.methods.find(row => row.name === 'playerContent').native, true);
  assert.equal(native.methods.find(row => row.name === 'playerContent').codePresent, false);
  const inventory = inventorySpiderClasses(result.classes);
  assert.equal(inventory.candidates.find(row => row.apiCandidate === 'csp_Child').methods.player.origin, 'inherited');
  for (const mutate of [
    buffer => buffer.writeUInt32LE(0xffffffff, 100),
    buffer => buffer.writeUInt32LE(0xffffffff, 76),
    buffer => buffer.writeUInt32LE(0xffffffff, buffer.readUInt32LE(100) + 24),
    buffer => buffer.writeUInt16LE(0xffff, buffer.readUInt32LE(92)),
  ]) {
    const broken = Buffer.from(bytes); mutate(broken); assert.throws(() => inspectSpiderDex(broken));
  }
});

function storedZip(name, bytes) {
  const n = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(n.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + bytes.length, 16);
  return Buffer.concat([local, n, bytes, central, n, end]);
}

test('disk inventory verifies frozen bytes and publishes symbols plus hashes without private source fields', async t => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'tvbox-static-inventory-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const capture = join(directory, 'capture'); await mkdir(join(capture, 'captures', 'catalog-1'), { recursive: true }); await mkdir(join(capture, 'artifacts'));
  const bytes = storedZip('classes.dex', structuralDex([cls('Child', BASE, [contractMethod('home')]), cls('Unconfigured')])), digest = sha(bytes);
  await writeFile(join(capture, 'artifacts', digest + '.jar'), bytes);
  const config = { globals: { spider: '' }, sites: [{ key: SECRET, api: 'csp_Child', type: 3, jar: SIGNATURE, ext: SECRET }] };
  const configPath = 'captures/catalog-1/config.json'; await writeFile(join(capture, configPath), JSON.stringify(config));
  const entry = { id: 'catalog-1', parseSuccess: true, publicName: '公开目录', configFile: configPath,
    configSha256: sha(await readFile(join(capture, configPath))), responses: [] };
  const artifact = { id: digest, sha256: digest, jarPath: 'artifacts/' + digest + '.jar', bytes: bytes.length, sites: [] };
  const writeJson = (name, value) => writeFile(join(capture, name), JSON.stringify(value));
  await Promise.all([writeFile(join(capture, 'index.html'), 'owned index'), writeFile(join(capture, 'list.txt'), 'owned catalog'), writeJson('site-config.json', {}),
    writeJson('inventory.json', { entries: [entry] }), writeJson('captures/catalog-1/metadata.json', entry),
    writeJson('input-manifest.json', { artifacts: [artifact] }), writeJson('artifact-inventory.json', { artifacts: [{ ...artifact, inspection: { ok: true } }],
      retrievals: [{ role: 'site', signature: SIGNATURE, ok: true, sha256: digest, bytes: bytes.length }] })]);
  await freezeCatalog({ directory: capture });
  const out = join(directory, 'public.json'), report = await inventoryWorkingSpiders({ directory: capture, selection: { sha256: [digest] }, out });
  assert.equal(report.summary.artifacts, 1);
  assert.equal(report.summary.publicConcreteZeroArgCandidates, 2);
  assert.equal(report.summary.configuredSourceScenarios, 1);
  assert.equal(report.summary.unconfiguredCandidates, 1);
  assert.equal(JSON.stringify(report).includes(SECRET), false);
  assert.equal(JSON.stringify(report).includes(SIGNATURE), false);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), report);
  await assert.rejects(inventoryWorkingSpiders({ directory: capture, selection: { sha256: [digest] }, out: join(capture, 'public.json') }), /OUTPUT_OVERLAPS_CAPTURE/);
  await writeFile(join(capture, 'index.html'), 'changed bytes');
  await assert.rejects(inventoryWorkingSpiders({ directory: capture, selection: { sha256: [digest] } }), /FREEZE_INPUT_CHANGED/);
});
