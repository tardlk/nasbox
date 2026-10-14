// Host adapters for selected original Hawk/history and loadConfig methods.
// These adapters are test code, not the production persistence implementation.
import { extractMethod } from './oracle.mjs';

export function stateReference(api, history, md5, files, build) {
  const historyMethods = ['public static void setApiHistory(', 'public static void setLiveApiHistory(', 'public static void clearApiLineList(']
    .map(signature => extractMethod(history, signature));
  const switching = extractMethod(api, 'private boolean switchApiCollectionIfNeeded(');
  const clear = extractMethod(api, 'private void clearApiLinesIfUnmatched(');
  const read = extractMethod(api, 'private String readConfigFile(');
  const load = extractMethod(api, 'public void loadConfig(');
  const save = extractMethod(files, 'public static void saveCache(');
  const encode = [extractMethod(md5, 'public static String encode(String'), extractMethod(md5, 'private static String encode(byte[]')];
  const classes = `
class HawkConfig {
  static final String API_URL="apiUrl", LIVE_API_URL="liveApiUrl", API_LINE_SOURCE="apiLineSource",
    API_LINE_LIST="apiLineList", API_HISTORY="apiHistory", LIVE_API_HISTORY="liveApiHistory";
}
class Hawk {
  static final Map<String,Object> values = new LinkedHashMap<>();
  @SuppressWarnings("unchecked") static <T> T get(String key,T fallback) { return values.containsKey(key)?(T)values.get(key):fallback; }
  static void put(String key,Object value) { values.put(key,value); }
  static void restore(JsonObject state) {
    values.clear();
    for(String key:Arrays.asList("apiUrl","liveApiUrl","apiLineSource")) values.put(key,state.has(key)?state.get(key).getAsString():"");
    for(String key:Arrays.asList("apiLineList","apiHistory","liveApiHistory")) {
      ArrayList<String> items=new ArrayList<>();
      if(state.has(key)) for(JsonElement item:state.getAsJsonArray(key)) items.add(item.isJsonNull()?null:item.getAsString());
      values.put(key,items);
    }
  }
  static JsonObject snapshot() { return new Gson().toJsonTree(values).getAsJsonObject(); }
}
class MD5 {
  private static final char[] hexDigits="0123456789abcdef".toCharArray();
  private static final java.security.MessageDigest sDigest;
  static { try { sDigest=java.security.MessageDigest.getInstance("MD5"); } catch(Exception e) {throw new ExceptionInInitializerError(e);} }
  ${encode.join('\n')}
}
class Activity {}
class App {
  static File directory;
  static App getInstance(){return new App();}
  File getFilesDir(){return directory;}
}
class Trace {
  static JsonArray events = new JsonArray();
  static void add(String kind,String field,String value) {JsonObject item=new JsonObject();item.addProperty("kind",kind);item.addProperty(field,value);events.add(item);}
}
class OriginalFileUtils { ${save} }
class FileUtils {
  static void saveCache(File file,String text) {Trace.add("cacheWrite","key",file.getName());OriginalFileUtils.saveCache(file,text);}
}
`;
  const methods = `
  ${switching}
  ${clear}
  ${read}
  ${load}
  interface LoadConfigCallback {void success();void error(String msg);void notice(String msg);}
  interface ConfigFetchCallback {void success(String body);void error(String error);}
  private JsonArray plannedFetches;
  private int fetchIndex;
  private void parseJson(String url,String text) {
    Trace.add("parse","url",url);
    sites(text); // Selected-source parser substitute: explicitly not full ApiConfig.
  }
  private void fetchConfigAsync(String apiUrl,String requestUrl,String key,ConfigFetchCallback callback) {
    Trace.add("fetch","url",requestUrl);
    String text=null,error=null;
    try {
      if(fetchIndex>=plannedFetches.size()) throw new IllegalStateException("fixture exhausted");
      JsonObject plan=plannedFetches.get(fetchIndex++).getAsJsonObject();
      if(plan.has("url")&&!plan.get("url").getAsString().equals(requestUrl)) throw new IllegalStateException("unexpected fixture URL");
      if(plan.has("error")) error=plan.get("error").getAsString();
      else {
        text=FindResult(plan.get("body").getAsString(),key);
        if(apiUrl.startsWith("clan")) text=clanContentFix(clanToAddress(apiUrl),text);
        text=fixContentPath(apiUrl,text);
      }
    } catch(Throwable failure) {error=failure.getMessage();if(TextUtils.isEmpty(error))error=failure.toString();}
    if(error==null)callback.success(text);else callback.error(error);
  }
  private JsonElement loadSequence(JsonObject request) throws Exception {
    Hawk.restore(request.has("preferences")?request.getAsJsonObject("preferences"):new JsonObject());
    sourceBeanList.clear();
    Trace.events=new JsonArray();
    App.directory=java.nio.file.Files.createTempDirectory(java.nio.file.Paths.get(${JSON.stringify(build)}),"load-").toFile();
    plannedFetches=request.has("fetches")?request.getAsJsonArray("fetches"):new JsonArray();fetchIndex=0;
    try {
      if(request.has("cache")) for(Map.Entry<String,JsonElement> entry:request.getAsJsonObject("cache").entrySet()) {
        byte[] bytes=entry.getValue().isJsonObject()?java.util.Base64.getDecoder().decode(entry.getValue().getAsJsonObject().get("base64").getAsString()):entry.getValue().getAsString().getBytes(StandardCharsets.UTF_8);
        java.nio.file.Files.write(new File(App.directory,MD5.encode(entry.getKey())).toPath(),bytes);
      }
      JsonArray results=new JsonArray();
      for(JsonElement element:request.getAsJsonArray("loads")) {
        JsonObject spec=element.getAsJsonObject();
        if(spec.has("url"))Hawk.put(HawkConfig.API_URL,spec.get("url").getAsString());
        final JsonObject result=new JsonObject();
        try {
          loadConfig(spec.has("useCache")&&spec.get("useCache").getAsBoolean(),new LoadConfigCallback(){
            public void success(){result.addProperty("ok",true);result.addProperty("apiUrl",Hawk.get(HawkConfig.API_URL,""));result.add("sites",snapshot());}
            public void error(String msg){result.addProperty("ok",false);result.addProperty("message",msg);}
            public void notice(String msg){}
          },new Activity());
        } catch(Throwable error){result.addProperty("ok",false);result.addProperty("thrown",error.getClass().getName());}
        results.add(result);
      }
      JsonObject caches=new JsonObject();
      File[] cachedFiles=App.directory.listFiles();Arrays.sort(cachedFiles,Comparator.comparing(File::getName));
      for(File file:cachedFiles)caches.addProperty(file.getName(),java.util.Base64.getEncoder().encodeToString(java.nio.file.Files.readAllBytes(file.toPath())));
      JsonObject value=new JsonObject();value.add("results",results);value.add("state",Hawk.snapshot());value.add("sites",snapshot());value.add("cache",caches);value.add("events",Trace.events);
      return value;
    } finally {
      try(java.util.stream.Stream<java.nio.file.Path> paths=java.nio.file.Files.walk(App.directory.toPath())) {
        for(java.nio.file.Path path:paths.sorted(Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList()))java.nio.file.Files.deleteIfExists(path);
      }
    }
  }
`;
  const dispatch = `
    if(operation.equals("state")){if(request.has("state"))Hawk.restore(request.getAsJsonObject("state"));return Hawk.snapshot();}
    if(operation.equals("collectionSwitch")){JsonObject result=new JsonObject();result.addProperty("switched",switchApiCollectionIfNeeded(request.get("url").getAsString(),text));result.add("state",Hawk.snapshot());return result;}
    if(operation.equals("clearLines")){clearApiLinesIfUnmatched(request.get("url").getAsString());return Hawk.snapshot();}
    if(operation.equals("history")){String entry=request.get("entry").isJsonNull()?null:request.get("entry").getAsString();if(request.get("kind").getAsString().equals("live"))HistoryHelper.setLiveApiHistory(entry);else HistoryHelper.setApiHistory(entry);return Hawk.snapshot();}
    if(operation.equals("cacheKey"))return new JsonPrimitive(MD5.encode(request.get("url").getAsString()));
    if(operation.equals("cacheRead")){
      java.nio.file.Path file=java.nio.file.Files.createTempFile(java.nio.file.Paths.get(${JSON.stringify(build)}),"read-",".tmp");
      try{java.nio.file.Files.write(file,java.util.Base64.getDecoder().decode(request.get("bytes").getAsString()));return new JsonPrimitive(readConfigFile(file.toFile()));}finally{java.nio.file.Files.deleteIfExists(file);}
    }
    if(operation.equals("siteState"))return snapshot();
    if(operation.equals("loadSequence"))return loadSequence(request);
`;
  return { classes, methods, dispatch, historyMethods, originals: [switching, clear, read, load, save, ...encode, ...historyMethods] };
}
