// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {compareArtResults} from '../scripts/android/compare-art-results.mjs';
import {loaderContextOf,officialOracleApkSha256} from '../scripts/android/loader-context.mjs';
import {oracleBudgetsOf} from '../scripts/android/run-oracle.mjs';
import {replayBudgetsOf} from '../scripts/android/replay-nas.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const plan={schemaVersion:1,artifacts:[{id:sha('jar'),sha256:sha('jar'),sites:[{key:'fixture-site',api:'csp_FixtureGuard',ext:'exact ext',extSha256:sha('exact ext')}]}]};
 const options={manifestSha256:sha(JSON.stringify(plan)),generatedAt:'2026-10-15T00:00:00.000Z'};
 const report={schemaVersion:1,artifactIndex:0,siteIndex:0,id:sha('jar'),jarSha256:sha('jar'),siteKey:'fixture-site',api:'csp_FixtureGuard',extSha256:sha('exact ext'),manifestSha256:options.manifestSha256,loaderMode:'main',loadSuccess:true,initSuccess:true,spiderClass:'com.github.catvod.spider.FixtureGuard'};
 const result=()=>({caseId:'0-0',report:structuredClone(report),privateCalls:[{method:'homeContent',params:[true],value:'{"class":[{"type_id":"1","type_name":"fixture"}],"list":[]}'}]});
 return{plan,options,art:result(),nas:result()};
}
const compare=f=>compareArtResults(f.plan,[f.art],[f.nas],f.options);

test('same Node canonical comparison handles escaping, numeric rendering and key ordering',()=>{
 const f=fixture();
 f.art.privateCalls[0].value='{"class":[{"type_id":"1","type_name":"<\\/script>"}],"list":[],"number":1.0,"nested":{"b":2,"a":1}}';
 f.nas.privateCalls[0].value='{"nested":{"a":1,"b":2},"number":1,"list":[],"class":[{"type_name":"</script>","type_id":"1"}]}';
 const report=compare(f),call=report.cases[0].calls[0];
 assert.equal(call.rawEqual,false);assert.equal(call.semanticEqual,true);assert.equal(call.classesEqual,true);
 assert.equal(report.summary.nonemptySemanticMatches,1);assert.equal(report.cases[0].observation,'matched-tested-methods');
});

test('rejects changed exact parameters even when the method and response match',()=>{
 const f=fixture();f.nas.privateCalls[0].params=[false];
 assert.throws(()=>compare(f),/method or exact params/);
 f.nas.privateCalls[0].params=[true];f.nas.privateCalls[0].method='homeVideoContent';
 assert.throws(()=>compare(f),/method or exact params/);
});

test('rejects JAR, manifest, API, ext and site identity substitutions',()=>{
 for(const field of ['jarSha256','manifestSha256','extSha256','api','siteKey','id']){
  const f=fixture();f.nas.report[field]=field.endsWith('Sha256')?sha('other'):'other';
  assert.throws(()=>compare(f),/input identity differs/);
 }
});

test('role-aware comparison pins original signature, load key and coexisting main input',()=>{
 const f=fixture(),site=f.plan.artifacts[0].sites[0],artifact=f.plan.artifacts[0];
 site.jar='https://fixture.invalid/site.jar;md5; declared';
 site.loaderContext={role:'site',signature:site.jar,main:{sha256:sha('main'),signature:'original main',jarPath:'main.jar',jarUrl:'http://fixture.invalid/main.jar'}};
 f.options.manifestSha256=sha(JSON.stringify(f.plan));
 const identity=loaderContextOf(artifact,site).identity;
 for(const value of [f.art,f.nas])Object.assign(value.report,identity,{manifestSha256:f.options.manifestSha256,jarBytesVerified:true,mainJarBytesVerified:true,targetApkSha256:officialOracleApkSha256});
 f.art.report.budgets=oracleBudgetsOf(f.plan);
 const b=replayBudgetsOf(f.plan);f.nas.report.budgets={caseMs:b.caseTimeoutMs,loadMs:b.loadTimeoutMs,initMs:b.initTimeoutMs,callMs:b.callTimeoutMs};f.nas.report.initPolicy='android';
 f.art.report.symbolMapSha256=sha('audited map');
 const report=compare(f);
 assert.equal(report.summary.bothReady,1);assert.equal(report.cases[0].loaderMode,'site');
 assert.equal(report.cases[0].mainJarSha256,sha('main'));
 assert.ok(!JSON.stringify(report).includes('fixture.invalid'));
 for(const field of Object.keys(identity)){
  const old=f.nas.report[field];f.nas.report[field]='changed';assert.throws(()=>compare(f),/loader context/);f.nas.report[field]=old;
 }
 delete f.nas.report.mainJarBytesVerified;assert.throws(()=>compare(f),/loader context/);
});

