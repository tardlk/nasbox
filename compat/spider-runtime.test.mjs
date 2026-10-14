import test from'node:test';import assert from'node:assert/strict';
import{readFileSync,existsSync,mkdtempSync,rmSync,writeFileSync,mkdirSync}from'node:fs';import{resolve,join}from'node:path';import{tmpdir}from'node:os';import{spawnSync}from'node:child_process';
import{root,reference}from'../scripts/compat/reference.mjs';import{verifyPlatformReference}from'../scripts/compat/platform-reference.mjs';import{extractMethod}from'../scripts/compat/oracle.mjs';
import{buildSpiderFixtures}from'../scripts/compat/spider-fixtures.mjs';import{buildSpiderOracle}from'../scripts/compat/spider-oracle.mjs';import{spiderCases}from'../scripts/compat/spider-cases.mjs';import{runSpiderCases}from'../scripts/compat/spider-runner.mjs';
import{createSpiderRuntime,SpiderRuntimeError}from'../backend/spider-runtime/index.mjs';import{createExecutableSubscriptionSession}from'../backend/spider-runtime/session.mjs';import{MemorySubscriptionStore}from'../backend/subscription/store.mjs';
const fixtures=buildSpiderFixtures(),built=fixtures.built;
const source=(key,api,ext='',jar='')=>({key,type:3,api,ext,jar});
const frozen=JSON.parse(readFileSync(resolve(root,'compat/fixtures/spider-observations.json'),'utf8'));

