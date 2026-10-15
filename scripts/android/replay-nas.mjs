// SPDX-License-Identifier: GPL-3.0-only
// Replay the exact private ART call arguments on the Linux/NAS engine.
// Never prints raw configuration, method arguments, response bodies or logs.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,mkdtemp,realpath,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,relative,isAbsolute,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSpiderRuntime} from '../../backend/spider-runtime/index.mjs';
import {canonical,classifyFailure,summarizeResponse} from '../container/jar-matrix-probe.mjs';
import {extractMissingSymbols} from '../container/jar-failure-diagnostics.mjs';
import {assertLoaderIdentity,loaderContextOf,officialOracleApkSha256} from './loader-context.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const allowed=new Set(['homeContent','homeVideoContent','categoryContent','detailContent','searchContent','playerContent']);
const label=value=>{
 const text=String(value??'');
 return text.length>160||/(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text)?'sha256:'+digest(text):text;
};
function kill(pid){
 if(!Number.isSafeInteger(pid)||pid<=1||pid===process.pid)return false;
 try{process.kill(pid,'SIGKILL');return true;}catch(error){return error.code==='ESRCH';}
}

function diagnosticRing(maxBytes=1024*1024){
 const bytes=Buffer.alloc(maxBytes);let next=0,total=0;
 return{
  mark:()=>total,
  append(value){
   const chunk=Buffer.isBuffer(value)?value:Buffer.from(String(value));total+=chunk.length;
   if(chunk.length>=maxBytes){chunk.copy(bytes,0,chunk.length-maxBytes);next=0;return;}
   const first=Math.min(chunk.length,maxBytes-next);chunk.copy(bytes,next,0,first);chunk.copy(bytes,0,first);next=(next+chunk.length)%maxBytes;
  },
  since(mark=0){
   const start=Math.max(mark,total-maxBytes,0),length=total-start,offset=(next-length+maxBytes)%maxBytes;
   const value=offset+length<=maxBytes?bytes.subarray(offset,offset+length):Buffer.concat([bytes.subarray(offset),bytes.subarray(0,length-(maxBytes-offset))]);
   return{text:value.toString('utf8'),truncated:start>mark};
  },
 };
}

export function replayBudgetsOf(plan = {}) {
 const budgets={caseMs:240000,loadMs:90000,initMs:30000,callMs:30000,...plan.nasBudgets};
 for(const [key,value]of Object.entries(budgets))if(!['caseMs','loadMs','initMs','callMs'].includes(key)||!Number.isSafeInteger(value)||value<1||value>3600000)throw new Error('INPUT_SCHEMA: invalid NAS replay budget');
 return {caseTimeoutMs:budgets.caseMs,loadTimeoutMs:budgets.loadMs,initTimeoutMs:budgets.initMs,callTimeoutMs:budgets.callMs};
}

