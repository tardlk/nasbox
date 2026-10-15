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

const digest=value=>createHash('sha256').update(value).digest('hex');
const allowed=new Set(['homeContent','homeVideoContent','categoryContent','detailContent','searchContent']);
const label=value=>{
 const text=String(value??'');
 return text.length>160||/(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text)?'sha256:'+digest(text):text;
};
function kill(pid){
 if(!Number.isSafeInteger(pid)||pid<=1||pid===process.pid)return false;
 try{process.kill(pid,'SIGKILL');return true;}catch(error){return error.code==='ESRCH';}
}

/** One fresh runtime per exact artifact/site case. Injectable for offline tests. */
export async function replayCase({caseId,artifact,site,androidPrivatePath,android,jarPath}, {
 runtimeFactory=createSpiderRuntime,caseTimeoutMs=240000,callTimeoutMs=30000,loadTimeoutMs=90000,workRoot=tmpdir(),
}={}){
 const start=Date.now(),deadline=start+caseTimeoutMs;
 const report={schemaVersion:1,scope:'Linux/NAS JVM/DEX/ARM bridge replay of exact original-product ART inputs; live network responses',
  caseId,id:label(artifact.id),artifactIndex:android.report.artifactIndex,siteIndex:android.report.siteIndex,manifestSha256:android.report.manifestSha256,
  jarSha256:artifact.sha256,extSha256:digest(site.ext),api:label(site.api),siteKey:label(site.key),
  loaderMode:'main',initPolicy:'android',calls:[],cleanup:{}};
 const privateCalls=[];
 let runtime,directory,workerPid,fatal=false,stage='input';
 async function bounded(action,milliseconds=callTimeoutMs,cleanup=false){
  const duration=cleanup?milliseconds:Math.min(milliseconds,deadline-Date.now());
  if(duration<=0){fatal=true;throw Object.assign(new Error('Case deadline exceeded'),{code:'ARTIFACT_DEADLINE'});}
  let timer;
  try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{
   timer=setTimeout(()=>{fatal=true;report.cleanup.forcedWorkerKill=kill(workerPid);reject(Object.assign(new Error('Replay deadline exceeded'),{code:cleanup?'CALL_DEADLINE':Date.now()>=deadline?'ARTIFACT_DEADLINE':'CALL_DEADLINE'}));},duration);
  })]);}finally{clearTimeout(timer);}
 }
 try{
  const bytes=await readFile(jarPath);
  if(digest(bytes)!==artifact.sha256)throw Object.assign(new Error('INPUT_CHECKSUM'),{code:'INPUT_CHECKSUM'});
  report.jarBytes=bytes.length;
  directory=await mkdtemp(join(workRoot,'tvbox-art-replay-'));
  stage='start';runtime=runtimeFactory({nativeBridge:true,timeoutMs:loadTimeoutMs,dataDir:join(directory,'runtime')});
  const nativeState=await bounded(()=>runtime.request({operation:'nativeState'}));
  if(Number.isSafeInteger(nativeState?.workerPid))workerPid=nativeState.workerPid;
  await bounded(()=>runtime.request({operation:'host',jarInitPolicy:'android',packageName:android.report.targetPackage||'com.github.tvbox.osc.jun'}));
  stage='load';let started=Date.now();
  const loaded=await bounded(()=>runtime.loadMain(jarPath),loadTimeoutMs);
  report.loadMs=Date.now()-started;report.loadSuccess=loaded?.loaded===true;
  if(!report.loadSuccess)throw Object.assign(new Error('JAR_LOAD_FAILED'),{code:'JAR_LOAD_FAILED'});
  await bounded(()=>runtime.setModules({remote:true}));
  stage='init';started=Date.now();
  const spider=await bounded(()=>runtime.getCSP({...site,type:3,jar:''}));
  report.initMs=Date.now()-started;report.initSuccess=spider?.ready===true;
  report.spiderClass=spider?.className??null;
  if(!report.initSuccess)throw new Error('SPIDER_NOT_READY: SpiderNull');
  for(const call of android.privateCalls){
   if(fatal)break;
   stage=call.method;started=Date.now();
   const row={method:call.method,paramsSha256:digest(JSON.stringify(canonical(call.params)))};const privateRow={method:call.method,params:call.params};
   try{
    const value=await bounded(()=>runtime.call(spider.token,call.method,call.params));
    privateRow.value=value;
    const {metadata}=summarizeResponse(value);
    row.response=metadata;row.success=true;
   }catch(error){
    row.success=false;row.error=classifyFailure(error,runtime.getDiagnostics?.().stderr);privateRow.error=row.error;
    if(['timeout','artifact-timeout'].includes(row.error.category)||/worker exited|runtime is closed/i.test(String(error?.message)))fatal=true;
   }
   row.elapsedMs=Date.now()-started;privateRow.metadata=row;
   report.calls.push(row);privateCalls.push(privateRow);
  }
  report.completed=!fatal&&privateCalls.length===android.privateCalls.length;
 }catch(error){report.error={stage,...classifyFailure(error,runtime?.getDiagnostics?.().stderr)};}
 finally{
  if(runtime){
   try{await bounded(()=>runtime.close(),5000,true);report.cleanup.closed=true;}
   catch(error){report.cleanup.closed=false;report.cleanup.error=classifyFailure(error);report.cleanup.forcedWorkerKill=kill(workerPid);}
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
  if(android.privateCalls.length>20||android.privateCalls.some(call=>!allowed.has(call.method)||!Array.isArray(call.params)))throw new Error('INPUT_SCHEMA: invalid ART call');
  const jarPath=await realpath(resolve(root,artifact.jarPath));const rel=relative(root,jarPath);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw new Error('INPUT_PATH: captured JAR escapes input root');
  const info=await stat(jarPath);
  if(!info.isFile()||info.size<1||info.size>128*1024*1024)throw new Error('INPUT_SIZE: invalid captured JAR');
  cases.push({caseId:artifactIndex+'-'+siteIndex,artifact,site,androidPrivatePath,android,jarPath});
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
 if(caseIndex!==undefined&&!cases[caseIndex])throw new Error('Case index out of range');
 await mkdir(output,{recursive:true,mode:0o700});
 for(const entry of caseIndex===undefined?cases:[cases[caseIndex]]){
  const result=await replayCase(entry);
  await writeFile(join(output,entry.caseId+'-private.json'),JSON.stringify(result)+'\n',{mode:0o600});
  await writeFile(join(output,entry.caseId+'-metadata.json'),JSON.stringify(result.report)+'\n',{mode:0o600});
  console.log(JSON.stringify(result.report));
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({error:classifyFailure(error)}));process.exitCode=1;});
