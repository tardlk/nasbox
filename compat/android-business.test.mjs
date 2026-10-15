// SPDX-License-Identifier: GPL-3.0-only
// Synthetic calls only; these checks do not execute providers or Android/ART.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {compareArtResults} from '../scripts/android/compare-art-results.mjs';
import {replayCase} from '../scripts/android/replay-nas.mjs';
import {copyPlatformReference} from '../scripts/compat/platform-reference.mjs';
import {verifyReference,root} from '../scripts/compat/reference.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(calls){
 const artifact={id:sha('owned jar'),sha256:sha('owned jar'),sites:[{key:'owned',api:'csp_Owned',ext:''}]};
 const plan={schemaVersion:1,businessDiscovery:true,artifacts:[artifact]},manifestSha256=sha(JSON.stringify(plan));
 const report={schemaVersion:1,manifestSha256,artifactIndex:0,siteIndex:0,id:artifact.id,jarSha256:artifact.sha256,siteKey:'owned',api:'csp_Owned',extSha256:sha(''),loaderMode:'main',loadSuccess:true,initSuccess:true};
 return {artifact,site:artifact.sites[0],plan,manifestSha256,art:{report,privateCalls:calls},nas:{report:structuredClone(report),privateCalls:structuredClone(calls)}};
}
const compare=f=>compareArtResults(f.plan,[f.art],[f.nas],{manifestSha256:f.manifestSha256});
const skipped={method:'playerContent',params:[],metadata:{method:'playerContent',status:'not-tested',reason:'no-derived-playback-entry',discoveryStep:'player',success:false}};

test('business comparison excludes missing derived parameters from tested successes',()=>{
 const f=fixture([skipped]),value=compare(f);
 assert.equal(value.summary.testedCalls,0);assert.equal(value.summary.notTestedCalls,1);
 assert.equal(value.summary.pairedSuccessfulJsonCalls,0);assert.equal(value.cases[0].calls[0].observation,'not-tested');
 assert.equal(value.cases[0].observation,'unknown-method-coverage');
});

test('player return is nonempty data while private flag, URL, ID and VIP values never appear publicly',()=>{
 const f=fixture([{method:'playerContent',params:['private-flag','private-id',['private-vip']],value:'{"url":"https://private.invalid/media?token=private","parse":0}',metadata:{discoveryStep:'player',status:'nonempty',success:true}}]);
 const value=compare(f),row=value.cases[0].calls[0];
 assert.equal(row.art.playbackUrlPresent,true);assert.equal(row.art.status,'nonempty');assert.equal(row.semanticEqual,true);
 assert.equal(value.summary.nonemptySemanticMatches,1);
 assert.ok(!/private-flag|private-id|private-vip|private.invalid|token=/.test(JSON.stringify(value)));
});

test('empty overrides remain distinct from proven inherited base defaults and delegated search',()=>{
 const base={declaringClass:'com.github.catvod.crawler.Spider',baseSpiderClass:'com.github.catvod.crawler.Spider',inheritedBaseDefault:true,baseDelegatingOverload:false};
 const f=fixture([
  {method:'homeVideoContent',params:[],value:'',metadata:{status:'not-implemented',success:false,methodProvenance:base}},
  {method:'searchContent',params:['owned',false,'1'],value:'{"list":[]}',metadata:{status:'empty',success:true,methodProvenance:{...base,inheritedBaseDefault:false,baseDelegatingOverload:true}}},
  {method:'detailContent',params:[['id']],value:'{}',metadata:{status:'empty',success:true,methodProvenance:{...base,declaringClass:'fixture.Overrides',inheritedBaseDefault:false}}},
  {method:'homeContent',params:[true],value:'',metadata:{status:'empty',success:true,methodProvenance:{...base,declaringClass:'fixture.Overrides',inheritedBaseDefault:false}}},
 ]);
 const value=compare(f),rows=value.cases[0].calls;
 assert.equal(rows[0].art.state,'not-implemented');assert.equal(rows[0].observation,'method-not-implemented');
 assert.equal(rows[1].art.state,'json');assert.equal(rows[1].art.methodProvenance.baseDelegatingOverload,true);
 assert.equal(rows[2].art.status,'empty');assert.equal(value.summary.pairedSuccessfulJsonCalls,2);
 assert.equal(rows[3].art.state,'empty-response');assert.equal(rows[3].observation,'both-empty-response');
});

