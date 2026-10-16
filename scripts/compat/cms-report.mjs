// SPDX-License-Identifier: GPL-3.0-only
// Offline byte/identity audit; never downloads from a source or executes scripts.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {classifyBusinessResponse} from '../container/working-source-probe.mjs';
import {cmsRequest} from '../../backend/cms-runtime/index.mjs';
const SELF=fileURLToPath(import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const identity=v=>sha(JSON.stringify(canonical(v)));
const check=(x,code)=>{if(!x)throw new Error('CMS_REPORT_'+code);};
const statuses=['nonempty','empty','invalid-response','network','failed','timeout','not-tested'];
const steps=['home','home-video','category-page1','category-page2','category-filter','detail','search','search-page1','search-detail','player'];
const safe=x=>typeof x==='string'&&x.length<120&&!/[?:=&\r\n]|:\/\/|token[:\s]|bearer\s/i.test(x)?x:'sha256:'+sha(String(x));
async function json(path){const bytes=await readFile(path);return {bytes,value:JSON.parse(bytes),sha256:sha(bytes)};}
const count=calls=>Object.fromEntries(statuses.map(s=>[s,calls.filter(c=>c.status===s).length]));
export function validateCmsCase(raw,metadata,{source,sourceIndex,manifestSha256,runnerSha256,mode,categoryPolicy}={}){
 const r=raw.report;check(raw.schemaVersion===1&&raw.runnerSha256===runnerSha256&&equal(raw.source,source)&&r?.sourceSha256===identity(source)&&r.sourceIndex===sourceIndex&&r.manifestSha256===manifestSha256,'IDENTITY');
 check(equal(metadata,{schemaVersion:1,runnerSha256,report:r}),'METADATA');check(r.transportMode===(mode==='live'?'live-http':'exact-frozen-http-replay')&&r.categoryPolicy===categoryPolicy&&r.timeoutMs===12000,'MODE');
 check(r.configurationAccepted===true&&r.cleanup?.closed===true&&r.noScriptInstances===true&&r.cmsState?.inFlight===0,'LIFECYCLE');check(raw.privateCalls.length===10&&r.calls.length===10,'SLOTS');
 const responses=new Map(),calls=[];
 for(const[i,c]of raw.privateCalls.entries()){
  const m=c.metadata;check(equal(m,r.calls[i])&&m.step===steps[i]&&m.method===c.method,'CALL_METADATA');
  const row={step:m.step,method:c.method,status:m.status==='invalid-json'?'invalid-response':m.status};check(statuses.includes(row.status),'STATUS');
  if(m.status==='not-tested'){check(c.params.length===0&&!Object.hasOwn(c,'value'),'SKIPPED');row.reason=safe(m.reason);calls.push(row);continue;}
  check(m.paramsSha256===identity(c.params),'PARAMS');row.paramsSha256=m.paramsSha256;row.origin=m.origin;
  if(responses.has(m.origin))check(m.derivedResponseSha256===responses.get(m.origin),'PARAMETER_PROVENANCE');
  if(Object.hasOwn(c,'value')){const observed=classifyBusinessResponse(c.method,c.value);check(observed.status===m.status&&equal(observed.response,m.response),'RESPONSE');responses.set(m.step,sha(c.value));row.response=observed.response;if(c.method==='playerContent'){row.parse=observed.json.parse;row.returnedInputIdSame=observed.json.url===c.params[1];}}
  else{check(m.error&&['invalid-response','network','failed','timeout'].includes(row.status),'FAILURE');row.error={category:m.error.category,...(m.error.code?{code:m.error.code}:{}),fingerprint:m.error.fingerprint};}
  calls.push(row);
 }
 check(Array.isArray(raw.http)&&raw.http.length===r.http.length,'HTTP_COUNT');
 for(const[i,h]of raw.http.entries()){
  const bytes=Buffer.from(h.bodyBase64,'base64'),m=r.http[i];check(sha(bytes)===h.bodySha256&&bytes.length===h.bodyBytes&&m.bodySha256===h.bodySha256&&m.bodyBytes===h.bodyBytes&&m.status===h.status,'HTTP_BYTES');
  check(m.requestUrlSha256===sha(h.request.url)&&m.finalUrlSha256===sha(h.finalUrl)&&h.request.method==='GET','HTTP_IDENTITY');
  if(['homeContent','categoryContent','searchContent'].includes(h.purpose)){
   const call=raw.privateCalls.filter(c=>c.method===h.purpose&&Object.hasOwn(c,'value')||c.method===h.purpose&&c.metadata.error).find(c=>cmsRequest(source,c.method,c.params).url===h.request.url);
   check(call,'PROTOCOL_REQUEST');
  }
 }
 const replayComplete=mode!=='replay'||r.replay?.consumed===r.replay?.expected&&!r.replayIncomplete;
 if(!replayComplete)check(r.replayIncomplete===true&&raw.privateCalls.some(c=>c.metadata.error?.code==='CMS_REPLAY_REQUEST_MISMATCH'),'REPLAY_UNEXPLAINED_INCOMPLETE');
 return {sourceIndex,name:safe(source.key),type:source.type,sourceSha256:identity(source),configurationAccepted:true,noScriptInstances:true,cleanup:{closed:true},calls,observations:count(calls),http:r.http,
  ...(mode==='replay'?{replayValidation:replayComplete?'complete':'harness-input-incomplete',sourceCompatibilityInference:replayComplete?'paired-observation-only':'none'}:{})};
}
export function validateCmsContainer(inspect,exit,{image,index,tag,mode}={}){
 const c=Array.isArray(inspect)&&inspect.length===1?inspect[0]:undefined;check(c?.Image===image&&c.Config?.User==='10001:10001'&&c.State?.Status==='exited'&&c.State.Running===false&&c.State.ExitCode===exit&&exit===0,'CONTAINER');
 const stem='case-'+String(index).padStart(3,'0'),args=['scripts/container/cms-source-probe.mjs','--plan','/input/input-plan.json','--case-index',String(index),...(mode==='replay'?['--replay-network','/reference/'+stem+'-private.json']:[]),'--output','/output/'+stem+'-private.json','--metadata','/output/'+stem+'-metadata.json'];
 check(c.Path==='node'&&equal(c.Args,args)&&c.HostConfig.ReadonlyRootfs===true&&c.HostConfig.Privileged===false&&c.HostConfig.RestartPolicy.Name==='no','CONTAINER_POLICY');
 check(['/input','/reference'].every(p=>c.Mounts.some(m=>m.Destination===p&&m.RW===false))&&c.Mounts.some(m=>m.Destination==='/output'&&m.RW===true),'MOUNTS');if(mode==='replay')check(c.HostConfig.NetworkMode==='none','OFFLINE_REPLAY');
 return {imageId:image,user:'10001:10001',exited:true,exitCode:exit,network:mode==='replay'?'none':'online',containerId:c.Id,inspectSha256:identity(inspect)};
}
export async function buildCmsReport({workRoot,inputRoot,generatedAt=new Date().toISOString()}={}){
 const freeze=await json(join(inputRoot,'freeze.json')),original=await json(join(inputRoot,'input-plan.json'));
 for(const p of freeze.value.files){const bytes=await readFile(join(inputRoot,p.path));check(bytes.length===p.bytes&&sha(bytes)===p.sha256,'FREEZE');}
 const catalogueRoot=join(dirname(resolve(inputRoot)),'jar-round1-20261015'),catalogue=await json(join(catalogueRoot,'freeze.json'));
 check(catalogue.value.inputSetSha256===original.value.sourceInputSetSha256,'ORIGINAL_INPUT_SET');
 for(const[index,source]of original.value.sources.entries()){
  const origin=original.value.origins[index],capture=catalogue.value.captures.find(c=>c.id===origin.captureId&&c.accepted&&!c.partial);
  check(capture&&capture.configSha256===origin.configSha256,'ORIGINAL_CAPTURE');const config=await json(join(catalogueRoot,capture.configFile));
  check(config.sha256===origin.configSha256&&config.value.sites.some(s=>equal(s,source))&&origin.sourceSha256===identity(source),'ORIGINAL_SOURCE_BYTES');
 }
 const imageInput=await json(join(workRoot,'image-inspect-v2.json')),image=imageInput.value[0];check(image.Os==='linux'&&image.Architecture==='amd64','IMAGE_ARCH');
 const imagePins=await json(join(workRoot,'image-context-pins-v2.json'));check(imagePins.value.image===image.Id,'IMAGE_SOURCE_ID');
 for(const pin of imagePins.value.files){check(typeof pin.path==='string'&&!pin.path.startsWith('/')&&!pin.path.split('/').includes('..'),'IMAGE_SOURCE_PATH');const b=await readFile(join(workRoot,'image-context-v2',pin.path));check(b.length===pin.bytes&&sha(b)===pin.sha256,'IMAGE_SOURCE_BYTES');}
 const tracks=[];for(const tag of ['final','leaf']){
  const run=await json(join(workRoot,'run-'+tag,'run-plan.json')),plan=await json(join(workRoot,'run-'+tag,'input-plan.json'));
  const policy=tag==='final'?'first-class':'recommendation-type';check(equal(plan.value,{...original.value,categoryPolicy:policy})&&run.value.image===image.Id&&run.value.planSha256===plan.sha256,'PLAN');
  const runner=await readFile(join(workRoot,'image-context-v2/scripts/container/cms-source-probe.mjs'));check(sha(runner)===run.value.runnerSha256,'RUNNER');
  const sources=[];for(const[index,source]of plan.value.sources.entries()){
   const paired={};for(const mode of ['live','replay']){
    const root=join(workRoot,'nas-'+tag,mode),base='case-'+String(index).padStart(3,'0');
    const[raw,metadata,inspect,exitRaw]=await Promise.all([json(join(root,base+'-private.json')),json(join(root,base+'-metadata.json')),json(join(root,base+'.inspect.json')),readFile(join(root,base+'.exit.txt'),'utf8')]);
    const row=validateCmsCase(raw.value,metadata.value,{source,sourceIndex:index,manifestSha256:plan.sha256,runnerSha256:run.value.runnerSha256,mode,categoryPolicy:policy});
    row.container=validateCmsContainer(inspect.value,Number(exitRaw.trim()),{image:image.Id,index,tag,mode});row.privateSha256=raw.sha256;paired[mode]={row,raw:raw.value};
   }
   let comparison;
   if(paired.replay.row.replayValidation==='complete'){
    comparison=paired.live.raw.privateCalls.map((a,i)=>{const b=paired.replay.raw.privateCalls[i];check(equal(a.params,b.params),'REPLAY_PARAMS');check(a.metadata.status===b.metadata.status,'REPLAY_STATUS');if(Object.hasOwn(a,'value'))check(a.value===b.value,'REPLAY_RESPONSE');return {step:a.metadata.step,paramsEqual:true,statusEqual:true,rawResponseEqual:Object.hasOwn(a,'value')?a.value===b.value:null};});
    check(equal(paired.live.raw.http,paired.replay.raw.http),'REPLAY_HTTP');
   }else{
    check(paired.live.raw.privateCalls.some(c=>c.metadata.status==='network'&&!c.metadata.error?.code),'UNEXPLAINED_REPLAY_GAP');
    comparison=steps.map(step=>({step,observation:'not-comparable-harness-missing-transport-failure-event'}));
   }
   sources.push({live:paired.live.row,replay:paired.replay.row,comparison});
  }
  tracks.push({name:tag==='final'?'primary-original-first-category':'supplemental-category-from-real-recommendation',policy,planSha256:plan.sha256,sources,live:count(sources.flatMap(s=>s.live.calls)),replay:count(sources.filter(s=>s.replay.replayValidation==='complete').flatMap(s=>s.replay.calls)),completeReplays:sources.filter(s=>s.replay.replayValidation==='complete').length,harnessIncompleteReplays:sources.filter(s=>s.replay.replayValidation!=='complete').length});
 }
 const doctor=await json(join(workRoot,'cms-doctor.json')),doctorInspect=await json(join(workRoot,'cms-doctor.inspect.json'));check(doctor.value.ok===true&&doctor.value.cleanup.closed===true&&doctor.value.cleanup.httpStopped===true,'DOCTOR');check(doctorInspect.value[0].Image===image.Id&&doctorInspect.value[0].State.ExitCode===0&&doctorInspect.value[0].State.Running===false&&doctorInspect.value[0].HostConfig.NetworkMode==='none','DOCTOR_CONTAINER');
 return {schemaVersion:1,generatedAt,scope:'Four exact captured XML/JSON CMS configurations; bounded production-session method calls and byte-identical offline HTTP replay. Not all CMS sources or Android/ART parity.',
  authority:'Pinned TVBoxOS ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1 HTTP branches and original JSON model conversions; XML uses explicit secured DOM binding, not XStream.',
  playbackScope:'Metadata only, no media bytes, player/decoder/transcoder or external parse provider tested.',searchScope:'Two search signatures are exercised; baseline CMS search ignores page/quick flags, so this is not two search pages.',
  image:{id:image.Id,tag:'tvbox-core:linux-amd64-cms-20261016',bytes:image.Size,base:'sha256:808d15d8ac47fed98670eda0e33ffcb00a12b637114690b94536e53e40e447e7'},
  inputFreezeSha256:freeze.sha256,originalPlanSha256:original.sha256,originalCatalogueFreezeSha256:catalogue.sha256,imageSourcePinsSha256:imagePins.sha256,tracks,offlineDoctor:doctor.value,doctorSha256:doctor.sha256,
  limitations:['Live errors and empty parent categories are retained; supplemental category IDs come from actual recommendation rows and the original class list.','XML external entities/DOCTYPE/XInclude are disabled; general XStream equivalence and Android UI/cache async behavior remain unverified.','Node HTTP transport does not implement Android hosts/proxy/DOH/cookie/client state.','Local loopback /file/ ext has no implicitly bound NAS storage root.','JAR compatibility remains paused; old full-JAR matrix belongs to the retained base image, not this new CMS image.'],reporterSha256:sha(await readFile(SELF))};
}
export function cmsReportMarkdown(r){const lines=['# JSON／XML CMS接口源 NAS 业务验收','',`生成时间：${new Date(r.generatedAt).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false})}（Asia/Shanghai）`,'',`镜像：${r.image.id}。四份原配置；分类、搜索、详情和解析返回通过正式订阅会话调用。断网重放固定实际响应，并保留空值和HTTP/解析失败。`,'',
 '播放仅验证元数据；没有下载媒体。两种搜索签名在CMS协议中共享不分页搜索，不计作搜索第二页。',''];
 for(const t of r.tracks){lines.push('## '+t.name,'','| 源 | 类型 | 非空 | 空 | HTTP失败 | 响应解析失败 | 未测试 |','| --- | --- | ---: | ---: | ---: | ---: | ---: |');for(const s of t.sources)lines.push(`| ${s.live.name} | ${s.live.type===1?'JSON':'XML'} | ${s.live.observations.nonempty} | ${s.live.observations.empty} | ${s.live.observations.network} | ${s.live.observations['invalid-response']} | ${s.live.observations['not-tested']} |`);lines.push('',`断网重放完整 ${t.completeReplays}/4，工具输入记录不足 ${t.harnessIncompleteReplays}/4。完整重放的状态、参数和实际返回字节均相同；补测不覆盖原首分类结果。`,'');
  for(const s of t.sources.filter(s=>s.replay.replayValidation!=='complete'))lines.push(`${s.live.name}：在线在取得响应前发生网络失败，没有可冻结响应字节，现有按响应顺序的重放工具产生请求错配。该重放单列为工具输入不足，不计CMS源失败，也不计通过。`,'');
  for(const s of t.sources){lines.push('### '+s.live.name,'','| 步骤 | 结果 |','| --- | --- |',...s.live.calls.map(c=>`| ${c.step} | ${c.status}${c.error?.code?' ('+c.error.code+')':''} |`),'');}
 }
 lines.push('## 验证边界','',...r.limitations.map(s=>'- '+s),'','固定源码的JSON模型方法保持原实现；XML采用JDK DOM适配并拒绝外部实体，尚无实际ART同输入业务对照。不能据此宣称所有CMS源兼容或原版安卓完全等价。','');return lines.join('\n');}
async function main(){const a=process.argv.slice(2),get=n=>{const i=a.indexOf('--'+n);return i<0?undefined:a[i+1];};const r=await buildCmsReport({workRoot:resolve(get('work-root')),inputRoot:resolve(get('input-root'))});for(const[p,b]of[[get('output-json'),JSON.stringify(r,null,2)+'\n'],[get('output-md'),cmsReportMarkdown(r)]])await writeFile(resolve(p),b,{flag:'wx'});console.log(JSON.stringify({image:r.image,tracks:r.tracks.map(t=>({name:t.name,live:t.live}))}));}
if(process.argv[1]&&resolve(process.argv[1])===SELF)main().catch(error=>{console.error(JSON.stringify({code:/^CMS_REPORT_[A-Z_]+$/.test(error.message)?error.message:'CMS_REPORT_IO',fingerprint:sha(error.message)}));process.exitCode=1;});
