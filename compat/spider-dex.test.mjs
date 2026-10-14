import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,mkdtempSync,rmSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {buildDexFixtures} from '../scripts/compat/dex-fixtures.mjs';
import {buildSpiderOracle} from '../scripts/compat/spider-oracle.mjs';
import {spiderCases} from '../scripts/compat/spider-cases.mjs';import {runSpiderCases} from '../scripts/compat/spider-runner.mjs';
import {createSpiderRuntime} from '../backend/spider-runtime/index.mjs';import {dexToolchain} from '../backend/spider-runtime/dex/toolchain.mjs';
import {root} from '../scripts/compat/reference.mjs';import {verifyPlatformReference} from '../scripts/compat/platform-reference.mjs';
const f=buildDexFixtures(),built=f.built;after(()=>f.cleanup());
const source=(key='a',api='csp_Contract',ext='raw',jar='')=>({key,type:3,api,ext,jar});
const runtime=options=>createSpiderRuntime({built,timeoutMs:30000,...options});

test('DEX round trip reproduces all 136 JVM/QuickJS contract observations',async()=>{
 const expected=await runSpiderCases(spiderCases,f),actual=await runSpiderCases(spiderCases,{...f,jar:f.archive});
 for(let i=0;i<spiderCases.length;i++)assert.deepEqual(actual[i],expected[i],spiderCases[i].id);
});
test('raw DEX, disguised archive and multidex resolve classes and preserve resources',async()=>{
 for(const path of[f.raw,f.disguised,f.multi]){const r=runtime();try{
  assert.equal((await r.loadMain(path)).loaded,true,path);const s=await r.getCSP(source());assert.equal(s.ready,true);
  assert.deepEqual(JSON.parse(await r.call(s.token,'homeContent',[true])).trace,['construct:null','initApi:a','init:raw']);
  if(path!==f.raw)assert.equal(await r.call(s.token,'action',['resource']),'fixture-resource');
  assert.equal(await r.call(s.token,'action',['initCount']),'1');
 }finally{await r.close();}}
});
test('per-site DEX artifact dispatch uses original signatures, cache keys and cleanup',async()=>{
 const r=runtime();try{await r.registerJar('https://fixture.invalid/source.jar;md5;owned',f.multi);const s=await r.getCSP(source('site','csp_Contract','extension','https://fixture.invalid/source.jar;md5;owned'));assert.equal(s.ready,true);assert.equal(JSON.parse(await r.call(s.token,'homeContent',[false])).ext,'extension');const cached=await r.getCSP(source('site','csp_Defaults','changed','https://fixture.invalid/source.jar;md5;owned'));assert.equal(cached.token,s.token);await r.clear('jar');assert.equal((await r.getState()).jar.loaderCount,0);}finally{await r.close();}
});
test('unchanged upstream protection scanner handles raw/ZIP and plain/encrypted package whitelists',async()=>{
 const {extra}=verifyPlatformReference();assert.equal(readFileSync(resolve(root,'backend/spider-runtime/src/com/github/catvod/crawler/ProtectedInitJar.java'),'utf8'),readFileSync(resolve(extra,'app/src/main/java/com/github/catvod/crawler/ProtectedInitJar.java'),'utf8'));
 const r=runtime();try{
  for(const [fixture,want] of [[f.protectedFixture,true],[f.nativeFixture,true],[f.plainWhitelist,false],[f.encryptedWhitelist,false]])for(const path of[fixture.raw,fixture.jar])assert.equal(await r.request({operation:'scanProtection',path}),want,path);
  await r.request({operation:'host',packageName:'different.app'});for(const fixture of[f.plainWhitelist,f.encryptedWhitelist])assert.equal(await r.request({operation:'scanProtection',path:fixture.jar}),true);
  assert.equal(await r.request({operation:'scanProtection',path:f.jar}),false);
 }finally{await r.close();}
});
async function protectedRun(built){
 const r=runtime({built});try{
  assert.equal((await r.loadMain(f.protectedFixture.jar)).loaded,true);const s=await r.getCSP(source('guard','csp_Guarded','payload-ext'));assert.equal(s.ready,true);
  assert.equal((await r.request({operation:"dexState"})).nestedLoaderCount,1);
  const result={home:await r.call(s.token,'homeContent',[true]),flags:await r.call(s.token,'action',['flags'])};
  await r.clear('jar');assert.equal((await r.request({operation:'dexState'})).nestedLoaderCount,0);assert.equal((await r.getState()).jar.loaderCount,0);assert.ok((await r.request({operation:'logs'})).includes('payload destroyed:guard'));await assert.rejects(r.call(s.token,'homeContent',[true]),/cleared Spider/);return result;
 }finally{await r.close();}
}
test('protected initialization binds Context and real nested AES DEX loader, then destroys payload',async()=>{
 assert.deepEqual(await protectedRun(built),{home:'payload|guard|payload-ext|true|9978',flags:'com.github.tvbox.osc.jun|0|true|true'});
});
test('fresh pinned protection helper reproduces nested payload execution on the declared host boundary',async()=>{
 const oracle=buildSpiderOracle(built);assert.deepEqual(await protectedRun(oracle),{home:'payload|guard|payload-ext|true|9978',flags:'com.github.tvbox.osc.jun|0|true|true'});
});
test('native-only protected loader remains a failed initialization and does not yield a ready Spider',async()=>{
 const r=runtime();try{const v=await r.loadMain(f.nativeFixture.jar);assert.equal(v.loaded,false);assert.equal(v.failure,'PROTECTED_INIT_UNBOUND');assert.equal((await r.getCSP(source('native','csp_Guarded'))).ready,false);assert.equal((await r.getState()).jar.loaderCount,0);}finally{await r.close();}
});
test('DEX cache survives worker restart, verifies cached digest and rebuilds corrupted products',async()=>{
 const data=mkdtempSync(join(tmpdir(),'tvbox-dex-cache-'));let target,stamp;
 try{
  const first=runtime({dataDir:data});try{assert.equal((await first.loadMain(f.archive)).loaded,true);}finally{await first.close();}
  const dir=join(data,'dex-cache');const name=readdirSync(dir).find(n=>n.endsWith('.jar'));target=join(dir,name);stamp=statSync(target).mtimeMs;
  const second=runtime({dataDir:data});try{assert.equal((await second.loadMain(f.archive)).loaded,true);assert.equal(statSync(target).mtimeMs,stamp);}finally{await second.close();}
  writeFileSync(target,'corrupt');
  const third=runtime({dataDir:data});try{assert.equal((await third.loadMain(f.archive)).loaded,true);const s=await third.getCSP(source());assert.equal(await third.call(s.token,'action',['resource']),'fixture-resource');assert.ok(statSync(target).size>7);assert.equal(readdirSync(dir).some(n=>n.startsWith('convert-')),false);}finally{await third.close();}
 }finally{rmSync(data,{recursive:true,force:true});}
});
test('DEX toolchain is optional for class JARs and fails explicitly for DEX when absent',async()=>{
 const r=runtime({dex:null});try{assert.equal((await r.loadMain(f.archive)).failure,'IOException: DEX_CONVERTER_UNAVAILABLE');assert.equal((await r.loadMain(f.jar)).loaded,true);}finally{await r.close();}
});
test('installed converter hashes are verified before use',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tvbox-dex-tools-'));try{mkdirSync(join(dir,'lib'));writeFileSync(join(dir,'lib/dex-tools-v2.4.jar'),'corrupt');assert.throws(()=>dexToolchain({directory:dir,required:true}),/checksum differs/);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('malformed DEX and packaged native libraries fail without partial caches or retained loaders',async()=>{
 const malformed=f.pack('malformed.jar',{'classes.dex':Buffer.from('dex\n035\0')});const broken=Buffer.alloc(112);broken.write('dex\n035\0');const invalid=f.pack('invalid.jar',{'classes.dex':broken});const native=f.pack('arm.jar',{'classes.dex':readFileSync(f.raw),'lib/arm64-v8a/libfixture.so':'unexecutable fixture'});
 const r=runtime();try{for(const [path,error] of[[malformed,'INVALID_DEX_HEADER'],[invalid,'DEX_CONVERSION_FAILED'],[native,'NATIVE_PLUGIN_UNAVAILABLE']]){const value=await r.loadMain(path);assert.equal(value.loaded,false);assert.ok(value.failure.includes(error));assert.equal((await r.getState()).jar.loaderCount,0);}assert.equal(readdirSync(join(r.dataDirectory,'dex-cache')).some(n=>n.startsWith('convert-')),false);assert.equal((await r.loadMain(f.archive)).loaded,true);}finally{await r.close();}
});
test('duplicate DEX classes are rejected instead of silently selecting an arbitrary definition',async()=>{
 const path=f.pack('duplicate.jar',{'classes.dex':readFileSync(f.raw),'classes2.dex':readFileSync(f.raw)}),r=runtime();try{const value=await r.loadMain(path);assert.equal(value.loaded,false);assert.match(value.failure,/DUPLICATE_DEX_CLASS/);}finally{await r.close();}
});
test('converted JAR resources retain assets and discard stale signature entries',async()=>{
 const r=runtime();try{assert.equal((await r.loadMain(f.archive)).loaded,true);const dir=join(r.dataDirectory,'dex-cache'),path=join(dir,readdirSync(dir).find(n=>n.endsWith('.jar')));
  // Inspect archive entries with the existing JDK, without adding ZIP dependencies.
  const {spawnSync}=await import('node:child_process');const entries=spawnSync(join(built.javaHome,'bin/jar'),['tf',path],{encoding:'utf8'});assert.equal(entries.status,0);assert.match(entries.stdout,/assets\/value.txt/);assert.doesNotMatch(entries.stdout,/OLD.SF|classes.dex/);
 }finally{await r.close();}
});
test('DEX cache identity follows content and toolchain rather than filename',async()=>{
 const data=mkdtempSync(join(tmpdir(),'tvbox-dex-identity-'));
 try{
  const r=runtime({dataDir:data});try{assert.equal((await r.loadMain(f.archive)).loaded,true);await r.clear('jar');assert.equal((await r.loadMain(f.disguised)).loaded,true);assert.equal(readdirSync(join(data,'dex-cache')).filter(n=>n.endsWith('.jar')).length,1);}finally{await r.close();}
  const other=runtime({dataDir:data,dex:{...f.tool,fingerprint:'controlled-other-toolchain'}});try{assert.equal((await other.loadMain(f.archive)).loaded,true);assert.equal(readdirSync(join(data,'dex-cache')).filter(n=>n.endsWith('.jar')).length,2);}finally{await other.close();}
 }finally{rmSync(data,{recursive:true,force:true});}
});
