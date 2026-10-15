// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { compareParserResults } from '../scripts/android/compare-parser-results.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const apkSha = '5fb63e491f280c0e271091da5490fcdf0923d6c2f8773ef03553b20a333db657';
function fixture() {
  const plan = { schemaVersion:1, configs:[{ id:'private-source-key', apiUrl:'https://example.invalid/private?token=secret', rawSha256:sha('fixed raw bytes') }] };
  const options = { manifestSha256:sha(JSON.stringify(plan)), generatedAt:'2026-10-15T00:00:00.000Z' };
  const preparedText = '{"sites":[{"key":"private-row","type":3,"api":"csp_Private"}]}';
  const report = { configIndex:0, manifestSha256:options.manifestSha256, idSha256:sha(plan.configs[0].id), apiUrlSha256:sha(plan.configs[0].apiUrl), rawSha256:plan.configs[0].rawSha256, configSha256:sha(preparedText), accepted:true, targetApkSha256:apkSha, unobservableFields:['filterable'] };
  const normalized = { globals:{ spider:'https://example.invalid/private.jar', jarCache:'true', danmaku:'', wallpaper:'' }, sites:[{ key:'private-row', name:'Private', api:'csp_Private', type:3, searchable:2, quickSearch:1, changeable:1, playUrl:'', ext:'{"b":2,"a":1}', jar:'', categories:[], playerType:-1, timeout:0, click:'', style:'', playTimeoutSeconds:15 }] };
  const result = () => ({ report:structuredClone(report), input:structuredClone(plan.configs[0]), preparedText, normalized:structuredClone(normalized) });
  const art=result(), nas=result();nas.normalized.sites[0].filterable=1;
  return {plan, options, art, nas};
}
const compare = f => compareParserResults(f.plan, [f.art], [f.nas], f.options);

test('compares exact prepared text and observable rows in one JSON implementation', () => {
  const f=fixture();f.nas.normalized.globals=Object.fromEntries(Object.entries(f.nas.normalized.globals).reverse());
  const report=compare(f);assert.equal(report.summary.matchedCases,1);assert.equal(report.summary.matchedSourceRows,1);
  assert.equal(report.cases[0].preparedEqual,true);assert.equal(report.cases[0].normalizedEqual,true);
  assert.equal(f.nas.normalized.sites[0].filterable,1);
});
test('only R8-unobservable filterable is excluded; defaults, flags and ext strings remain exact', () => {
  for(const [field,value] of [['searchable',true],['timeout',15],['playTimeoutSeconds',30],['categories',null],['ext','{"a":1,"b":2}']]) {
    const f=fixture();f.nas.normalized.sites[0][field]=value;
    const row=compare(f).cases[0];assert.equal(row.normalizedEqual,false,field);assert.equal(row.observation,'parser-output-difference');assert.deepEqual(row.differencePaths,['sites[0].'+field]);
  }
});
test('preserves source order, duplicate positions and unknown extra fields', () => {
  const f=fixture();f.art.normalized.sites.push({...f.art.normalized.sites[0],key:'second'});f.nas.normalized.sites.push({...f.nas.normalized.sites[0],key:'second'});
  f.nas.normalized.sites.reverse();assert.equal(compare(f).summary.matchedCases,0);
  const g=fixture();g.nas.normalized.sites[0]['secret-dynamic-field']='secret-value';const report=compare(g);assert.equal(report.summary.matchedCases,0);assert.ok(report.cases[0].differencePaths[0].startsWith('sites[0].sha256:'));assert.ok(!JSON.stringify(report).includes('secret-value'));
});
test('rejects identity substitutions, altered prepared bytes and unsupported APK mappings', () => {
  for(const field of ['manifestSha256','rawSha256','apiUrlSha256','idSha256','configSha256']) {const f=fixture();f.nas.report[field]=sha('wrong');assert.throws(()=>compare(f),/identity differs/);}
  const f=fixture();f.art.report.targetApkSha256=sha('other apk');assert.throws(()=>compare(f),/APK pin/);
  const g=fixture();g.art.report.unobservableFields=['ext'];assert.throws(()=>compare(g),/unobservable field/);
  const h=fixture();h.nas.input.apiUrl='https://wrong.invalid';assert.throws(()=>compare(h),/private input differs/);
});
test('different prepared text cannot count as a match even if normalized output agrees', () => {
  const f=fixture();f.nas.preparedText+='\n';f.nas.report.configSha256=sha(f.nas.preparedText);const report=compare(f);
  assert.equal(report.cases[0].normalizedEqual,true);assert.equal(report.cases[0].preparedEqual,false);assert.equal(report.cases[0].observation,'preparation-difference');assert.equal(report.summary.matchedCases,0);
});
test('missing or duplicate results are explicit unknowns or rejected input', () => {
  const f=fixture();const report=compareParserResults(f.plan,[f.art],[],f.options);assert.equal(report.summary.matchedCases,0);assert.deepEqual(report.summary.missingNAS,[0]);assert.equal(report.cases[0].observation,'unknown-missing-result');
  assert.throws(()=>compareParserResults(f.plan,[f.art,f.art],[f.nas],f.options),/duplicate/);
});
test('harness lookup failures and timeouts do not become parser incompatibility or passes', () => {
  for(const reason of ['harness','timeout']) {
    const f=fixture();f.art.report.accepted=false;f.art.report.errorPhase=reason==='harness'?'originalConfigUrl':'originalParseJson';f.art.report.error={type:reason==='harness'?'java.lang.ClassNotFoundException':'java.util.concurrent.TimeoutException',fingerprint:sha(reason)};if(reason==='harness')f.art.report.failureKind='harnessLookupFailure';delete f.art.normalized;
    const report=compare(f);assert.equal(report.summary.matchedCases,0);assert.equal(report.cases[0].observation,'unknown-execution');
  }
});
test('both original parser rejections retain exception types without becoming successful matches', () => {
  const f=fixture();for(const r of [f.art,f.nas]){r.report.accepted=false;r.report.errorPhase='originalParseJson';r.report.error={type:'com.google.gson.JsonSyntaxException',fingerprint:sha('private exception')};}
  const report=compare(f);assert.equal(report.summary.bothRejected,1);assert.equal(report.summary.matchedCases,0);assert.equal(report.cases[0].exceptionTypeEqual,true);
  assert.equal(report.cases[0].partialNormalizedEqual,true);assert.equal(report.summary.bothRejectedMatchingPartial,1);
  f.nas.normalized.sites[0].ext='different partial';assert.equal(compare(f).cases[0].partialNormalizedEqual,false);assert.equal(compare(f).summary.matchedCases,0);
  f.nas.report.accepted=true;delete f.nas.report.error;assert.equal(compare(f).cases[0].observation,'acceptance-difference');
});
test('public reports exclude private input and output values, including unsafe exception labels', () => {
  const f=fixture();f.nas.normalized.sites[0].ext='private-ext-secret';f.art.report.error={type:'invalid?token=private-exception-secret',fingerprint:sha('private-exception-secret')};const text=JSON.stringify(compare(f));
  for(const secret of ['private-source-key','private-row','example.invalid','csp_Private','private-ext-secret','private-exception-secret'])assert.ok(!text.includes(secret),secret);
  assert.ok(text.includes('UnknownError'));
});