/** One fresh runtime per exact artifact/site case. Injectable for offline tests. */
export async function replayCase({caseId,artifact,site,androidPrivatePath,android,jarPath,mainJarPath}, {
 runtimeFactory=createSpiderRuntime,caseTimeoutMs=240000,callTimeoutMs=30000,initTimeoutMs=callTimeoutMs,loadTimeoutMs=90000,workRoot=tmpdir(),
}={}){
 const start=Date.now(),deadline=start+caseTimeoutMs;
 const context=loaderContextOf(artifact,site);
 const report={schemaVersion:1,scope:'Linux/NAS JVM/DEX/ARM bridge replay of exact original-product ART inputs; live network responses',
  caseId,id:label(artifact.id),artifactIndex:android.report.artifactIndex,siteIndex:android.report.siteIndex,manifestSha256:android.report.manifestSha256,
  jarSha256:artifact.sha256,extSha256:digest(site.ext),api:label(site.api),siteKey:label(site.key),
  ...context.identity,initPolicy:'android',budgets:{caseMs:caseTimeoutMs,loadMs:loadTimeoutMs,initMs:initTimeoutMs,callMs:callTimeoutMs},calls:[],controlledEvidence:[],cleanup:{},
  ...(android.report.targetApkSha256?{targetApkSha256:android.report.targetApkSha256}:{}),
  ...(android.report.symbolMapSha256?{artSymbolMapSha256:android.report.symbolMapSha256}:{}),
  ...(android.report.knownVersionDifference?{knownVersionDifference:android.report.knownVersionDifference}:{})};
 const privateCalls=[];
 let runtime,directory,workerPid,fatal=false,stage='input',stageMark=0;
 const diagnostics=diagnosticRing();
 const beginStage=name=>{stage=name;stageMark=diagnostics.mark();};
 const errorText=error=>[error?.errorType||error?.name||'Error',error?.message||''].join(': ');
 const classify=(error,mark=stageMark)=>classifyFailure(error,diagnostics.since(mark).text);
 const isFatal=error=>['timeout','artifact-timeout'].includes(error?.category)||/worker exited|runtime is closed/i.test(error?.message||'');
 async function collectEvidence(name,mark,extra='',queryLogs=false){
  let logs='';
  if(queryLogs&&runtime&&!fatal&&deadline-Date.now()>1){
   try{
    const value=await bounded(()=>runtime.request({operation:'logs'}),Math.min(1000,callTimeoutMs));
    // Parse each returned log string directly; JSON encoding would hide newlines.
    logs=(Array.isArray(value)?value.filter(item=>typeof item==='string').join('\n'):typeof value==='string'?value:'').slice(-1024*1024);
   }catch(error){if(isFatal(classify(error))||/worker exited|runtime is closed/i.test(error?.message||''))fatal=true;}
  }
  const captured=diagnostics.since(mark);
  const evidence=extractMissingSymbols(captured.text+'\n'+logs+'\n'+extra);
  if(evidence.exceptionTypes.length||evidence.missingSymbols.length||captured.truncated)report.controlledEvidence.push({stage:name,...evidence,...(captured.truncated?{stderrTruncated:true}:{})});
 }
 async function bounded(action,milliseconds=callTimeoutMs,cleanup=false){
  const duration=cleanup?milliseconds:Math.min(milliseconds,deadline-Date.now());
  if(duration<=0){fatal=true;throw Object.assign(new Error('Case deadline exceeded'),{code:'ARTIFACT_DEADLINE'});}
  let timer;
  try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{
   timer=setTimeout(()=>{fatal=true;report.cleanup.forcedWorkerKill=kill(workerPid);reject(Object.assign(new Error('Replay deadline exceeded'),{code:cleanup?'CALL_DEADLINE':Date.now()>=deadline?'ARTIFACT_DEADLINE':'CALL_DEADLINE'}));},duration);
  })]);}finally{clearTimeout(timer);}
 }
 try{
  assertLoaderIdentity(android.report,artifact,site);
  if(!context.legacy&&(android.report.targetApkSha256!==officialOracleApkSha256||!/^[a-f0-9]{64}$/.test(android.report.symbolMapSha256)))throw new Error('INPUT_CHECKSUM: ART APK/map pin differs');
  for(const budget of [caseTimeoutMs,loadTimeoutMs,initTimeoutMs,callTimeoutMs])if(!Number.isSafeInteger(budget)||budget<1)throw new Error('INPUT_SCHEMA: invalid replay budget');
  const bytes=await readFile(jarPath);
  if(digest(bytes)!==artifact.sha256)throw Object.assign(new Error('INPUT_CHECKSUM'),{code:'INPUT_CHECKSUM'});
  report.jarBytes=bytes.length;
  report.jarBytesVerified=true;
  if(context.main){
   if(!mainJarPath)throw new Error('INPUT_SCHEMA: missing frozen main JAR');
   const mainBytes=await readFile(mainJarPath);
   if(digest(mainBytes)!==context.main.sha256)throw new Error('INPUT_CHECKSUM: main JAR differs');
   report.mainJarBytes=mainBytes.length;report.mainJarBytesVerified=true;
  }
  directory=await mkdtemp(join(workRoot,'tvbox-art-replay-'));
  report.applicationStatePolicy='fresh-runtime-data';
  beginStage('start');runtime=runtimeFactory({nativeBridge:true,timeoutMs:loadTimeoutMs,dataDir:join(directory,'runtime'),onStderr:chunk=>diagnostics.append(chunk)});
  const nativeState=await bounded(()=>runtime.request({operation:'nativeState'}));
  if(Number.isSafeInteger(nativeState?.workerPid))workerPid=nativeState.workerPid;
  await bounded(()=>runtime.request({operation:'host',jarInitPolicy:'android',packageName:android.report.targetPackage||'com.github.tvbox.osc.jun'}));
  if(context.main){
   beginStage('main-load');const begin=Date.now();report.mainLoad={attempted:true};
   const mainLoaded=await bounded(()=>runtime.loadMain(mainJarPath),loadTimeoutMs);
   Object.assign(report.mainLoad,{loaded:mainLoaded?.loaded===true,milliseconds:Date.now()-begin});
   if(!report.mainLoad.loaded)throw Object.assign(new Error(String(mainLoaded?.failure||'MAIN_JAR_LOAD_FAILED')),{code:'JAR_LOAD_FAILED'});
   await collectEvidence(stage,stageMark);
  }
  let started=Date.now();
  if(context.role==='main'){
   beginStage('load');report.selectedLoad={attempted:true};
   const loaded=await bounded(()=>runtime.loadMain(jarPath),loadTimeoutMs);
   report.loadMs=Date.now()-started;report.loadSuccess=loaded?.loaded===true;
   Object.assign(report.selectedLoad,{loaded:report.loadSuccess,milliseconds:report.loadMs});
   if(!report.loadSuccess)throw Object.assign(new Error(String(loaded?.failure||'JAR_LOAD_FAILED')),{code:'JAR_LOAD_FAILED'});
   await collectEvidence(stage,stageMark);
  }else{
   beginStage('site-register');await bounded(()=>runtime.registerJar(context.signature,jarPath),loadTimeoutMs);
   report.selectedLoad={attempted:false,registered:true,includesSpiderInit:true};
  }
  await bounded(()=>runtime.setModules({remote:true}));
  beginStage(context.role==='site'?'site-load-init':'init');started=Date.now();
  if(context.role==='site')Object.assign(report.selectedLoad,{attempted:true,usedBudgetMs:loadTimeoutMs});
  const spider=await bounded(()=>runtime.getCSP({...site,type:3,jar:context.role==='site'?context.signature:''}),context.role==='site'?loadTimeoutMs:initTimeoutMs);
  report.initMs=Date.now()-started;report.initSuccess=spider?.ready===true;
  report.spiderClass=spider?.className??null;
  if(context.role==='site'){
   const state=await bounded(()=>runtime.getState());
   const count=state?.jar?.loaderCount;
   report.loadSuccess=Number.isSafeInteger(count)?count>=(context.main?2:1):null;
   report.loadMs=report.initMs;
   Object.assign(report.selectedLoad,{loaded:report.loadSuccess,milliseconds:report.loadMs,loaderCount:Number.isSafeInteger(count)?count:null});
   if(report.loadSuccess===false)throw new Error('JAR_LOAD_FAILED');
  }
  if(!report.initSuccess)throw new Error('SPIDER_NOT_READY: SpiderNull');
  await collectEvidence(stage,stageMark);
  for(const call of android.privateCalls){
   if(fatal)break;
   if(call.metadata?.status==='not-tested'){
    const row={method:call.method,paramsSha256:digest(JSON.stringify(canonical(call.params))),success:false,status:'not-tested',reason:call.metadata.reason,elapsedMs:0,
     ...(call.metadata.discoveryStep?{discoveryStep:call.metadata.discoveryStep}:{})};
    report.calls.push(row);privateCalls.push({method:call.method,params:call.params,metadata:row});continue;
   }
   beginStage(call.method);started=Date.now();
   const row={method:call.method,paramsSha256:digest(JSON.stringify(canonical(call.params))),
    ...(call.metadata?.discoveryStep?{discoveryStep:call.metadata.discoveryStep}:{}),
    ...(call.metadata?.methodProvenance?{androidMethodProvenance:call.metadata.methodProvenance}:{})};const privateRow={method:call.method,params:call.params};
   try{
    const value=await bounded(()=>runtime.call(spider.token,call.method,call.params));
    privateRow.value=value;
    const {json,metadata}=typeof value==='string'&&value.trim()===''?{json:{},metadata:{bytes:Buffer.byteLength(value),sha256:digest(value),emptyResponse:true,hasContent:false}}:summarizeResponse(value);
    metadata.playbackUrlPresent=typeof json.url==='string'&&json.url.length>0;
    if(metadata.playbackUrlPresent)metadata.hasContent=true;
    row.response=metadata;row.success=true;
    row.status=metadata.hasContent||metadata.playbackUrlPresent?'nonempty':'empty';
    row.elapsedMs=Date.now()-started;
   }catch(error){
    row.elapsedMs=Date.now()-started;
    row.success=false;row.error={stage,...classify(error)};privateRow.error=row.error;
    if(error.responseMetadata)row.response=error.responseMetadata;
    row.status=['timeout','artifact-timeout'].includes(row.error.category)?'timeout':row.error.category==='network'?'network':row.error.category==='invalid-json'||error.responseMetadata?'invalid-json':'failed';
    if(['timeout','artifact-timeout'].includes(row.error.category)||/worker exited|runtime is closed/i.test(String(error?.message)))fatal=true;
    await collectEvidence(stage,stageMark,errorText(error),!fatal);
   }
   if(row.success)await collectEvidence(stage,stageMark);
   privateRow.metadata=row;
   report.calls.push(row);privateCalls.push(privateRow);
  }
  report.completed=!fatal&&privateCalls.length===android.privateCalls.length;
 }catch(error){
  report.error={stage,...classify(error)};
  if(isFatal(report.error)||/worker exited|runtime is closed/i.test(error?.message||''))fatal=true;
  // A nonfatal init exception can occur after the site's loader was admitted.
  // Do not query a timed-out worker: that would only queue behind its blocked call.
  if(stage==='site-load-init'&&!fatal&&!['timeout','artifact-timeout'].includes(report.error.category)){
   try{
    const state=await bounded(()=>runtime.getState());
    const count=state?.jar?.loaderCount;
    report.loadSuccess=Number.isSafeInteger(count)?count>=(context.main?2:1):null;
    Object.assign(report.selectedLoad,{loaded:report.loadSuccess,loaderCount:Number.isSafeInteger(count)?count:null,loadStateObservedAfterInitError:true});
   }catch(stateError){report.selectedLoad.stateError=classifyFailure(stateError);}
  }
  if(stage==='main-load'&&report.mainLoad)report.mainLoad.error=report.error;
  if(['load','site-load-init'].includes(stage)&&report.selectedLoad)report.selectedLoad.error=report.error;
  await collectEvidence(stage,stageMark,errorText(error),!fatal);
 }
 finally{
  if(runtime){
   const closeMark=diagnostics.mark();
   try{await bounded(()=>runtime.close(),5000,true);report.cleanup.closed=true;}
   catch(error){report.cleanup.closed=false;report.cleanup.error=classify(error,closeMark);report.cleanup.forcedWorkerKill=kill(workerPid);await collectEvidence('cleanup',closeMark,errorText(error));}
  }
  if(workerPid){try{process.kill(workerPid,0);report.cleanup.workerExited=false;}catch(error){report.cleanup.workerExited=error.code==='ESRCH';}}
  if(directory){try{await rm(directory,{recursive:true,force:true});report.cleanup.temporaryDataRemoved=true;}catch(error){report.cleanup.temporaryDataRemoved=false;report.cleanup.error=classifyFailure(error);}}
 }
 report.elapsedMs=Date.now()-start;
 return{report,privateCalls};
}

