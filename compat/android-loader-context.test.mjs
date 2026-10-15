// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loaderContextOf,assertLoaderIdentity,officialOracleApkSha256} from '../scripts/android/loader-context.mjs';
import {replayCase,replayBudgetsOf} from '../scripts/android/replay-nas.mjs';
import {oracleBudgetsOf,oracleStatePolicyOf,prepareOracleAppState,oracleInstrumentationArguments} from '../scripts/android/run-oracle.mjs';
import {buildSpiderFixtures} from '../scripts/compat/spider-fixtures.mjs';
import {createSpiderRuntime} from '../backend/spider-runtime/index.mjs';
import {readFile} from 'node:fs/promises';

const sha=value=>createHash('sha256').update(value).digest('hex');
const signature='https://fixture.invalid/规则.jar;md5; abcdef';
const artifact={id:sha('site'),sha256:sha('site'),jarPath:'site.jar'};
const main={sha256:sha('main'),jarPath:'main.jar',jarUrl:'http://fixture.invalid/main.jar',signature:'https://fixture.invalid/main.jar'};
const site={key:'owned-key',api:'csp_Owned',ext:'exact private ext',jar:signature,loaderContext:{role:'site',signature,main}};

test('loader identities preserve full original signature and low-byte Java MD5 keys',()=>{
 const context=loaderContextOf(artifact,site),bytes=Buffer.from(Array.from(signature,char=>char.charCodeAt(0)&255));
 assert.equal(context.identity.jarLoadKey,createHash('md5').update(bytes).digest('hex'));
 assert.notEqual(context.identity.jarLoadKey,createHash('md5').update(signature).digest('hex'));
 assert.equal(context.identity.jarSignatureSha256,sha(signature));
 assert.equal(context.identity.mainJarSha256,main.sha256);
 assert.equal(context.identity.mainSignatureSha256,sha(main.signature));
 assert.equal(context.source,'https://fixture.invalid/规则.jar');
 assert.equal(loaderContextOf(artifact,{...site,loaderContext:{role:'main',signature:'original main'},jar:''}).identity.jarLoadKey,'main');
 assert.equal(loaderContextOf(artifact,{key:'legacy',api:'csp_Owned',ext:''}).legacy,true);
});

test('legacy main compatibility never permits new context identity substitutions',()=>{
 assert.doesNotThrow(()=>assertLoaderIdentity({loaderMode:'main'},artifact,{key:'legacy',api:'csp_Owned',ext:''}));
 const identity=loaderContextOf(artifact,site).identity;
 assert.doesNotThrow(()=>assertLoaderIdentity(identity,artifact,site));
 for(const field of Object.keys(identity)){
  assert.throws(()=>assertLoaderIdentity({...identity,[field]:'wrong'},artifact,site),/context differs/);
  const absent={...identity};delete absent[field];assert.throws(()=>assertLoaderIdentity(absent,artifact,site),/context differs/);
 }
 assert.throws(()=>loaderContextOf(artifact,{...site,jar:'changed'}),/signature/);
 assert.throws(()=>loaderContextOf(artifact,{...site,expectedLoaderIdentity:{...identity,mainJarSha256:sha('changed')}}),/planned/);
 assert.throws(()=>loaderContextOf(artifact,{...site,loaderContext:{role:'main',signature:'main',main},jar:''}),/main artifact/);
});

test('ART and NAS stage and total budgets are explicit and validated separately',()=>{
 assert.deepEqual(oracleBudgetsOf({artBudgets:{caseMs:500000,loadMs:45000}}),{caseMs:500000,loadMs:45000,initMs:30000,callMs:30000});
 assert.deepEqual(replayBudgetsOf({nasBudgets:{caseMs:600000,initMs:12000}}),{caseTimeoutMs:600000,loadTimeoutMs:90000,initTimeoutMs:12000,callTimeoutMs:30000});
 assert.throws(()=>oracleBudgetsOf({artBudgets:{loadMs:0}}),/budget/);
 assert.throws(()=>replayBudgetsOf({nasBudgets:{unknown:1}}),/budget/);
});

