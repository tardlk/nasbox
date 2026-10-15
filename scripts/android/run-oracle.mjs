// SPDX-License-Identifier: GPL-3.0-only
// Serial original-product instrumentation; one cold app process per captured case.
import {readFile,writeFile,mkdir,mkdtemp,rename,rm,stat,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {assertLoaderIdentity,loaderContextOf,officialOracleApkSha256} from './loader-context.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const label=value=>{
 const text=String(value??'');
 return text.length>160||/(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text)?'sha256:'+sha(text):text;
};
const allowed=new Set(['homeContent','homeVideoContent','categoryContent','detailContent','searchContent','playerContent']);
const target='com.github.tvbox.osc.jun',instrument='com.github.tvbox.parity.oracle/com.github.tvbox.parity.oracle.OracleInstrumentation';

export function oracleBudgetsOf(plan = {}) {
 const budgets={caseMs:240000,loadMs:30000,initMs:30000,callMs:30000,...plan.artBudgets};
 for(const [key,value]of Object.entries(budgets))if(!['caseMs','loadMs','initMs','callMs'].includes(key)||!Number.isSafeInteger(value)||value<100||value>(key==='caseMs'?3600000:180000))throw new Error('INPUT_SCHEMA: invalid ART stage budget');
 return budgets;
}

export function oracleStatePolicyOf(plan = {}) {
 const policy=plan.artStatePolicy??'cold-process-preserve-data';
 if(!['cold-process-preserve-data','fresh-app-data'].includes(policy))throw new Error('INPUT_SCHEMA: invalid ART application state policy');
 return policy;
}

/** The command adapter is injectable; no permissions or preferences are changed here. */
export function prepareOracleAppState(command,policy) {
 oracleStatePolicyOf({artStatePolicy:policy});
 const stopped=command(['shell','am','force-stop',target]);
 if(stopped.error||stopped.status!==0)throw new Error('ART_STATE_FORCE_STOP_FAILED');
 if(policy==='fresh-app-data'){
  const cleared=command(['shell','pm','clear',target]);
  if(cleared.error||cleared.status!==0||String(cleared.stdout||'').trim()!=='Success')throw new Error('ART_STATE_CLEAR_FAILED');
 }
 return policy;
}

export function oracleInstrumentationArguments({base,manifestSha256,artifactIndex,siteIndex,budgets,applicationStatePolicy}) {
 oracleStatePolicyOf({artStatePolicy:applicationStatePolicy});
 return ['shell','am','instrument','-w','-r','-e','manifestUrl',base+'/oracle-plan.json','-e','manifestSha256',manifestSha256,
  '-e','artifactIndex',String(artifactIndex),'-e','siteIndex',String(siteIndex),'-e','appDataPolicy',applicationStatePolicy,
  '-e','caseTimeoutMs',String(budgets.caseMs),'-e','loadTimeoutMs',String(budgets.loadMs),'-e','initTimeoutMs',String(budgets.initMs),'-e','callTimeoutMs',String(budgets.callMs),instrument];
}

export async function invalidateOracleOutputs(output, plan) {
 await rm(join(output,'summary-private.json'),{force:true});
 for(const [artifactIndex,artifact]of plan.artifacts.entries())for(const [siteIndex]of artifact.sites.entries())await rm(join(output,artifactIndex+'-'+siteIndex+'-private.json'),{force:true});
}

