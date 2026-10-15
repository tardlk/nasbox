// SPDX-License-Identifier: GPL-3.0-only
// Owned synthetic adb results only. No Android device or provider is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pullVerifiedJSResult,androidJSCanonical,androidJSSourceSha256,jsOracleBudgets} from '../scripts/android/run-js-oracle.mjs';
import {jsOracleOfficialApkSha256} from '../scripts/android/js-apk-symbol-map.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
 const output=await mkdtemp(join(tmpdir(),'tvbox-js-collection-'));t.after(()=>rm(output,{recursive:true,force:true}));
 const source={key:'owned-中文',api:'https://owned.invalid/main.js',ext:'https://owned.invalid/中文.js',type:3,jar:''};
 const metadata={method:'homeContent',discoveryStep:'home',status:'nonempty',response:{sha256:sha('{"class":[1]}'),bytes:13}};
 const report={schemaVersion:1,manifestSha256:sha('owned plan'),sourceIndex:0,sourceSha256:androidJSSourceSha256(source),extSha256:sha(source.ext),
  api:'sha256:'+sha(source.api),siteKey:source.key,targetApkSha256:jsOracleOfficialApkSha256,symbolMapSha256:sha('owned map'),calls:[metadata]};
 const value={report,privateCalls:[{method:'homeContent',params:[true],value:'{"class":[1]}',metadata}]};
 metadata.response.bytes=Buffer.byteLength(value.privateCalls[0].value);
 const options={command:args=>{writeFileSync(args[2],JSON.stringify(value));return{status:0};},output,index:0,source,manifestSha256:report.manifestSha256,
  instrumentReport:structuredClone(report),devicePath:'/storage/emulated/0/Android/data/com.github.tvbox.osc.jun/files/parity-js-oracle/result-0.json'};
 return{output,source,value,options,final:join(output,'0-private.json')};
}
test('AOSP canonical input identity preserves slash escaping separately from Node identity',()=>{
 const value={url:'https://owned.invalid/中文.js',nested:{z:'a/b',a:1},key:'source'};
 assert.equal(androidJSCanonical(value),'{"key":"source","nested":{"a":1,"z":"a\\/b"},"url":"https:\\/\\/owned.invalid\\/中文.js"}');
 assert.notEqual(androidJSSourceSha256(value),sha(JSON.stringify(value)));
 assert.deepEqual(jsOracleBudgets(),{caseMs:300000,initMs:90000,callMs:12000});
 assert.throws(()=>jsOracleBudgets({artBudgets:{callMs:0}}),/BUDGET/);
});
test('verified current JS result is atomically published with exact bytes and owner-only permissions',async t=>{
 const f=await fixture(t),result=await pullVerifiedJSResult(f.options),bytes=await readFile(f.final);
 assert.equal(result.ok,true);assert.equal(result.sha256,sha(bytes));assert.equal(result.bytes,bytes.length);
 assert.deepEqual(JSON.parse(bytes),f.value);assert.equal((await stat(f.final)).mode&0o777,0o600);assert.deepEqual(await readdir(f.output),['0-private.json']);
});
test('unrelated manifest/source/ext/APK or changed status cannot be accepted as current JS evidence',async t=>{
 for(const field of['manifestSha256','sourceSha256','extSha256','targetApkSha256','symbolMapSha256','siteKey']){
  const f=await fixture(t);f.value.report[field]='changed';f.options.instrumentReport=structuredClone(f.value.report);
  assert.equal((await pullVerifiedJSResult(f.options)).ok,false);assert.equal(existsSync(f.final),false);
 }
 const f=await fixture(t);f.value.report.initSuccess=false;assert.equal((await pullVerifiedJSResult(f.options)).ok,false);
});
test('changed response bytes and partial transport do not leave stale final private files',async t=>{
 const f=await fixture(t);await writeFile(f.final,'stale');f.value.privateCalls[0].value='changed';
 assert.equal((await pullVerifiedJSResult(f.options)).code,'PRIVATE_RESPONSE');assert.equal(existsSync(f.final),false);
 f.options.command=args=>{writeFileSync(args[2],'{partial');return{status:1};};
 assert.equal((await pullVerifiedJSResult(f.options)).code,'ADB_PULL_FAILED');assert.deepEqual(await readdir(f.output),[]);
});
test('a real original null return is retained as invalid-json evidence without an invented exception',async t=>{
 const f=await fixture(t),call=f.value.privateCalls[0];call.value=null;call.metadata={method:'homeContent',discoveryStep:'home',status:'invalid-json',resultType:'null',success:false};
 f.value.report.calls=[call.metadata];f.options.instrumentReport=structuredClone(f.value.report);
 assert.equal((await pullVerifiedJSResult(f.options)).ok,true);
 const read=JSON.parse(await readFile(f.final));assert.equal(read.privateCalls[0].value,null);assert.equal(read.privateCalls[0].error,undefined);
});
