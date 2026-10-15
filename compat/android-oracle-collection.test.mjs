// SPDX-License-Identifier: GPL-3.0-only
// Fake adb writes only owned synthetic JSON; no Android device or JVM is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pullVerifiedPrivateResult} from '../scripts/android/run-oracle.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(action){
 const output=await mkdtemp(join(tmpdir(),'tvbox-oracle-collection-'));
 try{
  const artifact={id:sha('owned jar'),sha256:sha('owned jar')},site={key:'owned-site',api:'csp_Owned',ext:'exact owned ext'};
  const call={method:'homeContent',params:[true],value:'{"class":[]}'};
  const metadata={method:call.method,success:true,paramsSha256:sha('[true]'),response:{sha256:sha(call.value),bytes:Buffer.byteLength(call.value)}};
  call.metadata=metadata;
  const report={schemaVersion:1,loaderMode:'main',artifactIndex:0,siteIndex:0,id:artifact.id,jarSha256:artifact.sha256,siteKey:site.key,api:site.api,extSha256:sha(site.ext),manifestSha256:sha('owned plan'),loadSuccess:true,initSuccess:true,calls:[metadata]};
  const value={report,privateCalls:[call]},finalPath=join(output,'0-0-private.json');
  await writeFile(finalPath,'old private result');
  const options={output,id:'0-0',artifactIndex:0,siteIndex:0,artifact,site,manifestSha256:report.manifestSha256,instrumentReport:structuredClone(report),devicePath:'/storage/emulated/0/Android/data/com.github.tvbox.osc.jun/files/parity-oracle/result-0-0.json'};
  await action({options,value,output,finalPath});
 }finally{await rm(output,{recursive:true,force:true});}
}
test('failed adb pull removes stale final result and partial staging file',async()=>fixture(async({options,output,finalPath})=>{
 options.command=args=>{assert.equal(existsSync(finalPath),false);writeFileSync(args[2],'{partial');return{status:1};};
 const result=await pullVerifiedPrivateResult(options);
 assert.deepEqual(result,{ok:false,errorCode:'ADB_PULL_FAILED'});assert.equal(existsSync(finalPath),false);assert.deepEqual(await readdir(output),[]);
}));
test('successful current result is verified then atomically published privately',async()=>fixture(async({options,value,output,finalPath})=>{
 let destination;
 options.command=args=>{assert.equal(existsSync(finalPath),false);destination=args[2];assert.notEqual(destination,finalPath);writeFileSync(destination,JSON.stringify(value));return{status:0};};
 const result=await pullVerifiedPrivateResult(options),bytes=await readFile(finalPath);
 assert.equal(result.ok,true);assert.equal(result.sha256,sha(bytes));assert.equal(result.bytes,bytes.length);
 assert.deepEqual(JSON.parse(bytes),value);assert.deepEqual(await readdir(output),['0-0-private.json']);assert.equal((await stat(finalPath)).mode&0o777,0o600);
}));
test('manifest, JAR, API, ext and site substitutions never reach final result',async()=>{
 for(const field of ['manifestSha256','jarSha256','api','extSha256','siteKey','artifactIndex'])await fixture(async({options,value,output,finalPath})=>{
  value.report[field]=field==='artifactIndex'?1:'wrong';
  // Even a correspondingly changed status report cannot bypass launch identity.
  options.instrumentReport=structuredClone(value.report);
  options.command=args=>{writeFileSync(args[2],JSON.stringify(value));return{status:0};};
  const result=await pullVerifiedPrivateResult(options);assert.equal(result.ok,false);assert.equal(result.errorCode,'PRIVATE_RESULT_IDENTITY');assert.equal(existsSync(finalPath),false);assert.deepEqual(await readdir(output),[]);
 });
});
test('a pulled report must match this instrumentation status report',async()=>fixture(async({options,value,finalPath})=>{
 value.report.initSuccess=false;options.command=args=>{writeFileSync(args[2],JSON.stringify(value));return{status:0};};
 assert.equal((await pullVerifiedPrivateResult(options)).errorCode,'PRIVATE_RESULT_IDENTITY');assert.equal(existsSync(finalPath),false);
}));
test('invalid JSON, changed response bytes and inconsistent calls are rejected',async()=>{
 for(const mode of ['json','hash','calls'])await fixture(async({options,value,finalPath,output})=>{
  if(mode==='hash')value.privateCalls[0].value='{"altered":true}';
  if(mode==='calls')value.privateCalls=[];
  options.command=args=>{writeFileSync(args[2],mode==='json'?'bad json':JSON.stringify(value));return{status:0};};
  assert.equal((await pullVerifiedPrivateResult(options)).ok,false);assert.equal(existsSync(finalPath),false);assert.deepEqual(await readdir(output),[]);
 });
});
test('missing current report or wrong case path clears old local output without calling adb',async()=>{
 for(const mode of ['missing','path'])await fixture(async({options,output,finalPath})=>{
  if(mode==='missing')options.instrumentReport=undefined;else options.devicePath=options.devicePath.replace('result-0-0','result-0-1');
  options.command=()=>{throw Error('adb must not run');};
  assert.equal((await pullVerifiedPrivateResult(options)).errorCode,'MISSING_CURRENT_RESULT');assert.equal(existsSync(finalPath),false);assert.deepEqual(await readdir(output),[]);
 });
});