/** Never publish an old/partial/unpaired adb result at the comparator's final path. */
export async function pullVerifiedPrivateResult({command,devicePath,output,id,artifactIndex,siteIndex,artifact,site,manifestSha256,instrumentReport,applicationStatePolicy}){
 if(!/^\d+-\d+$/.test(id))return {ok:false,errorCode:'INVALID_CASE_ID'};
 const finalPath=join(output,id+'-private.json');
 await rm(finalPath,{force:true});
 const expectedDevicePath='/storage/emulated/0/Android/data/'+target+'/files/parity-oracle/result-'+id+'.json';
 if(devicePath!==expectedDevicePath||!instrumentReport)return {ok:false,errorCode:'MISSING_CURRENT_RESULT'};
 const temporary=await mkdtemp(join(output,'.oracle-pull-'+id+'-'));
 const pending=join(temporary,'private.json');
 try{
  const pulled=command(['pull',devicePath,pending]);
  if(pulled.error||pulled.status!==0)return {ok:false,errorCode:'ADB_PULL_FAILED'};
  const info=await stat(pending);
  if(!info.isFile()||info.size>128*1024*1024)return {ok:false,errorCode:'PRIVATE_RESULT_SIZE'};
  const bytes=await readFile(pending),value=JSON.parse(bytes),meta=value?.report;
  if(meta?.schemaVersion!==1||meta.manifestSha256!==manifestSha256||
   meta.artifactIndex!==artifactIndex||meta.siteIndex!==siteIndex||meta.jarSha256!==artifact.sha256||
   meta.id!==label(artifact.id)||meta.api!==label(site.api)||meta.siteKey!==label(site.key)||
   typeof site.ext!=='string'||meta.extSha256!==sha(site.ext)||!isDeepStrictEqual(meta,instrumentReport))return {ok:false,errorCode:'PRIVATE_RESULT_IDENTITY'};
  if(applicationStatePolicy!==undefined&&meta.applicationStatePolicy!==applicationStatePolicy)return {ok:false,errorCode:'PRIVATE_RESULT_STATE_POLICY'};
  try{const context=assertLoaderIdentity(meta,artifact,site);if(!context.legacy&&(meta.targetApkSha256!==officialOracleApkSha256||!/^[a-f0-9]{64}$/.test(meta.symbolMapSha256)))return {ok:false,errorCode:'PRIVATE_RESULT_IDENTITY'};}catch{return {ok:false,errorCode:'PRIVATE_RESULT_IDENTITY'};}
  if(!Array.isArray(value.privateCalls)||value.privateCalls.length>20||!Array.isArray(meta.calls)||value.privateCalls.length!==meta.calls.length)return {ok:false,errorCode:'PRIVATE_RESULT_CALLS'};
  for(const [index,call]of value.privateCalls.entries()){
   if(!allowed.has(call.method)||!Array.isArray(call.params)||call.method!==meta.calls[index].method||!isDeepStrictEqual(call.metadata,meta.calls[index]))return {ok:false,errorCode:'PRIVATE_RESULT_CALLS'};
   const response=call.metadata.response;
   if(response&&(typeof call.value!=='string'||response.sha256!==sha(call.value)||response.bytes!==Buffer.byteLength(call.value)))return {ok:false,errorCode:'PRIVATE_RESULT_RESPONSE_HASH'};
  }
  await chmod(pending,0o600);await rename(pending,finalPath);
  return {ok:true,sha256:sha(bytes),bytes:bytes.length};
 }catch{return {ok:false,errorCode:'PRIVATE_RESULT_INVALID'};}
 finally{await rm(temporary,{recursive:true,force:true});}
}