function roleFixture(){
 const f=fixture(),site=f.plan.artifacts[0].sites[0];
 site.jar='';site.loaderContext={role:'main',signature:'original main signature'};
 f.plan.artBudgets={caseMs:150000,loadMs:90000,initMs:10000,callMs:10000};f.plan.nasBudgets={...f.plan.artBudgets};
 f.options.manifestSha256=sha(JSON.stringify(f.plan));
 for(const result of [f.art,f.nas])Object.assign(result.report,loaderContextOf(f.plan.artifacts[0],site).identity,{manifestSha256:f.options.manifestSha256,jarBytesVerified:true,targetApkSha256:officialOracleApkSha256,budgets:{...f.plan.artBudgets}});
 f.art.report.symbolMapSha256=sha('audited map');f.nas.report.initPolicy='android';
 return f;
}

test('new contexts strictly pin stage budgets and default initialization policy while historical contexts may omit them',()=>{
 assert.doesNotThrow(()=>compare(fixture()));
 const f=roleFixture();assert.equal(compare(f).cases[0].nas.initPolicy,'android');
 for(const host of ['art','nas'])for(const key of ['caseMs','loadMs','initMs','callMs']){
  const changed=roleFixture();changed[host].report.budgets[key]=1;
  assert.throws(()=>compare(changed),/stage budgets/);
 }
 for(const host of ['art','nas']){const changed=roleFixture();delete changed[host].report.budgets;assert.throws(()=>compare(changed),/stage budgets/);}
 for(const policy of ['declared',undefined]){const changed=roleFixture();changed.nas.report.initPolicy=policy;assert.throws(()=>compare(changed),/initialization policy/);}
});

test('known failed loader observation is retained separately from unresolved network causality',()=>{
 const f=roleFixture();delete f.nas.report.initSuccess;f.nas.privateCalls=[];
 f.nas.report.loadSuccess=false;f.nas.report.selectedLoad={attempted:true,loaded:false,loaderCount:1};
 f.nas.report.error={stage:'site-load-init',type:'java.net.ConnectException',category:'network',fingerprint:sha('network evidence')};
 const report=compare(f),nas=report.cases[0].nas;
 assert.equal(nas.load,'unknown');assert.equal(nas.loadObserved,'failed');assert.equal(nas.loadCausalCategory,'network');assert.equal(nas.loadCauseResolved,false);
 assert.equal(report.summary.nasLoadObserved.failed,1);assert.equal(report.summary.bothLoadFailed,0);
});

test('application state is independently visible and never inferred from absent historical metadata',()=>{
 const f=fixture();let report=compare(f);
 assert.equal(report.cases[0].art.applicationStatePolicy,'unrecorded');assert.equal(report.cases[0].nas.applicationStatePolicy,'unrecorded');
 f.plan.artStatePolicy='fresh-app-data';f.options.manifestSha256=sha(JSON.stringify(f.plan));
 for(const result of [f.art,f.nas])result.report.manifestSha256=f.options.manifestSha256;
 f.art.report.applicationStatePolicy='fresh-app-data';f.nas.report.applicationStatePolicy='fresh-runtime-data';
 report=compare(f);assert.equal(report.cases[0].art.applicationStatePolicy,'fresh-app-data');assert.equal(report.cases[0].nas.applicationStatePolicy,'fresh-runtime-data');
 f.art.report.applicationStatePolicy='cold-process-preserve-data';assert.throws(()=>compare(f),/state policy/);
});

test('missing case is explicitly unknown and never a successful comparison',()=>{
 const f=fixture(),report=compareArtResults(f.plan,[f.art],[],f.options);
 assert.equal(report.summary.pairedCases,0);assert.equal(report.summary.semanticMatches,0);
 assert.deepEqual(report.summary.missingNAS,['0-0']);
 assert.equal(report.cases[0].observation,'unknown-missing-result');
 assert.equal(report.cases[0].calls[0].nas.state,'not-replayed');
});

test('both initialization failures are retained and not counted as passes',()=>{
 const f=fixture();
 for(const result of [f.art,f.nas]){
  delete result.report.initSuccess;result.report.spiderClass='com.github.catvod.crawler.SpiderNull';
  result.report.error={type:'java.lang.IllegalStateException',fingerprint:sha('unavailable')};result.privateCalls=[];
 }
 const report=compare(f);
 assert.equal(report.summary.bothInitFailed,1);assert.equal(report.summary.bothReady,0);
 assert.equal(report.summary.semanticMatches,0);assert.equal(report.cases[0].observation,'both-init-failed');
});