test('ART fresh app state clears only the target and must succeed before instrumentation arguments are used',()=>{
 assert.equal(oracleStatePolicyOf(), 'cold-process-preserve-data');
 assert.equal(oracleStatePolicyOf({artStatePolicy:'fresh-app-data'}), 'fresh-app-data');
 assert.throws(()=>oracleStatePolicyOf({artStatePolicy:'provider-choice'}),/state policy/);
 const calls=[],command=args=>{calls.push(args);return{status:0,stdout:args[1]==='pm'?'Success\n':''};};
 assert.equal(prepareOracleAppState(command,'fresh-app-data'),'fresh-app-data');
 assert.deepEqual(calls,[['shell','am','force-stop','com.github.tvbox.osc.jun'],['shell','pm','clear','com.github.tvbox.osc.jun']]);
 calls.length=0;prepareOracleAppState(command,'cold-process-preserve-data');assert.equal(calls.length,1);
 for(const failure of [{status:1,stdout:'Success'},{status:0,stdout:'Failed'},{status:0,stdout:'',error:{code:'ETIMEDOUT'}}]){
  const invoked=[];
  assert.throws(()=>prepareOracleAppState(args=>{invoked.push(args);return args[1]==='am'?{status:0}:failure;},'fresh-app-data'),/ART_STATE_CLEAR_FAILED/);
  assert.equal(invoked.length,2);
 }
 const stopped=[];
 assert.throws(()=>prepareOracleAppState(args=>{stopped.push(args);return{status:1};},'fresh-app-data'),/ART_STATE_FORCE_STOP_FAILED/);
 assert.equal(stopped.length,1);
 const budgets=oracleBudgetsOf({artBudgets:{caseMs:150000,loadMs:90000,initMs:10000,callMs:10000}});
 const args=oracleInstrumentationArguments({base:'http://10.0.2.2:18765',manifestSha256:sha('plan'),artifactIndex:1,siteIndex:2,budgets,applicationStatePolicy:'fresh-app-data'});
 assert.equal(args[args.indexOf('appDataPolicy')+1],'fresh-app-data');assert.equal(args[args.indexOf('caseTimeoutMs')+1],'150000');
 assert.equal(args[args.indexOf('loadTimeoutMs')+1],'90000');assert.equal(args[args.indexOf('initTimeoutMs')+1],'10000');
 assert.equal(args[args.indexOf('callTimeoutMs')+1],'10000');
 assert.ok(!args.includes('grant'));
});

test('NAS role replay verifies both inputs before one runtime loads main then original site signature',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tvbox-role-replay-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const jarPath=join(directory,'site.jar'),mainJarPath=join(directory,'main.jar');
 await writeFile(jarPath,'site');await writeFile(mainJarPath,'main');
 const calls=[],identity=loaderContextOf(artifact,site).identity;
 const android={report:{artifactIndex:0,siteIndex:0,manifestSha256:sha('plan'),targetApkSha256:officialOracleApkSha256,symbolMapSha256:sha('audited map'),...identity},privateCalls:[{method:'homeContent',params:[true]}]};
 let created=0;
 const factory=()=>{created++;return{
  request:async()=>({enabled:false}),loadMain:async path=>{calls.push(['main',path]);return{loaded:true};},
  registerJar:async(...args)=>calls.push(['register',...args]),setModules:async()=>{},
  getCSP:async value=>{calls.push(['get',value.jar,value.ext]);return{ready:true,token:'owned',className:'fixture.Spider'};},
  getState:async()=>({jar:{loaderCount:2}}),call:async()=>'{"class":[]}',close:async()=>calls.push(['close']),
 };};
 const value=await replayCase({caseId:'0-0',artifact,site,android,jarPath,mainJarPath},{runtimeFactory:factory,workRoot:directory});
 assert.equal(value.report.error,undefined);assert.equal(value.report.loadSuccess,true);assert.equal(value.report.initSuccess,true);
 assert.equal(value.report.mainLoad.loaded,true);assert.equal(value.report.selectedLoad.includesSpiderInit,true);
 assert.equal(value.report.jarBytesVerified,true);assert.equal(value.report.mainJarBytesVerified,true);
 assert.deepEqual(calls.slice(0,3),[['main',mainJarPath],['register',signature,jarPath],['get',signature,site.ext]]);
 assert.equal(value.report.calls.length,1);assert.equal(value.report.cleanup.closed,true);
 assert.equal(value.report.applicationStatePolicy,'fresh-runtime-data');
 await writeFile(mainJarPath,'changed');
 const rejected=await replayCase({caseId:'0-0',artifact,site,android,jarPath,mainJarPath},{runtimeFactory:factory,workRoot:directory});
 assert.equal(rejected.report.error.stage,'input');assert.equal(rejected.report.error.category,'input');assert.equal(created,1);
 assert.equal(rejected.report.applicationStatePolicy,undefined);
});