async function main(){
const [planArg,outArg,adbArg,serial='emulator-5554',base='http://10.0.2.2:18765']=process.argv.slice(2);
if(!planArg||!outArg||!adbArg)throw Error('Usage: node run-oracle.mjs PLAN OUTPUT_DIR ADB [SERIAL] [FIXTURE_BASE]');
const planBytes=await readFile(planArg),plan=JSON.parse(planBytes),output=resolve(outArg),adb=resolve(adbArg);
const manifestSha256=sha(planBytes),runnerSha256=sha(await readFile(fileURLToPath(import.meta.url)));
const budgets=oracleBudgetsOf(plan);
const applicationStatePolicy=oracleStatePolicyOf(plan);
await mkdir(output,{recursive:true,mode:0o700});
// Invalidate all expected cases up front too: if a later case is never reached
// after an interruption, a previous run cannot supply its missing observation.
await invalidateOracleOutputs(output,plan);
const env={...process.env,ADB_MDNS:'0'};
function command(args,timeout=20000){return spawnSync(adb,['-s',serial,...args],{encoding:'utf8',timeout,maxBuffer:16*1024*1024,env});}
const summary=[];
for(const [artifactIndex,artifact]of plan.artifacts.entries())for(const [siteIndex,site]of artifact.sites.entries()){
 const context=loaderContextOf(artifact,site);
 const transportBudgetMs=context.legacy&&!plan.artBudgets?150000:budgets.caseMs+20000;
 const id=artifactIndex+'-'+siteIndex,report={id,jarSha256:artifact.sha256,api:site.api,extSha256:site.extSha256,artifactIndex,siteIndex,...context.identity,budgets,transportBudgetMs,privateResultPulled:false};
 // Invalidate previous local output before transport or instrumentation can fail.
 await rm(join(output,id+'-private.json'),{force:true});
 try{report.applicationStatePolicy=prepareOracleAppState(command,applicationStatePolicy);}
 catch(error){
  report.statePreparationError=/^ART_STATE_[A-Z_]+$/.test(error.message)?error.message:'ART_STATE_FAILED';
  summary.push(report);await writeFile(join(output,'summary-private.json'),JSON.stringify({manifestSha256,runnerSha256,budgets,applicationStatePolicy,cases:summary},null,2)+'\n',{mode:0o600});
  throw error;
 }
 command(['shell','rm','-f','/sdcard/Android/data/'+target+'/files/parity-oracle/result-'+id+'.json']);
 command(['logcat','-c']);
 const args=oracleInstrumentationArguments({base,manifestSha256,artifactIndex,siteIndex,budgets,applicationStatePolicy});
 const result=command(args,transportBudgetMs),text=(result.stdout||'')+(result.stderr||'');
 await writeFile(join(output,id+'-instrument.txt'),text,{mode:0o600});
 report.adbExit=result.status;report.transportTimeout=result.error?.code==='ETIMEDOUT';
 const meta=/^INSTRUMENTATION_RESULT: report=(.*)$/m.exec(text),path=/^INSTRUMENTATION_RESULT: privateResultPath=(.*)$/m.exec(text),code=/^INSTRUMENTATION_CODE: (.*)$/m.exec(text);
 report.instrumentationCode=code?Number(code[1]):null;
 if(meta)try{report.report=JSON.parse(meta[1]);}catch{report.invalidReport=true;}
 const collected=await pullVerifiedPrivateResult({command,devicePath:path?.[1],output,id,artifactIndex,siteIndex,artifact,site,manifestSha256,instrumentReport:report.report,applicationStatePolicy});
 report.privateResultPulled=collected.ok;
 if(collected.ok){report.privateResultSha256=collected.sha256;report.privateResultBytes=collected.bytes;}
 else report.collectionError=collected.errorCode;
 const logs=command(['logcat','-d']);await writeFile(join(output,id+'-logcat.txt'),logs.stdout||'',{mode:0o600});
 command(['shell','am','force-stop',target]);
 summary.push(report);await writeFile(join(output,'summary-private.json'),JSON.stringify({manifestSha256,runnerSha256,budgets,applicationStatePolicy,cases:summary},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({case:id,api:site.api,load:report.report?.loadSuccess,ready:report.report?.initSuccess,calls:report.report?.calls?.map(c=>({method:c.method,ok:c.success,content:c.response?.hasContent})),error:report.report?.error?.type,code:report.instrumentationCode,transportTimeout:report.transportTimeout,pulled:report.privateResultPulled,collectionError:report.collectionError}));
}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({errorType:error.name,fingerprint:sha(String(error.message||error))}));process.exitCode=1;});
