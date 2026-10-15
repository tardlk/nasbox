// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { JarArtifactCache } from '../backend/spider-runtime/artifact-cache.mjs';
import { createSpiderRuntime, buildSpiderRuntime } from '../backend/spider-runtime/index.mjs';
import { buildDexFixtures } from '../scripts/compat/dex-fixtures.mjs';
const root=join(import.meta.dirname,'..');
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function child(code,extra={}) {
 const process=spawn(globalThis.process.execPath,['--input-type=module','-e',code],{cwd:root,...extra});
 let buffer='',stderr='';process.stderr.on('data',b=>{stderr+=b;});
 const ready=new Promise((done,reject)=>{process.stdout.on('data',b=>{buffer+=b;if(buffer.includes('\n'))done(JSON.parse(buffer.split('\n')[0]));});process.on('error',reject);process.on('close',code=>reject(Error('Child exited '+code+': '+stderr)));});
 const exited=new Promise(done=>process.once('close',done));
 return {process,ready,exited};
}
async function waitFor(action){let last;for(let i=0;i<50;i++){try{return await action();}catch(error){last=error;await delay(50);}}throw last;}

test('SIGKILL of cache owner releases kernel lease and abandoned writes recover without deleting lock inodes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tvbox-cache-kill-'));let owner;
 try{
  owner=await child(`import{JarArtifactCache}from'./backend/spider-runtime/artifact-cache.mjs';import{writeFileSync}from'node:fs';const c=new JarArtifactCache({directory:${JSON.stringify(dir)}});await c.getState();writeFileSync(c.directory+'/pending-1234.jar','partial');console.log(JSON.stringify({directory:c.directory}));setInterval(()=>{},1000);`);
  const info=await owner.ready;owner.process.kill('SIGKILL');await owner.exited;
  const cache=await waitFor(async()=>{const c=new JarArtifactCache({directory:dir});try{await c.getState();return c;}catch(error){await c.close();throw error;}});
  try{assert.equal(readdirSync(info.directory).includes('pending-1234.jar'),false);assert.equal((await cache.getState()).entries,0);}finally{await cache.close();}
  assert.equal(existsSync(join(info.directory,'.lease')),true);
 }finally{owner?.process.kill('SIGKILL');if(owner)await owner.exited;rmSync(dir,{recursive:true,force:true});}
});

test('live runtime cannot be stolen and parent SIGKILL stops an executing JVM before restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tvbox-worker-kill-'));let owner,pid;
 try{
  owner=await child(`import{createSpiderRuntime}from'./backend/spider-runtime/index.mjs';const r=createSpiderRuntime({dataDir:${JSON.stringify(dir)},timeoutMs:60000});await r.setModules({modules:{'https://fixture.invalid/loop.js':'export default {home(){while(true){}}};'}});const s=await r.getCSP({key:'loop',type:3,api:'https://fixture.invalid/loop.js',ext:'',jar:''});r.call(s.token,'homeContent',[true]).catch(()=>{});console.log(JSON.stringify({pid:r.workerPid}));`);
  pid=(await owner.ready).pid;
  const other=createSpiderRuntime({dataDir:dir});try{await assert.rejects(other.getState(),error=>error.code==='CACHE_ALREADY_OWNED');}finally{await other.close();}
  await delay(150);owner.process.kill('SIGKILL');await owner.exited;
  await waitFor(async()=>{try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')return;}throw Error('Orphan worker still alive');});
  const next=await waitFor(async()=>{const r=createSpiderRuntime({dataDir:dir});try{await r.request({operation:'cacheState'});return r;}catch(error){await r.close();throw error;}});
  try{assert.equal((await next.request({operation:'cacheState'})).bytes,0);}finally{await next.close();}
 }finally{owner?.process.kill('SIGKILL');if(owner)await owner.exited;if(pid)try{process.kill(pid,'SIGKILL');}catch{}rmSync(dir,{recursive:true,force:true});}
});