test('both method errors compare types and fingerprints without becoming JSON successes',()=>{
 const f=fixture();
 for(const result of [f.art,f.nas])result.privateCalls[0]={method:'homeContent',params:[true],error:{type:'java.io.IOException',fingerprint:sha('first')}};
 f.nas.privateCalls[0].error.fingerprint=sha('second');
 const report=compare(f),call=report.cases[0].calls[0];
 assert.equal(report.summary.bothCallsFailed,1);assert.equal(report.summary.semanticMatches,0);
 assert.equal(call.failures.exceptionTypeEqual,true);assert.equal(call.failures.fingerprintEqual,false);
 assert.match(call.failures.fingerprintNote,/different message envelopes/);
});

test('both invalid JSON returns are compared as raw evidence, without treating parser errors as runtime differences or passes',()=>{
 const f=fixture();
 f.art.privateCalls[0]={method:'homeContent',params:[true],value:'',error:{type:'org.json.JSONException',fingerprint:sha('art parser')}};
 f.nas.privateCalls[0]={method:'homeContent',params:[true],value:'',error:{type:'SyntaxError',fingerprint:sha('node parser')}};
 const report=compare(f),call=report.cases[0].calls[0];
 assert.equal(call.observation,'both-invalid-json');assert.equal(call.invalidRawEqual,true);
 assert.equal(report.summary.bothInvalidJsonCalls,1);assert.equal(report.summary.bothInvalidRawMatches,1);
 assert.equal(report.summary.semanticMatches,0);assert.equal(report.summary.pairedSuccessfulJsonCalls,0);
 assert.equal(report.cases[0].observation,'same-successful-or-failed-behavior');
});

test('an execution difference is not hidden by another method live-response difference',()=>{
 const f=fixture();
 f.nas.privateCalls[0].value='{"class":[{"type_id":"2"}],"list":[]}';
 f.art.privateCalls.push({method:'categoryContent',params:['1','1',true,{}],value:'{"list":[]}'});
 f.nas.privateCalls.push({method:'categoryContent',params:['1','1',true,{}],error:{type:'java.lang.RuntimeException',fingerprint:sha('failure')}});
 assert.equal(compare(f).cases[0].observation,'method-results-need-diagnosis');
});

test('wrapper and payload class names do not gate matching method behavior',()=>{
 const f=fixture();f.nas.report.spiderClass='com.github.catvod.spider.RealFixture';
 const report=compare(f);assert.equal(report.cases[0].spiderClassEqual,false);
 assert.equal(report.cases[0].observation,'matched-tested-methods');assert.equal(report.summary.semanticMatches,1);
});

test('distinguishes an empty JSON object, empty class/list and nonempty content',()=>{
 const f=fixture();f.art.privateCalls[0].value='{}';f.nas.privateCalls[0].value='{}';
 let report=compare(f);
 assert.equal(report.summary.emptyObjectSemanticMatches,1);assert.equal(report.summary.nonemptySemanticMatches,0);
 assert.equal(report.cases[0].calls[0].art.emptyObject,true);
 f.art.privateCalls[0].value='{"class":[],"list":[]}';f.nas.privateCalls[0].value=f.art.privateCalls[0].value;
 report=compare(f);assert.equal(report.summary.emptyObjectSemanticMatches,0);
 assert.equal(report.cases[0].calls[0].art.hasContent,false);assert.equal(report.summary.semanticMatches,1);
});

test('live list differences remain observations and preserve equal stable class/filter evidence',()=>{
 const f=fixture();
 f.art.privateCalls[0].value='{"class":[{"type_id":"1"}],"filters":{},"list":[{"vod_id":"private-art-id"}]}';
 f.nas.privateCalls[0].value='{"class":[{"type_id":"1"}],"filters":{},"list":[{"vod_id":"private-nas-id"}]}';
 const report=compare(f),call=report.cases[0].calls[0];
 assert.equal(call.semanticEqual,false);assert.equal(call.classesEqual,true);assert.equal(call.filtersEqual,true);
 assert.equal(call.observation,'live-response-difference');assert.equal(report.summary.liveResponseDifferences,1);
 const text=JSON.stringify(report);assert.ok(!text.includes('private-art-id'));assert.ok(!text.includes('private-nas-id'));
 assert.ok(!text.includes('runtimeBug'));
});

