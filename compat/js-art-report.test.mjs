// SPDX-License-Identifier: GPL-3.0-only
// Synthetic ART/NAS evidence. No Android device, provider or JVM is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeJSArtCall,validateJSArtCase,compareJSArtCalls,jsARTMarkdown} from '../scripts/compat/js-art-report.mjs';
import {androidJSCanonical,androidJSSourceSha256} from '../scripts/android/run-js-oracle.mjs';
import {jsOracleOfficialApkSha256} from '../scripts/android/js-apk-symbol-map.mjs';
import {classifyJsResponse} from '../scripts/container/js-source-probe.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const steps=[['home','homeContent'],['home-video','homeVideoContent'],['category-page1','categoryContent'],['category-page2','categoryContent'],['category-filter','categoryContent'],['detail','detailContent'],['search','searchContent'],['search-page1','searchContent'],['search-detail','detailContent'],['player','playerContent']];
const PRIVATE='JS_REPORT_PRIVATE_32';
function artCall(step,method,params,value){
 const observed=classifyJsResponse(method,value),response=typeof value==='string'?{sha256:sha(value),bytes:Buffer.byteLength(value)}:undefined;
 const metadata={method,discoveryStep:step,status:observed.status,paramsSha256:sha(androidJSCanonical(params)),...(response?{response}:{resultType:'null'})};
 return{method,params,value,metadata};
}
function nasCall(art){
 const {json,...observation}=classifyJsResponse(art.method,art.value),metadata={method:art.method,discoveryStep:art.metadata.discoveryStep,
  paramsSha256:sha(JSON.stringify(art.params)),...observation};
 return{method:art.method,params:structuredClone(art.params),value:art.value,metadata};
}
test('ART summary recomputes JSON and distinguishes parse requests, pass-through IDs and raw nulls',()=>{
 const call=artCall('player','playerContent',['flag','https://owned.invalid/'+PRIVATE,[]],JSON.stringify({url:'https://owned.invalid/'+PRIVATE,parse:1}));
 const result=summarizeJSArtCall(call);assert.equal(result.status,'nonempty');assert.equal(result.parse,1);assert.equal(result.returnedInputIdSame,true);
 assert.equal(result.playbackUrlPresent,true);assert.equal(JSON.stringify(result).includes(PRIVATE),false);
 const empty=summarizeJSArtCall(artCall('search','searchContent',[PRIVATE,false],'{"list":[]}'));assert.equal(empty.status,'empty');
 const nil=summarizeJSArtCall(artCall('home','homeContent',[true],null));assert.equal(nil.status,'invalid-json');assert.equal(nil.returnedNull,true);
});
test('exact ART/NAS comparison rejects different parameters and retains same-status JSON differences',()=>{
 const art=artCall('search','searchContent',[PRIVATE,false],'{"list":[{"vod_id":"one"}]}'),nas=nasCall(art);
 assert.equal(compareJSArtCalls([art],[nas])[0].observation,'same-params-same-json');
 nas.value='{"list":[{"vod_id":"two"}]}';Object.assign(nas.metadata,classifyJsResponse(nas.method,nas.value));delete nas.metadata.json;
 let row=compareJSArtCalls([art],[nas])[0];assert.equal(row.paramsEqual,true);assert.equal(row.semanticEqual,false);assert.equal(row.observation,'same-params-live-response-difference');
 nas.params=['other',false];nas.metadata.paramsSha256=sha(JSON.stringify(nas.params));assert.throws(()=>compareJSArtCalls([art],[nas]),/REPLAY_EXACT_PARAMS/);
});
test('ART validation requires original UID/APK/map/context and cannot replace missing method records',()=>{
 const source={type:3,key:'owned',api:'https://owned.invalid/main.js',ext:'https://owned.invalid/rule.js',jar:''};
 const calls=steps.map(([step,method])=>artCall(step,method,[],step==='home'?'{"class":[1]}':'{}'));
 const options={source,sourceIndex:0,manifestSha256:sha('plan'),symbolMapSha256:sha('map'),budgets:{caseMs:300000,initMs:90000,callMs:12000}};
 const report={schemaVersion:1,sourceIndex:0,manifestSha256:options.manifestSha256,sourceSha256:androidJSSourceSha256(source),extSha256:sha(source.ext),siteKey:source.key,
  api:'sha256:'+sha(source.api),targetApkSha256:jsOracleOfficialApkSha256,symbolMapSha256:options.symbolMapSha256,applicationStatePolicy:'fresh-app-data',budgets:options.budgets,
  applicationUid:10166,vmName:'Dalvik',applicationConfigContext:'Original audited ApiConfig singleton initialized synchronously before original JsLoader',moduleBytesVerified:true,modules:[],calls:calls.map(c=>c.metadata)};
 const value={report,privateCalls:calls};assert.equal(validateJSArtCase(value,options).length,10);
 for(const field of['sourceSha256','targetApkSha256','symbolMapSha256','applicationConfigContext']){const changed=structuredClone(value);changed.report[field]='changed';assert.throws(()=>validateJSArtCase(changed,options),/JS_ART_REPORT_/);}
 const wrongUID=structuredClone(value);wrongUID.report.applicationUid=0;assert.throws(()=>validateJSArtCase(wrongUID,options),/ART_RUNTIME/);
 const missing=structuredClone(value);missing.privateCalls.pop();assert.throws(()=>validateJSArtCase(missing,options),/ART_MODULE_OR_CALLS/);
});
test('ART source hash and response hash independently reject altered captured inputs or result values',()=>{
 const call=artCall('home','homeContent',[true],'{"class":[1]}');call.value='{"class":[2]}';assert.throws(()=>summarizeJSArtCall(call),/ART_RESPONSE_HASH/);
 const changed=artCall('player','playerContent',['flag','https://owned.invalid/id',[]],'{"url":"https://owned.invalid/id"}');
 changed.metadata.paramsSha256=sha(JSON.stringify(changed.params));assert.throws(()=>summarizeJSArtCall(changed),/ART_PARAMETER_HASH/);
});
