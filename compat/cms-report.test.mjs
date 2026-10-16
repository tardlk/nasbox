import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateCmsCase,validateCmsContainer,cmsReportMarkdown} from '../scripts/compat/cms-report.mjs';
import {classifyBusinessResponse} from '../scripts/container/working-source-probe.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v,hash=v=>sha(JSON.stringify(canonical(v)));
const source={key:'owned',type:1,api:'https://owned.invalid/?token=PRIVATE_CMS_REPORT',ext:''};
function fixture(){
 const specs=[['home','homeContent',[true]],['home-video','homeVideoContent',[]],['category-page1','categoryContent',['a','1',true,{}]],['category-page2','categoryContent',['a','2',true,{}]],['category-filter','categoryContent',['a','1',true,{year:'2026'}]],['detail','detailContent',[['x']]],['search','searchContent',['word',false]],['search-page1','searchContent',['word',false,'1']],['search-detail','detailContent',[['x']]],['player','playerContent',['a','https://media.invalid/owned/one.m3u8',[]]]];
 const calls=specs.map(([step,method,params])=>{const value=JSON.stringify(method==='playerContent'?{url:params[1],parse:0}:{class:[{type_id:'a',type_name:'A'}],list:[{vod_id:'x',vod_name:'X'}]});const o=classifyBusinessResponse(method,value);return {method,params,value,metadata:{step,method,paramsSha256:hash(params),origin:'fixed',derivedResponseSha256:null,status:o.status,response:o.response}};});
 const report={sourceSha256:hash(source),sourceIndex:0,manifestSha256:sha('plan'),transportMode:'live-http',categoryPolicy:'first-class',timeoutMs:12000,configurationAccepted:true,cleanup:{closed:true},noScriptInstances:true,cmsState:{inFlight:0},calls:calls.map(c=>c.metadata),http:[]};
 const raw={schemaVersion:1,runnerSha256:sha('runner'),source,report,privateCalls:calls,http:[]};return {raw,meta:{schemaVersion:1,runnerSha256:raw.runnerSha256,report},opts:{source,sourceIndex:0,manifestSha256:report.manifestSha256,runnerSha256:raw.runnerSha256,mode:'live',categoryPolicy:'first-class'}};
}
test('CMS report recomputes response and parameter identity, keeping secrets and raw URLs private',()=>{
 const f=fixture();const r=validateCmsCase(f.raw,f.meta,f.opts);assert.equal(r.observations.nonempty,10);assert.equal(r.calls.at(-1).parse,0);assert.equal(r.calls.at(-1).returnedInputIdSame,true);assert.equal(JSON.stringify(r).includes('PRIVATE_CMS_REPORT'),false);
 for(const field of ['sourceSha256','manifestSha256']){const a=fixture();a.raw.report[field]=sha('changed');assert.throws(()=>validateCmsCase(a.raw,a.meta,a.opts),/IDENTITY/);}
 const a=fixture();a.raw.privateCalls[0].value='{"class":[]}';assert.throws(()=>validateCmsCase(a.raw,a.meta,a.opts),/RESPONSE/);
 const b=fixture();b.raw.privateCalls[1].params=['changed'];assert.throws(()=>validateCmsCase(b.raw,b.meta,b.opts),/PARAMS/);
 const c=fixture();c.raw.report.cleanup.closed=false;assert.throws(()=>validateCmsCase(c.raw,c.meta,c.opts),/LIFECYCLE/);
});
test('incomplete frozen replay remains an explicit harness failure and cannot acquire a compatibility inference',()=>{
 const f=fixture();f.opts.mode='replay';f.raw.report.transportMode='exact-frozen-http-replay';f.raw.report.replay={expected:1,consumed:2};f.raw.report.replayIncomplete=true;
 assert.throws(()=>validateCmsCase(f.raw,f.meta,f.opts),/REPLAY_UNEXPLAINED/);
 const c=f.raw.privateCalls[0];delete c.value;delete c.metadata.response;c.metadata.status='failed';c.metadata.error={code:'CMS_REPLAY_REQUEST_MISMATCH'};
 const result=validateCmsCase(f.raw,f.meta,f.opts);assert.equal(result.replayValidation,'harness-input-incomplete');assert.equal(result.sourceCompatibilityInference,'none');
});
test('container evidence binds exact image, command, UID, read-only inputs and offline replay',()=>{
 const image='sha256:'+sha('image'),base='case-000';const args=['scripts/container/cms-source-probe.mjs','--plan','/input/input-plan.json','--case-index','0','--replay-network','/reference/'+base+'-private.json','--output','/output/'+base+'-private.json','--metadata','/output/'+base+'-metadata.json'];
 const c={Image:image,Config:{User:'10001:10001'},State:{Status:'exited',Running:false,ExitCode:0},Path:'node',Args:args,HostConfig:{ReadonlyRootfs:true,Privileged:false,RestartPolicy:{Name:'no'},NetworkMode:'none'},Mounts:[{Destination:'/input',RW:false},{Destination:'/reference',RW:false},{Destination:'/output',RW:true}]};
 const options={image,index:0,tag:'final',mode:'replay'};assert.equal(validateCmsContainer([c],0,options).network,'none');
 for(const mutate of [x=>x.Config.User='0',x=>x.Image='wrong',x=>x.Args.push('--oops'),x=>x.HostConfig.NetworkMode='bridge',x=>x.Mounts[0].RW=true]){const changed=structuredClone(c);mutate(changed);assert.throws(()=>validateCmsContainer([changed],0,options),/CMS_REPORT_/);}
});