test('public output omits raw source keys, URLs, arguments, response IDs and unsafe exception labels',()=>{
 const f=fixture(),secret='private-token-abc',api='https://example.invalid/api?token='+secret;
 const site=f.plan.artifacts[0].sites[0];site.api=api;site.key='key-'+secret;
 f.options.manifestSha256=sha(JSON.stringify(f.plan));
 for(const result of [f.art,f.nas]){
  result.report.api='sha256:'+sha(api);result.report.siteKey=site.key;result.report.manifestSha256=f.options.manifestSha256;
  result.privateCalls[0]={method:'searchContent',params:[secret,false],value:JSON.stringify({list:[{vod_id:secret}]})};
  result.report.error={type:'invalid?token='+secret,fingerprint:sha(secret)};
 }
 const text=JSON.stringify(compare(f));
 assert.ok(!text.includes(secret));assert.ok(!text.includes('example.invalid'));assert.ok(text.includes('UnknownError'));
});

test('rejects duplicate or unplanned cases and calls absent from the ART execution',()=>{
 const f=fixture();
 assert.throws(()=>compareArtResults(f.plan,[f.art,f.art],[f.nas],f.options),/duplicate case/);
 f.nas.privateCalls.push({method:'homeVideoContent',params:[],value:'{}'});
 assert.throws(()=>compare(f),/calls absent from ART/);
});

test('missing NAS calls are unknown coverage, while invalid JSON never counts as a match',()=>{
 const f=fixture();f.nas.privateCalls=[];
 let report=compare(f);assert.equal(report.summary.semanticMatches,0);
 assert.equal(report.cases[0].calls[0].observation,'unknown-not-replayed');
 f.nas.privateCalls=[{method:'homeContent',params:[true],value:''}];
 report=compare(f);assert.equal(report.summary.semanticMatches,0);
 assert.equal(report.cases[0].calls[0].nas.state,'invalid-json');
});

test('missing early NAS output pin needs both a separately verified launch pin and an explicit provenance envelope',()=>{
 const f=fixture();delete f.nas.report.manifestSha256;
 assert.throws(()=>compare(f),/missing execution manifest pin/);
 const provenance={manifestSha256:f.options.manifestSha256,runnerSha256:sha('captured executed runner'),source:'captured-launch-input'};
 f.nas.executionProvenance=structuredClone(provenance);
 assert.throws(()=>compare(f),/missing execution manifest pin/);
 f.options.replayProvenance=provenance;
 const before=JSON.stringify({report:f.nas.report,privateCalls:f.nas.privateCalls});
 const report=compare(f),input=report.cases[0].nas.inputProvenance;
 assert.equal(report.summary.semanticMatches,1);assert.equal(report.summary.recoveredNASManifestMetadata,1);
 assert.equal(input.originalManifestFieldMissing,true);assert.equal(input.recoveredMetadataFromVerifiedInput,true);
 assert.equal(input.source,'captured-launch-input');assert.equal(input.runnerSha256,provenance.runnerSha256);
 assert.equal(JSON.stringify({report:f.nas.report,privateCalls:f.nas.privateCalls}),before);
 assert.equal(f.nas.report.manifestSha256,undefined);
});

test('recovery rejects wrong launch or runner provenance and cannot override a conflicting output pin',()=>{
 for(const altered of ['manifestSha256','runnerSha256','source']){
  const f=fixture();delete f.nas.report.manifestSha256;
  f.options.replayProvenance={manifestSha256:f.options.manifestSha256,runnerSha256:sha('verified runner'),source:'captured-launch-input'};
  f.nas.executionProvenance={...f.options.replayProvenance,[altered]:altered==='source'?'self-asserted':sha('wrong')};
  assert.throws(()=>compare(f),/identity differs/);
 }
 const f=fixture();f.options.replayProvenance={manifestSha256:f.options.manifestSha256,runnerSha256:sha('verified runner'),source:'captured-launch-input'};
 f.nas.executionProvenance={...f.options.replayProvenance};f.nas.report.manifestSha256=sha('conflicting execution output');
 assert.throws(()=>compare(f),/reported manifest pin differs/);
 delete f.nas.report.manifestSha256;delete f.nas.executionProvenance;
 assert.throws(()=>compare(f),/unverified replay launch provenance/);
});

test('provenance fallback applies only to the omitted NAS field and never to ART or null values',()=>{
 const f=fixture();f.options.replayProvenance={manifestSha256:f.options.manifestSha256,runnerSha256:sha('verified runner'),source:'captured-launch-input'};
 f.art.executionProvenance={...f.options.replayProvenance};delete f.art.report.manifestSha256;
 assert.throws(()=>compare(f),/ART missing execution manifest pin/);
 f.art.report.manifestSha256=f.options.manifestSha256;f.nas.report.manifestSha256=null;f.nas.executionProvenance={...f.options.replayProvenance};
 assert.throws(()=>compare(f),/reported manifest pin differs/);
});
