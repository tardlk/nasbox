// SPDX-License-Identifier: GPL-3.0-only
// All cross-host JSON hashes are recomputed here, by the same Node implementation.
// Private response strings and call parameters never enter the returned report.
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const sha=value=>createHash('sha256').update(value).digest('hex');
const hashPattern=/^[a-f0-9]{64}$/;
const classPattern=/^(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*$/;
const methods=new Set(['homeContent','homeVideoContent','categoryContent','detailContent','searchContent']);
const categories=new Set(['execution','artifact-timeout','timeout','invalid-json','missing-class-or-member','native-binding','network','invalid-result','input','environment','spider-not-ready']);
export function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const semantic=value=>sha(JSON.stringify(canonical(value)));
const originalLabel=value=>{
 const text=String(value??'');
 return text.length>160||/(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text)?'sha256:'+sha(text):text;
};
const apiLabel=value=>typeof value==='string'&&classPattern.test(value)&&value.length<=240?value:'sha256:'+sha(String(value));
const safeClass=value=>typeof value==='string'&&classPattern.test(value)&&value.length<=240?value:null;
const counts=values=>values.reduce((result,key)=>(result[key]=(result[key]||0)+1,result),{});
const identityError=reason=>Object.assign(new Error('ART comparison input identity differs: '+reason),{code:'INPUT_CHECKSUM'});

export async function readPrivateResults(directory){
 const names=(await readdir(directory)).filter(name=>/^\d+-\d+-private\.json$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 return Promise.all(names.map(async name=>({caseId:name.replace(/-private\.json$/,''),...JSON.parse(await readFile(join(directory,name),'utf8'))})));
}
export const readARTResults=readPrivateResults;

function safeError(value){
 if(!value)return null;
 return {type:safeClass(value.type)||'UnknownError',fingerprint:hashPattern.test(value.fingerprint)?value.fingerprint:null,
  category:categories.has(value.category)?value.category:/Timeout/.test(value.type||'')?'timeout':/UnknownHost|ConnectException|SSL|Socket/.test(value.type||'')?'network':'execution'};
}
function failureComparison(a,b){
 const art=safeError(a),nas=safeError(b);
 return {art,nas,...(art&&nas?{exceptionTypeEqual:art.type===nas.type,
  fingerprintEqual:art.fingerprint&&nas.fingerprint?art.fingerprint===nas.fingerprint:null,
  fingerprintNote:'Producer-specific fingerprints use different message envelopes; unequal hashes do not establish unequal underlying causes.'}:{})};
}
function reportState(result,kind){
 if(!result)return 'unknown';
 const report=result.report;
 if(report[kind+'Success']===true)return kind==='load'?'loaded':'ready';
 const error=safeError(report.error);
 if(report.timedOut||['timeout','artifact-timeout','network','environment','input'].includes(error?.category))return 'unknown';
 if(report[kind+'Success']===false)return 'failed';
 if(kind==='init'&&report.spiderClass?.endsWith('.SpiderNull'))return 'failed';
 if(kind==='init'&&report.loadSuccess===true&&report.error?.stage==='init')return 'failed';
 if(kind==='init'&&report.loadSuccess===false)return 'not-reached';
 return 'unknown';
}
function summarizeValue(call){
 if(!call)return {state:'not-replayed'};
 const error=call.error||call.metadata?.error;
 if(typeof call.value!=='string')return {state:error?'failed':'unknown',error:safeError(error)};
 const raw={bytes:Buffer.byteLength(call.value),sha256:sha(call.value)};
 let value;
 try{value=JSON.parse(call.value);}catch{return {...raw,state:'invalid-json',error:safeError(error)};}
 if(!value||typeof value!=='object'||Array.isArray(value))return {...raw,state:'invalid-json-object',error:safeError(error)};
 const classes=Array.isArray(value.class)?value.class.length:null,list=Array.isArray(value.list)?value.list.length:null;
 const filterGroups=value.filters&&typeof value.filters==='object'&&!Array.isArray(value.filters)?Object.keys(value.filters).length:null;
 return {...raw,state:error||call.metadata?.success===false?'failed-with-json':'json',semanticSha256:semantic(value),
  fields:Object.keys(value).length,emptyObject:Object.keys(value).length===0,classes,list,filterGroups,
  hasContent:(classes||0)>0||(list||0)>0,
  ...(Object.hasOwn(value,'class')?{classSha256:semantic(value.class)}:{}),
  ...(Object.hasOwn(value,'filters')?{filtersSha256:semantic(value.filters)}:{}),
  ...(error?{error:safeError(error)}:{})};
}

function validateReplayProvenance(value,manifestSha256){
 if(!value||value.source!=='captured-launch-input'||value.manifestSha256!==manifestSha256||!hashPattern.test(value.runnerSha256))throw identityError('unverified replay launch provenance');
 return {manifestSha256:value.manifestSha256,runnerSha256:value.runnerSha256,source:value.source};
}
function inputProvenance(result){
 const missing=result.report.manifestSha256===undefined;
 return {originalManifestFieldMissing:missing,recoveredMetadataFromVerifiedInput:missing,
  source:missing?'captured-launch-input':'execution-report',
  ...(missing?{manifestSha256:result.executionProvenance.manifestSha256,runnerSha256:result.executionProvenance.runnerSha256}:{})};
}
function indexResults(rows,expected,host,manifestSha256,replayProvenance){
 const map=new Map();
 for(const result of rows){
  const meta=result?.report,caseId=result.caseId??(Number.isSafeInteger(meta?.artifactIndex)&&Number.isSafeInteger(meta?.siteIndex)?meta.artifactIndex+'-'+meta.siteIndex:undefined);
  const entry=expected.get(caseId);
  if(!entry||map.has(caseId))throw identityError(host+' unknown or duplicate case');
  const {artifact,site,artifactIndex,siteIndex}=entry;
  if(meta?.manifestSha256===undefined){
   // An early runner validated its input before execution but omitted the hash
   // from output. Recovery needs a separate caller-verified launch pin AND an
   // explicit result envelope; neither may replace a conflicting reported pin.
   if(host!=='NAS'||!replayProvenance)throw identityError(host+' missing execution manifest pin');
   const recovered=validateReplayProvenance(result.executionProvenance,manifestSha256);
   if(recovered.runnerSha256!==replayProvenance.runnerSha256)throw identityError('replay runner provenance differs');
  }else if(meta.manifestSha256!==manifestSha256)throw identityError(host+' reported manifest pin differs');
  if(result.executionProvenance){
   const supplied=validateReplayProvenance(result.executionProvenance,manifestSha256);
   if(replayProvenance&&supplied.runnerSha256!==replayProvenance.runnerSha256)throw identityError('replay runner provenance differs');
  }
  if(meta?.artifactIndex!==artifactIndex||meta?.siteIndex!==siteIndex||meta.jarSha256!==artifact.sha256||
   meta.extSha256!==sha(site.ext)||meta.api!==originalLabel(site.api)||meta.siteKey!==originalLabel(site.key)||
   meta.id!==originalLabel(artifact.id))throw identityError(host+' manifest/JAR/API/ext/site');
  if(meta.loaderMode!=='main')throw identityError(host+' loader mode');
  if(!Array.isArray(result.privateCalls)||result.privateCalls.length>20)throw identityError(host+' malformed calls');
  if(result.privateCalls.some(call=>!methods.has(call.method)||!Array.isArray(call.params)))throw identityError(host+' unsupported method');
  map.set(caseId,result);
 }
 return map;
}

export function compareArtResults(plan,artResults,nasResults,{manifestSha256,replayProvenance,generatedAt=new Date().toISOString()}={}){
 if(!hashPattern.test(manifestSha256)||plan?.schemaVersion!==1||!Array.isArray(plan.artifacts))throw new Error('Expected exact oracle plan and manifestSha256');
 const trustedReplayProvenance=replayProvenance===undefined?undefined:validateReplayProvenance(replayProvenance,manifestSha256);
 const expected=new Map();
 plan.artifacts.forEach((artifact,artifactIndex)=>{
  if(!hashPattern.test(artifact.sha256)||!Array.isArray(artifact.sites))throw new Error('Malformed captured artifact');
  artifact.sites.forEach((site,siteIndex)=>{
   if(typeof site.ext!=='string'||typeof site.api!=='string'||typeof site.key!=='string'||site.extSha256&&site.extSha256!==sha(site.ext))throw identityError('malformed captured site');
   expected.set(artifactIndex+'-'+siteIndex,{artifact,site,artifactIndex,siteIndex});
  });
 });
 const arts=indexResults(artResults,expected,'ART',manifestSha256),nases=indexResults(nasResults,expected,'NAS',manifestSha256,trustedReplayProvenance);
 const cases=[];
 for(const [caseId,{artifact,site,artifactIndex,siteIndex}]of expected){
  const art=arts.get(caseId),nas=nases.get(caseId);
  const row={caseId,artifactIndex,siteIndex,jarSha256:artifact.sha256,api:apiLabel(site.api),siteKeySha256:sha(site.key),extSha256:sha(site.ext),
   art:{present:!!art,load:reportState(art,'load'),init:reportState(art,'init')},
   nas:{present:!!nas,load:reportState(nas,'load'),init:reportState(nas,'init')},calls:[]};
  if(art){row.art.spiderClass=safeClass(art.report.spiderClass);row.art.inputProvenance=inputProvenance(art);}
  if(nas){row.nas.spiderClass=safeClass(nas.report.spiderClass);row.nas.inputProvenance=inputProvenance(nas);}
  if(art&&nas){
   row.spiderClassEqual=row.art.spiderClass&&row.nas.spiderClass?row.art.spiderClass===row.nas.spiderClass:null;
   row.spiderClassNote='Wrapper and payload class names can differ; class-name equality is not a compatibility gate.';
   row.failures=failureComparison(art.report.error,nas.report.error);
   if(nas.privateCalls.length>art.privateCalls.length)throw identityError('NAS contains calls absent from ART');
  }
  for(const [index,call]of (art?.privateCalls||[]).entries()){
   const other=nas?.privateCalls[index];
   if(other&&(other.method!==call.method||semantic(other.params)!==semantic(call.params)))throw identityError('method or exact params');
   const a=summarizeValue(call),b=summarizeValue(other);
   const comparison={index,method:call.method,paramsSha256:semantic(call.params),art:a,nas:b};
   if(a.state==='json'&&b.state==='json'){
    comparison.rawEqual=a.sha256===b.sha256;comparison.semanticEqual=a.semanticSha256===b.semanticSha256;
    comparison.classesEqual=a.classSha256===undefined&&b.classSha256===undefined?null:a.classSha256===b.classSha256;
    comparison.filtersEqual=a.filtersSha256===undefined&&b.filtersSha256===undefined?null:a.filtersSha256===b.filtersSha256;
    comparison.observation=comparison.semanticEqual?'same-json':'live-response-difference';
   }else if(['invalid-json','invalid-json-object'].includes(a.state)&&['invalid-json','invalid-json-object'].includes(b.state)){
    comparison.observation='both-invalid-json';comparison.invalidRawEqual=a.sha256===b.sha256;
   }else if(a.state==='failed'&&b.state==='failed')comparison.observation='both-failed';
   else comparison.observation=a.state==='not-replayed'||b.state==='not-replayed'?'unknown-not-replayed':'execution-or-result-difference';
   if(a.error||b.error)comparison.failures=failureComparison(a.error,b.error);
   row.calls.push(comparison);
  }
  if(!art||!nas)row.observation='unknown-missing-result';
  else if(row.art.init==='failed'&&row.nas.init==='failed')row.observation='both-init-failed';
  else if(row.art.init==='ready'&&row.nas.init==='ready')row.observation=row.calls.length===0?'ready-no-compared-calls':
   row.calls.every(call=>call.semanticEqual===true)?'matched-tested-methods':
   row.calls.some(call=>call.observation==='execution-or-result-difference')?'method-results-need-diagnosis':
   row.calls.some(call=>call.observation==='unknown-not-replayed')?'unknown-method-coverage':
   row.calls.some(call=>call.observation==='live-response-difference')?'live-response-difference':'same-successful-or-failed-behavior';
  else if([row.art.init,row.nas.init].includes('unknown'))row.observation='unknown-execution';
  else row.observation='init-difference-needs-diagnosis';
  cases.push(row);
 }
 const calls=cases.flatMap(row=>row.calls);
 return {schemaVersion:1,generatedAt,manifestSha256,
  scope:'Captured JAR and exact ext/API/method inputs; original official APK on real Android/ART versus NAS JVM/DEX/ARM bridge. This compares tested methods, not every source or Android API.',
  responseScope:'Business HTTP responses were live, not frozen. Response differences require diagnosis and do not automatically identify runtime defects. Empty JSON success and nonempty content are counted separately.',
  hashScope:'All response and argument hashes are recomputed from private raw files in one Node implementation; producer Java/JS semantic hashes are not trusted as directly comparable.',
  ...(trustedReplayProvenance?{replayProvenance:{...trustedReplayProvenance,
   validationScope:'Caller separately verified the captured launch manifest and executed runner hashes. Missing NAS output metadata is recovered from that launch evidence; original reports and response values remain unchanged.'}}:{}),
  summary:{expectedCases:expected.size,artCases:arts.size,nasCases:nases.size,pairedCases:cases.filter(row=>row.art.present&&row.nas.present).length,
   recoveredNASManifestMetadata:cases.filter(row=>row.nas.inputProvenance?.recoveredMetadataFromVerifiedInput).length,
   missingART:cases.filter(row=>!row.art.present).map(row=>row.caseId),missingNAS:cases.filter(row=>!row.nas.present).map(row=>row.caseId),
   artLoaded:cases.filter(row=>row.art.load==='loaded').length,nasLoaded:cases.filter(row=>row.nas.load==='loaded').length,
   bothLoadFailed:cases.filter(row=>row.art.load==='failed'&&row.nas.load==='failed').length,
   artReady:cases.filter(row=>row.art.init==='ready').length,nasReady:cases.filter(row=>row.nas.init==='ready').length,
   bothReady:cases.filter(row=>row.art.init==='ready'&&row.nas.init==='ready').length,bothInitFailed:cases.filter(row=>row.observation==='both-init-failed').length,
   testedCalls:calls.length,pairedSuccessfulJsonCalls:calls.filter(row=>row.art.state==='json'&&row.nas.state==='json').length,
   semanticMatches:calls.filter(row=>row.semanticEqual===true).length,rawMatches:calls.filter(row=>row.rawEqual===true).length,
   nonemptySemanticMatches:calls.filter(row=>row.semanticEqual===true&&row.art.hasContent&&row.nas.hasContent).length,
   emptyObjectSemanticMatches:calls.filter(row=>row.semanticEqual===true&&row.art.emptyObject&&row.nas.emptyObject).length,
   bothCallsFailed:calls.filter(row=>row.observation==='both-failed').length,
   bothInvalidJsonCalls:calls.filter(row=>row.observation==='both-invalid-json').length,
   bothInvalidRawMatches:calls.filter(row=>row.invalidRawEqual===true).length,
   liveResponseDifferences:calls.filter(row=>row.observation==='live-response-difference').length,
   caseObservations:counts(cases.map(row=>row.observation)),callObservations:counts(calls.map(row=>row.observation))},cases};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),provenanceIndex=args.indexOf('--replay-provenance');
 let replayProvenance;
 if(provenanceIndex>=0){const file=args[provenanceIndex+1];if(!file)throw new Error('Expected verified replay provenance file');replayProvenance=JSON.parse(await readFile(file,'utf8'));args.splice(provenanceIndex,2);}
 const [planPath,artDirectory,nasDirectory,output]=args;
 if(!planPath||!artDirectory||!nasDirectory||!output)throw new Error('Usage: node compare-art-results.mjs PLAN ART_PRIVATE_DIR NAS_PRIVATE_DIR PUBLIC_OUTPUT [--replay-provenance VERIFIED_LAUNCH.json]');
 const [bytes,art,nas]=await Promise.all([readFile(planPath),readPrivateResults(artDirectory),readPrivateResults(nasDirectory)]);
 const report=compareArtResults(JSON.parse(bytes),art,nas,{manifestSha256:sha(bytes),replayProvenance});
 await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.summary));
}