test('NAS main failure prevents site execution and site timeout leaves loading unresolved',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tvbox-role-failure-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const jarPath=join(directory,'site.jar'),mainJarPath=join(directory,'main.jar');
 await writeFile(jarPath,'site');await writeFile(mainJarPath,'main');
 const android={report:{artifactIndex:0,siteIndex:0,manifestSha256:sha('plan'),targetApkSha256:officialOracleApkSha256,symbolMapSha256:sha('map'),...loaderContextOf(artifact,site).identity},privateCalls:[]};
 const events=[];
 const factory=mainLoaded=>()=>({
  request:async()=>({enabled:false}),loadMain:async()=>({loaded:mainLoaded}),registerJar:async()=>events.push('register'),setModules:async()=>{},
  getCSP:()=>{events.push('get');return new Promise(()=>{});},getState:async()=>{throw Error('must not read state after timeout');},close:async()=>{},
 });
 const entry={caseId:'0-0',artifact,site,android,jarPath,mainJarPath};
 const failed=await replayCase(entry,{runtimeFactory:factory(false),workRoot:directory});
 assert.equal(failed.report.error.stage,'main-load');assert.equal(failed.report.mainLoad.loaded,false);assert.deepEqual(events,[]);
 const timed=await replayCase(entry,{runtimeFactory:factory(true),workRoot:directory,loadTimeoutMs:15});
 assert.equal(timed.report.error.stage,'site-load-init');assert.equal(timed.report.error.category,'timeout');
 assert.equal(timed.report.loadSuccess,undefined);assert.equal(timed.report.selectedLoad.attempted,true);
 assert.equal(timed.report.selectedLoad.includesSpiderInit,true);assert.equal(timed.report.calls.length,0);
 assert.deepEqual(events,['register','get']);assert.equal(timed.report.cleanup.closed,true);
});

test('site init exceptions retain observed loading while a second native artifact blocker never passes',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tvbox-role-init-error-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const jarPath=join(directory,'site.jar'),mainJarPath=join(directory,'main.jar');await writeFile(jarPath,'site');await writeFile(mainJarPath,'main');
 const android={report:{artifactIndex:0,siteIndex:0,manifestSha256:sha('plan'),targetApkSha256:officialOracleApkSha256,symbolMapSha256:sha('map'),...loaderContextOf(artifact,site).identity},privateCalls:[{method:'homeContent',params:[true]}]};
 let businessCalls=0;
 const factory=count=>()=>({request:async()=>({enabled:false}),loadMain:async()=>({loaded:true}),registerJar:async()=>{},setModules:async()=>{},
  getCSP:async()=>{throw new Error(count===2?'Owned init failure':'NATIVE_WORKER_SINGLE_ARTIFACT');},getState:async()=>({jar:{loaderCount:count}}),call:async()=>{businessCalls++;return '{}';},close:async()=>{}});
 for(const count of [2,1]){
  const result=await replayCase({caseId:'0-0',artifact,site,android,jarPath,mainJarPath},{runtimeFactory:factory(count),workRoot:directory});
  assert.equal(result.report.error.stage,'site-load-init');assert.equal(result.report.loadSuccess,count===2);
  assert.equal(result.report.selectedLoad.loadStateObservedAfterInitError,true);assert.equal(result.report.initSuccess,undefined);
  assert.equal(result.report.calls.length,0);assert.equal(result.report.cleanup.closed,true);
 }
 assert.equal(businessCalls,0);
});

test('one owned JAR loaded as both main and site keeps two original loader map keys', {timeout:60000}, async t=>{
 const fixtures=buildSpiderFixtures();t.after(()=>rm(fixtures.build,{recursive:true,force:true}));
 const bytes=await readFile(fixtures.jar),digest=sha(bytes);
 const artifact={id:digest,sha256:digest,jarPath:fixtures.jar};
 const signature='https://owned.invalid/same.jar;md5; original';
 const site={key:'same-owned',api:'csp_Contract',ext:'same-input',jar:signature,loaderContext:{role:'site',signature,main:{sha256:digest,signature:'https://owned.invalid/main.jar',jarPath:fixtures.jar,jarUrl:'http://fixture.invalid/same.jar'}}};
 const android={report:{artifactIndex:0,siteIndex:0,manifestSha256:sha('same plan'),targetApkSha256:officialOracleApkSha256,symbolMapSha256:sha('map'),...loaderContextOf(artifact,site).identity},privateCalls:[{method:'homeContent',params:[true]}]};
 const value=await replayCase({caseId:'0-0',artifact,site,android,jarPath:fixtures.jar,mainJarPath:fixtures.jar},{runtimeFactory:options=>createSpiderRuntime({...options,built:fixtures.built,nativeBridge:false}),workRoot:fixtures.build});
 assert.equal(value.report.error,undefined);assert.equal(value.report.mainLoad.loaded,true);assert.equal(value.report.loadSuccess,true);
 assert.equal(value.report.selectedLoad.loaderCount,2);assert.equal(value.report.initSuccess,true);
 assert.equal(value.report.cleanup.closed,true);assert.equal(value.report.cleanup.temporaryDataRemoved,true);
});

