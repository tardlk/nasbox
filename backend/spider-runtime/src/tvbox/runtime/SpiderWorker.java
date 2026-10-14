// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import com.github.catvod.crawler.*;
import com.github.tvbox.osc.bean.SourceBean;
import com.google.gson.*;
import java.util.*;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
/** One serialized runtime session. Stdout belongs only to the JSON-line protocol. */
public final class SpiderWorker {
 private final Gson gson=new GsonBuilder().serializeNulls().create();
 private final JarExecutor jars=new JarExecutor();
 private final JsExecutor scripts=new JsExecutor();
 private final CspRouter router=new CspRouter(jars,scripts);
 private final IdentityHashMap<Spider,String> identities=new IdentityHashMap<>();
 private final Map<String,Spider> references=new LinkedHashMap<>();
 private final Map<String,String> kinds=new LinkedHashMap<>();
 private int nextIdentity=0;
 private JsonElement run(JsonObject r)throws Exception{
  String operation=r.get("operation").getAsString();
  if(operation.equals("resetKeys")){router.currentPyKey="";return JsonNull.INSTANCE;}
  if(operation.equals("host")){HostServices.configure(r);return JsonNull.INSTANCE;}
  if(operation.equals("loadMain")){JsonObject v=new JsonObject();v.addProperty("loaded",jars.loadMain(Path.of(r.get("path").getAsString())));v.add("logs",HostServices.logs.deepCopy());if(!v.get("loaded").getAsBoolean()&&jars.failure()!=null)v.addProperty("failure",jars.failure());return v;}
  if(operation.equals("dexState")){JsonObject v=new JsonObject();v.addProperty("nestedLoaderCount",dalvik.system.BaseDexClassLoader.ownedCount());return v;}
  if(operation.equals("scanProtection"))return new JsonPrimitive(new ProtectedJarSupport().check(r.get("path").getAsString()));
  if(operation.equals("registerJar")){String signature=r.get("signature").getAsString();Path path=Path.of(r.get("path").getAsString());jars.register(signature,path);scripts.register(signature.split(";md5;")[0],path);return JsonNull.INSTANCE;}
  if(operation.equals("moduleRead"))return gson.toJsonTree(com.github.tvbox.osc.util.FileUtils.loadModule(r.get("name").getAsString()));
  if(operation.equals("moduleState"))return SourceModuleLoader.snapshot();
  if(operation.equals("modules")){
   if(r.has("android"))com.github.tvbox.osc.util.FileUtils.androidModules=r.get("android").getAsBoolean();
   if(r.has("remote")){SourceModuleLoader.remote=r.get("remote").getAsBoolean();if(SourceModuleLoader.remote)com.github.tvbox.osc.util.FileUtils.androidModules=true;}
   if(r.has("debug"))SourceModuleLoader.debug=r.get("debug").getAsBoolean();
   if(r.has("root"))com.github.tvbox.osc.util.FileUtils.moduleRoot=Path.of(r.get("root").getAsString()).toRealPath();
   if(r.has("modules"))for(Map.Entry<String,JsonElement> e:r.getAsJsonObject("modules").entrySet())com.github.tvbox.osc.util.FileUtils.register(e.getKey(),e.getValue().isJsonNull()?null:e.getValue().getAsString());return JsonNull.INSTANCE;
  }
  if(operation.equals("get")){
   SourceBean source=gson.fromJson(r.get("source"),SourceBean.class);
   if(source.getType()!=3)throw new UnsupportedOperationException("Only type=3 CSP dispatch is supported");
   Spider spider=router.getCSP(source);String kind=route(source.getApi());
   String token=identities.get(spider);if(token==null){token="spider-"+(++nextIdentity);identities.put(spider,token);references.put(token,spider);kinds.put(token,kind);}
   JsonObject v=new JsonObject();v.addProperty("token",token);v.addProperty("kind",kind);v.addProperty("className",spider.getClass().getName());v.addProperty("siteKey",spider.siteKey);
   v.addProperty("ready",!(spider instanceof SpiderNull)&&(!kind.equals("js")||scripts.ready(spider)));return v;
  }
  if(operation.equals("route"))return new JsonPrimitive(route(r.get("api").getAsString()));
  if(operation.equals("call")){
   Spider spider=references.get(r.get("token").getAsString());if(spider==null)throw new IllegalStateException("Unknown or cleared Spider token");
   return value(invoke(spider,r.get("method").getAsString(),r.has("args")?r.getAsJsonArray("args"):new JsonArray()));
  }
  if(operation.equals("proxy"))return value(r.get("kind").getAsString().equals("js")?scripts.proxyInvoke(stringMap(r.get("params"))):jars.proxyInvoke(stringMap(r.get("params"))));
  if(operation.equals("clear")){
   String kind=r.get("kind").getAsString();if(kind.equals("jar"))jars.close();else if(kind.equals("js")){scripts.close();SourceModuleLoader.resetBudget();}else throw new IllegalArgumentException("Unsupported runtime kind");
   for(String token:new ArrayList<>(references.keySet()))if(kinds.get(token).equals(kind)){identities.remove(references.remove(token));kinds.remove(token);}return snapshot();
  }
  if(operation.equals("state"))return snapshot();
  if(operation.equals("logs")){JsonArray v=HostServices.logs.deepCopy();while(HostServices.logs.size()>0)HostServices.logs.remove(0);return v;}
  if(operation.equals("api"))return value(api(r));
  if(operation.equals("contract"))return contract();
  if(operation.equals("compileModule")){
   com.whl.quickjs.wrapper.QuickJSContext ctx=com.whl.quickjs.wrapper.QuickJSContext.create();
   try{ctx.setMemoryLimit(64*1024*1024);byte[] bytes=ctx.compileModule(r.get("text").getAsString(),r.get("name").getAsString());JsonObject v=new JsonObject();v.addProperty("base64",java.util.Base64.getEncoder().encodeToString(bytes));v.addProperty("version",bytes[0]);return v;}finally{ctx.destroy();}
  }
  throw new IllegalArgumentException("Unknown runtime operation");
 }
 private JsonObject snapshot(){JsonObject v=new JsonObject();v.add("jar",jars.snapshot());v.add("js",scripts.snapshot());v.addProperty("currentPyKey",router.currentPyKey);v.addProperty("referenceCount",references.size());return v;}
 static String route(String api){if(api.endsWith(".js")||api.contains(".js?"))return "js";if(api.contains(".py"))return "py";return "jar";}
 private Object api(JsonObject r){SpiderApi api=new SpiderApi();JsonArray a=r.has("args")?r.getAsJsonArray("args"):new JsonArray();switch(r.get("method").getAsString()){
  case "getAddress":return api.getAddress(a.get(0).getAsBoolean());case "getPort":return api.getPort();case "getScreenOrientation":return api.getScreenOrientation();
  case "webParse":return api.webParse(string(a,0),string(a,1));case "multiReq":return api.multiReq(a.size()==0||a.get(0).isJsonNull()?null:a.get(0).getAsJsonArray());
  case "log":api.log(string(a,0));return null;default:throw new IllegalArgumentException("Unknown SpiderApi method");}}
 private Object invoke(Spider s,String method,JsonArray a){switch(method){
  case "homeContent":return s.homeContent(a.get(0).getAsBoolean());case "homeVideoContent":return s.homeVideoContent();
  case "categoryContent":return s.categoryContent(string(a,0),string(a,1),a.get(2).getAsBoolean(),stringMap(a.get(3)));
  case "detailContent":return s.detailContent(stringList(a.get(0)));case "searchContent":return a.size()>2?s.searchContent(string(a,0),a.get(1).getAsBoolean(),string(a,2)):s.searchContent(string(a,0),a.get(1).getAsBoolean());
  case "playerContent":return s.playerContent(string(a,0),string(a,1),stringList(a.get(2)));case "isVideoFormat":return s.isVideoFormat(string(a,0));case "manualVideoCheck":return s.manualVideoCheck();
  case "liveContent":return s.liveContent(string(a,0));case "action":return s.action(string(a,0));case "proxyLocal":return s.proxyLocal(stringMap(a.get(0)));case "proxy":return s.proxy(stringMap(a.get(0)));
  case "cancelByTag":s.cancelByTag();return null;case "destroy":s.destroy();return null;default:throw new IllegalArgumentException("Unknown Spider method");}}
 static String string(JsonArray a,int i){return a.get(i).isJsonNull()?null:a.get(i).getAsString();}
 static HashMap<String,String> stringMap(JsonElement e){if(e==null||e.isJsonNull())return null;HashMap<String,String> map=new HashMap<>();for(Map.Entry<String,JsonElement> v:e.getAsJsonObject().entrySet())map.put(v.getKey(),v.getValue().isJsonNull()?null:v.getValue().getAsString());return map;}
 static List<String> stringList(JsonElement e){if(e.isJsonNull())return null;ArrayList<String> list=new ArrayList<>();for(JsonElement v:e.getAsJsonArray())list.add(v.isJsonNull()?null:v.getAsString());return list;}
 private JsonElement value(Object object)throws IOException{
  if(object==null)return JsonNull.INSTANCE;
  if(object instanceof InputStream){try(InputStream stream=(InputStream)object){byte[] bytes=stream.readNBytes(2*1024*1024+1);if(bytes.length>2*1024*1024)throw new IOException("Proxy response exceeds host bridge limit");JsonObject v=new JsonObject();v.addProperty("encoding","base64");v.addProperty("bytes",java.util.Base64.getEncoder().encodeToString(bytes));v.addProperty("length",bytes.length);return v;}}
  if(object instanceof Object[]){JsonArray array=new JsonArray();for(Object v:(Object[])object)array.add(value(v));return array;}return gson.toJsonTree(object);
 }
 private JsonObject contract(){
  JsonObject v=new JsonObject();JsonArray methods=new JsonArray(),fields=new JsonArray(),api=new JsonArray();
  for(java.lang.reflect.Method m:Spider.class.getDeclaredMethods())methods.add(descriptor(m));for(java.lang.reflect.Field f:Spider.class.getDeclaredFields())fields.add(f.getName()+":"+f.getType().getName());
  for(java.lang.reflect.Method m:SpiderApi.class.getDeclaredMethods())if(java.lang.reflect.Modifier.isPublic(m.getModifiers()))api.add(descriptor(m));
  v.add("spiderMethods",sorted(methods));v.add("spiderFields",sorted(fields));v.add("apiMethods",sorted(api));return v;
 }
 static String descriptor(java.lang.reflect.Method m){StringJoiner j=new StringJoiner(",");for(Class<?> c:m.getParameterTypes())j.add(c.getName());return m.getName()+"("+j+"):"+m.getReturnType().getName();}
 static JsonArray sorted(JsonArray a){ArrayList<String> s=new ArrayList<>();for(JsonElement v:a)s.add(v.getAsString());Collections.sort(s);JsonArray r=new JsonArray();for(String v:s)r.add(v);return r;}
 private void close()throws Exception{
  Exception failure=null;try{jars.close();}catch(Exception e){failure=e;}
  try{scripts.close();}catch(Exception e){failure=e;}finally{
   try{dalvik.system.BaseDexClassLoader.closeAll();}catch(Exception e){failure=e;}
   try{DexArtifacts.close();}catch(Exception e){failure=e;}
   HostServices.close();com.github.tvbox.osc.util.FileUtils.clear();
  }
  if(failure!=null)throw failure;
 }
 public static void main(String[] args)throws Exception{
  System.load(args[0]);HostServices.directory=Path.of(args[1]).toFile();com.orhanobut.hawk.Hawk.restore();
  PrintWriter output=new PrintWriter(new OutputStreamWriter(new FileOutputStream(FileDescriptor.out),StandardCharsets.UTF_8),true);
  System.setOut(new PrintStream(System.err,true,"UTF-8"));
  SpiderWorker worker=new SpiderWorker();BufferedReader input=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8));String line;
  try{while((line=input.readLine())!=null){JsonObject response=new JsonObject();try{JsonObject r=JsonParser.parseString(line).getAsJsonObject();response.add("id",r.get("id"));JsonElement value=worker.run(r);response.addProperty("ok",true);response.add("value",value);}catch(Throwable e){response.addProperty("ok",false);response.addProperty("errorType",e.getClass().getName());response.addProperty("message",e.getMessage());}output.println(response);}}
  finally{worker.close();}
 }
}