test('exact replay skips missing arguments, keeps slots aligned, and continues independent calls after failure',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tvbox-business-replay-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const f=fixture([skipped,{method:'homeContent',params:[true]},{method:'playerContent',params:['flag','id',[]]}]);
 const jarPath=join(directory,'owned.jar');await writeFile(jarPath,'owned jar');
 const invoked=[];
 const result=await replayCase({caseId:'0-0',artifact:f.artifact,site:f.site,android:f.art,jarPath},{workRoot:directory,runtimeFactory:()=>({
  request:async()=>({enabled:false}),loadMain:async()=>({loaded:true}),setModules:async()=>{},
  getCSP:async()=>({ready:true,token:'owned',className:'fixture.Owned'}),
  call:async(token,method,params)=>{invoked.push([method,params]);if(method==='homeContent')throw new Error('owned failure');return '{"url":"https://owned.invalid/media"}';},close:async()=>{},
 })});
 assert.deepEqual(invoked,[['homeContent',[true]],['playerContent',['flag','id',[]]]]);
 assert.deepEqual(result.privateCalls.map(call=>call.metadata.status),['not-tested','failed','nonempty']);
 assert.equal(result.report.completed,true);assert.equal(result.report.cleanup.temporaryDataRemoved,true);
});

test('ART business parameter derivation preserves real filters and complete playback IDs',{
 skip:!existsSync(join(process.env.TVBOX_JAVA_HOME||join(root,'.tools/jdk17'),'bin/javac'))||!existsSync(join(root,'.tools/android-sdk/platforms/android-33/android.jar')),
},async t=>{
 // Run only the static derivation helpers on a host JVM, using hash-verified
 // Android JSON sources. This is an algorithm check, not ART/provider evidence.
 verifyReference();
 const directory=await mkdtemp(join(tmpdir(),'tvbox-business-parameters-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const sources=join(directory,'src'),classes=join(directory,'classes');
 copyPlatformReference(sources);
 const harness=join(directory,'BusinessParameters.java');
 await writeFile(harness,`import java.lang.reflect.*;import org.json.*;import java.util.concurrent.*;
public class BusinessParameters {
 public static class Base {
  public String homeContent(boolean filter){return "";}
  public String homeVideoContent(){return "";}
  public String searchContent(String key,boolean quick){return "";}
  public String searchContent(String key,boolean quick,String pg){return searchContent(key,quick);}
 }
 public static class Provided extends Base {
  public String homeContent(boolean filter){throw new IllegalStateException("owned failure");}
  public String searchContent(String key,boolean quick){return "{\\"list\\":[]}";}
 }
 static Object invoke(String name,Class<?>[] types,Object... args)throws Exception {Class<?> c=Class.forName("com.github.tvbox.parity.oracle.OracleInstrumentation");Method m=c.getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(null,args);}
 public static void main(String[] args)throws Exception {
 JSONObject home=new JSONObject("{\\"filters\\":{\\"real-tid\\":[{\\"key\\":\\"area\\",\\"value\\":[{\\"v\\":\\"\\"},{\\"v\\":\\"真实地区\\"}]},{\\"key\\":\\"year\\",\\"value\\":[{\\"v\\":\\"2026\\"}]}]}}");
 System.out.println(invoke("filterValues",new Class[]{JSONObject.class,String.class},home,"real-tid"));
 JSONObject detail=new JSONObject("{\\"list\\":[{\\"vod_id\\":\\"real-id\\",\\"vod_play_from\\":\\"empty$$$real-flag\\",\\"vod_play_url\\":\\"bad$$$E1$https://owned.invalid/path$a?b=c#E2$second\\"}]}");
 System.out.println(invoke("playerParameters",new Class[]{JSONObject.class},detail));
 System.out.println(invoke("playerParameters",new Class[]{JSONObject.class},new JSONObject("{\\"list\\":[{\\"vod_id\\":\\"id\\"}]}"))==null);
 Class<?> oracle=Class.forName("com.github.tvbox.parity.oracle.OracleInstrumentation");Object instance=oracle.newInstance();
 Field base=oracle.getDeclaredField("baseSpiderClass");base.setAccessible(true);base.set(instance,Base.class);
 Method run=oracle.getDeclaredMethod("runCall",Object.class,String.class,JSONArray.class);run.setAccessible(true);
 try {
  Provided source=new Provided();
  run.invoke(instance,source,"homeContent",new JSONArray().put(true));
  run.invoke(instance,source,"homeVideoContent",new JSONArray());
  run.invoke(instance,source,"searchContent",new JSONArray().put("owned").put(false).put("1"));
  Field calls=oracle.getDeclaredField("publicCalls");calls.setAccessible(true);System.out.println(calls.get(instance));
 } finally {Field executor=oracle.getDeclaredField("executor");executor.setAccessible(true);((ExecutorService)executor.get(instance)).shutdownNow();}
 }}
`);
 const jsonDir=join(sources,'org/json'),jsonFiles=(await readdir(jsonDir)).filter(name=>name.endsWith('.java')).map(name=>join(jsonDir,name));
 const annotations=['android/annotation/SystemApi.java','android/compat/annotation/UnsupportedAppUsage.java','libcore/util/NonNull.java','libcore/util/Nullable.java'].map(name=>join(sources,name));
 const javaHome=process.env.TVBOX_JAVA_HOME||join(root,'.tools/jdk17'),android=join(root,'.tools/android-sdk/platforms/android-33/android.jar');
 const compiled=spawnSync(join(javaHome,'bin/javac'),['-encoding','UTF-8','-cp',android,'-d',classes,...jsonFiles,...annotations,resolve(root,'scripts/android/OracleInstrumentation.java'),harness],{encoding:'utf8',timeout:30000});
 assert.equal(compiled.status,0,compiled.stderr);
 // Runtime-only no-op app bindings allow synthetic reflection calls on the host.
 // Oracle itself was compiled against the actual retained Android SDK above.
 const stubApp=join(directory,'stubs/android/app'),stubOs=join(directory,'stubs/android/os');
 await mkdir(stubApp,{recursive:true});await mkdir(stubOs,{recursive:true});
 const instrumentation=join(stubApp,'Instrumentation.java'),bundle=join(stubOs,'Bundle.java');
 await writeFile(instrumentation,'package android.app;public class Instrumentation {public Instrumentation(){} public void sendStatus(int code,android.os.Bundle result){}}');
 await writeFile(bundle,'package android.os;public class Bundle {public Bundle(){} public void putString(String key,String value){}}');
 const stubs=spawnSync(join(javaHome,'bin/javac'),['-d',classes,instrumentation,bundle],{encoding:'utf8',timeout:30000});
 assert.equal(stubs.status,0,stubs.stderr);
 const executed=spawnSync(join(javaHome,'bin/java'),['-cp',classes+':'+android,'BusinessParameters'],{encoding:'utf8',timeout:10000});
 assert.equal(executed.status,0,executed.stderr);
 const lines=executed.stdout.trim().split('\n');
 assert.deepEqual(JSON.parse(lines[0]),{area:'真实地区',year:'2026'});
 assert.deepEqual(JSON.parse(lines[1]),['real-flag','https://owned.invalid/path$a?b=c',[]]);
 assert.equal(lines[2],'true');
 const calls=JSON.parse(lines[3]);
 assert.deepEqual(calls.map(call=>call.status),['failed','not-implemented','empty']);
 assert.equal(calls[1].methodProvenance.inheritedBaseDefault,true);
 assert.equal(calls[2].methodProvenance.baseDelegatingOverload,true);
 assert.equal(calls[2].methodProvenance.inheritedBaseDefault,false);
});
