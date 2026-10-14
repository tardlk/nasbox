import { extractMethod } from './oracle.mjs';

export function vodReference(api) {
  const original = extractMethod(api, 'private void parseJson(String apiUrl, String jsonStr)');
  const boundary = original.indexOf('// 直播源');
  if (boundary < 0) throw new Error('VOD/live boundary changed');
  const prefix = original.slice(0, boundary) + '\n    }';
  const helpers = ['public SourceBean getSource(', 'public void setSourceBean(', 'public void setDefaultParse(',
    'private void addSuperParse(', 'public List<SourceBean> getSearchSourceBeanList('].map(signature => extractMethod(api, signature));
  const fields = `
  private final Gson gson = new Gson();
  private final LinkedHashMap<String, SourceBean> sourceBeanList = new LinkedHashMap<>();
  private final List<ParseBean> parseBeanList = new ArrayList<>();
  private List<SourceBean> searchSourceBeanList = new ArrayList<>();
  private List<String> vipParseFlags;
  private SourceBean mHomeSource;
  private ParseBean mDefaultParse;
  private String spider = null, jarCache = "true", danmaku = "", wallpaper = "";
  // Adapter for only the reset state consumed by this source prefix.
  private void resetConfigData() { sourceBeanList.clear(); parseBeanList.clear(); searchSourceBeanList = new ArrayList<>(); }
`;
  const observations = `
  private JsonElement sourceValue(SourceBean bean) {
    if(bean==null)return JsonNull.INSTANCE;
    JsonObject value=gson.toJsonTree(bean).getAsJsonObject();
    value.add("playUrl",value.remove("playerUrl"));value.add("click",value.remove("clickSelector"));
    value.addProperty("playTimeoutSeconds",bean.getPlayTimeoutSeconds());return value;
  }
  private JsonElement parseValue(ParseBean bean) {
    if(bean==null)return JsonNull.INSTANCE;
    JsonObject value=gson.toJsonTree(bean).getAsJsonObject();
    value.addProperty("effectiveUrl",bean.getUrl());value.addProperty("mixedUrl",bean.mixUrl());return value;
  }
  JsonArray sources() { JsonArray result=new JsonArray();for(SourceBean bean:sourceBeanList.values())result.add(sourceValue(bean));return result; }
  JsonArray searchSources() {JsonArray result=new JsonArray();for(SourceBean bean:getSearchSourceBeanList())result.add(sourceValue(bean));return result;}
  JsonElement source(String key) {return sourceValue(getSource(key));}
  JsonObject snapshot() {
    JsonObject result=new JsonObject();result.addProperty("scope","vod-prefix");
    JsonObject globals=new JsonObject();globals.add("spider",spider==null?JsonNull.INSTANCE:new JsonPrimitive(spider));
    globals.addProperty("jarCache",jarCache);globals.addProperty("danmaku",danmaku);globals.addProperty("wallpaper",wallpaper);
    result.add("globals",globals);result.add("sites",sources());result.add("home",sourceValue(mHomeSource));
    result.add("flags",gson.toJsonTree(vipParseFlags));JsonArray parses=new JsonArray();for(ParseBean bean:parseBeanList)parses.add(parseValue(bean));
    result.add("parses",parses);result.add("defaultParse",parseValue(mDefaultParse));
    JsonObject selection=new JsonObject();selection.addProperty("homeApi",Hawk.get(HawkConfig.HOME_API,""));selection.addProperty("defaultParse",Hawk.get(HawkConfig.DEFAULT_PARSE,""));
    result.add("selection",selection);return result;
  }
  void apply(String url,String text) {parseJson(url,text);}
  JsonObject run(String url,String text) {
    JsonObject result=new JsonObject();
    try{apply(url,text);result.addProperty("accepted",true);}catch(Throwable error){result.addProperty("accepted",false);result.addProperty("errorType",error.getClass().getName());}
    result.add("config",snapshot());return result;
  }
`;
  const source = `class VodOracle { ${fields}\n${prefix}\n${helpers.join('\n')}\n${observations}\n}`;
  return { source, prefix, helpers, fields, observations };
}
