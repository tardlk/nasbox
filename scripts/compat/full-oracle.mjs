// Dedicated full-configuration source probe. Never used by the production build.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, reference, sha256 } from './reference.mjs';
import { copyPlatformReference } from './platform-reference.mjs';
import { fullConfigReference } from './full-config-reference.mjs';
import { extractMethod } from './oracle.mjs';

export function buildFullOracle() {
  const referenceCode = fullConfigReference();
  const base = resolve(root,'.cache/compat/full-oracle');mkdirSync(base,{recursive:true});
  const build=mkdtempSync(resolve(base,'run-'));
  const platform=copyPlatformReference(build);
  const defaults=readFileSync(resolve(reference,'app/src/main/java/com/github/tvbox/osc/util/DefaultConfig.java'),'utf8');
  // Independent host preference adapter. Values restored here are typed explicitly,
  // rather than importing the production PreferenceStore or worker implementation.
  const adapter=`package tvbox.config;
import com.google.gson.*;import java.util.*;
class PreferenceStore {
 final LinkedHashMap<String,Object> values=new LinkedHashMap<>();
 PreferenceStore(){restore(new JsonObject());}
 @SuppressWarnings("unchecked") <T>T get(String k,T v){return values.containsKey(k)?(T)values.get(k):v;}
 void put(String k,Object v){values.put(k,v);}
 void restore(JsonObject input){values.clear();
 for(String k:Arrays.asList("apiUrl","liveApiUrl","apiLineSource"))values.put(k,input.has(k)?input.get(k).getAsString():"");
 for(String k:Arrays.asList("homeApi","defaultParse"))if(input.has(k))values.put(k,input.get(k).getAsString());
 for(String k:Arrays.asList("apiLineList","apiHistory","liveApiHistory")){ArrayList<String> list=new ArrayList<>();if(input.has(k))for(JsonElement v:input.getAsJsonArray(k))list.add(v.isJsonNull()?null:v.getAsString());values.put(k,list);}
 for(Map.Entry<String,JsonElement> e:input.entrySet()){String k=e.getKey();JsonElement v=e.getValue();
 if(k.equals("epgUrl")||k.equals("dohJson"))values.put(k,v.getAsString());
 if(k.equals("liveGroupList"))values.put(k,v.deepCopy());
 if(k.equals("liveWebHeader"))values.put(k,v.isJsonNull()?null:new Gson().fromJson(v,new com.google.gson.reflect.TypeToken<HashMap<String,String>>(){}.getType()));
 if(k.equals("dohUrl")||k.equals("playType")||k.equals("liveConnectTimeout")||k.equals("liveGroupIndex")||k.startsWith("liveGroupIndex_"))values.put(k,v.getAsInt());
 if(k.equals("livePlayType"))values.put(k,v.getAsJsonPrimitive().isString()?v.getAsString():v.getAsInt());
 }}JsonObject snapshot(){return new Gson().toJsonTree(values).getAsJsonObject();}}
class DefaultConfig {static String localAddress="http://127.0.0.1:9978/";public static String checkReplaceProxy(String s){return s.startsWith("proxy://")?s.replace("proxy://",localAddress+"proxy?"):s;} }
class PreferenceKeys{static final String HOME_API="homeApi",DEFAULT_PARSE="defaultParse";}
public class FullOracle {
 public static void main(String[] args)throws Exception{
 PreferenceStore store=new PreferenceStore();FullConfig config=null;
 java.io.BufferedReader reader=new java.io.BufferedReader(new java.io.InputStreamReader(System.in,java.nio.charset.StandardCharsets.UTF_8));String line;
 while((line=reader.readLine())!=null){JsonObject out=new JsonObject();try{JsonObject r=JsonParser.parseString(line).getAsJsonObject();String op=r.get("operation").getAsString();JsonElement value;
 if(r.has("localAddress"))DefaultConfig.localAddress=r.get("localAddress").getAsString();
 if(op.equals("state")){if(r.has("state"))store.restore(r.getAsJsonObject("state"));value=store.snapshot();}
 else{if(config==null)config=new FullConfig(store);if(op.equals("full"))value=config.run(r);else if(op.equals("fullInspect"))value=config.inspect(r);else if(op.equals("fullResetKeys")){config.resetRuntimeKeys();value=JsonNull.INSTANCE;}else value=config.snapshot();}
 out.addProperty("ok",true);out.add("value",value);
 }catch(Throwable e){out.addProperty("ok",false);out.addProperty("errorType",e.getClass().getName());out.add("partialSites",new JsonArray());}System.out.println(out);}}}
`;
  const parseBean=readFileSync(resolve(platform.extra,'app/src/main/java/com/github/tvbox/osc/bean/ParseBean.java'),'utf8').replace('import com.github.tvbox.osc.util.DefaultConfig;','import tvbox.config.DefaultConfig;');
  // ParseBean's public dependency remains an unchanged original method in a separate adapter.
  const publicDefault=`package tvbox.config;public class DefaultConfig {static String localAddress="http://127.0.0.1:9978/";${extractMethod(defaults,'public static String checkReplaceProxy(').replace('ControlManager.get().getAddress(true)','localAddress')}}`;
  const files={'FullConfig.java':referenceCode.source,'FullOracle.java':adapter.replace(/class DefaultConfig \{[^\n]*\n/,''),
    'DefaultConfig.java':publicDefault,'ParseBean.java':parseBean,'SourceBean.java':readFileSync(resolve(reference,'app/src/main/java/com/github/tvbox/osc/bean/SourceBean.java'),'utf8')};
  for(const[name,text]of Object.entries(files))writeFileSync(resolve(build,name),text);
  const gson=process.env.TVBOX_GSON_JAR||resolve(root,'.tools/lib/gson-2.10.1.jar');
  const integrity=JSON.parse(readFileSync(resolve(root,'compat/toolchain-integrity.json'),'utf8'));
  if(sha256(readFileSync(gson))!==integrity.gson.sha256)throw new Error('Gson checksum differs');
  const home=process.env.TVBOX_JAVA_HOME||resolve(root,'.tools/jdk17');
  const command=name=>existsSync(resolve(home,'bin',name))?resolve(home,'bin',name):name;
  const result=spawnSync(command('javac'),['--release','17','-encoding','UTF-8','-cp',gson,'-d',build,...Object.keys(files).map(n=>resolve(build,n)),...platform.sources],{encoding:'utf8',timeout:30000});
  if(result.error||result.status!==0)throw new Error(`Full oracle compile failed: ${result.error||result.stderr}`);
  writeFileSync(resolve(build,'extraction.json'),JSON.stringify(referenceCode.extraction,null,2)+'\n');
  return{build,gson,java:command('java'),extraction:referenceCode.extraction};
}
export function queryFullOracle(requests,built=buildFullOracle()){
 const r=spawnSync(built.java,['-Dfile.encoding=UTF-8','-cp',[built.build,built.gson].join(delimiter),'tvbox.config.FullOracle'],{
 input:requests.map(r=>JSON.stringify(r)).join('\n')+'\n',encoding:'utf8',maxBuffer:32*1024*1024,timeout:30000});
 if(r.error||r.status!==0)throw new Error(`Full oracle failed: ${r.error||r.stderr}`);
 const values=r.stdout.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));if(values.length!==requests.length)throw new Error('Oracle response count differs');return values;
}