test('failed selected load preserves its real failure and extracts only controlled symbols from bounded stage diagnostics',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tvbox-replay-evidence-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const bytes=Buffer.from('owned evidence jar'),jarPath=join(directory,'owned.jar');await writeFile(jarPath,bytes);
 const artifact={id:sha(bytes),sha256:sha(bytes)},site={key:'owned',api:'csp_Owned',ext:''};
 const android={report:{artifactIndex:0,siteIndex:0,manifestSha256:sha('plan'),loaderMode:'main'},privateCalls:[]};
 const secret='https://secret.invalid/?token=raw-secret',queries=[];
 const value=await replayCase({caseId:'0-0',artifact,site,android,jarPath},{workRoot:directory,runtimeFactory:options=>({
  request:async request=>{queries.push(request.operation);return request.operation==='logs'?['java.lang.NoSuchFieldError: android.os.Build.MODEL\n'+secret]:{enabled:false};},
  loadMain:async()=>{
   options.onStderr('java.lang.ClassNotFoundException: private.before.Truncated\n');
   options.onStderr('x'.repeat(1024*1024+128));
   options.onStderr('\njava.lang.ClassNotFoundException: android.webkit.WebView\n'+secret+'\n');
   return{loaded:false,failure:'java.lang.NoSuchMethodError: android.app.Activity.isFinishing() '+secret};
  },close:async()=>{},
 })});
 assert.equal(value.report.error.category,'missing-class-or-member');
 assert.ok(value.report.error.failureCodes.includes('JAR_LOAD_FAILED'));
 const evidence=value.report.controlledEvidence.find(row=>row.stage==='load');assert.equal(evidence.stderrTruncated,true);
 assert.ok(evidence.missingSymbols.some(row=>row.kind==='class'&&row.name==='android.webkit.WebView'));
 assert.ok(evidence.missingSymbols.some(row=>row.kind==='field'&&row.owner==='android.os.Build'&&row.name==='MODEL'));
 assert.ok(queries.includes('logs'));assert.equal(value.report.cleanup.closed,true);
 for(const text of [secret,'raw-secret','private.before.Truncated'])assert.equal(JSON.stringify(value).includes(text),false);
});

test('SpiderNull logs and actual method error types are phase-scoped, and timeouts never query more logs',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tvbox-replay-phase-evidence-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const bytes=Buffer.from('owned phase jar'),jarPath=join(directory,'owned.jar');await writeFile(jarPath,bytes);
 const artifact={id:sha(bytes),sha256:sha(bytes)},site={key:'owned',api:'csp_Owned',ext:''};
 const android={report:{artifactIndex:0,siteIndex:0,manifestSha256:sha('plan'),loaderMode:'main'},privateCalls:[{method:'homeContent',params:[true]}]};
 const secret='https://secret.invalid/?token=must-not-appear';
 for(const mode of ['null','method','timeout']){
  const queries=[];
  const value=await replayCase({caseId:'0-0',artifact,site,android,jarPath},{workRoot:directory,initTimeoutMs:10,runtimeFactory:options=>({
   request:async request=>{queries.push(request.operation);return request.operation==='logs'?['java.lang.NoSuchMethodError: android.os.Build.foo(int)\n'+secret]:{enabled:false};},
   loadMain:async()=>({loaded:true}),setModules:async()=>{},
   getCSP:async()=>{
    if(mode==='timeout')return new Promise(()=>{});
    if(mode==='null'){options.onStderr('java.lang.ClassNotFoundException: android.view.OwnedMissing\n'+secret);return{ready:false,className:'com.github.catvod.crawler.SpiderNull'};}
    return{ready:true,token:'owned',className:'fixture.Spider'};
   },
   call:async()=>{throw Object.assign(new Error('android.os.Build.MODEL\n'+secret),{errorType:'java.lang.NoSuchFieldError'});},close:async()=>{},
  })});
  assert.equal(JSON.stringify(value).includes(secret),false);assert.equal(value.report.cleanup.closed,true);
  if(mode==='timeout'){assert.equal(value.report.error.category,'timeout');assert.equal(queries.includes('logs'),false);}
  if(mode==='null'){
   assert.equal(value.report.loadSuccess,true);assert.equal(value.report.initSuccess,false);
   assert.ok(value.report.controlledEvidence.some(row=>row.stage==='init'&&row.missingSymbols.some(symbol=>symbol.name==='android.view.OwnedMissing')));
  }
  if(mode==='method'){
   assert.equal(value.report.calls[0].success,false);
   const evidence=value.report.controlledEvidence.find(row=>row.stage==='homeContent');
   assert.ok(evidence.exceptionTypes.includes('java.lang.NoSuchFieldError'));
   assert.ok(evidence.missingSymbols.some(symbol=>symbol.kind==='field'&&symbol.owner==='android.os.Build'&&symbol.name==='MODEL'));
  }
 }
});