test('JVM usage guard blocks JAR-cache takeover when its owner closes too early',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tvbox-cache-guard-'));const cache=new JarArtifactCache({directory:dir});const runtime=createSpiderRuntime();
 try{
  await cache.getState();await runtime.request({operation:'artifactLease',guard:cache.guardPath});
  await assert.rejects(cache.close(),error=>error.code==='CACHE_STILL_IN_USE');
  const other=new JarArtifactCache({directory:dir});try{await assert.rejects(other.getState(),error=>error.code==='CACHE_STILL_IN_USE');}finally{await other.close();}
  await runtime.close();const after=new JarArtifactCache({directory:dir});try{assert.equal((await after.getState()).entries,0);}finally{await after.close();}
 }finally{await runtime.close();await cache.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});

test('legacy PID-only locks are not guessed stale and require explicit one-time migration',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tvbox-legacy-lock-'));let cache;
 try{
  cache=new JarArtifactCache({directory:dir});await cache.getState();const path=join(cache.directory,'.lock');await cache.close();writeFileSync(path,'999999');
  cache=new JarArtifactCache({directory:dir});await assert.rejects(cache.getState(),error=>error.code==='LEGACY_JAR_LOCK_REQUIRES_MIGRATION');await cache.close();
  cache=new JarArtifactCache({directory:dir,recoverLegacyLock:true});await cache.getState();assert.equal(existsSync(path),false);
 }finally{await cache?.close();rmSync(dir,{recursive:true,force:true});}
});

test('aggregate runtime budget protects pinned DEX, evicts inactive module entries and preserves previous data on rejection',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tvbox-runtime-budget-')),built=buildSpiderRuntime();
 const code=readFileSync(join(import.meta.dirname,'fixtures/runtime-cache-budget.java.txt'),'utf8');
 try{
  writeFileSync(join(dir,'BudgetProbe.java'),code);const compile=spawnSync(join(built.javaHome,'bin/javac'),['-cp',built.classpath,'-d',dir,join(dir,'BudgetProbe.java')],{encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);
  const run=spawnSync(built.java,['-Dtvbox.cache.maxBytes=2048','-cp',[dir,built.classpath].join(delimiter),'BudgetProbe',dir],{encoding:'utf8',timeout:15000});assert.equal(run.status,0,run.stderr);
  const state=JSON.parse(run.stdout);assert.equal(state.bytes,1964);assert.equal(state.dexBytes,764);assert.equal(state.pinnedDexEntries,1);assert.equal(state.evictedEntries,1);assert.equal(state.rejectedWrites,1);
  assert.equal(readdirSync(join(dir,'dex-cache')).some(n=>n.startsWith('.incoming-')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('real module loader preserves fetched values under quota and reports rejected optional cache writes',async()=>{
 const server=createServer((req,res)=>res.end('x'.repeat(req.url==='/large.js'?2000:600)));await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const runtime=createSpiderRuntime({cacheMaxBytes:1024});const base='http://127.0.0.1:'+server.address().port;
 try{await runtime.setModules({remote:true});for(const name of ['/a.js','/b.js'])assert.equal((await runtime.request({operation:'moduleRead',name:base+name})).length,600);
  assert.equal((await runtime.request({operation:'moduleRead',name:base+'/large.js'})).length,2000);
  const state=await runtime.request({operation:'cacheState'});assert.equal(state.entries,1);assert.ok(state.bytes<=1024);assert.equal(state.rejectedWrites,1);assert.equal(state.evictedEntries,1);
 }finally{await runtime.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
});

test('actual DEX conversion respects persistent quota and discards staging without publishing a partial entry',async()=>{
 const fixtures=buildDexFixtures(),runtime=createSpiderRuntime({cacheMaxBytes:1,timeoutMs:30000});
 try{const loaded=await runtime.loadMain(fixtures.archive);assert.equal(loaded.loaded,false);assert.match(loaded.failure,/RUNTIME_CACHE_QUOTA/);assert.equal((await runtime.request({operation:'cacheState'})).bytes,0);assert.equal(readdirSync(join(runtime.dataDirectory,'tmp')).some(n=>n.startsWith('tvbox-convert-')),false);}
 finally{await runtime.close();fixtures.cleanup();}
});