export async function prepareCases(planPath,privateResults,inputRoot){
 const planBytes=await readFile(planPath),plan=JSON.parse(planBytes);
 if(plan.schemaVersion!==1||!Array.isArray(plan.artifacts))throw new Error('INPUT_SCHEMA: expected oracle plan');
 const root=await realpath(resolve(inputRoot||plan.inputRoot||'/input'));
 const files=(await readdir(privateResults)).filter(name=>/^\d+-\d+-private\.json$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 const cases=[];
 for(const file of files){
  const [artifactIndex,siteIndex]=file.split('-').map(Number);
  const androidPrivatePath=join(privateResults,file),android=JSON.parse(await readFile(androidPrivatePath));
  const artifact=plan.artifacts[artifactIndex],site=artifact?.sites?.[siteIndex];
  if(!artifact||!site||typeof site.ext!=='string'||!Array.isArray(android.privateCalls))throw new Error('INPUT_SCHEMA: case missing captured inputs');
  const meta=android.report;
  if(meta?.artifactIndex!==artifactIndex||meta?.siteIndex!==siteIndex||meta.jarSha256!==artifact.sha256||meta.extSha256!==digest(site.ext)||meta.api!==label(site.api)||meta.siteKey!==label(site.key)||meta.id!==label(artifact.id))throw new Error('INPUT_CHECKSUM: ART case identity differs');
  if(site.extSha256&&site.extSha256!==digest(site.ext))throw new Error('INPUT_CHECKSUM: plan ext differs');
  if(meta.manifestSha256!==digest(planBytes))throw new Error('INPUT_CHECKSUM: plan differs from instrumented manifest');
  const context=assertLoaderIdentity(meta,artifact,site);
  if(!context.legacy&&(meta.targetApkSha256!==officialOracleApkSha256||!/^[a-f0-9]{64}$/.test(meta.symbolMapSha256)))throw new Error('INPUT_CHECKSUM: ART APK/map pin differs');
  if(android.privateCalls.length>20||android.privateCalls.some(call=>!allowed.has(call.method)||!Array.isArray(call.params)))throw new Error('INPUT_SCHEMA: invalid ART call');
  const checkedPath=async input=>{
   const path=await realpath(resolve(root,input.jarPath)),rel=relative(root,path);
   if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw new Error('INPUT_PATH: captured JAR escapes input root');
   const info=await stat(path);
   if(!info.isFile()||info.size<1||info.size>128*1024*1024)throw new Error('INPUT_SIZE: invalid captured JAR');
   if(digest(await readFile(path))!==input.sha256)throw new Error('INPUT_CHECKSUM: captured JAR differs');
   return path;
  };
  const jarPath=await checkedPath(artifact),mainJarPath=context.main?await checkedPath(context.main):undefined;
  cases.push({caseId:artifactIndex+'-'+siteIndex,artifact,site,androidPrivatePath,android,jarPath,mainJarPath});
 }
 return cases;
}

async function main(){
 const args=process.argv.slice(2),position=args.indexOf('--case-index');
 let caseIndex;
 if(position>=0){caseIndex=Number(args[position+1]);args.splice(position,2);if(!Number.isSafeInteger(caseIndex)||caseIndex<0)throw new Error('Invalid case index');}
 const [planPath,privateResults,outputArg,inputRoot]=args;
 if(!planPath||!privateResults||!outputArg)throw new Error('Usage: node replay-nas.mjs PLAN PRIVATE_RESULTS OUTPUT_DIR [INPUT_ROOT] [--case-index N]');
 const cases=await prepareCases(resolve(planPath),resolve(privateResults),inputRoot),output=resolve(outputArg);
 const budgets=replayBudgetsOf(JSON.parse(await readFile(planPath,'utf8')));
 if(caseIndex!==undefined&&!cases[caseIndex])throw new Error('Case index out of range');
 await mkdir(output,{recursive:true,mode:0o700});
 for(const entry of caseIndex===undefined?cases:[cases[caseIndex]]){
  const result=await replayCase(entry,budgets);
  await writeFile(join(output,entry.caseId+'-private.json'),JSON.stringify(result)+'\n',{mode:0o600});
  await writeFile(join(output,entry.caseId+'-metadata.json'),JSON.stringify(result.report)+'\n',{mode:0o600});
  console.log(JSON.stringify(result.report));
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({error:classifyFailure(error)}));process.exitCode=1;});
