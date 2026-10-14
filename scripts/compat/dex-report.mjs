// Host-only evidence; never infer Android/ART or native protection compatibility.
import {writeFileSync,readFileSync} from 'node:fs';import {resolve} from 'node:path';import {isDeepStrictEqual} from 'node:util';
import {root,sha256} from './reference.mjs';import {buildDexFixtures} from './dex-fixtures.mjs';import {buildSpiderOracle} from './spider-oracle.mjs';
import {spiderCases} from './spider-cases.mjs';import {runSpiderCases} from './spider-runner.mjs';import {createSpiderRuntime} from '../../backend/spider-runtime/index.mjs';
const f=buildDexFixtures();
try{
 const oracle=buildSpiderOracle(f.built),expected=await runSpiderCases(spiderCases,f,oracle),actual=await runSpiderCases(spiderCases,{...f,jar:f.archive});
 const rows=spiderCases.map((c,i)=>({id:c.id,equal:isDeepStrictEqual(expected[i],actual[i])}));
 async function protection(built){const r=createSpiderRuntime({built,timeoutMs:30000});const result={};try{
  for(const [name,fixture] of [['protected',f.protectedFixture],['native',f.nativeFixture],['plain-whitelist',f.plainWhitelist],['encrypted-whitelist',f.encryptedWhitelist]])for(const kind of ['raw','jar'])result[name+'-'+kind]=await r.request({operation:'scanProtection',path:fixture[kind]});
  await r.request({operation:'host',packageName:'different.app'});for(const [name,fixture] of [['plain',f.plainWhitelist],['encrypted',f.encryptedWhitelist]])result[name+'-other-package']=await r.request({operation:'scanProtection',path:fixture.jar});
  await r.request({operation:'host',packageName:'com.github.tvbox.osc.jun'});result.loaded=(await r.loadMain(f.protectedFixture.jar)).loaded;
  const s=await r.getCSP({key:'guard',type:3,api:'csp_Guarded',ext:'payload-ext',jar:''});result.ready=s.ready;result.nestedBefore=(await r.request({operation:'dexState'})).nestedLoaderCount;
  result.home=await r.call(s.token,'homeContent',[true]);result.flags=await r.call(s.token,'action',['flags']);await r.clear('jar');result.nestedAfter=(await r.request({operation:'dexState'})).nestedLoaderCount;
  result.destroyed=(await r.request({operation:'logs'})).includes('payload destroyed:guard');result.nativeLoaded=(await r.loadMain(f.nativeFixture.jar)).loaded;result.nativeReady=(await r.getCSP({key:'native',type:3,api:'csp_Guarded',ext:'',jar:''})).ready;
  return result;
 }finally{await r.close();}}
 const required={'protected-raw':true,'protected-jar':true,'native-raw':true,'native-jar':true,'plain-whitelist-raw':false,'plain-whitelist-jar':false,'encrypted-whitelist-raw':false,'encrypted-whitelist-jar':false,'plain-other-package':true,'encrypted-other-package':true,loaded:true,ready:true,nestedBefore:1,home:'payload|guard|payload-ext|true|9978',flags:'com.github.tvbox.osc.jun|0|true|true',nestedAfter:0,destroyed:true,nativeLoaded:false,nativeReady:false};
 const sourceProtection=await protection(oracle),productionProtection=await protection(f.built);
 const protectionRows=Object.keys(required).map(id=>({id,expected:required[id],source:sourceProtection[id],actual:productionProtection[id],equal:isDeepStrictEqual(sourceProtection[id],required[id])&&isDeepStrictEqual(productionProtection[id],required[id])}));
 const all=[...rows,...protectionRows];const report={baseline:oracle.extraction.commit,host:{platform:process.platform,architecture:process.arch},scope:'Controlled Java-8 -> dx DEX -> isolated dex2jar -> JVM; fresh pinned TVBox protected helper on shared host classloader bindings. No Android/ART, Linux/NAS or native decryption execution.',
 toolchain:{dex2jar:f.tool.manifest.version,archiveSha256:f.tool.manifest.archiveSha256,fingerprint:f.tool.fingerprint,verification:f.tool.manifest.verification},
 artifactSha256:Object.fromEntries([['dex',f.raw],['protectedDex',f.protectedFixture.raw],['nativeOnlyDex',f.nativeFixture.raw]].map(([n,p])=>[n,sha256(readFileSync(p))])),
 protectionSource:oracle.extraction.copies.find(c=>c.path.endsWith('/ProtectedInitJar.java')),comparison:'Exact 136 existing results against fresh class-JAR source probe, plus 19 explicitly specified protection observations against both fresh source and production',total:all.length,matching:all.filter(r=>r.equal).length,differences:all.filter(r=>!r.equal).length,roundTrip:rows,protection:protectionRows,
 limits:['Synthetic owned fixtures; no actual subscription JAR/JS executed','DEX conversion is not ART verification; R8/obfuscation, reflection and missing Android dependencies may still fail','Pure-Java AES fixture is not evidence of proprietary native/ARM shell compatibility','JNI/native libraries, Android framework services and Python remain unavailable','Same host classloader/adapters are shared by the source probe; requires real Android and Linux x86_64 comparisons','Per-artifact expansion and process time/memory bounded; caller-owned persistent cache has no aggregate quota yet']};
 writeFileSync(resolve(root,'docs/linux/dex-runtime-comparison.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({total:report.total,matching:report.matching,differences:report.differences}));if(report.differences)process.exitCode=1;
}finally{f.cleanup();}
