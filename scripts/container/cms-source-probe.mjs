// SPDX-License-Identifier: GPL-3.0-only
// Runs the production subscription->CMS dispatch. Inputs/raw HTTP remain private.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createExecutableSubscriptionSession} from '../../backend/spider-runtime/session.mjs';
import {chooseCategory,chooseFilter,chooseKeyword,choosePlayer,classifyBusinessResponse} from './working-source-probe.mjs';
const SELF=fileURLToPath(import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>sha(JSON.stringify(canonical(v)));
const safe=v=>String(v).length<120&&!/[?:=&\r\n]|:\/\/|token[:\s]|bearer\s/i.test(String(v))?String(v):'sha256:'+sha(String(v));
export function cmsFailure(error){const code=error.code||'',message=String(error.message||error);return {category:/TIMEOUT|Abort|Timeout|timed out/.test(code+message)?'timeout':/CMS_INVALID_BODY/.test(code+message)?'invalid-response':/CMS_HTTP|fetch failed|ECONN|ENOTFOUND|TLS|SSL/.test(code+message)?'network':/CMS_.*(?:ARGUMENT|SOURCE_SCHEMA|HTTP_REQUIRED)/.test(code+message)?'input':'execution',code:/^[A-Z_0-9]{1,70}$/.test(code)?code:undefined,fingerprint:sha(message),errorType:typeof error.errorType==='string'?error.errorType:undefined};}
export function recordedCmsFetch(records){
 if(!Array.isArray(records)||records.length>128)throw new Error('CMS_REPLAY_SCHEMA');let total=0;
 for(const r of records){const bytes=Buffer.from(r.bodyBase64||'','base64');total+=bytes.length;if(bytes.length!==r.bodyBytes||sha(bytes)!==r.bodySha256||bytes.length>6*1024*1024||total>64*1024*1024||r.request?.method!=='GET'||!Number.isInteger(r.status)||r.status<100||r.status>599)throw new Error('CMS_REPLAY_CHECKSUM');}
 const entries=[];for(const r of records){for(const redirect of r.redirects||[])entries.push({url:redirect.from,status:redirect.status,headers:{Location:redirect.to},bytes:''});entries.push({url:r.finalUrl,status:r.status,headers:{'Content-Type':r.contentType},bytes:r.bodyBase64});}
 let index=0;const fn=async(url,options)=>{const r=entries[index++];if(!r||url!==r.url||options.method!=='GET')throw Object.assign(new Error('CMS_REPLAY_REQUEST_MISMATCH'),{code:'CMS_REPLAY_REQUEST_MISMATCH'});return new Response(Buffer.from(r.bytes,'base64'),{status:r.status,headers:r.headers});};fn.state=()=>({expected:entries.length,consumed:index});return fn;
}
export async function probeCmsSource({source,sourceIndex=0,manifestSha256,timeoutMs=15000,networkRecords,categoryPolicy='first-class'}={}){
 if(!source||![0,1].includes(source.type))throw new Error('CMS_SOURCE_SCHEMA');
 const report={schemaVersion:1,sourceIndex,manifestSha256,name:safe(source.key),sourceSha256:hash(source),type:source.type,keySha256:sha(source.key),apiSha256:sha(source.api),extSha256:sha(source.ext||''),
  scope:'Production CMS session HTTP/parse calls; finite parameters; no Android/ART or media execution claim',transportMode:networkRecords?'exact-frozen-http-replay':'live-http',categoryPolicy,timeoutMs,calls:[],cleanup:{},
  methodScope:'home recommendations derive original home list IDs; both search signatures call the same baseline non-paginated CMS search; no category fallback or media fetch'};
 const privateCalls=[],http=[],replay=networkRecords?recordedCmsFetch(networkRecords):null;const start=Date.now();let session;
 const seen=new Map();
 async function call(step,method,params,origin){
  const metadata={step,method,paramsSha256:hash(params),origin,derivedResponseSha256:seen.get(origin)||null},row={method,params,metadata};const begin=Date.now();
  try{const result=await session.call(source.key,method,params);row.value=result.value;const observed=classifyBusinessResponse(method,result.value);metadata.status=observed.status;metadata.response=observed.response;if(method==='playerContent'&&observed.json){metadata.parse=observed.json.parse;metadata.returnedInputIdSame=observed.json.url===params[1];}seen.set(step,sha(result.value));return observed.json;}
  catch(error){metadata.error=cmsFailure(error);metadata.status=metadata.error.category==='invalid-response'?'invalid-json':metadata.error.category==='timeout'?'timeout':metadata.error.category==='network'?'network':'failed';row.errorMessage=String(error.message);}
  finally{metadata.elapsedMs=Date.now()-begin;report.calls.push(metadata);privateCalls.push(row);}
 }
 function skip(step,method,reason){const metadata={step,method,status:'not-tested',reason};report.calls.push(metadata);privateCalls.push({method,params:[],metadata});}
 try{
  session=await createExecutableSubscriptionSession({fetchText:async()=>JSON.stringify({sites:[source]}),cmsOptions:{...(replay?{fetchImpl:replay}:{}),timeoutMs,onResponse:r=>{http.push({...r,bytes:undefined,bodyBase64:r.bytes.toString('base64'),bodyBytes:r.bytes.length,bodySha256:sha(r.bytes)});}}});
  const loaded=await session.load({apiUrl:'https://cms-probe.invalid/frozen-config'});if(!loaded.ok)throw new Error('CMS_PROBE_CONFIG_REJECTED');report.configurationAccepted=true;
  const home=await call('home','homeContent',[true],'fixed');const recommendation=await call('home-video','homeVideoContent',[],'home');let category1;
  if(!['first-class','recommendation-type'].includes(categoryPolicy))throw new Error('CMS_CATEGORY_POLICY');
  let category=chooseCategory(home),categoryOrigin='home';if(categoryPolicy==='recommendation-type'){
   const present=new Set((home?.class||[]).map(c=>String(c.type_id))),candidate=recommendation?.list?.find(v=>v.type_id!==undefined&&present.has(String(v.type_id)));
   if(candidate){category=String(candidate.type_id);categoryOrigin='home-video';}else category=undefined;
  }
  if(category!==undefined){category1=await call('category-page1','categoryContent',[category,'1',true,{}],categoryOrigin);await call('category-page2','categoryContent',[category,'2',true,{}],categoryOrigin);const filter=chooseFilter(home,category);if(filter)await call('category-filter','categoryContent',[category,'1',true,filter],'home');else skip('category-filter','categoryContent','no-real-filter');}
  else for(const step of ['category-page1','category-page2','category-filter'])skip(step,'categoryContent','no-real-category');
  const first=v=>v?.list?.find(x=>['string','number'].includes(typeof x?.vod_id)&&String(x.vod_id));const item=first(category1)||first(recommendation)||first(home);let detail;
  if(item)detail=await call('detail','detailContent',[[String(item.vod_id)]],first(category1)?'category-page1':first(recommendation)?'home-video':'home');else skip('detail','detailContent','no-real-id');
  const keyword=chooseKeyword(category1,recommendation,home);let a,b,searchDetail;
  if(!keyword.fallback){const origin=['category-page1','home-video','home'][keyword.originIndex];a=await call('search','searchContent',[keyword.keyword,false],origin);b=await call('search-page1','searchContent',[keyword.keyword,false,'1'],origin);}else{skip('search','searchContent','no-real-title');skip('search-page1','searchContent','no-real-title');}
  const found=first(a)||first(b);if(found)searchDetail=await call('search-detail','detailContent',[[String(found.vod_id)]],first(a)?'search':'search-page1');else skip('search-detail','detailContent','no-real-search-id');
  const player=choosePlayer(detail)||choosePlayer(searchDetail);if(player)await call('player','playerContent',[player.flag,player.id,[]],choosePlayer(detail)?'detail':'search-detail');else skip('player','playerContent','no-real-episode');
  const state=await session.getState();report.noScriptInstances=state.runtime.jar.spiderCount===0&&state.runtime.js.spiderCount===0;report.cmsState=state.cms;
 }catch(error){report.error=cmsFailure(error);}
 finally{if(session)try{await session.close();report.cleanup.closed=true;}catch(error){report.cleanup.closed=false;report.cleanup.error=cmsFailure(error);}else report.cleanup.closed=true;}
 report.http=http.map(r=>({purpose:r.purpose,requestUrlSha256:sha(r.request.url),finalUrlSha256:sha(r.finalUrl),status:r.status,bodyBytes:r.bodyBytes,bodySha256:r.bodySha256,redirects:r.redirects.length}));
 if(replay){report.replay=replay.state();if(report.replay.consumed!==report.replay.expected)report.replayIncomplete=true;}
 report.observations=Object.fromEntries(['nonempty','empty','invalid-json','network','failed','timeout','not-tested'].map(s=>[s,report.calls.filter(c=>c.status===s).length]));report.elapsedMs=Date.now()-start;
 return {source,report,privateCalls,http};
}
async function main(){const args=process.argv.slice(2),get=n=>{const i=args.indexOf('--'+n);return i<0?undefined:args[i+1];};const bytes=await readFile(resolve(get('plan'))),plan=JSON.parse(bytes);const index=Number(get('case-index')||0);if(!Number.isSafeInteger(index)||!plan.sources[index])throw new Error('CMS_SOURCE_INDEX');let replay;
 if(get('replay-network')){replay=JSON.parse(await readFile(resolve(get('replay-network'))));if(hash(replay.source)!==hash(plan.sources[index]))throw new Error('CMS_REPLAY_SOURCE_MISMATCH');}
 const result=await probeCmsSource({source:plan.sources[index],sourceIndex:index,manifestSha256:sha(bytes),timeoutMs:plan.timeoutMs||15000,networkRecords:replay?.http,categoryPolicy:plan.categoryPolicy||'first-class'});
 const output={schemaVersion:1,runnerSha256:sha(await readFile(SELF)),...result};for(const[path,value]of[[get('output'),output],[get('metadata'),{schemaVersion:1,runnerSha256:output.runnerSha256,report:result.report}]]){if(!path)throw new Error('CMS_OUTPUT_REQUIRED');await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(resolve(path),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
 console.log(JSON.stringify(result.report));if(!result.report.cleanup.closed)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===SELF)main().catch(error=>{console.error(JSON.stringify({error:cmsFailure(error)}));process.exitCode=1;});
