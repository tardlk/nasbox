// SPDX-License-Identifier: GPL-3.0-only
// Port of selected original ApiConfig prefix; see NOTICE.md for scope and adaptations.
package tvbox.config;
import com.google.gson.*;
import com.github.tvbox.osc.bean.SourceBean;
import com.github.tvbox.osc.bean.ParseBean;
import java.util.*;
final class VodConfig {
  private final PreferenceStore preferences;
  VodConfig(PreferenceStore preferences) {this.preferences=preferences;}
  private static boolean isEmpty(String text) {return text==null||text.length()==0;}
  private static class LOG {static void i(String ignored){}}

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

  private void parseJson(String apiUrl, String jsonStr) {
        resetConfigData();
        JsonObject infoJson = gson.fromJson(jsonStr, JsonObject.class);
        // spider
        spider = DefaultConfig.safeJsonString(infoJson, "spider", "");
        jarCache = DefaultConfig.safeJsonString(infoJson, "jarCache", "true");
        danmaku = DefaultConfig.safeJsonString(infoJson, "danmaku", "");
        // wallpaper
        wallpaper = DefaultConfig.safeJsonString(infoJson, "wallpaper", "");
        // 远端站点源
        SourceBean firstSite = null;
        for (JsonElement opt : infoJson.get("sites").getAsJsonArray()) {
            JsonObject obj = (JsonObject) opt;
            if (!obj.has("key") || !obj.has("type") || !obj.has("api")) {
                LOG.i("echo-skip incomplete site config: " + obj);
                continue;
            }
            SourceBean sb = new SourceBean();
            String siteKey = obj.get("key").getAsString().trim();
            sb.setKey(siteKey);
            sb.setName(obj.has("name")?obj.get("name").getAsString().trim():siteKey);
            sb.setType(obj.get("type").getAsInt());
            sb.setApi(obj.get("api").getAsString().trim());
            sb.setSearchable(DefaultConfig.safeJsonInt(obj, "searchable", 1));
            sb.setQuickSearch(DefaultConfig.safeJsonInt(obj, "quickSearch", 1));
            sb.setChangeable(DefaultConfig.safeJsonInt(obj, "changeable", 1));
            if(siteKey.startsWith("py_")){
                sb.setFilterable(1);
            }else {
                sb.setFilterable(DefaultConfig.safeJsonInt(obj, "filterable", 1));
            }
            sb.setPlayerUrl(DefaultConfig.safeJsonString(obj, "playUrl", ""));
            sb.setExt(DefaultConfig.safeJsonString(obj, "ext", ""));
            sb.setJar(DefaultConfig.safeJsonString(obj, "jar", ""));
            sb.setPlayerType(DefaultConfig.safeJsonInt(obj, "playerType", -1));
            sb.setCategories(DefaultConfig.safeJsonStringList(obj, "categories"));
            sb.setTimeout(DefaultConfig.safeJsonInt(obj, "timeout", 0));
            sb.setClickSelector(DefaultConfig.safeJsonString(obj, "click", ""));
            sb.setStyle(DefaultConfig.safeJsonString(obj, "style", ""));
            if (firstSite == null) firstSite = sb;
            sourceBeanList.put(siteKey, sb);
        }
        if (sourceBeanList != null && sourceBeanList.size() > 0) {
            String home = preferences.get(PreferenceKeys.HOME_API, "");
            SourceBean sh = getSource(home);
            if (sh == null) {
                assert firstSite != null;
                setSourceBean(firstSite);
            }
            else
                setSourceBean(sh);
        }
        // 需要使用vip解析的flag
        vipParseFlags = DefaultConfig.safeJsonStringList(infoJson, "flags");
        // 解析地址
        parseBeanList.clear();
        if(infoJson.has("parses")){
            JsonArray parses = infoJson.get("parses").getAsJsonArray();
            for (JsonElement opt : parses) {
                JsonObject obj = (JsonObject) opt;
                ParseBean pb = new ParseBean();
                pb.setName(obj.get("name").getAsString().trim());
                pb.setUrl(obj.get("url").getAsString().trim());
                String ext = obj.has("ext") ? obj.get("ext").getAsJsonObject().toString() : "";
                pb.setExt(ext);
                pb.setType(DefaultConfig.safeJsonInt(obj, "type", 0));
                parseBeanList.add(pb);
            }
            if(!parseBeanList.isEmpty())addSuperParse();
        }
        // 获取默认解析
        if (parseBeanList != null && parseBeanList.size() > 0) {
            String defaultParse = preferences.get(PreferenceKeys.DEFAULT_PARSE, "");
            if (!isEmpty(defaultParse))
                for (ParseBean pb : parseBeanList) {
                    if (pb.getName().equals(defaultParse))
                        setDefaultParse(pb);
                }
            if (mDefaultParse == null)
                setDefaultParse(parseBeanList.get(0));
        }


    }
  public SourceBean getSource(String key) {
        if (!sourceBeanList.containsKey(key)) {
            if ("push_agent".equals(key)) {
                SourceBean sourceBean = new SourceBean();
                sourceBean.setKey("push_agent");
                sourceBean.setName("推送");
                sourceBean.setType(-1);
                return sourceBean;
            }
            return null;
        }
        return sourceBeanList.get(key);
    }
public void setSourceBean(SourceBean sourceBean) {
        this.mHomeSource = sourceBean;
        preferences.put(PreferenceKeys.HOME_API, sourceBean.getKey());
    }
public void setDefaultParse(ParseBean parseBean) {
        if (this.mDefaultParse != null)
            this.mDefaultParse.setDefault(false);
        this.mDefaultParse = parseBean;
        preferences.put(PreferenceKeys.DEFAULT_PARSE, parseBean.getName());
        parseBean.setDefault(true);
    }
private void addSuperParse()
    {
        ParseBean superPb = new ParseBean();
        superPb.setName("超级解析");
        superPb.setUrl("SuperParse");
        superPb.setExt("");
        superPb.setType(4);
        parseBeanList.add(0, superPb);
    }
public List<SourceBean> getSearchSourceBeanList() {
        if(searchSourceBeanList.isEmpty()){
            LOG.i("echo-第一次getSearchSourceBeanList");
            searchSourceBeanList = new ArrayList<>();
            for (SourceBean bean : sourceBeanList.values()) {
                if (bean.isSearchable()) {
                    searchSourceBeanList.add(bean);
                }
            }
        }
        return searchSourceBeanList;
    }

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
    JsonObject selection=new JsonObject();selection.addProperty("homeApi",preferences.get(PreferenceKeys.HOME_API,""));selection.addProperty("defaultParse",preferences.get(PreferenceKeys.DEFAULT_PARSE,""));
    result.add("selection",selection);return result;
  }
  void apply(String url,String text) {parseJson(url,text);}
  JsonObject run(String url,String text) {
    JsonObject result=new JsonObject();
    try{apply(url,text);result.addProperty("accepted",true);}catch(Throwable error){result.addProperty("accepted",false);result.addProperty("errorType",error.getClass().getName());}
    result.add("config",snapshot());return result;
  }

}
