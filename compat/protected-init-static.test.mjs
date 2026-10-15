// SPDX-License-Identifier: GPL-3.0-only
// Owned nonexecuted DEX table fixtures; no third-party code or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { inspectProtectionDex, summarizeStaticDisassembly, whitelistMatch } from '../scripts/compat/protected-init-static.mjs';

const PACKAGE = 'com.github.tvbox.osc.jun';
function dexTable({ kill = true, whitelist = 'owned no-match constant' } = {}) {
  const strings = ['Lcom/github/catvod/spider/Init;', 'Lcom/github/catvod/spider/Init$Worker;',
    'Landroid/os/Process;', 'Ljava/lang/Object;', 'Landroid/content/Context;', 'V', 'I', 'init', 'run', 'killProcess', whitelist];
  const bytes = Buffer.alloc(2048); bytes.write('dex\n035\0', 'ascii');
  const u16 = (offset, value) => bytes.writeUInt16LE(value, offset);
  const u32 = (offset, value) => bytes.writeUInt32LE(value, offset);
  const uleb = value => { const out = []; do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; out.push(byte); } while (value); return out; };
  const stringOffset = 112, typeOffset = 160, protoOffset = 192, methodOffset = 232, classOffset = 256;
  for (const [a, b] of [[56, strings.length], [60, stringOffset], [64, 7], [68, typeOffset], [72, 3], [76, protoOffset],
    [80, 0], [84, 0], [88, 3], [92, methodOffset], [96, 2], [100, classOffset]]) u32(a, b);
  let cursor = 400;
  strings.forEach((value, index) => { u32(stringOffset + index * 4, cursor); const data = Buffer.from([...uleb(value.length), ...Buffer.from(value), 0]); data.copy(bytes, cursor); cursor += data.length; });
  for (let i = 0; i < 7; i++) u32(typeOffset + i * 4, i);
  for (let i = 0; i < 3; i++) { u32(protoOffset + i * 12 + 4, 5); u32(protoOffset + i * 12 + 8, i < 2 ? 800 + i * 8 : 0); }
  u32(800, 1); u16(804, 4); u32(808, 1); u16(812, 6);
  [[0, 0, 7], [2, 1, 9], [1, 2, 8]].forEach(([type, proto, name], i) => { u16(methodOffset + i * 8, type); u16(methodOffset + i * 8 + 2, proto); u32(methodOffset + i * 8 + 4, name); });
  for (const [i, type, data] of [[0, 0, 900], [1, 1, 920]]) { u32(classOffset + i * 32, type); u32(classOffset + i * 32 + 8, 3); u32(classOffset + i * 32 + 24, data); }
  Buffer.from([0, 0, 1, 0, 0, 9, ...uleb(1024)]).copy(bytes, 900);
  Buffer.from([0, 0, 1, 0, 2, 1, ...uleb(1100)]).copy(bytes, 920);
  u32(1024 + 12, 3); u16(1024 + 16, 0x001a); u16(1024 + 18, 10); u16(1024 + 20, 0x000e);
  u32(1100 + 12, 4); u16(1100 + 16, kill ? 0x0071 : 0x000e); u16(1100 + 18, 1); u16(1100 + 20, 0); u16(1100 + 22, 0x000e);
  return bytes;
}

test('static scanner records the exact Init child killProcess heuristic separately from shell/native conclusions', () => {
  const report = inspectProtectionDex(dexTable());
  assert.equal(report.hasExactInit, true); assert.equal(report.hasKillProcess, true);
  assert.equal(report.whitelistAccepted, false); assert.equal(report.heuristicProtected, true);
  assert.equal(report.dexNativeDefined, false); assert.equal(report.allNativeMethods, 0);
  assert.equal(report.initClasses.find(cls => cls.descriptor.includes('$Worker')).killMatches[0].target, 'Landroid/os/Process;->killProcess(I)V');
  assert.equal(inspectProtectionDex(dexTable({ kill: false })).heuristicProtected, false);
});

test('literal and encrypted Init whitelist constants suppress the fixed protection heuristic without publishing values', () => {
  assert.equal(whitelistMatch(PACKAGE), 'literal');
  assert.equal(whitelistMatch('other.package, ' + PACKAGE + ' '), 'literal');
  const key = Buffer.from('1234123412341234'), cipher = createCipheriv('aes-128-cbc', key, key);
  const encoded = Buffer.concat([cipher.update(Buffer.from('other.package,' + PACKAGE)), cipher.final()]).toString('base64');
  assert.equal(whitelistMatch(encoded), 'aes-cbc-whitelist');
  assert.equal(whitelistMatch('not-base64'), null);
  const literal = inspectProtectionDex(dexTable({ whitelist: PACKAGE }));
  assert.equal(literal.whitelistAccepted, true); assert.equal(literal.heuristicProtected, false);
  assert.equal(JSON.stringify(literal).includes(PACKAGE), false);
  assert.equal(inspectProtectionDex(dexTable({ whitelist: encoded })).whitelistAccepted, true);
});

test('static DEX parser rejects malformed ranges and excessive tables before allocating', () => {
  assert.throws(() => inspectProtectionDex(Buffer.from('short')), /PROTECTED_STATIC_DEX/);
  const huge = dexTable(); huge.writeUInt32LE(0xffffffff, 56);
  assert.throws(() => inspectProtectionDex(huge), /PROTECTED_STATIC_DEX_COUNT/);
  const bad = dexTable(); bad.writeUInt32LE(2047, 60);
  assert.throws(() => inspectProtectionDex(bad), /PROTECTED_STATIC_DEX_RANGE/);
});

test('disassembly summary detects a ClassNotFound handler returning a constant and never reports string literals', () => {
  const text = `.method private bindDexLoader(Ljava/lang/Class;Ljava/lang/Object;)Z
 .registers 3
 const/4 v1, 1
 :L0
 const-string v0, "com.github.catvod.spider.DexNative"
 :L1
 return v1
 :L2
 return v1
 .catch Ljava/lang/ClassNotFoundException; { :L0 .. :L1 } :L2
.end method
`;
  const summary = summarizeStaticDisassembly(text);
  assert.deepEqual(summary.methods[0].classNotFoundCatchDirectReturns, [true]);
  assert.deepEqual(summary.methods[0].classNotFoundCatchHandlerOpcodes, [['return v1']]);
  assert.equal(summary.methods[0].dexNativeNameConstant, true);
  assert.equal(JSON.stringify(summary).includes('com.github.catvod.spider.DexNative'), false);
  const overwritten = text.replace(' :L1', ' move-result v1\n :L1');
  assert.deepEqual(summarizeStaticDisassembly(overwritten).methods[0].classNotFoundCatchDirectReturns, ['unresolved']);
});
