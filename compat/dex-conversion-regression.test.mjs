// SPDX-License-Identifier: GPL-3.0-only
// Owned, minimal DEX programs; captured provider code is never executed here.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSpiderRuntime } from '../backend/spider-runtime/build.mjs';
import { createSpiderRuntime } from '../backend/spider-runtime/index.mjs';
import { dexToolchain } from '../backend/spider-runtime/dex/toolchain.mjs';

const built = buildSpiderRuntime(), tool = dexToolchain({ required: true });
const directory = mkdtempSync(join(tmpdir(), 'tvbox-dex-zero-branch-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const helper = join(directory, 'OwnedDex.java');
writeFileSync(helper, `import java.nio.file.*;
import com.googlecode.d2j.smali.Smali;
import com.googlecode.d2j.dex.writer.DexFileWriter;
import com.googlecode.d2j.dex.Dex2jar;
class OwnedDex {
 public static void main(String[] args)throws Exception {
  if(args[0].equals("build")){DexFileWriter writer=new DexFileWriter();Smali.smaliFile(Path.of(args[1]),writer);Files.write(Path.of(args[2]),writer.toByteArray());}
  else try{Dex2jar.from(Files.readAllBytes(Path.of(args[1]))).to(Path.of(args[2]));System.out.println("converted");}
  catch(Exception failure){for(Throwable cause=failure;cause!=null;cause=cause.getCause())if(cause.getMessage()!=null)System.out.println(cause.getMessage());}
 }
}`);
function command(...args) {
 const result = spawnSync(built.java, ['-Xmx256m', '-cp', tool.classpath, helper, ...args], { encoding: 'utf8', timeout: 30000 });
 assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
 return result.stdout;
}
function fixture(name, methods) {
 const smali = join(directory, name + '.smali'), dex = join(directory, name + '.dex');
 writeFileSync(smali, `.class public Lcom/github/catvod/spider/${name};
.super Lcom/github/catvod/crawler/Spider;
.method public constructor <init>()V
 .registers 1
 invoke-direct {p0}, Lcom/github/catvod/crawler/Spider;-><init>()V
 return-void
.end method
${methods}`);
 command('build', smali, dex);
 return dex;
}
const good = fixture('ZeroBranch', `
.method public homeContent(Z)Ljava/lang/String;
 .registers 2
 if-eqz p1, :zero
 const-string v0, "nonzero"
 return-object v0
 :zero
 invoke-static {p1}, Ljava/lang/String;->valueOf(Ljava/lang/Object;)Ljava/lang/String;
 move-result-object v0
 return-object v0
.end method
.method public action(Ljava/lang/String;)Ljava/lang/String;
 .registers 5
 invoke-virtual {p1}, Ljava/lang/String;->isEmpty()Z
 move-result v0
 if-nez v0, :nonzero
 invoke-static {v0}, Ljava/lang/String;->valueOf(Ljava/lang/Object;)Ljava/lang/String;
 move-result-object v1
 invoke-static {v0}, Ljava/lang/String;->valueOf(Z)Ljava/lang/String;
 move-result-object v2
 invoke-virtual {v1, v2}, Ljava/lang/String;->concat(Ljava/lang/String;)Ljava/lang/String;
 move-result-object v1
 return-object v1
 :nonzero
 const-string v1, "nonzero"
 return-object v1
.end method
.method public homeVideoContent()Ljava/lang/String;
 .registers 2
 :try_start
 new-instance v0, Ljava/lang/IllegalStateException;
 const-string v1, "caught"
 invoke-direct {v0, v1}, Ljava/lang/IllegalStateException;-><init>(Ljava/lang/String;)V
 throw v0
 :try_end
 .catch Ljava/lang/IllegalStateException; {:try_start .. :try_end} :handler
 :handler
 move-exception v0
 invoke-virtual {v0}, Ljava/lang/Throwable;->getMessage()Ljava/lang/String;
 move-result-object v0
 return-object v0
.end method
`);
const joined = fixture('JoinedBranch', `
.method public homeContent(Z)Ljava/lang/String;
 .registers 2
 if-eqz p1, :joined
 goto :joined
 :joined
 invoke-static {p1}, Ljava/lang/String;->valueOf(Ljava/lang/Object;)Ljava/lang/String;
 move-result-object v0
 return-object v0
.end method
`);
const handler = fixture('HandlerBranch', `
.method public homeContent(Z)Ljava/lang/String;
 .registers 2
 :try_start
 invoke-static {}, Ljava/lang/System;->gc()V
 :try_end
 .catch Ljava/lang/Throwable; {:try_start .. :try_end} :zero
 if-eqz p1, :zero
 const-string v0, "nonzero"
 return-object v0
 :zero
 invoke-static {p1}, Ljava/lang/String;->valueOf(Ljava/lang/Object;)Ljava/lang/String;
 move-result-object v0
 return-object v0
.end method
`);
const degenerate = fixture('SameSuccessor', `
.method public homeContent(Z)Ljava/lang/String;
 .registers 2
 if-eqz p1, :same
 :same
 invoke-static {p1}, Ljava/lang/String;->valueOf(Ljava/lang/Object;)Ljava/lang/String;
 move-result-object v0
 return-object v0
.end method
`);
const switched = fixture('SwitchPredecessor', `
.method public homeContent(Z)Ljava/lang/String;
 .registers 2
 const/4 v0, 0
 packed-switch v0, :targets
 if-eqz p1, :zero
 const-string v0, "nonzero"
 return-object v0
 :zero
 invoke-static {p1}, Ljava/lang/String;->valueOf(Ljava/lang/Object;)Ljava/lang/String;
 move-result-object v0
 return-object v0
 :targets
 .packed-switch 0
  :zero
 .end packed-switch
.end method
`);

test('owned zero-branch DEX reproduces the pinned converter boolean/reference inference failure', () => {
 assert.match(command('convert', good, join(directory, 'baseline.jar')), /Can't merge (?:L and Z|Z and L)/);
});

test('zero branches preserve null, boolean reuse and both nonzero paths under JVM verification', async () => {
 const runtime = createSpiderRuntime({ built, timeoutMs: 30000 });
 try {
  assert.equal((await runtime.loadMain(good)).loaded, true);
  const spider = await runtime.getCSP({ key: 'zero', type: 3, api: 'csp_ZeroBranch', ext: '' });
  assert.equal(spider.ready, true);
  assert.equal(await runtime.call(spider.token, 'homeContent', [false]), 'null');
  assert.equal(await runtime.call(spider.token, 'homeContent', [true]), 'nonzero');
  assert.equal(await runtime.call(spider.token, 'action', ['nonempty']), 'nullfalse');
  assert.equal(await runtime.call(spider.token, 'action', ['']), 'nonzero');
  assert.equal(await runtime.call(spider.token, 'homeVideoContent', []), 'caught');
 } finally { await runtime.close(); }
});

for (const [name, input] of [['a second control-flow predecessor', joined], ['an exception-handler predecessor', handler], ['both branch outcomes reaching one successor', degenerate], ['a switch predecessor', switched]]) {
 test('zero-branch inference rejects ' + name + ' without a partial cache or loader', async () => {
  const runtime = createSpiderRuntime({ built, timeoutMs: 30000 });
  try {
   const loaded = await runtime.loadMain(input);
   assert.equal(loaded.loaded, false);
   assert.match(loaded.failure, /DEX_CONVERSION_FAILED/);
   assert.equal((await runtime.getState()).jar.loaderCount, 0);
   assert.equal(readdirSync(join(runtime.dataDirectory, 'dex-cache')).some(name => name.endsWith('.jar')), false);
   assert.equal(readdirSync(runtime.dataDirectory).some(name => name.startsWith('convert-')), false);
  } finally { await runtime.close(); }
 });
}