test('actual class-JAR/QuickJS runtime matches 136 frozen source-method observations',async()=>{
 assert.deepEqual(frozen.cases.map(({id,request})=>({id,request})),spiderCases);
 const values=await runSpiderCases(spiderCases,fixtures);
 for(const[i,c]of frozen.cases.entries())assert.deepEqual(values[i],c.expected,c.id);
});
test('fresh pinned source probe reproduces the 136 frozen runtime observations',async()=>{
 const values=await runSpiderCases(spiderCases,fixtures,buildSpiderOracle(built));
 for(const[i,c]of frozen.cases.entries())assert.deepEqual(values[i],c.expected,c.id);
});
test('Spider/SpiderApi ABI, router and selected loader bodies remain tied to the pinned source',()=>{
 const runtime=resolve(root,'backend/spider-runtime/src');
 for(const name of['Spider','SpiderApi'])assert.equal(readFileSync(join(runtime,`com/github/catvod/crawler/${name}.java`),'utf8'),readFileSync(resolve(reference,`app/src/main/java/com/github/catvod/crawler/${name}.java`),'utf8'));
 const api=readFileSync(resolve(reference,'app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java'),'utf8');assert.equal(extractMethod(readFileSync(join(runtime,'tvbox/runtime/CspRouter.java'),'utf8'),'public Spider getCSP('),extractMethod(api,'public Spider getCSP('));
 const jar=readFileSync(resolve(reference,'app/src/main/java/com/github/catvod/crawler/JarLoader.java'),'utf8'),host=readFileSync(join(runtime,'tvbox/runtime/JarExecutor.java'),'utf8');
 for(const{signature}of frozen.extraction.jarMethods)assert.equal(extractMethod(host,signature.replaceAll('DexClassLoader','JvmJarClassLoader')),extractMethod(jar,signature).replaceAll('DexClassLoader','JvmJarClassLoader'));
 const{extra}=verifyPlatformReference();const original=readFileSync(resolve(extra,'app/src/main/java/com/github/catvod/crawler/JsLoader.java'),'utf8');
 for(const{signature}of frozen.extraction.jsLoaderMethods)assert.equal(extractMethod(readFileSync(join(runtime,'tvbox/runtime/JsExecutor.java'),'utf8'),signature),extractMethod(original,signature));
 const js=readFileSync(join(runtime,'com/github/catvod/crawler/js/JsSpider.java'),'utf8').replace('\n        // Host resource bounds, applied before any module is compiled or executed.\n        ctx.setMemoryLimit(64 * 1024 * 1024);\n        ctx.setMaxStackSize(512 * 1024);','');assert.equal(js,readFileSync(resolve(reference,'app/src/main/java/com/github/catvod/crawler/js/JsSpider.java'),'utf8'));
});
test('JAR initialization order, resource access, retained instance state and destroy failures execute for real',async()=>{
 const r=createSpiderRuntime({built});try{
  assert.equal((await r.loadMain(fixtures.jar)).loaded,true);const s=await r.getCSP(source('a','csp_Contract','original'));
  const first=JSON.parse(await r.call(s.token,'homeContent',[true]));assert.deepEqual(first.trace,['construct:null','initApi:a','init:original']);
  assert.equal(await r.call(s.token,'action',['resource']),'fixture-resource');
  const cached=await r.getCSP(source('a','csp_Defaults','changed'));assert.equal(cached.token,s.token);assert.equal(JSON.parse(await r.call(cached.token,'homeContent',[false])).ext,'original');
  await r.getCSP(source('bad-destroy','csp_DestroyFailure'));await r.call(s.token,'cancelByTag');await r.clear('jar');
  const logs=await r.request({operation:'logs'});assert.ok(logs.includes('cancel:a'));assert.ok(logs.includes('destroy:a'));assert.equal((await r.getState()).jar.spiderCount,0);
  await assert.rejects(r.call(s.token,'homeContent',[true]),e=>e instanceof SpiderRuntimeError&&e.errorType==='java.lang.IllegalStateException');
 }finally{await r.close();}
});
test('QuickJS cat/default/legacy modules, relative imports, Promise and exact result casts execute for real',async()=>{
 const r=createSpiderRuntime({built});try{
  await r.setModules({modules:fixtures.modules});const s=await r.getCSP(source('js','https://fixture.invalid/contract.js','raw'));
  assert.equal(s.ready,true);const home=JSON.parse(await r.call(s.token,'homeContent',[true]));assert.equal(home.extension,'raw');assert.equal(home.marker,'relative-module');
  assert.equal(JSON.parse(await r.call(s.token,'detailContent',[['first','ignored']])).args[0],'first');assert.equal(await r.call(s.token,'detailContent',[[]]),null);
  const proxy=await r.call(s.token,'proxyLocal',[{}]);assert.equal(proxy[2].bytes,'AID/');assert.equal(proxy[2].length,3);
  const p=await r.getCSP(source('p','https://fixture.invalid/promises.js'));assert.deepEqual(JSON.parse(await r.call(p.token,'homeContent',[true])),{filter:true,promise:true});assert.equal(await r.call(p.token,'searchContent',['reject',false]),null);
  const types=await r.getCSP(source('types','https://fixture.invalid/return-types.js'));assert.equal(await r.call(types.token,'homeContent',[true]),null);assert.equal(await r.call(types.token,'manualVideoCheck'),false);
  const cat=await r.getCSP(source('cat','https://fixture.invalid/cat.js','{"v":1}'));assert.deepEqual(JSON.parse(await r.call(cat.token,'homeContent',[false])),{config:{stype:3,skey:'cat',ext:{v:1}},filter:false,cat:true});
 }finally{await r.close();}
});
test('JS local survives real worker restart using a caller-owned data directory',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tvbox-spider-store-'));
 const first=createSpiderRuntime({built,dataDir:dir});try{await first.setModules({modules:fixtures.modules});const sp=await first.getCSP(source('a','https://fixture.invalid/contract.js'));assert.equal(await first.call(sp.token,'action',['store']),'persisted');}finally{await first.close();}
 const second=createSpiderRuntime({built,dataDir:dir});try{await second.setModules({modules:fixtures.modules});const sp=await second.getCSP(source('a','https://fixture.invalid/contract.js'));assert.equal(await second.call(sp.token,'action',['read']),'persisted');}finally{await second.close();rmSync(dir,{recursive:true,force:true});}
});
test('ordinary JSON-object JS init thread behavior remains an observation, while cat cfg init receives an object',async()=>{
 const r=createSpiderRuntime({built});try{
  await r.setModules({modules:fixtures.modules});const sp=await r.getCSP(source('ordinary','https://fixture.invalid/contract.js','{"v":1}'));
  // Original JsSpider parses an object outside its owning QuickJS thread and catches
  // the exception. This source/JVM observation is not asserted as Android/ART behavior.
  assert.equal(JSON.parse(await r.call(sp.token,'homeContent',[true])).extension,'unset');
 }finally{await r.close();}
});
test('truncated DEX artifacts remain rejected before Spider initialization',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'tvbox-dex-fixture-'));const r=createSpiderRuntime({built});
 try{
  writeFileSync(join(directory,'classes.dex'),Buffer.from('dex\n035\0'));
  const jar=join(directory,'dex.jar');const pack=spawnSync(join(built.javaHome,'bin/jar'),['--create','--file',jar,'-C',directory,'classes.dex'],{encoding:'utf8'});assert.equal(pack.status,0);
  assert.equal((await r.loadMain(jar)).loaded,false);assert.equal((await r.getCSP(source('unsupported','csp_Contract'))).ready,false);
 }finally{await r.close();rmSync(directory,{recursive:true,force:true});}
});
test('runtime start failure, oversize input, and owned temporary data cleanup are bounded',async()=>{
 const invalid=createSpiderRuntime({built:{...built,java:resolve(root,'.cache/no-java')}});const dir=invalid.dataDirectory;
 try{await assert.rejects(invalid.getState(),/ENOENT/);}finally{await invalid.close();}assert.equal(existsSync(dir),false);
 const r=createSpiderRuntime({built,maxBytes:1024});try{await assert.rejects(r.query({operation:'route',api:'x'.repeat(1024)}),/size limit/);assert.equal(await r.request({operation:'route',api:'demo.js'}),'js');}finally{await r.close();}
});
test('nonterminating QuickJS code is killed and its temporary data is removed',async()=>{
 const r=createSpiderRuntime({built,timeoutMs:1500});const dir=r.dataDirectory;
 try{await r.setModules({modules:{'https://fixture.invalid/loop.js':'export default {home(){while(true){}}}'} });const s=await r.getCSP(source('loop','https://fixture.invalid/loop.js'));await assert.rejects(r.call(s.token,'homeContent',[true]),/timed out/);await assert.rejects(r.getState(),/timed out/);}finally{await r.close();}assert.equal(existsSync(dir),false);
});
test('an unresolved JS Promise is also bounded by process timeout',async()=>{
 const r=createSpiderRuntime({built,timeoutMs:1500});try{await r.setModules({modules:{'https://fixture.invalid/pending.js':'export default {home(){return new Promise(()=>{})}}'} });const s=await r.getCSP(source('pending','https://fixture.invalid/pending.js'));await assert.rejects(r.call(s.token,'homeContent',[true]),/timed out/);}finally{await r.close();}
});
test('subscription to lazy JAR/JS calls clears actual runtime instances before reimport',async()=>{
 const runtime=createSpiderRuntime({built});let generation=0;
 const payload=()=>JSON.stringify({spider:'fixture-main',sites:[{key:'java',type:3,api:'csp_Contract',ext:'generation-'+generation},{key:'js',type:3,api:'https://fixture.invalid/contract.js',ext:'js-'+generation},{key:'py',type:3,api:'https://fixture.invalid/test.py'}]});
 const session=await createExecutableSubscriptionSession({runtime,artifacts:{'fixture-main':fixtures.jar},modules:fixtures.modules,store:new MemorySubscriptionStore(),fetchText:async()=>payload()});
 try{
  assert.equal((await session.load({apiUrl:'http://config.invalid/main'})).ok,true);
  const java=await session.call('java','homeContent',[true]),js=await session.call('js','homeContent',[true]);assert.equal(JSON.parse(java.value).ext,'generation-0');assert.equal(JSON.parse(js.value).extension,'js-0');
  await assert.rejects(session.getCSP('py'),/Python execution is not implemented/);assert.equal((await session.getState()).runtime.currentPyKey,'py');
  generation++;assert.equal((await session.load()).ok,true);const state=await session.getState();assert.equal(state.runtime.currentPyKey,'');assert.equal(state.runtime.jar.spiderCount,0);assert.equal(state.runtime.js.spiderCount,0);
  const next=await session.call('java','homeContent',[true]);assert.notEqual(next.spider.token,java.spider.token);assert.equal(JSON.parse(next.value).ext,'generation-1');assert.equal(JSON.parse(next.value).calls,1);
  assert.ok((await runtime.request({operation:'logs'})).includes('destroy:java'));
 }finally{await session.close();await runtime.close();}
});
test('CLI starts and exits actual JAR/JS workers with clean JSON output',()=>{
 for(const args of[
  ['--jar',fixtures.jar,'--api','csp_Contract','--method','homeContent','--args','[true]','--ext','cli-jar'],
  ['--js',resolve(root,'compat/spiders/js/contract.js'),'--method','homeContent','--args','[false]','--ext','cli-js'],
 ]){
  const run=spawnSync(process.execPath,['backend/spider-runtime/cli.mjs',...args],{cwd:root,encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);const value=JSON.parse(run.stdout);assert.equal(value.ready,true);const result=JSON.parse(value.value);assert.equal(result.calls,1);
 }
});

test('concurrent session close disposes both owned runtimes without racing worker shutdown',async()=>{
 const session=await createExecutableSubscriptionSession({artifacts:{'main':fixtures.jar},modules:fixtures.modules,fetchText:async()=>'{spider:"main",sites:[{key:"java",type:3,api:"csp_Contract"},{key:"js",type:3,api:"https://fixture.invalid/contract.js"}]}'});
 try{assert.equal((await session.load({apiUrl:'http://config.invalid/a'})).ok,true);await session.call('java','homeContent',[true]);await session.call('js','homeContent',[true]);}
 finally{await Promise.all([session.close(),session.close()]);}
 await assert.rejects(session.getConfig(),/closed/);
});
