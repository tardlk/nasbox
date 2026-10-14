// SPDX-License-Identifier: GPL-3.0-only
// Explicit real-code probe. No remote code or decrypted payload is retained.
import{readFileSync,writeFileSync,mkdtempSync,rmSync}from'node:fs';import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{createFullSubscriptionLoader}from'../../backend/subscription/full-loader.mjs';import{createSpiderRuntime}from'../../backend/spider-runtime/index.mjs';
const digest=(bytes,kind='sha256')=>createHash(kind).update(bytes).digest('hex');
export async function probeNativeArtifacts(config,jarPath,{homeKeys=['玩偶','Aid','点我切源','seed','MTV'],timeoutMs=45000}={}){
 const errors={};let tail='';const runtime=createSpiderRuntime({nativeBridge:true,timeoutMs,onStderr:chunk=>{const lines=(tail+chunk).split('\n');tail=lines.pop();for(const line of lines){const error=line.match(/(?:Caused by: )?((?:java|android)\.[\w.$]*(?:Exception|Error))(?=:)/);if(error)errors[error[1]]=(errors[error[1]]||0)+1;}}});
 const rows=[];try{
  const load=await runtime.loadMain(jarPath);if(!load.loaded)throw new Error('Native JAR initialization failed: '+load.failure);
  for(const source of config.sites.filter(s=>s.type===3&&s.api.startsWith('csp_'))){const spider=await runtime.getCSP(source);rows.push({key:source.key,api:source.api,ready:spider.ready,className:spider.className});}
  for(const key of homeKeys){const source=config.sites.find(s=>s.key===key),row=rows.find(s=>s.key===key);if(!source||!row?.ready)continue;
   const spider=await runtime.getCSP(source),value=await runtime.call(spider.token,'homeContent',[true]),json=JSON.parse(value);
   row.home={bytes:Buffer.byteLength(value),sha256:digest(value),keys:Object.keys(json),classes:json.class?.length??null,list:json.list?.length??null};
  }
  const initialized=await runtime.request({operation:'nativeState'});await runtime.clear('jar');const cleared=await runtime.request({operation:'nativeState'});if(cleared.workerPid===initialized.workerPid)throw new Error('Native worker was not replaced');
  const reload=await runtime.loadMain(jarPath);let reloadedSpider=null;const first=config.sites.find(s=>s.key==='Aid')||config.sites.find(s=>s.type===3&&s.api.startsWith('csp_'));
  if(reload.loaded&&first)reloadedSpider=await runtime.getCSP(first);
  return{host:{platform:process.platform,architecture:process.arch},scope:'Real ARM native JAR registration/getLoader/decrypted DEX translation/getSpider/init/home on host JVM; no Android/ART or Linux/NAS evidence',rows,
   observations:{sites:rows.length,ready:rows.filter(r=>r.ready).length,homes:rows.filter(r=>r.home).length},initialized,cleared,reload:{loaded:reload.loaded,ready:reloadedSpider?.ready??false},diagnosticCategories:errors};
 }finally{await runtime.close();}
}
export async function probeNativeSource(url){const directory=mkdtempSync(join(tmpdir(),'tvbox-native-source-'));let loader;
 try{
  loader=createFullSubscriptionLoader();await loader.load({apiUrl:url});const config=await loader.getConfig();await loader.close();loader=null;
  const[jarUrl,md5]=config.globals.spider.split(';md5;');const response=await fetch(jarUrl,{headers:{'User-Agent':'okhttp/3.12.11'},signal:AbortSignal.timeout(25000)});if(!response.ok){await response.body?.cancel();throw new Error('Artifact HTTP '+response.status);}
  const chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;if(total>64*1024*1024)throw new Error('Artifact size limit');chunks.push(Buffer.from(chunk));}const bytes=Buffer.concat(chunks);
  if(md5&&digest(bytes,'md5')!==md5)throw new Error('Subscription JAR MD5 differs');const path=join(directory,'spider.jar');writeFileSync(path,bytes);
  const report=await probeNativeArtifacts(config,path);return{date:new Date().toISOString(),subscription:{url,sites:config.sites.length},globalJar:{bytes:bytes.length,sha256:digest(bytes),md5:digest(bytes,'md5'),advertisedMd5:md5??null},...report};
 }finally{try{if(loader)await loader.close();}finally{rmSync(directory,{recursive:true,force:true});}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const[url,output]=process.argv.slice(2);if(!url||!output)throw new Error('Usage: node scripts/compat/native-source-probe.mjs SUBSCRIPTION_URL REPORT_JSON');const report=await probeNativeSource(url);writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.observations));}
