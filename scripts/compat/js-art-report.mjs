// SPDX-License-Identifier: GPL-3.0-only
// Strict same-input original-product ART / NAS evidence audit. No provider execution.
import {createHash} from 'node:crypto';
import {readFile,writeFile,realpath,readdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import {canonical} from '../container/jar-matrix-probe.mjs';
import {jsSourceIdentity,verifyJsInputs,jsProbeBudgets,classifyJsResponse,verifyJsHostBinding} from '../container/js-source-probe.mjs';
import {summarizeJsCall,jsLogMarkers} from './js-source-report.mjs';
import {verifyJsSourceInputs} from './prepare-js-source-inputs.mjs';
import {androidJSCanonical,androidJSSourceSha256,jsOracleBudgets} from '../android/run-js-oracle.mjs';
import {jsOracleOfficialApkSha256} from '../android/js-apk-symbol-map.mjs';

const SELF=fileURLToPath(import.meta.url),ROOT=resolve(dirname(SELF),'../..');
const sha=value=>createHash('sha256').update(value).digest('hex'),semantic=value=>sha(JSON.stringify(canonical(value)));
const hashPattern=/^[a-f0-9]{64}$/;
const statuses=['nonempty','empty','not-implemented','invalid-json','network','failed','timeout','not-tested'];
const steps=[['home','homeContent'],['home-video','homeVideoContent'],['category-page1','categoryContent'],['category-page2','categoryContent'],['category-filter','categoryContent'],
 ['detail','detailContent'],['search','searchContent'],['search-page1','searchContent'],['search-detail','detailContent'],['player','playerContent']];
const check=(value,code)=>{if(!value)throw Error('JS_ART_REPORT_'+code);};
const safeClass=value=>typeof value==='string'&&/^[\w.$]{1,240}$/.test(value)?value:undefined;
const label=value=>{const t=String(value??'');return t.length>160||/(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(t)?'sha256:'+sha(t):t;};
const counts=calls=>Object.fromEntries(statuses.map(s=>[s,calls.filter(c=>c.status===s).length]));
async function json(path){let bytes=await readFile(path);return{bytes,value:JSON.parse(bytes),sha256:sha(bytes)};}

export function summarizeJSArtCall(call){
 const meta=call?.metadata;check(meta&&Array.isArray(call.params)&&steps.some(([s,m])=>s===meta.discoveryStep&&m===call.method)&&statuses.includes(meta.status),'ART_CALL_SCHEMA');
 check(meta.paramsSha256===sha(androidJSCanonical(call.params)),'ART_PARAMETER_HASH');
 const result={method:call.method,discoveryStep:meta.discoveryStep,paramsSha256:semantic(call.params),status:meta.status};
 if(meta.status==='not-tested'){check(call.params.length===0&&!Object.hasOwn(call,'value'),'ART_SKIPPED');result.reason=/^[a-z-]{1,80}$/.test(meta.reason||'')?meta.reason:'unrecorded';return result;}
 if(Object.hasOwn(call,'value')){
  const observed=classifyJsResponse(call.method,call.value);check(observed.status===meta.status||meta.status==='not-implemented'&&meta.methodProvenance?.inheritedBaseDefault===true,'ART_STATUS');
  if(typeof call.value==='string')check(meta.response?.sha256===sha(call.value)&&meta.response.bytes===Buffer.byteLength(call.value),'ART_RESPONSE_HASH');
  result.status=meta.status;result.response=observed.response;if(observed.returnedNull)result.returnedNull=true;
  if(call.method==='playerContent'&&observed.json){result.playbackUrlPresent=typeof observed.json.url==='string'&&!!observed.json.url.trim();result.returnedInputIdSame=observed.json.url===call.params[1];if(Number.isSafeInteger(observed.json.parse))result.parse=observed.json.parse;}
 }else{
  check(meta.error&&['failed','network','timeout'].includes(meta.status),'ART_MISSING_RESPONSE');
  result.error={type:safeClass(meta.error.type)||'UnknownError',fingerprint:hashPattern.test(meta.error.fingerprint)?meta.error.fingerprint:null};
 }
 if(meta.methodProvenance){const p=meta.methodProvenance;result.javaMethodProvenance={declaringClass:safeClass(p.declaringClass),baseSpiderClass:safeClass(p.baseSpiderClass),inheritedBaseDefault:p.inheritedBaseDefault===true,baseDelegatingOverload:p.baseDelegatingOverload===true};}
 return result;
}

export function validateJSArtCase(value,{source,sourceIndex,manifestSha256,budgets,symbolMapSha256}={}){
 const report=value?.report;check(report?.schemaVersion===1&&report.sourceIndex===sourceIndex&&report.manifestSha256===manifestSha256
  &&report.sourceSha256===androidJSSourceSha256(source)&&report.extSha256===sha(source.ext)&&report.api===label(source.api)&&report.siteKey===label(source.key),'ART_IDENTITY');
 check(report.targetApkSha256===jsOracleOfficialApkSha256&&report.symbolMapSha256===symbolMapSha256&&report.applicationStatePolicy==='fresh-app-data'
  &&equal(report.budgets,budgets)&&Number.isSafeInteger(report.applicationUid)&&report.applicationUid>=10000&&report.vmName==='Dalvik','ART_RUNTIME');
 check(typeof report.applicationConfigContext==='string'&&report.applicationConfigContext.startsWith('Original audited ApiConfig singleton initialized synchronously'),'ART_STARTUP_CONTEXT');
 check(report.moduleBytesVerified===true&&Array.isArray(report.modules)&&Array.isArray(value.privateCalls)&&value.privateCalls.length===10&&report.calls?.length===10,'ART_MODULE_OR_CALLS');
 return value.privateCalls.map((call,index)=>{check(equal(call.metadata,report.calls[index])&&call.method===steps[index][1]&&call.metadata.discoveryStep===steps[index][0],'ART_METHOD_ORDER');return summarizeJSArtCall(call);});
}

export function compareJSArtCalls(artCalls,nasCalls){
 check(artCalls.length===nasCalls.length,'REPLAY_CALL_COUNT');
 return artCalls.map((art,index)=>{
  const nas=nasCalls[index];check(art.method===nas.method&&art.metadata.discoveryStep===nas.metadata.discoveryStep,'REPLAY_METHOD');
  const a=summarizeJSArtCall(art),b=summarizeJsCall(nas),row={method:art.method,discoveryStep:a.discoveryStep,art:a,nas:b};
  if(b.status!=='not-tested'){check(equal(art.params,nas.params),'REPLAY_EXACT_PARAMS');row.paramsEqual=true;row.paramsSha256=semantic(art.params);}
  else check(nas.params.length===0,'REPLAY_SKIPPED');
  if(a.response?.semanticSha256&&b.response?.semanticSha256){row.semanticEqual=a.response.semanticSha256===b.response.semanticSha256;row.rawEqual=a.response.sha256===b.response.sha256;}
  row.observation=a.status==='not-tested'||b.status==='not-tested'?'not-tested':a.status!==b.status?'same-params-status-difference':row.semanticEqual===true?'same-params-same-json':row.semanticEqual===false?'same-params-live-response-difference':a.status==='empty'?'both-empty':'same-non-json-status';
  return row;
 });
}

async function validateNAS({workRoot,inputRoot,planInput,verified,arts}){
 const replayRoot=join(workRoot,'art-replay-bundle'),run=await json(join(replayRoot,'run-plan.json')),runPlan=run.value;
 const original=await json(join(workRoot,'nas-bundle/run-plan.json'));
 check(runPlan.schemaVersion===1&&runPlan.image===original.value.image&&runPlan.manifestSha256===planInput.sha256&&runPlan.mode==='replay'
  &&hashPattern.test(runPlan.probeSha256)&&runPlan.cases.length===3,'NAS_RUN_PLAN');
 const probeSnapshot=await readFile(join(workRoot,'nas-bundle/scripts/container/js-source-probe.mjs'));
 check(sha(probeSnapshot)===runPlan.probeSha256,'NAS_EXECUTED_PROBE');
 const copiedRun=await json(join(workRoot,'nas-art-replay/run-plan.json'));check(equal(copiedRun.value,runPlan),'NAS_RUN_COLLECTION');
 const binding=await verifyJsHostBinding(join(workRoot,'nas-bundle/host-binding'));
 const nasPlan=await json(join(workRoot,'nas-bundle/frozen/input-plan.json'));check(nasPlan.sha256===planInput.sha256,'NAS_MANIFEST');
 const sources=[];
 for(const[index,source]of planInput.value.sources.entries()){
  const stem='case-'+String(index).padStart(3,'0'),art=arts[index],pin=runPlan.cases[index],calls=await json(join(replayRoot,stem+'-calls.json'));
  check(pin.index===index&&pin.callsSha256===calls.sha256&&pin.artPrivateSha256===art.sha256,'NAS_PARENT_PINS');
  check(equal(calls.value.input,{source})&&calls.value.report?.sourceIdentitySha256===jsSourceIdentity(source)&&calls.value.report.inputSetSha256===verified.inputSetSha256
   &&equal(calls.value.privateCalls,art.value.privateCalls),'NAS_PARENT_ART_CALLS');
  const directory=join(workRoot,'nas-art-replay'),[raw,metadata,inspect,exitRaw]=await Promise.all([json(join(directory,stem+'-private.json')),json(join(directory,stem+'-metadata.json')),
   json(join(directory,stem+'.inspect.json')),readFile(join(directory,stem+'.exit.txt'),'utf8')]);
  const bundle=raw.value;check(bundle.schemaVersion===1&&bundle.manifestSha256===planInput.sha256&&bundle.runnerSha256===runPlan.probeSha256&&bundle.cases?.length===1
   &&equal(metadata.value,{...bundle,cases:bundle.cases.map(c=>c.report)}),'NAS_BUNDLE');
  const value=bundle.cases[0],report=value.report;check(equal(value.input,{source})&&report.sourceIndex===index&&report.manifestSha256===planInput.sha256
   &&report.sourceIdentitySha256===jsSourceIdentity(source)&&report.extSha256===sha(source.ext)&&report.sourceKeySha256===sha(source.key)&&report.apiSha256===sha(source.api)
   &&report.inputSetSha256===verified.inputSetSha256&&report.mode==='replay'&&report.nativeBridge===false&&report.httpMode==='frozen'&&report.replayInputSha256===calls.sha256
   &&equal(report.budgets,jsProbeBudgets(planInput.value)),'NAS_SOURCE');
  check(equal(report.modules,verified.moduleMetadata)&&equal(report.httpFixtures,verified.httpMetadata),'NAS_STATIC_INPUTS');
  check(report.hostBinding?.sourceSha256===binding.sourceSha256&&report.hostBinding?.manifestSha256===binding.manifestSha256&&report.hostBinding.sha256===binding.sha256
   &&equal(report.hostBinding.classes,binding.classes),'NAS_HOST_BINDING');
  check(report.cleanup?.closed===true&&report.cleanup?.workerExited===true&&report.cleanup?.temporaryDataRemoved===true,'NAS_CLEANUP');
  check(Array.isArray(value.privateCalls)&&value.privateCalls.length===10&&report.calls?.length===10&&value.privateCalls.every((call,i)=>equal(call.metadata,report.calls[i])),'NAS_CALLS');
  check(Array.isArray(report.runtimes)&&report.runtimes.length>0&&report.runtimes.every(r=>r.init?.ready===true&&r.cleanup?.closed===true&&r.cleanup.workerExited===true&&r.cleanup.temporaryDataRemoved===true),'NAS_RUNTIMES');
  const container=inspect.value.length===1?inspect.value[0]:null,exit=Number(exitRaw.trim());
  const args=['scripts/container/js-source-probe.mjs','--plan','/run/frozen/input-plan.json','--input-root','/input','--case-index',String(index),'--mode','replay','--calls','/calls/'+stem+'-calls.json','--host-binding','/run/host-binding','--output','/output/'+stem+'-private.json','--metadata','/output/'+stem+'-metadata.json'];
  check(container?.Image===runPlan.image&&container.Config?.User==='10001:10001'&&container.Path==='node'&&equal(container.Args,args)&&container.State?.Running===false
   &&container.State.Status==='exited'&&container.State.ExitCode===exit&&exit===0,'NAS_CONTAINER');
  check(['/input','/run','/calls','/opt/tvbox/scripts'].every(p=>container.Mounts.some(m=>m.Destination===p&&m.RW===false))&&container.Mounts.some(m=>m.Destination==='/output'&&m.RW===true),'NAS_MOUNTS');
  check(container.HostConfig?.ReadonlyRootfs===true&&container.HostConfig?.Privileged===false&&container.HostConfig?.RestartPolicy?.Name==='no','NAS_CONTAINER_POLICY');
  const callsCompared=compareJSArtCalls(art.value.privateCalls,value.privateCalls);
  sources.push({sourceIndex:index,name:source.key,sourceIdentitySha256:jsSourceIdentity(source),artPrivateSha256:art.sha256,nasPrivateSha256:raw.sha256,wrapperSHA256:calls.sha256,
   container:{imageId:runPlan.image,user:'10001:10001',exitCode:0,running:false,containerId:container.Id},cleanup:{closed:true,workerExited:true,temporaryDataRemoved:true},calls:callsCompared});
 }
 return{runPlanSha256:run.sha256,imageId:runPlan.image,probeSha256:runPlan.probeSha256,hostBinding:{sourceSha256:binding.sourceSha256,manifestSha256:binding.manifestSha256,sha256:binding.sha256},sources};
}

export async function buildJSArtReport({workRoot,inputRoot,includeNAS=true,generatedAt=new Date().toISOString()}={}){
 await verifyJsSourceInputs({directory:inputRoot});
 const planInput=await json(join(inputRoot,'input-plan.json')),plan=planInput.value,verified=await verifyJsInputs(plan,{inputRoot});
 const build=await json(join(workRoot,'art/build-v2/build-metadata.json')),symbols=await json(join(workRoot,'art/build-v2/js-symbol-map.json'));
 const apk=await readFile(join(workRoot,'art/build-v2/tvbox-art-js-oracle.apk'));
 check(build.value.targetApk.sha256===jsOracleOfficialApkSha256&&build.value.targetApk.originalUnmodified===true&&build.value.signing.certificateMatchesOfficialApk===true
  &&build.value.signing.certificateSha256==='4b9421de6d46778f6280b180179413fa6973845f0a0132c00f6800c06464e051'&&sha(apk)===build.value.instrumentationApk.sha256
  &&build.value.instrumentationApk.bytes===apk.length&&build.value.symbolMap.sha256===symbols.sha256&&symbols.value.apkSha256===jsOracleOfficialApkSha256,'BUILD_PINS');
 const sourceFiles={'javaSha256':'scripts/android/JsOracleInstrumentation.java','manifestSha256':'scripts/android/AndroidJsManifest.xml','buildScriptSha256':'scripts/android/build-js-oracle.mjs','symbolInspectorSha256':'scripts/android/js-apk-symbol-map.mjs'};
 for(const[key,file]of Object.entries(sourceFiles))check(sha(await readFile(join(ROOT,file)))===build.value.source[key],'BUILD_SOURCE');
 const collection=await json(join(workRoot,'art/results-v2/summary-private.json')),budgets=jsOracleBudgets(plan);
 check(collection.value.manifestSha256===planInput.sha256&&collection.value.runnerSha256===sha(await readFile(join(ROOT,'scripts/android/run-js-oracle.mjs')))
  &&collection.value.cases.length===3&&equal(collection.value.budgets,budgets)&&collection.value.applicationStatePolicy==='fresh-app-data','COLLECTION_PLAN');
 const artSources=[],arts=[];
 for(const[index,source]of plan.sources.entries()){
  const result=await json(join(workRoot,'art/results-v2',index+'-private.json')),meta=result.value.report,collected=collection.value.cases[index];
  check(collected.sourceIndex===index&&collected.privateResultPulled===true&&collected.privateResultSha256===result.sha256&&collected.privateResultBytes===result.bytes.length
   &&equal(collected.report,meta)&&collected.adbExit===0&&collected.transportTimeout===false&&collected.instrumentationCode===-1,'ART_COLLECTED_BYTES');
  const calls=validateJSArtCase(result.value,{source,sourceIndex:index,manifestSha256:planInput.sha256,budgets,symbolMapSha256:symbols.sha256});
  check(equal(meta.modules,verified.moduleMetadata)&&meta.staticFixtureCount===verified.httpMetadata.length,'ART_FROZEN_MODULES');
  const fixtureHashes=new Set(plan.http.fixtures.map(f=>sha(new URL(f.url).href)));
  check(meta.staticFixtureHits.length===fixtureHashes.size&&meta.staticFixtureHits.every(h=>fixtureHashes.has(h.urlSha256)&&Number.isSafeInteger(h.hits)&&h.hits>=0),'ART_FIXTURE_HITS');
  check(meta.cleanup?.restoredFixturesAndCaches===true&&meta.cleanup.forceStopRequired===false&&meta.initSuccess===true&&meta.loadSuccess===true&&meta.completed===true,'ART_CLEANUP_READY');
  const http=(meta.unmappedHTTP||[]).map(row=>{check(hashPattern.test(row.urlSha256)&&typeof row.method==='string','ART_HTTP_METADATA');return{urlSha256:row.urlSha256,method:row.method,
   ...(Number.isSafeInteger(row.status)?{status:row.status}:{}),...(Number.isSafeInteger(row.declaredBytes)?{declaredBytes:row.declaredBytes}:{}),...(row.error?{errorType:safeClass(row.error.type),fingerprint:row.error.fingerprint}:{})};});
  artSources.push({sourceIndex:index,name:source.key,sourceIdentitySha256:jsSourceIdentity(source),nodeCanonicalSourceSha256:semantic(source),aospCanonicalSourceSha256:meta.sourceSha256,
   sourceKeySha256:sha(source.key),apiSha256:sha(source.api),extSha256:sha(source.ext),privateResultSha256:result.sha256,ready:true,applicationUid:meta.applicationUid,androidSdk:meta.androidSdk,abi:meta.abi,
   modules:meta.modules,staticFixtureHits:meta.staticFixtureHits,unmatchedBusinessHTTP:http,cleanup:meta.cleanup,calls});arts.push(result);
 }
 const initial=await json(join(workRoot,'art/results/summary-private.json'));
 check(initial.value.manifestSha256===planInput.sha256&&initial.value.cases.length===3&&initial.value.cases.every((row,index)=>row.privateResultPulled===false
  &&row.collectionError==='PRIVATE_IDENTITY'&&row.report?.sourceSha256===androidJSSourceSha256(plan.sources[index])&&row.sourceSha256===semantic(plan.sources[index])),'INITIAL_COLLECTION_REJECTION');
 const initialEvidence=[];
 for(const[index]of plan.sources.entries()){
  const instrument=await readFile(join(workRoot,'art/results',index+'-instrument.txt')),log=await readFile(join(workRoot,'art/results',index+'-logcat.txt'));
  initialEvidence.push({sourceIndex:index,instrumentSha256:sha(instrument),logcatSha256:sha(log),privateResultVerified:false,providerFailureClaim:false});
 }
 const nas=includeNAS?await validateNAS({workRoot,inputRoot,planInput,verified,arts}):undefined;
 return{schemaVersion:1,generatedAt,scope:'Three exact configured pure-JS sources, finite sampled methods and arguments; no helper JAR or media execution, no full Android API parity claim',
  sourceScope:'Original API/key/ext strings unchanged. Both hosts use captured static code/rules; business HTTP remains live. This ART run is distinct from independently derived NAS discovery groups.',
  startupContext:'Original audited ApiConfig singleton/default local IJK and advertisement defaults initialized synchronously before source JsLoader creation; no config subscription or JAR load requested. This prevents the first lazy networking access from clearing an already active original JS instance.',
  hashScope:'AOSP source/argument producer hashes verify AOSP slash-escaped canonical serialization; Node identities and response semantic hashes are recomputed independently. Producer semantic hashes are not compared across hosts.',
  playerScope:'playerContent JSON only. parse=1 requests further parsing; returned URL equal to input ID is pass-through, not a confirmed media URL or playback result.',
  manifestSha256:planInput.sha256,originalApkSha256:jsOracleOfficialApkSha256,instrumentationApkSha256:sha(apk),buildMetadataSha256:build.sha256,symbolMapSha256:symbols.sha256,
  artifactBytes:apk.length,buildSource:build.value.source,collectorSha256:collection.value.runnerSha256,collectionSha256:collection.sha256,modules:verified.moduleMetadata,httpFixtures:verified.httpMetadata,
  art:{sources:artSources,summary:{sources:3,ready:3,methodStatuses:counts(artSources.flatMap(s=>s.calls)),cleanupPassed:3}},
  ...(nas?{nasReplay:nas,replaySummary:{sources:nas.sources.length,exactAttemptedPairs:nas.sources.flatMap(s=>s.calls).filter(c=>c.paramsEqual).length,
   artStatuses:counts(nas.sources.flatMap(s=>s.calls.map(c=>c.art))),nasStatuses:counts(nas.sources.flatMap(s=>s.calls.map(c=>c.nas))),
   sameJSON:nas.sources.flatMap(s=>s.calls).filter(c=>c.semanticEqual===true).length,liveJSONDifferences:nas.sources.flatMap(s=>s.calls).filter(c=>c.semanticEqual===false).length,
   statusDifferences:nas.sources.flatMap(s=>s.calls).filter(c=>c.observation==='same-params-status-difference').length}}:{}),
  initialAttempt:{summarySha256:initial.sha256,status:'collector-hash-serialization-and-startup-context-incomplete',providerFailureClaim:false,
   explanation:'First collection rejected the correct source because Node and AOSP slash escaping differed. The initial direct-loader process also lazily initialized original ApiConfig during first business HTTP, clearing original JS instances. Original results remain unchanged; corrected execution is a separate fresh run.',evidence:initialEvidence},
  reportDependencies:await Promise.all(['scripts/compat/js-source-report.mjs','scripts/container/js-source-probe.mjs','scripts/android/run-js-oracle.mjs'].map(async file=>({file,sha256:sha(await readFile(join(ROOT,file)))}))),
  reporterSha256:sha(await readFile(SELF))};
}

export function jsARTMarkdown(report){
 const t=new Date(report.generatedAt).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false});
 const lines=['# 真实 JS 的原版 Android 与 NAS 同参数验证','',`生成时间：${t}（Asia/Shanghai）`,'','固定三个配置源，代码与规则冻结，业务请求在线。API、key、ext 保留原值；仅覆盖记录的有限参数。原版 APK 未修改，独立同证书 instrumentation 运行在应用 UID。','',
  '启动前先初始化官方 ApiConfig 单例及本地默认配置，再创建官方 JsLoader/JsSpider，避免首次网络请求才触发清理当前实例；此步骤未请求订阅或 JAR 加载。','',
  '| 状态 | ART | NAS 原参数重放 |','| --- | ---: | ---: |',...statuses.map(s=>`| ${s} | ${report.art.summary.methodStatuses[s]} | ${report.replaySummary?.nasStatuses[s]??'未执行'} |`),''];
 for(const source of report.art.sources){const replay=report.nasReplay?.sources.find(s=>s.sourceIndex===source.sourceIndex);lines.push(`## ${source.name}`,'',
  '| 步骤 | ART | NAS | 同参数比较 |','| --- | --- | --- | --- |',...source.calls.map((call,i)=>{const p=replay?.calls[i];return`| ${call.discoveryStep} | ${call.status} | ${p?.nas.status??'未测试'} | ${p?.observation??'未测试'} |`;}),'');
  for(const[host,calls]of[['ART',source.calls],['NAS',replay?.calls.map(c=>c.nas)||[]]])for(const c of calls.filter(c=>c.method==='playerContent'))lines.push(`${host} 播放解析：${c.status}，parse=${c.parse??'未声明'}，${c.returnedInputIdSame?'URL 与输入 ID 相同（透传）':'返回 URL 异于输入 ID或未提供'}。`,'');
 }
 if(report.replaySummary)lines.push(`实际同参数重放 ${report.replaySummary.exactAttemptedPairs} 次；JSON 语义相同 ${report.replaySummary.sameJSON} 次，在线响应不同 ${report.replaySummary.liveJSONDifferences} 次，状态不同 ${report.replaySummary.statusDifferences} 次。在线差异需要结合时间、网络和上游响应判因，不能单独归为核心缺陷。`,'');
 lines.push('播放仅验证 playerContent 返回。parse=1 或 URL 原样透传都不能称为已解析出媒体，更没有验证播放器。空搜索是本次真实观察；缺少真实参数的步骤保持未测试。','',
  '初轮因 AOSP/Node 斜线转义的输入哈希差异被采集器拒绝，且直接 loader 的启动上下文不完整；三条原始日志与状态记录保留，不能计为脚本或核心失败。修正后另起完整新一轮，没有改写旧结果。','');
 return lines.join('\n');
}
async function main(){const args=process.argv.slice(2),opt=n=>{const i=args.indexOf('--'+n);return i<0?undefined:args[i+1];};const report=await buildJSArtReport({workRoot:resolve(opt('work-root')),inputRoot:resolve(opt('input-root')),includeNAS:!args.includes('--art-only')});
 await writeFile(resolve(opt('output-json')),JSON.stringify(report,null,2)+'\n',{flag:'wx'});await writeFile(resolve(opt('output-md')),jsARTMarkdown(report),{flag:'wx'});console.log(JSON.stringify({art:report.art.summary,replay:report.replaySummary}));}
if(process.argv[1]&&resolve(process.argv[1])===SELF)main().catch(error=>{console.error(JSON.stringify({code:/^JS_ART_REPORT_[A-Z_]+$/.test(error.message)?error.message:'JS_ART_REPORT_INPUT_OR_IO',fingerprint:sha(error.message)}));process.exitCode=1;});
