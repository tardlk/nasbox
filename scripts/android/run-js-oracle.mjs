// SPDX-License-Identifier: GPL-3.0-only
// Cold original-app process per exact source. Raw params/responses remain private.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,rename,rm,stat,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {canonical} from '../container/jar-matrix-probe.mjs';
import {jsOracleOfficialApkSha256} from './js-apk-symbol-map.mjs';
import {prepareOracleAppState} from './run-oracle.mjs';

const SELF=fileURLToPath(import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
const target='com.github.tvbox.osc.jun',instrument='com.github.tvbox.parity.jsoracle/com.github.tvbox.parity.jsoracle.JsOracleInstrumentation';
const label=value=>{const text=String(value??'');return text.length>160||/(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text)?'sha256:'+sha(text):text;};
const allowed=new Set(['homeContent','homeVideoContent','categoryContent','detailContent','searchContent','playerContent']);
// AOSP JSONObject.quote escapes every slash; keep its producer hash distinct
// from the Node canonical identity used by NAS and this collector's summary.
export const androidJSCanonical=value=>JSON.stringify(canonical(value)).replaceAll('/','\\/');
export const androidJSSourceSha256=source=>sha(androidJSCanonical(source));
export function jsOracleBudgets(plan={}){
 const value={caseMs:300000,initMs:90000,callMs:12000,...plan.artBudgets};
 for(const[key,n]of Object.entries(value))if(!['caseMs','initMs','callMs'].includes(key)||!Number.isSafeInteger(n)||n<100||n>3600000)throw Error('JS_ORACLE_BUDGET');
 return value;
}
export async function pullVerifiedJSResult({command,devicePath,output,index,source,manifestSha256,instrumentReport}){
 const final=join(output,index+'-private.json');await rm(final,{force:true});
 if(devicePath!=='/storage/emulated/0/Android/data/'+target+'/files/parity-js-oracle/result-'+index+'.json'||!instrumentReport)return{ok:false,code:'MISSING_CURRENT_RESULT'};
 const temporary=await mkdtemp(join(output,'.js-pull-'+index+'-')),pending=join(temporary,'private.json');
 try{
  const pulled=command(['pull',devicePath,pending]);if(pulled.error||pulled.status!==0)return{ok:false,code:'ADB_PULL_FAILED'};
  const info=await stat(pending);if(!info.isFile()||info.size>128*1024*1024)return{ok:false,code:'PRIVATE_SIZE'};
  const bytes=await readFile(pending),value=JSON.parse(bytes),meta=value.report;
  if(!isDeepStrictEqual(meta,instrumentReport)||meta.schemaVersion!==1||meta.manifestSha256!==manifestSha256||meta.sourceIndex!==index
   ||meta.sourceSha256!==androidJSSourceSha256(source)||meta.extSha256!==sha(source.ext)||meta.api!==label(source.api)||meta.siteKey!==label(source.key)
   ||meta.targetApkSha256!==jsOracleOfficialApkSha256||!/^[a-f0-9]{64}$/.test(meta.symbolMapSha256))return{ok:false,code:'PRIVATE_IDENTITY'};
  if(!Array.isArray(value.privateCalls)||value.privateCalls.length>20||!Array.isArray(meta.calls)||meta.calls.length!==value.privateCalls.length)return{ok:false,code:'PRIVATE_CALLS'};
  for(const[i,call]of value.privateCalls.entries()){
   if(!allowed.has(call.method)||!Array.isArray(call.params)||!isDeepStrictEqual(call.metadata,meta.calls[i]))return{ok:false,code:'PRIVATE_CALLS'};
   if(call.metadata.response&&(typeof call.value!=='string'||call.metadata.response.sha256!==sha(call.value)||call.metadata.response.bytes!==Buffer.byteLength(call.value)))return{ok:false,code:'PRIVATE_RESPONSE'};
  }
  await chmod(pending,0o600);await rename(pending,final);return{ok:true,sha256:sha(bytes),bytes:bytes.length};
 }catch{return{ok:false,code:'PRIVATE_INVALID'};}finally{await rm(temporary,{recursive:true,force:true});}
}
async function main(){
 const[planPath,outPath,adbPath,serial='emulator-5554',manifestUrl='http://10.0.2.2:18765/input-plan.json']=process.argv.slice(2);
 if(!planPath||!outPath||!adbPath)throw Error('Usage: node run-js-oracle.mjs PLAN OUT ADB [SERIAL] [MANIFEST_URL]');
 const planBytes=await readFile(planPath),plan=JSON.parse(planBytes),manifestSha256=sha(planBytes),output=resolve(outPath),budgets=jsOracleBudgets(plan);
 if(plan.schemaVersion!==1||!Array.isArray(plan.sources)||plan.sources.some(s=>s.type!==3||typeof s.key!=='string'||typeof s.api!=='string'||typeof s.ext!=='string'||s.jar))throw Error('JS_ORACLE_SOURCE_SCHEMA');
 await mkdir(output,{recursive:true,mode:0o700});await rm(join(output,'summary-private.json'),{force:true});
 for(const[index]of plan.sources.entries())await rm(join(output,index+'-private.json'),{force:true});
 const env={...process.env,ADB_MDNS:'0'},summary=[];
 const command=(args,timeout=20000)=>spawnSync(resolve(adbPath),['-s',serial,...args],{encoding:'utf8',timeout,maxBuffer:32*1024*1024,env});
 for(const[index,source]of plan.sources.entries()){
  prepareOracleAppState(command,'fresh-app-data');
  const device='/sdcard/Android/data/'+target+'/files/parity-js-oracle/result-'+index+'.json';command(['shell','rm','-f',device]);command(['logcat','-c']);
  const args=['shell','am','instrument','-w','-r','-e','manifestUrl',manifestUrl,'-e','manifestSha256',manifestSha256,'-e','sourceIndex',String(index),'-e','appDataPolicy','fresh-app-data',
   '-e','caseTimeoutMs',String(budgets.caseMs),'-e','initTimeoutMs',String(budgets.initMs),'-e','callTimeoutMs',String(budgets.callMs),instrument];
  const result=command(args,budgets.caseMs+20000),text=(result.stdout||'')+(result.stderr||'');await writeFile(join(output,index+'-instrument.txt'),text,{mode:0o600});
  const raw=/^INSTRUMENTATION_RESULT: report=(.*)$/m.exec(text),path=/^INSTRUMENTATION_RESULT: privateResultPath=(.*)$/m.exec(text),code=/^INSTRUMENTATION_CODE: (.*)$/m.exec(text);
  const row={sourceIndex:index,sourceSha256:sha(JSON.stringify(canonical(source))),adbExit:result.status,transportTimeout:result.error?.code==='ETIMEDOUT',instrumentationCode:code?Number(code[1]):null};
  if(raw)try{row.report=JSON.parse(raw[1]);}catch{row.invalidReport=true;}
  const pulled=await pullVerifiedJSResult({command,devicePath:path?.[1],output,index,source,manifestSha256,instrumentReport:row.report});
  Object.assign(row,{privateResultPulled:pulled.ok,...(pulled.ok?{privateResultSha256:pulled.sha256,privateResultBytes:pulled.bytes}:{collectionError:pulled.code})});
  const logs=command(['logcat','-d']);await writeFile(join(output,index+'-logcat.txt'),logs.stdout||'',{mode:0o600});command(['shell','am','force-stop',target]);
  summary.push(row);await writeFile(join(output,'summary-private.json'),JSON.stringify({schemaVersion:1,manifestSha256,runnerSha256:sha(await readFile(SELF)),budgets,applicationStatePolicy:'fresh-app-data',cases:summary},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({sourceIndex:index,ready:row.report?.initSuccess,calls:row.report?.calls?.map(call=>({step:call.discoveryStep,method:call.method,status:call.status})),error:row.report?.error,privateResultPulled:row.privateResultPulled}));
 }
}
if(process.argv[1]&&resolve(process.argv[1])===SELF)main().catch(error=>{console.error(JSON.stringify({code:'JS_ORACLE_FAILED',fingerprint:sha(error.message)}));process.exitCode=1;});
