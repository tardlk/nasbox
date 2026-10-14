// SPDX-License-Identifier: GPL-3.0-only
// Pinned TVBoxOS methods with host bindings. See NOTICE.md for scope.
package tvbox.config;
import com.google.gson.*;
import com.google.gson.reflect.TypeToken;
import com.google.gson.annotations.SerializedName;
import com.github.tvbox.osc.bean.SourceBean;
import com.github.tvbox.osc.bean.ParseBean;
import android.net.Uri;
import android.util.Base64;
import java.util.*;
import java.util.regex.*;
import java.io.*;
import java.lang.reflect.Type;
import java.net.*;
import java.util.concurrent.CopyOnWriteArrayList;
final class FullConfig {

  private final Gson gson = new Gson();
  private final LinkedHashMap<String, SourceBean> sourceBeanList = new LinkedHashMap<>();
  private final List<ParseBean> parseBeanList = new ArrayList<>();
  private List<SourceBean> searchSourceBeanList = new ArrayList<>();
  private List<String> vipParseFlags;
  private SourceBean mHomeSource;
  private ParseBean mDefaultParse;
  private String spider = null, jarCache = "true", danmaku = "", wallpaper = "";

  // Host bindings: persistence adapter, observable empty executor lifecycle, and
  // explicit failures for unimplemented script initialization. No source is run.
  private final PreferenceStore preferences;
  private final HawkAdapter Hawk;
  private final OkGoHelper OkGoHelper = new OkGoHelper();
  private final List<LiveChannelGroup> liveChannelGroupList = new ArrayList<>();
  private final List<LiveSettingGroup> liveSettingGroupList = new ArrayList<>();
  private Map<String,String> myHosts;
  private final Set<String> warmedSearchSpiderKeys = new HashSet<>();
  private String currentPlaySourceKey="",currentPyKey="",currentLivePyKey="",liveSpider="";
  private String currentLiveSpider=null;
  private final JsonArray effects = new JsonArray();
  private String clearFailure = "";
  private final Loader jarLoader=new Loader("jar"),pyLoader=new Loader("py"),jsLoader=new Loader("js");
  FullConfig(PreferenceStore store){preferences=store;Hawk=new HawkAdapter();clearLoader();Hawk.put(HawkConfig.LIVE_GROUP_LIST,new JsonArray());loadDefaultConfig();}
  class HawkAdapter {
    <T>T get(String key,T fallback){return preferences.get(key,fallback);}
    void put(String key,Object value){preferences.put(key,value);}
  }
  static class HawkConfig {
    static final String HOME_API="homeApi",DEFAULT_PARSE="defaultParse",LIVE_API_URL="liveApiUrl",API_URL="apiUrl",
      LIVE_GROUP_INDEX="liveGroupIndex",LIVE_GROUP_LIST="liveGroupList",LIVE_API_HISTORY="liveApiHistory",
      EPG_URL="epgUrl",LIVE_PLAY_TYPE="livePlayType",PLAY_TYPE="playType",LIVE_CONNECT_TIMEOUT="liveConnectTimeout",
      LIVE_WEB_HEADER="liveWebHeader",DOH_JSON="dohJson",DOH_URL="dohUrl";
  }
  static class TextUtils{static boolean isEmpty(CharSequence s){return s==null||s.length()==0;}}
  static class Log{static void e(String a,String b){}}
  static class LOG{static void i(String ignored){}static void e(String a,String b){}}
  private void effect(String name,JsonArray args,boolean completed){
    JsonObject e=new JsonObject();e.addProperty("operation",name);e.add("arguments",args);e.addProperty("completed",completed);effects.add(e);
  }
  class Loader {
    final String kind; Loader(String kind){this.kind=kind;}
    void clear(){boolean ok=!clearFailure.equals(kind);effect(kind+".clear",new JsonArray(),ok);if(!ok)throw new IllegalStateException("Executor clear failed: "+kind);}
    void getSpider(String... args){JsonArray a=new JsonArray();for(String s:args)a.add(s);effect(kind+".getSpider",a,false);throw new UnsupportedOperationException("Unbound "+kind+" executor");}
    void loadLiveJar(String url){JsonArray a=new JsonArray();a.add(url);effect("jar.loadLiveJar",a,false);throw new UnsupportedOperationException("Unbound jar executor");}
  }
  JsonObject snapshot(){
    JsonObject result=vodSnapshot();result.addProperty("scope","config-state");
    result.add("hosts",gson.toJsonTree(myHosts));result.add("dnsHosts",gson.toJsonTree(OkGoHelper.myHosts));
    result.add("liveChannels",gson.toJsonTree(liveChannelGroupList));result.add("liveSettings",gson.toJsonTree(liveSettingGroupList));
    result.add("dnsNames",gson.toJsonTree(OkGoHelper.dnsHttpsList));
    JsonObject rules=new JsonObject();rules.add("rules",gson.toJsonTree(VideoParseRuler.HOSTS_RULE));rules.add("filters",gson.toJsonTree(VideoParseRuler.HOSTS_FILTER));
    rules.add("regex",gson.toJsonTree(VideoParseRuler.HOSTS_REGEX));rules.add("scripts",gson.toJsonTree(VideoParseRuler.HOSTS_SCRIPT));result.add("rules",rules);
    result.add("ads",gson.toJsonTree(AdBlocker.AD_HOSTS));result.add("effects",effects.deepCopy());
    result.add("preferences",preferences.snapshot());
    JsonObject keys=new JsonObject();keys.addProperty("play",currentPlaySourceKey);keys.addProperty("py",currentPyKey);
    keys.addProperty("livePy",currentLivePyKey);keys.addProperty("liveSpider",currentLiveSpider);keys.addProperty("liveGlobalSpider",liveSpider);
    keys.add("warmedSearch",gson.toJsonTree(warmedSearchSpiderKeys));result.add("runtimeKeys",keys);
    JsonArray proxies=new JsonArray();for(ProxyRule p:OkGoHelper.selector.getProxy()){
      if(p==null){proxies.add(JsonNull.INSTANCE);continue;}
      JsonObject item=new JsonObject();item.addProperty("name",p.getName());item.add("hosts",gson.toJsonTree(p.getHosts()));item.add("urls",gson.toJsonTree(p.getUrls()));
      item.add("proxies",proxyValues(p.getProxies()));proxies.add(item);
    }result.add("proxies",proxies);return result;
  }
  static JsonArray proxyValues(List<java.net.Proxy> proxies){JsonArray values=new JsonArray();for(java.net.Proxy p:proxies){
    JsonObject value=new JsonObject();value.addProperty("type",p.type().name());if(p.address() instanceof InetSocketAddress){InetSocketAddress a=(InetSocketAddress)p.address();value.addProperty("host",a.getHostString());value.addProperty("port",a.getPort());}values.add(value);
  }return values;}
  void resetRuntimeKeys(){currentPyKey="";currentLivePyKey="";currentLiveSpider="";}
  JsonObject run(JsonObject request){
    while(effects.size()>0)effects.remove(effects.size()-1);clearFailure=request.has("clearFailure")?request.get("clearFailure").getAsString():"";
    JsonObject result=new JsonObject();try{
      String op=request.has("action")?request.get("action").getAsString():"parse";
      String url=request.has("url")?request.get("url").getAsString():"";
      String text=request.has("text")&&!request.get("text").isJsonNull()?request.get("text").getAsString():null;
      if(op.equals("parse"))parseJson(url,text);
      else if(op.equals("liveContent"))parseLiveConfigContent(url,text);
      else if(op.equals("lives"))loadLives(JsonParser.parseString(text).getAsJsonArray());
      else if(op.equals("liveApi"))loadLiveApi(JsonParser.parseString(text).getAsJsonObject());
      else if(op.equals("seedRuntime")){currentPlaySourceKey="old-play";currentPyKey="old-py";currentLivePyKey="old-live-py";currentLiveSpider="old-live";warmedSearchSpiderKeys.add("old-search");}
      else throw new IllegalArgumentException("Unknown config action");
      result.addProperty("accepted",true);
    }catch(Throwable e){result.addProperty("accepted",false);result.addProperty("errorType",e.getClass().getName());}
    finally{clearFailure="";}
    result.add("config",snapshot());return result;
  }
  JsonElement inspect(JsonObject request){
    String action=request.get("action").getAsString();
    if(action.equals("doh"))return new JsonPrimitive(OkGoHelper.getDohUrl(request.get("index").getAsInt()));
    if(action.equals("proxy"))return proxyValues(OkGoHelper.selector.select(URI.create(request.get("url").getAsString())));
    if(action.equals("ad"))return new JsonPrimitive(AdBlocker.isAd(request.get("url").getAsString()));
    if(action.equals("script"))return new JsonPrimitive(VideoParseRuler.getHostScript(request.get("url").getAsString()));
    if(action.equals("video"))return new JsonPrimitive(VideoParseRuler.checkIsVideoForParse(request.get("webUrl").getAsString(),request.get("url").getAsString()));
    if(action.equals("filter"))return new JsonPrimitive(VideoParseRuler.isFilter(request.get("webUrl").getAsString(),request.get("url").getAsString()));
    if(action.equals("userInfo")){for(ProxyRule p:OkGoHelper.selector.getProxy()){String v=p.getUserInfo(request.get("host").getAsString());if(v!=null)return new JsonPrimitive(v);}return JsonNull.INSTANCE;}
    throw new IllegalArgumentException("Unknown config query");
  }

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
            String home = Hawk.get(HawkConfig.HOME_API, "");
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
            String defaultParse = Hawk.get(HawkConfig.DEFAULT_PARSE, "");
            if (!TextUtils.isEmpty(defaultParse))
                for (ParseBean pb : parseBeanList) {
                    if (pb.getName().equals(defaultParse))
                        setDefaultParse(pb);
                }
            if (mDefaultParse == null)
                setDefaultParse(parseBeanList.get(0));
        }

        // 直播源
        String live_api_url=Hawk.get(HawkConfig.LIVE_API_URL,"");
        if(live_api_url.isEmpty() || apiUrl.equals(live_api_url)){
            LOG.i("echo-load-config_live");
            initLiveSettings();
            if(infoJson.has("lives")){
                JsonArray lives_groups=infoJson.get("lives").getAsJsonArray();
                int live_group_index=getLiveGroupIndex();
                if(live_group_index>lives_groups.size()-1)live_group_index=0;
                Hawk.put(HawkConfig.LIVE_GROUP_LIST,lives_groups);
                //加载多源配置
                try {
                    ArrayList<LiveSettingItem> liveSettingItemList = new ArrayList<>();
                    for (int i=0; i< lives_groups.size();i++) {
                        JsonObject jsonObject = lives_groups.get(i).getAsJsonObject();
                        String name = jsonObject.has("name")?jsonObject.get("name").getAsString():"线路"+(i+1);
                        LiveSettingItem liveSettingItem = new LiveSettingItem();
                        liveSettingItem.setItemIndex(i);
                        liveSettingItem.setItemName(name);
                        liveSettingItemList.add(liveSettingItem);
                    }
                    liveSettingGroupList.get(5).setLiveSettingItems(liveSettingItemList);
                } catch (Exception e) {
                    // 捕获任何可能发生的异常
                    e.printStackTrace();
                }

                JsonObject livesOBJ = lives_groups.get(live_group_index).getAsJsonObject();
                loadLiveApi(livesOBJ);
            }
        }

        myHosts = new HashMap<>();
        if (infoJson.has("hosts")) {
            JsonArray hostsArray = infoJson.getAsJsonArray("hosts");
            for (int i = 0; i < hostsArray.size(); i++) {
                String entry = hostsArray.get(i).getAsString();
                String[] parts = entry.split("=", 2); // 只分割一次，防止 value 里有 =
                if (parts.length == 2) {
                    myHosts.put(parts[0], parts[1]);
                }
            }
        }

        loadProxyRules(infoJson);

        //video parse rule for host
        if (infoJson.has("rules")) {
            VideoParseRuler.clearRule();
            for(JsonElement oneHostRule : infoJson.getAsJsonArray("rules")) {
                JsonObject obj = (JsonObject) oneHostRule;
                //嗅探过滤规则
                if (obj.has("host")) {
                    String host = obj.get("host").getAsString();
                    if (obj.has("rule")) {
                        JsonArray ruleJsonArr = obj.getAsJsonArray("rule");
                        ArrayList<String> rule = new ArrayList<>();
                        for (JsonElement one : ruleJsonArr) {
                            String oneRule = one.getAsString();
                            rule.add(oneRule);
                        }
                        if (rule.size() > 0) {
                            VideoParseRuler.addHostRule(host, rule);
                        }
                    }
                    if (obj.has("filter")) {
                        JsonArray filterJsonArr = obj.getAsJsonArray("filter");
                        ArrayList<String> filter = new ArrayList<>();
                        for (JsonElement one : filterJsonArr) {
                            String oneFilter = one.getAsString();
                            filter.add(oneFilter);
                        }
                        if (filter.size() > 0) {
                            VideoParseRuler.addHostFilter(host, filter);
                        }
                    }
                }
                //广告过滤规则
                if (obj.has("hosts") && obj.has("regex")) {
                    ArrayList<String> rule = new ArrayList<>();
                    ArrayList<String> ads = new ArrayList<>();
                    JsonArray regexArray = obj.getAsJsonArray("regex");
                    for (JsonElement one : regexArray) {
                        String regex = one.getAsString();
                        if (M3u8.isAd(regex)) ads.add(regex);
                        else rule.add(regex);
                    }
                    JsonArray array = obj.getAsJsonArray("hosts");
                    for (JsonElement one : array) {
                        String host = one.getAsString();
                        VideoParseRuler.addHostRule(host, rule);
                        VideoParseRuler.addHostRegex(host, ads);
                    }
                }
                //嗅探脚本规则 如 click
                if (obj.has("hosts") && obj.has("script")) {
                    ArrayList<String> scripts = new ArrayList<>();
                    JsonArray scriptArray = obj.getAsJsonArray("script");
                    for (JsonElement one : scriptArray) {
                        String script = one.getAsString();
                        scripts.add(script);
                    }
                    JsonArray array = obj.getAsJsonArray("hosts");
                    for (JsonElement one : array) {
                        String host = one.getAsString();
                        VideoParseRuler.addHostScript(host, scripts);
                    }
                }
            }
        }

        if (infoJson.has("doh")) {
            String doh_json = infoJson.getAsJsonArray("doh").toString();
            if(!Hawk.get(HawkConfig.DOH_JSON, "").equals(doh_json)){
                Hawk.put(HawkConfig.DOH_URL, 0);
                Hawk.put(HawkConfig.DOH_JSON,doh_json);
            }
        }else {
            Hawk.put(HawkConfig.DOH_JSON,"");
        }
        OkGoHelper.setDnsList();
        LOG.i("echo-api-config-----------load");
        //追加的广告拦截
        if(infoJson.has("ads")){
            for (JsonElement host : infoJson.getAsJsonArray("ads")) {
                if(!AdBlocker.hasHost(host.getAsString())){
                    AdBlocker.addAdHost(host.getAsString());
                }
            }
        }
    }
private void resetConfigData() {
        clearSpiderCache();
        currentPlaySourceKey = "";
        sourceBeanList.clear();
        liveChannelGroupList.clear();
        parseBeanList.clear();
        searchSourceBeanList = new ArrayList<>();
        Hawk.put(HawkConfig.LIVE_GROUP_LIST,new JsonArray());
    }
public void clearLoader(){
        jarLoader.clear();
        pyLoader.clear();
        jsLoader.clear();
        synchronized (warmedSearchSpiderKeys) {
            warmedSearchSpiderKeys.clear();
        }
    }
public void clearSpiderCache() {
        currentPyKey = "";
        currentLivePyKey = "";
        currentLiveSpider = "";
        clearLoader();
    }
private void loadProxyRules(JsonObject infoJson) {
        if (!infoJson.has("proxy")) {
            OkGoHelper.setProxyList(null);
            return;
        }
        try {
            OkGoHelper.setProxyList(ProxyRule.arrayFrom(infoJson.get("proxy")));
        } catch (Throwable th) {
            th.printStackTrace();
            OkGoHelper.setProxyList(null);
        }
    }
private void initLiveSettings() {
        ArrayList<String> groupNames = new ArrayList<>(Arrays.asList("线路选择", "画面比例", "播放解码", "超时换源", "偏好设置", "多源切换", "配置切换"));
        ArrayList<ArrayList<String>> itemsArrayList = new ArrayList<>();
        ArrayList<String> sourceItems = new ArrayList<>();
        ArrayList<String> scaleItems = new ArrayList<>(Arrays.asList("默认", "16:9", "4:3", "填充", "原始", "裁剪"));
        ArrayList<String> playerDecoderItems = new ArrayList<>(Arrays.asList("ijk硬解", "ijk软解", "exo"));
        ArrayList<String> timeoutItems = new ArrayList<>(Arrays.asList("5s", "10s", "15s", "20s", "25s", "30s"));
        ArrayList<String> personalSettingItems = new ArrayList<>(Arrays.asList("显示时间", "显示网速", "换台反转", "跨选分类"));
        ArrayList<String> yumItems = new ArrayList<>();
        ArrayList<String> liveApiHistoryItems = new ArrayList<>();

        itemsArrayList.add(sourceItems);
        itemsArrayList.add(scaleItems);
        itemsArrayList.add(playerDecoderItems);
        itemsArrayList.add(timeoutItems);
        itemsArrayList.add(personalSettingItems);
        itemsArrayList.add(yumItems);
        itemsArrayList.add(liveApiHistoryItems);

        liveSettingGroupList.clear();
        for (int i = 0; i < groupNames.size(); i++) {
            LiveSettingGroup liveSettingGroup = new LiveSettingGroup();
            ArrayList<LiveSettingItem> liveSettingItemList = new ArrayList<>();
            liveSettingGroup.setGroupIndex(i);
            liveSettingGroup.setGroupName(groupNames.get(i));
            for (int j = 0; j < itemsArrayList.get(i).size(); j++) {
                LiveSettingItem liveSettingItem = new LiveSettingItem();
                liveSettingItem.setItemIndex(j);
                liveSettingItem.setItemName(itemsArrayList.get(i).get(j));
                liveSettingItemList.add(liveSettingItem);
            }
            liveSettingGroup.setLiveSettingItems(liveSettingItemList);
            liveSettingGroupList.add(liveSettingGroup);
        }
        refreshLiveApiHistoryItems();
    }
public void refreshLiveApiHistoryItems() {
        if (liveSettingGroupList.size() < 7) return;
        ArrayList<LiveSettingItem> liveSettingItemList = new ArrayList<>();
        ArrayList<String> history = Hawk.get(HawkConfig.LIVE_API_HISTORY, new ArrayList<String>());
        for (int i = 0; i < history.size(); i++) {
            LiveSettingItem liveSettingItem = new LiveSettingItem();
            liveSettingItem.setItemIndex(i);
            liveSettingItem.setItemName(history.get(i));
            liveSettingItemList.add(liveSettingItem);
        }
        liveSettingGroupList.get(6).setLiveSettingItems(liveSettingItemList);
    }
public void loadLiveApi(JsonObject livesOBJ) {
        try {
            LOG.i("echo-loadLiveApi");
            liveChannelGroupList.clear();
            currentLiveSpider = "";
            currentLivePyKey = "";
            String lives = livesOBJ.toString();
            int index = lives.indexOf("proxy://");
            String url;
            if (index != -1) {
                int endIndex = lives.lastIndexOf("\"");
                url = lives.substring(index, endIndex);
                url = DefaultConfig.checkReplaceProxy(url);
                String extUrl = Uri.parse(url).getQueryParameter("ext");
                if (extUrl != null && !extUrl.isEmpty()) {
                    String extUrlFix;
                    if(extUrl.startsWith("http") || extUrl.startsWith("clan://")){
                        extUrlFix = extUrl;
                    }else {
                        extUrlFix = new String(Base64.decode(extUrl, Base64.DEFAULT | Base64.URL_SAFE | Base64.NO_WRAP), "UTF-8");
                    }
                    extUrlFix = Base64.encodeToString(extUrlFix.getBytes("UTF-8"), Base64.DEFAULT | Base64.URL_SAFE | Base64.NO_WRAP);
                    url = url.replace(extUrl, extUrlFix);
                }
            } else {
                String api = livesOBJ.has("api") ? livesOBJ.get("api").getAsString().trim() : "";
                String type = livesOBJ.has("type") ? livesOBJ.get("type").getAsString() : (isLiveSpiderApi(api) ? "3" : "0");
                if(type.equals("0") || type.equals("3")){
                    url = livesOBJ.has("url")?livesOBJ.get("url").getAsString():"";
                    if(url.isEmpty())url=api;
                    LOG.i("echo-liveurl"+url);
                    if(!url.startsWith("http://127.0.0.1")){
                        if(url.startsWith("http")){
                            url = Base64.encodeToString(url.getBytes("UTF-8"), Base64.DEFAULT | Base64.URL_SAFE | Base64.NO_WRAP);
                        }
                        url ="http://127.0.0.1:9978/proxy?do=live&type=txt&ext="+url;
                    }
                    if(type.equals("3")){
                        String jarUrl = livesOBJ.has("jar")?livesOBJ.get("jar").getAsString().trim():"";
                        LOG.i("echo-liveApi1"+api);
                        if(api.contains(".py")){
                            LOG.i("echo-pyLoader.getSpider");
                            String ext="";
                            if(livesOBJ.has("ext") && (livesOBJ.get("ext").isJsonObject() || livesOBJ.get("ext").isJsonArray())){
                                ext=livesOBJ.get("ext").toString();
                            }else {
                                ext=DefaultConfig.safeJsonString(livesOBJ, "ext", "");
                            }

                            currentLivePyKey = MD5.string2MD5(api);
                            currentLiveSpider = api;
                            pyLoader.getSpider(currentLivePyKey,api,ext);
                        } else if (api.contains(".js")) {
                            LOG.i("echo-jsLoader.getSpider");
                            String ext="";
                            if(livesOBJ.has("ext") && (livesOBJ.get("ext").isJsonObject() || livesOBJ.get("ext").isJsonArray())){
                                ext=livesOBJ.get("ext").toString();
                            }else {
                                ext=DefaultConfig.safeJsonString(livesOBJ, "ext", "");
                            }
                            currentLiveSpider = api;
                            jsLoader.getSpider(MD5.string2MD5(api), api, ext, jarUrl);
                        }
                        if(!jarUrl.isEmpty() && !isLiveSpiderApi(api)){
                            jarLoader.loadLiveJar(jarUrl);
                            if (TextUtils.isEmpty(currentLiveSpider)) {
                                currentLiveSpider = jarUrl;
                            }
                        }else if(!liveSpider.isEmpty() && !isLiveSpiderApi(api)){
                            jarLoader.loadLiveJar(liveSpider);
                            if (TextUtils.isEmpty(currentLiveSpider)) {
                                currentLiveSpider = liveSpider;
                            }
                        }
                    }
                }else {
                    liveChannelGroupList.clear();
                    return;
                }
            }
            //设置epg
            if(livesOBJ.has("epg")){
                String epg =livesOBJ.get("epg").getAsString();
                Hawk.put(HawkConfig.EPG_URL,epg);
            }else {
                Hawk.put(HawkConfig.EPG_URL,"");
            }
            //直播播放器类型
            if(livesOBJ.has("playerType")){
                String livePlayType =livesOBJ.get("playerType").getAsString();
                Hawk.put(HawkConfig.LIVE_PLAY_TYPE,livePlayType);
            }else {
                Hawk.put(HawkConfig.LIVE_PLAY_TYPE,Hawk.get(HawkConfig.PLAY_TYPE, 2));
            }
            //设置UA
            if(livesOBJ.has("timeout")){
                int timeout = Math.max(5, Math.min(30, livesOBJ.get("timeout").getAsInt()));
                Hawk.put(HawkConfig.LIVE_CONNECT_TIMEOUT, (timeout + 4) / 5 - 1);
            }
            if(livesOBJ.has("header")) {
                JsonObject headerObj = livesOBJ.getAsJsonObject("header");
                HashMap<String, String> liveHeader = new HashMap<>();
                for (Map.Entry<String, JsonElement> entry : headerObj.entrySet()) {
                    liveHeader.put(entry.getKey(), entry.getValue().getAsString());
                }
                Hawk.put(HawkConfig.LIVE_WEB_HEADER, liveHeader);
            } else if(livesOBJ.has("ua")) {
                String ua = livesOBJ.get("ua").getAsString();
                HashMap<String,String> liveHeader = new HashMap<>();
                liveHeader.put("User-Agent", ua);
                Hawk.put(HawkConfig.LIVE_WEB_HEADER, liveHeader);
            }else {
                Hawk.put(HawkConfig.LIVE_WEB_HEADER,null);
            }
            LiveChannelGroup liveChannelGroup = new LiveChannelGroup();
            liveChannelGroup.setGroupName(url);
            liveChannelGroupList.clear();
            liveChannelGroupList.add(liveChannelGroup);
        } catch (Throwable th) {
            th.printStackTrace();
        }
    }
public void loadLives(JsonArray livesArray) {
        liveChannelGroupList.clear();
        int groupIndex = 0;
        int channelIndex = 0;
        int channelNum = 0;
        for (JsonElement groupElement : livesArray) {
            LiveChannelGroup liveChannelGroup = new LiveChannelGroup();
            liveChannelGroup.setLiveChannels(new ArrayList<LiveChannelItem>());
            liveChannelGroup.setGroupIndex(groupIndex++);
            String groupName = ((JsonObject) groupElement).get("group").getAsString().trim();
            String[] splitGroupName = groupName.split("_", 2);
            liveChannelGroup.setGroupName(splitGroupName[0]);
            if (splitGroupName.length > 1)
                liveChannelGroup.setGroupPassword(splitGroupName[1]);
            else
                liveChannelGroup.setGroupPassword("");
            channelIndex = 0;
            for (JsonElement channelElement : ((JsonObject) groupElement).get("channels").getAsJsonArray()) {
                JsonObject obj = (JsonObject) channelElement;
                LiveChannelItem liveChannelItem = new LiveChannelItem();
                liveChannelItem.setChannelName(obj.get("name").getAsString().trim());
                liveChannelItem.setChannelLogo(DefaultConfig.safeJsonString(obj, "logo", ""));
                liveChannelItem.setChannelEpg(DefaultConfig.safeJsonString(obj, "epg", ""));
                liveChannelItem.setChannelUa(DefaultConfig.safeJsonString(obj, "ua", ""));
                liveChannelItem.setChannelClick(DefaultConfig.safeJsonString(obj, "click", ""));
                liveChannelItem.setChannelFormat(DefaultConfig.safeJsonString(obj, "format", ""));
                liveChannelItem.setChannelOrigin(DefaultConfig.safeJsonString(obj, "origin", ""));
                liveChannelItem.setChannelReferer(DefaultConfig.safeJsonString(obj, "referer", ""));
                liveChannelItem.setChannelTvgId(DefaultConfig.safeJsonString(obj, "tvg-id", ""));
                liveChannelItem.setChannelTvgName(DefaultConfig.safeJsonString(obj, "tvg-name", ""));
                if (obj.has("parse")) {
                    try {
                        liveChannelItem.setChannelParse(obj.get("parse").getAsInt());
                    } catch (Throwable ignored) {
                    }
                }
                if (obj.has("catchup")) {
                    JsonObject catchupObj = new JsonObject();
                    if (obj.get("catchup").isJsonObject()) {
                        catchupObj = obj.getAsJsonObject("catchup");
                    } else {
                        catchupObj.addProperty("type", obj.get("catchup").getAsString());
                        if (obj.has("catchup-source")) catchupObj.addProperty("source", obj.get("catchup-source").getAsString());
                        if (obj.has("catchup-replace")) catchupObj.addProperty("replace", obj.get("catchup-replace").getAsString());
                    }
                    liveChannelItem.setChannelCatchup(catchupObj);
                }
                if (obj.has("header") && obj.get("header").isJsonObject()) {
                    JsonObject headerObj = obj.getAsJsonObject("header");
                    HashMap<String, String> channelHeader = new HashMap<>();
                    for (Map.Entry<String, JsonElement> entry : headerObj.entrySet()) {
                        channelHeader.put(entry.getKey(), entry.getValue().getAsString());
                    }
                    liveChannelItem.setChannelHeader(channelHeader);
                }
                ArrayList<String> urls = DefaultConfig.safeJsonStringList(obj, "urls");
                ArrayList<String> sourceNames = new ArrayList<>();
                ArrayList<String> sourceUrls = new ArrayList<>();
                int sourceIndex = 1;
                for (String url : urls) {
                    String[] splitText = url.split("\\$", 2);
                    sourceUrls.add(splitText[0]);
                    if (splitText.length > 1)
                        sourceNames.add(splitText[1]);
                    else
                        sourceNames.add("源" + Integer.toString(sourceIndex));
                    sourceIndex++;
                }
                liveChannelItem.setChannelSourceNames(sourceNames);
                liveChannelItem.setChannelUrls(sourceUrls);
                if (mergeLiveChannel(liveChannelGroup.getLiveChannels(), liveChannelItem)) {
                    liveChannelItem.setChannelIndex(channelIndex++);
                    liveChannelItem.setChannelNum(++channelNum);
                }
            }
            liveChannelGroupList.add(liveChannelGroup);
        }
    }
private boolean mergeLiveChannel(ArrayList<LiveChannelItem> channelItems, LiveChannelItem newItem) {
        LiveChannelItem oldItem = findLiveChannel(channelItems, newItem.getChannelName());
        if (oldItem == null) {
            channelItems.add(newItem);
            return true;
        }
        mergeLiveChannelUrls(oldItem, newItem);
        return false;
    }
private LiveChannelItem findLiveChannel(ArrayList<LiveChannelItem> channelItems, String channelName) {
        for (LiveChannelItem item : channelItems) {
            if (channelName != null && channelName.equals(item.getChannelName())) return item;
        }
        return null;
    }
private void mergeLiveChannelUrls(LiveChannelItem oldItem, LiveChannelItem newItem) {
        ArrayList<String> oldUrls = oldItem.getChannelUrls();
        ArrayList<String> oldSourceNames = oldItem.getChannelSourceNames();
        if (oldUrls == null) {
            oldUrls = new ArrayList<>();
            oldItem.setChannelUrls(oldUrls);
        }
        if (oldSourceNames == null) {
            oldSourceNames = new ArrayList<>();
            oldItem.setChannelSourceNames(oldSourceNames);
        }
        while (oldSourceNames.size() < oldUrls.size()) {
            oldSourceNames.add("源" + Integer.toString(oldSourceNames.size() + 1));
        }
        ArrayList<String> newUrls = newItem.getChannelUrls();
        ArrayList<String> newSourceNames = newItem.getChannelSourceNames();
        if (newUrls == null) return;
        for (int i = 0; i < newUrls.size(); i++) {
            String url = newUrls.get(i);
            if (oldUrls.contains(url)) continue;
            oldUrls.add(url);
            if (newSourceNames != null && i < newSourceNames.size()) {
                oldSourceNames.add(newSourceNames.get(i));
            } else {
                oldSourceNames.add("源" + Integer.toString(oldSourceNames.size() + 1));
            }
        }
        oldItem.setChannelUrls(oldUrls);
        oldItem.setChannelSourceNames(oldSourceNames);
    }
private boolean isLiveSpiderApi(String api) {
        return api.contains(".py") || api.contains(".js");
    }
private void parseLiveConfigContent(String apiUrl, String content) {
        String jsonContent = trimJsonObject(content);
        if (!TextUtils.isEmpty(jsonContent)) {
            try {
                JsonObject infoJson = gson.fromJson(jsonContent, JsonObject.class);
                if (infoJson != null && infoJson.has("lives")) {
                    parseLiveJson(apiUrl, jsonContent);
                    return;
                }
            } catch (Throwable ignored) {
            }
        }
        if (isLiveJsonContent(content)) {
            parseLiveJson(apiUrl, jsonContent);
        } else {
            parseLiveText(apiUrl, content);
        }
    }
private boolean isLiveJsonContent(String content) {
        if (content == null) return false;
        String text = content.trim();
        if (text.startsWith("\ufeff")) text = text.substring(1).trim();
        return text.startsWith("{");
    }
private void parseLiveText(String apiUrl, String content) {
        liveChannelGroupList.clear();
        liveSpider = "";
        currentLiveSpider = "";
        currentLivePyKey = "";
        initLiveSettings();
        Hawk.put(HawkConfig.LIVE_GROUP_LIST, new JsonArray());
        Hawk.put(HawkConfig.EPG_URL, extractLiveTextEpg(content));
        Hawk.put(HawkConfig.LIVE_PLAY_TYPE, Hawk.get(HawkConfig.PLAY_TYPE, 2));
        Hawk.put(HawkConfig.LIVE_WEB_HEADER, null);
        JsonArray livesArray = TxtSubscribe.parseToJsonArray(content);
        loadLives(livesArray);
        LOG.i("echo-live-text-config-----------load:" + apiUrl);
    }
private String extractLiveTextEpg(String content) {
        if (content == null) return "";
        String text = content.replace("\r\n", "\n").replace('\r', '\n');
        String[] lines = text.split("\n");
        for (String line : lines) {
            line = line.trim();
            if (line.startsWith("\ufeff")) line = line.substring(1).trim();
            if (!line.startsWith("#EXTM3U")) continue;
            String epg = extractQuotedAttr(line, "x-tvg-url");
            if (epg.isEmpty()) epg = extractQuotedAttr(line, "tvg-url");
            if (epg.isEmpty()) epg = extractQuotedAttr(line, "url-tvg");
            return epg;
        }
        return "";
    }
private String extractQuotedAttr(String line, String key) {
        String token = key + "=\"";
        int start = line.indexOf(token);
        if (start < 0) return "";
        start += token.length();
        int end = line.indexOf("\"", start);
        if (end < 0) return "";
        return line.substring(start, end).trim();
    }
private void parseLiveJson(String apiUrl, String jsonStr) {
        liveChannelGroupList.clear();
        JsonObject infoJson = gson.fromJson(jsonStr, JsonObject.class);
        // spider
        liveSpider = DefaultConfig.safeJsonString(infoJson, "spider", "");
        // 直播源
        initLiveSettings();
        if(infoJson.has("lives")){
            JsonArray lives_groups=infoJson.get("lives").getAsJsonArray();

            int live_group_index=getLiveGroupIndex();
            if(live_group_index>lives_groups.size()-1)live_group_index=0;
            Hawk.put(HawkConfig.LIVE_GROUP_LIST,lives_groups);
            //加载多源配置
            try {
                ArrayList<LiveSettingItem> liveSettingItemList = new ArrayList<>();
                for (int i=0; i< lives_groups.size();i++) {
                    JsonObject jsonObject = lives_groups.get(i).getAsJsonObject();
                    String name = jsonObject.has("name")?jsonObject.get("name").getAsString():"线路"+(i+1);
                    LiveSettingItem liveSettingItem = new LiveSettingItem();
                    liveSettingItem.setItemIndex(i);
                    liveSettingItem.setItemName(name);
                    liveSettingItemList.add(liveSettingItem);
                }
                liveSettingGroupList.get(5).setLiveSettingItems(liveSettingItemList);
            } catch (Exception e) {
                // 捕获任何可能发生的异常
                e.printStackTrace();
            }

            JsonObject livesOBJ = lives_groups.get(live_group_index).getAsJsonObject();
            loadLiveApi(livesOBJ);
        }

        myHosts = new HashMap<>();
        if (infoJson.has("hosts")) {
            JsonArray hostsArray = infoJson.getAsJsonArray("hosts");
            for (int i = 0; i < hostsArray.size(); i++) {
                String entry = hostsArray.get(i).getAsString();
                String[] parts = entry.split("=", 2); // 只分割一次，防止 value 里有 =
                if (parts.length == 2) {
                    myHosts.put(parts[0], parts[1]);
                }
            }
        }
        LOG.i("echo-api-live-config-----------load");
    }
private String trimJsonObject(String content) {
        if (content == null) {
            return "";
        }
        String trimContent = content.trim();
        int start = trimContent.indexOf("{");
        int end = trimContent.lastIndexOf("}");
        if (start >= 0 && end > start) {
            return trimContent.substring(start, end + 1);
        }
        return trimContent;
    }
public String getLiveGroupIndexKey() {
        String liveApiUrl = Hawk.get(HawkConfig.LIVE_API_URL, "");
        if (liveApiUrl == null || liveApiUrl.length() == 0) {
            return HawkConfig.LIVE_GROUP_INDEX;
        }
        return HawkConfig.LIVE_GROUP_INDEX + "_" + liveApiUrl;
    }
public int getLiveGroupIndex() {
        return Hawk.get(getLiveGroupIndexKey(), 0);
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
        Hawk.put(HawkConfig.HOME_API, sourceBean.getKey());
    }
public void setDefaultParse(ParseBean parseBean) {
        if (this.mDefaultParse != null)
            this.mDefaultParse.setDefault(false);
        this.mDefaultParse = parseBean;
        Hawk.put(HawkConfig.DEFAULT_PARSE, parseBean.getName());
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
private void loadDefaultConfig() {
        String defaultIJKADS="{\"ijk\":[{\"options\":[{\"name\":\"opensles\",\"category\":4,\"value\":\"0\"},{\"name\":\"framedrop\",\"category\":4,\"value\":\"1\"},{\"name\":\"soundtouch\",\"category\":4,\"value\":\"1\"},{\"name\":\"start-on-prepared\",\"category\":4,\"value\":\"1\"},{\"name\":\"http-detect-rangeupport\",\"category\":1,\"value\":\"0\"},{\"name\":\"fflags\",\"category\":1,\"value\":\"fastseek\"},{\"name\":\"skip_loop_filter\",\"category\":2,\"value\":\"48\"},{\"name\":\"reconnect\",\"category\":4,\"value\":\"1\"},{\"name\":\"enable-accurate-seek\",\"category\":4,\"value\":\"0\"},{\"name\":\"mediacodec\",\"category\":4,\"value\":\"0\"},{\"name\":\"mediacodec-all-videos\",\"category\":4,\"value\":\"0\"},{\"name\":\"mediacodec-auto-rotate\",\"category\":4,\"value\":\"0\"},{\"name\":\"mediacodec-handle-resolution-change\",\"category\":4,\"value\":\"0\"},{\"name\":\"mediacodec-hevc\",\"category\":4,\"value\":\"0\"},{\"name\":\"max-buffer-size\",\"category\":4,\"value\":\"15728640\"}],\"group\":\"软解码\"},{\"options\":[{\"name\":\"opensles\",\"category\":4,\"value\":\"0\"},{\"name\":\"framedrop\",\"category\":4,\"value\":\"1\"},{\"name\":\"soundtouch\",\"category\":4,\"value\":\"1\"},{\"name\":\"start-on-prepared\",\"category\":4,\"value\":\"1\"},{\"name\":\"http-detect-rangeupport\",\"category\":1,\"value\":\"0\"},{\"name\":\"fflags\",\"category\":1,\"value\":\"fastseek\"},{\"name\":\"skip_loop_filter\",\"category\":2,\"value\":\"48\"},{\"name\":\"reconnect\",\"category\":4,\"value\":\"1\"},{\"name\":\"enable-accurate-seek\",\"category\":4,\"value\":\"0\"},{\"name\":\"mediacodec\",\"category\":4,\"value\":\"1\"},{\"name\":\"mediacodec-all-videos\",\"category\":4,\"value\":\"1\"},{\"name\":\"mediacodec-auto-rotate\",\"category\":4,\"value\":\"1\"},{\"name\":\"mediacodec-handle-resolution-change\",\"category\":4,\"value\":\"1\"},{\"name\":\"mediacodec-hevc\",\"category\":4,\"value\":\"1\"},{\"name\":\"max-buffer-size\",\"category\":4,\"value\":\"15728640\"}],\"group\":\"硬解码\"}],\"ads\":[\"mimg.0c1q0l.cn\",\"www.googletagmanager.com\",\"www.google-analytics.com\",\"mc.usihnbcq.cn\",\"mg.g1mm3d.cn\",\"mscs.svaeuzh.cn\",\"cnzz.hhttm.top\",\"tp.vinuxhome.com\",\"cnzz.mmstat.com\",\"www.baihuillq.com\",\"s23.cnzz.com\",\"z3.cnzz.com\",\"c.cnzz.com\",\"stj.v1vo.top\",\"z12.cnzz.com\",\"img.mosflower.cn\",\"tips.gamevvip.com\",\"ehwe.yhdtns.com\",\"xdn.cqqc3.com\",\"www.jixunkyy.cn\",\"sp.chemacid.cn\",\"hm.baidu.com\",\"s9.cnzz.com\",\"z6.cnzz.com\",\"um.cavuc.com\",\"mav.mavuz.com\",\"wofwk.aoidf3.com\",\"z5.cnzz.com\",\"xc.hubeijieshikj.cn\",\"tj.tianwenhu.com\",\"xg.gars57.cn\",\"k.jinxiuzhilv.com\",\"cdn.bootcss.com\",\"ppl.xunzhuo123.com\",\"xomk.jiangjunmh.top\",\"img.xunzhuo123.com\",\"z1.cnzz.com\",\"s13.cnzz.com\",\"xg.huataisangao.cn\",\"z7.cnzz.com\",\"xg.huataisangao.cn\",\"z2.cnzz.com\",\"s96.cnzz.com\",\"q11.cnzz.com\",\"thy.dacedsfa.cn\",\"xg.whsbpw.cn\",\"s19.cnzz.com\",\"z8.cnzz.com\",\"s4.cnzz.com\",\"f5w.as12df.top\",\"ae01.alicdn.com\",\"www.92424.cn\",\"k.wudejia.com\",\"vivovip.mmszxc.top\",\"qiu.xixiqiu.com\",\"cdnjs.hnfenxun.com\",\"cms.qdwght.com\"]}";
        JsonObject defaultJson=gson.fromJson(defaultIJKADS, JsonObject.class);
        // 广告地址
        if(AdBlocker.isEmpty()){
            //默认广告拦截
            for (JsonElement host : defaultJson.getAsJsonArray("ads")) {
                AdBlocker.addAdHost(host.getAsString());
            }
        }

}
class OkGoHelper { final OkProxySelector selector = new OkProxySelector(); final ArrayList<String> dnsHttpsList=new ArrayList<>(); Map<String,String> myHosts; private static final String dnsConfigJson = "["
            + "{\"name\": \"腾讯\", \"url\": \"https://doh.pub/dns-query\"},"
            + "{\"name\": \"阿里\", \"url\": \"https://dns.alidns.com/dns-query\"},"
            + "{\"name\": \"360\", \"url\": \"https://doh.360.cn/dns-query\"}"
            + "]";
public String getDohUrl(int type) {
        String json=Hawk.get(HawkConfig.DOH_JSON,"");
        if(json.isEmpty())json=dnsConfigJson;
        JsonArray jsonArray = JsonParser.parseString(json).getAsJsonArray();
        if (type >= 1 && type < dnsHttpsList.size()) {
            JsonObject dnsConfig = jsonArray.get(type - 1).getAsJsonObject();
            return dnsConfig.get("url").getAsString();  // 获取对应的 URL
        }
        return "";
    }
public void setDnsList() {
        dnsHttpsList.clear();
        String json=Hawk.get(HawkConfig.DOH_JSON,"");
        if(json.isEmpty())json=dnsConfigJson;
        JsonArray jsonArray = JsonParser.parseString(json).getAsJsonArray();
        dnsHttpsList.add("关闭");
        for (int i = 0; i < jsonArray.size(); i++) {
            JsonObject dnsConfig = jsonArray.get(i).getAsJsonObject();
            String name = dnsConfig.has("name") ? dnsConfig.get("name").getAsString() : "Unknown Name";
            dnsHttpsList.add(name);
        }
        if(Hawk.get(HawkConfig.DOH_URL, 0)+1>dnsHttpsList.size())Hawk.put(HawkConfig.DOH_URL, 0);
        myHosts = FullConfig.this.myHosts;
    }
void setProxyList(List<ProxyRule> rules){selector.clear();if(rules!=null&&!rules.isEmpty())selector.addAll(rules); effect("http.reset",new JsonArray(),false);}
}
static class LiveChannelGroup {
    /**
     * groupIndex : 分组索引号
     * groupName : 分组名称
     * password : 分组密码
     */
    private int groupIndex;
    private String groupName;
    private String groupPassword;
    private ArrayList<LiveChannelItem> liveChannelItems;

    public int getGroupIndex() {
        return groupIndex;
    }

    public void setGroupIndex(int groupIndex) {
        this.groupIndex = groupIndex;
    }

    public String getGroupName() {
        return groupName;
    }

    public void setGroupName(String groupName) {
        this.groupName = groupName;
    }

    public ArrayList<LiveChannelItem> getLiveChannels() {
        return liveChannelItems;
    }

    public void setLiveChannels(ArrayList<LiveChannelItem> liveChannelItems) {
        this.liveChannelItems = liveChannelItems;
    }

    public String getGroupPassword() {
        return groupPassword;
    }

    public void setGroupPassword(String groupPassword) {
        this.groupPassword = groupPassword;
    }
}

static class LiveChannelItem {
    /**
     * channelIndex : 频道索引号
     * channelNum : 频道名称
     * channelSourceNames : 频道源名称
     * channelUrls : 频道源地址
     * sourceIndex : 频道源索引
     * sourceNum : 频道源总数
     */
    private int channelIndex;
    private int channelNum;
    private String channelName;
    private String channelLogo;
    private String channelEpg;
    private String channelUa;
    private String channelClick;
    private String channelFormat;
    private String channelOrigin;
    private String channelReferer;
    private String channelTvgId;
    private String channelTvgName;
    private JsonObject channelCatchup;
    private Map<String, String> channelHeader;
    private Integer channelParse;
    private ArrayList<String> channelSourceNames;
    private ArrayList<String> channelUrls;
    public int sourceIndex = 0;
    public int sourceNum = 0;
    public boolean include_back = false;

    public void setinclude_back(boolean include_back) {
        this.include_back = include_back;
    }

    public boolean getinclude_back() {
        return include_back;
    }

    public void setChannelIndex(int channelIndex) {
        this.channelIndex = channelIndex;
    }

    public int getChannelIndex() {
        return channelIndex;
    }

    public void setChannelNum(int channelNum) {
        this.channelNum = channelNum;
    }

    public int getChannelNum() {
        return channelNum;
    }

    public void setChannelName(String channelName) {
        this.channelName = channelName;
    }

    public String getChannelName() {
        return channelName;
    }

    public void setChannelLogo(String channelLogo) {
        this.channelLogo = channelLogo;
    }

    public String getChannelLogo() {
        return channelLogo == null ? "" : channelLogo;
    }

    public void setChannelEpg(String channelEpg) {
        this.channelEpg = channelEpg;
    }

    public String getChannelEpg() {
        return channelEpg == null ? "" : channelEpg;
    }

    public void setChannelUa(String channelUa) {
        this.channelUa = channelUa;
    }

    public String getChannelUa() {
        return channelUa == null ? "" : channelUa;
    }

    public void setChannelClick(String channelClick) {
        this.channelClick = channelClick;
    }

    public String getChannelClick() {
        return channelClick == null ? "" : channelClick;
    }

    public void setChannelFormat(String channelFormat) {
        this.channelFormat = channelFormat;
    }

    public String getChannelFormat() {
        return channelFormat == null ? "" : channelFormat;
    }

    public void setChannelOrigin(String channelOrigin) {
        this.channelOrigin = channelOrigin;
    }

    public String getChannelOrigin() {
        return channelOrigin == null ? "" : channelOrigin;
    }

    public void setChannelReferer(String channelReferer) {
        this.channelReferer = channelReferer;
    }

    public String getChannelReferer() {
        return channelReferer == null ? "" : channelReferer;
    }

    public void setChannelTvgId(String channelTvgId) {
        this.channelTvgId = channelTvgId;
    }

    public String getChannelTvgId() {
        return channelTvgId == null ? "" : channelTvgId;
    }

    public void setChannelTvgName(String channelTvgName) {
        this.channelTvgName = channelTvgName;
    }

    public String getChannelTvgName() {
        return channelTvgName == null ? "" : channelTvgName;
    }

    public void setChannelCatchup(JsonObject channelCatchup) {
        this.channelCatchup = channelCatchup;
    }

    public JsonObject getChannelCatchup() {
        return channelCatchup == null ? new JsonObject() : channelCatchup;
    }

    public boolean hasCatchup() {
        return channelCatchup != null && channelCatchup.entrySet().size() > 0;
    }

    public void setChannelHeader(Map<String, String> channelHeader) {
        this.channelHeader = channelHeader;
    }

    public Map<String, String> getChannelHeader() {
        return channelHeader == null ? new HashMap<String, String>() : channelHeader;
    }

    public void setChannelParse(Integer channelParse) {
        this.channelParse = channelParse;
    }

    public int getChannelParse() {
        return channelParse == null ? 0 : channelParse.intValue();
    }

    public Map<String, String> getHeaders() {
        Map<String, String> headers = new HashMap<>(getChannelHeader());
        if (!getChannelUa().isEmpty()) headers.put("User-Agent", getChannelUa());
        if (!getChannelOrigin().isEmpty()) headers.put("Origin", getChannelOrigin());
        if (!getChannelReferer().isEmpty()) headers.put("Referer", getChannelReferer());
        return headers;
    }

    public ArrayList<String> getChannelUrls() {
        return channelUrls;
    }

    public void setChannelUrls(ArrayList<String> channelUrls) {
        this.channelUrls = channelUrls;
        sourceNum = channelUrls.size();
    }
    public void preSource() {
        sourceIndex--;
        if (sourceIndex < 0) sourceIndex = sourceNum - 1;
    }
    public void nextSource() {
        sourceIndex++;
        if (sourceIndex == sourceNum) sourceIndex = 0;
    }

    public void setSourceIndex(int sourceIndex) {
        this.sourceIndex = sourceIndex;
    }

    public int getSourceIndex() {
        return sourceIndex;
    }

    public String getUrl() {
        return channelUrls.get(sourceIndex);
    }

    public int getSourceNum() {
        return sourceNum;
    }

    public ArrayList<String> getChannelSourceNames() {
        return channelSourceNames;
    }

    public void setChannelSourceNames(ArrayList<String> channelSourceNames) {
        this.channelSourceNames = channelSourceNames;
    }

    public String getSourceName() {
        return channelSourceNames.get(sourceIndex);
    }

    public boolean isEmptyCatchup() {
        return channelCatchup == null || channelCatchup.entrySet().size() == 0;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        LiveChannelItem that = (LiveChannelItem) o;
        return Objects.equals(channelName, that.channelName)
                && Objects.equals(channelUrls.get(sourceIndex), that.getUrl());
    }

    @Override
    public int hashCode() {
        return Objects.hash(channelName, channelUrls.get(sourceIndex));
    }
}
static class LiveSettingGroup {
    private int groupIndex;
    private String groupName;
    private ArrayList<LiveSettingItem> liveSettingItems;

    public int getGroupIndex() {
        return groupIndex;
    }

    public void setGroupIndex(int groupIndex) {
        this.groupIndex = groupIndex;
    }

    public String getGroupName() {
        return groupName;
    }

    public void setGroupName(String groupName) {
        this.groupName = groupName;
    }

    public ArrayList<LiveSettingItem> getLiveSettingItems() {
        return liveSettingItems;
    }

    public void setLiveSettingItems(ArrayList<LiveSettingItem> liveSettingItems) {
        this.liveSettingItems = liveSettingItems;
    }
}

static class LiveSettingItem {
    private int itemIndex;
    private String itemName;
    private boolean itemSelected = false;

    public int getItemIndex() {
        return itemIndex;
    }

    public void setItemIndex(int itemIndex) {
        this.itemIndex = itemIndex;
    }

    public String getItemName() {
        return itemName;
    }

    public void setItemName(String itemName) {
        this.itemName = itemName;
    }

    public boolean isItemSelected() {
        return itemSelected;
    }

    public void setItemSelected(boolean itemSelected) {
        this.itemSelected = itemSelected;
    }
}
static class ProxyRule implements Comparable<ProxyRule> {

    @SerializedName("name")
    private String name;
    @SerializedName("hosts")
    private List<String> hosts;
    @SerializedName("urls")
    private List<String> urls;

    private List<java.net.Proxy> proxies;
    private List<Uri> uris;
    private boolean wildcard;

    public static List<ProxyRule> arrayFrom(JsonElement element) {
        try {
            Type listType = new TypeToken<List<ProxyRule>>() {}.getType();
            List<ProxyRule> items = new Gson().fromJson(element, listType);
            return items == null ? Collections.<ProxyRule>emptyList() : items;
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    public void init() {
        wildcard = false;
        for (String host : getHosts()) {
            if (host != null && host.indexOf('*') >= 0) {
                wildcard = true;
                break;
            }
        }
        uris = new ArrayList<>();
        for (String url : getUrls()) {
            if (TextUtils.isEmpty(url)) continue;
            Uri uri = Uri.parse(url);
            if (isValid(uri)) uris.add(uri);
        }
        proxies = new ArrayList<>();
        for (Uri uri : uris) {
            java.net.Proxy proxy = create(uri);
            if (proxy != null) proxies.add(proxy);
        }
    }

    public String getName() {
        return TextUtils.isEmpty(name) ? "" : name;
    }

    public List<String> getHosts() {
        return hosts == null ? Collections.<String>emptyList() : hosts;
    }

    public List<String> getUrls() {
        return urls == null ? Collections.<String>emptyList() : urls;
    }

    public List<java.net.Proxy> getProxies() {
        return proxies == null ? Collections.<java.net.Proxy>emptyList() : proxies;
    }

    public String getUserInfo(String host) {
        if (uris == null || host == null) return null;
        for (Uri uri : uris) {
            if (uri == null || uri.getHost() == null) continue;
            if (host.equalsIgnoreCase(uri.getHost())) {
                String userInfo = uri.getUserInfo();
                if (!TextUtils.isEmpty(userInfo)) return userInfo;
            }
        }
        return null;
    }

    private boolean isValid(Uri uri) {
        return uri != null && uri.getScheme() != null && uri.getHost() != null && uri.getPort() > 0;
    }

    private java.net.Proxy create(Uri uri) {
        InetSocketAddress address = InetSocketAddress.createUnresolved(uri.getHost(), uri.getPort());
        if (isScheme(uri, "http")) return new java.net.Proxy(java.net.Proxy.Type.HTTP, address);
        if (isScheme(uri, "socks")) return new java.net.Proxy(java.net.Proxy.Type.SOCKS, address);
        return null;
    }

    private boolean isScheme(Uri uri, String scheme) {
        return uri.getScheme() != null && uri.getScheme().startsWith(scheme);
    }

    @Override
    public int compareTo(ProxyRule other) {
        return Boolean.compare(this.wildcard, other.wildcard);
    }
}

static class OkProxySelector extends ProxySelector {

    private final List<ProxyRule> proxy;
    private final ProxySelector system;

    public OkProxySelector() {
        proxy = new CopyOnWriteArrayList<>();
        system = ProxySelector.getDefault();
    }

    public synchronized void addAll(List<ProxyRule> items) {
        if (items == null || items.isEmpty()) return;
        for (ProxyRule item : items) {
            if (item != null) item.init();
        }
        proxy.addAll(items);
        Collections.sort(proxy);
    }

    public synchronized void clear() {
        proxy.clear();
    }

    public List<ProxyRule> getProxy() {
        return proxy;
    }

    private List<java.net.Proxy> fallback(URI uri) {
        if (system != null && uri != null) return system.select(uri);
        List<java.net.Proxy> result = new ArrayList<>();
        result.add(java.net.Proxy.NO_PROXY);
        return result;
    }

    @Override
    public List<java.net.Proxy> select(URI uri) {
        if (proxy.isEmpty() || uri == null || uri.getHost() == null) return fallback(uri);
        String host = uri.getHost();
        if ("127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host)) return fallback(uri);
        for (ProxyRule item : proxy) {
            for (String rule : item.getHosts()) {
                if (rule == null) continue;
                if (containOrMatch(host, rule)) {
                    List<java.net.Proxy> proxies = item.getProxies();
                    return proxies.isEmpty() ? fallback(uri) : proxies;
                }
            }
        }
        return fallback(uri);
    }

    @Override
    public void connectFailed(URI uri, SocketAddress socketAddress, IOException e) {
        if (system != null) system.connectFailed(uri, socketAddress, e);
    }

    private boolean containOrMatch(String text, String rule) {
        try {
            return text.contains(rule) || text.matches(rule);
        } catch (Throwable th) {
            return false;
        }
    }
}

static class RegexUtils {

    private static final Map<String, Pattern> patternCache = new HashMap<>();
    public static Pattern getPattern(String regex) {
        Pattern pattern = patternCache.get(regex);
        if (pattern == null) {
            pattern = Pattern.compile(regex);
            patternCache.put(regex, pattern);
        }
        return pattern;
    }

    public static Pattern getPattern(String regex,int flag) {
        Pattern pattern = patternCache.get(regex);
        if (pattern == null) {
            pattern = Pattern.compile(regex,flag);
            patternCache.put(regex, pattern);
        }
        return pattern;
    }
}

static class VideoParseRuler {

    private static final HashMap<String, ArrayList<ArrayList<String>>> HOSTS_RULE = new HashMap<>();
    private static final HashMap<String, ArrayList<ArrayList<String>>> HOSTS_FILTER = new HashMap<>();
    private static final HashMap<String, ArrayList<String>> HOSTS_REGEX = new HashMap<>();
    private static final HashMap<String, ArrayList<String>> HOSTS_SCRIPT = new HashMap<>();

    public static void clearRule() {
        HOSTS_RULE.clear();
        HOSTS_FILTER.clear();
        HOSTS_REGEX.clear();
        HOSTS_SCRIPT.clear();
    }

    public static void addHostRule(String host, ArrayList<String> rule) {
        ArrayList<ArrayList<String>> rules = new ArrayList<>();
        if (HOSTS_RULE.get(host) != null && HOSTS_RULE.get(host).size() > 0) {
            rules = HOSTS_RULE.get(host);
        }
        rules.add(rule);
        HOSTS_RULE.put(host, rules);
    }

    public static ArrayList<ArrayList<String>> getHostRules(String host) {
        if (HOSTS_RULE.containsKey(host)) {
            return HOSTS_RULE.get(host);
        }
        return null;
    }

    public static void addHostFilter(String host, ArrayList<String> rule) {
        ArrayList<ArrayList<String>> filters = new ArrayList<>();
        if (HOSTS_FILTER.get(host) != null && HOSTS_FILTER.get(host).size() > 0) {
            filters = HOSTS_FILTER.get(host);
        }
        filters.add(rule);
        HOSTS_FILTER.put(host, filters);
    }

    public static ArrayList<ArrayList<String>> getHostFilters(String host) {
        if (HOSTS_FILTER.containsKey(host)) {
            return HOSTS_FILTER.get(host);
        }
        return null;
    }

    public static void addHostRegex(String host, ArrayList<String> regex) {
        if (regex == null || regex.size() == 0) return;
        ArrayList<String> temp = new ArrayList<>();
        if (HOSTS_REGEX.get(host) != null && HOSTS_REGEX.get(host).size() > 0) temp = HOSTS_REGEX.get(host);
        temp.addAll(regex);
        HOSTS_REGEX.put(host, temp);
    }

    public static HashMap<String, ArrayList<String>> getHostsRegex() {
        return HOSTS_REGEX;
    }

    public static boolean checkIsVideoForParse(String webUrl, String url) {
        try {
            boolean isVideo = DefaultConfig.isVideoFormat(url);
            if (!HOSTS_RULE.isEmpty() && !isVideo && webUrl != null) {
                Uri uri = Uri.parse(webUrl);
                if(getHostRules(uri.getHost()) != null){
                    isVideo = checkVideoForOneHostRules(uri.getHost(), url);
                }else {
                    isVideo = checkVideoForOneHostRules("*", url);
                }
            }
            return isVideo;
        } catch (Exception e) {
            e.printStackTrace();
        }
        return false;
    }

    private static boolean checkVideoForOneHostRules(String host, String url) {
        boolean isVideo = false;
        ArrayList<ArrayList<String>> hostRules = getHostRules(host);
        if (hostRules != null && hostRules.size() > 0) {
            boolean isVideoRuleCheck = false;
            for(int i=0; i<hostRules.size(); i++) {
                boolean checkIsVideo = true;
                if (hostRules.get(i) != null && hostRules.get(i).size() > 0) {
                    for(int j=0; j<hostRules.get(i).size(); j++) {
                        Pattern onePattern = getPattern("" + hostRules.get(i).get(j));
                        if (!onePattern.matcher(url).find()) {
                            checkIsVideo = false;
                            break;
                        }
                        LOG.i("echo-VIDEO RULE:" + hostRules.get(i).get(j));
                    }
                } else {
                    checkIsVideo = false;
                }
                if (checkIsVideo) {
                    isVideoRuleCheck = true;
                    break;
                }
            }
            if (isVideoRuleCheck) {
                isVideo = true;
            }
        }
        return isVideo;
    }

    public static boolean isFilter(String webUrl, String url) {
        try {
            boolean isFilter = false;
            if (!HOSTS_FILTER.isEmpty() && webUrl != null) {
                Uri uri = Uri.parse(webUrl);
                if(getHostFilters(uri.getHost()) != null){
                    isFilter = checkIsFilterForOneHostRules(uri.getHost(), url);
                }
            }
            return isFilter;
        } catch (Exception e) {
            e.printStackTrace();
        }
        return false;
    }

    private static boolean checkIsFilterForOneHostRules(String host, String url) {
        boolean isFilter = false;
        ArrayList<ArrayList<String>> hostFilters = getHostFilters(host);
        if (hostFilters != null && hostFilters.size() > 0) {
            boolean isFilterRuleCheck = false;
            for(int i=0; i<hostFilters.size(); i++) {
                boolean checkIsFilter = true;
                if (hostFilters.get(i) != null && hostFilters.get(i).size() > 0) {
                    for(int j=0; j<hostFilters.get(i).size(); j++) {
                        Pattern onePattern = getPattern("" + hostFilters.get(i).get(j));
                        if (!onePattern.matcher(url).find()) {
                            checkIsFilter = false;
                            break;
                        }
                        LOG.i("echo-FILTER RULE:" + hostFilters.get(i).get(j));
                    }
                } else {
                    checkIsFilter = false;
                }
                if (checkIsFilter) {
                    isFilterRuleCheck = true;
                    break;
                }
            }
            if (isFilterRuleCheck) {
                isFilter = true;
            }
        }
        return isFilter;
    }

    public static void addHostScript(String host, ArrayList<String> script) {
        if (script == null || script.size() == 0) return;
        ArrayList<String> temp = new ArrayList<>();
        if (HOSTS_SCRIPT.get(host) != null && HOSTS_SCRIPT.get(host).size() > 0) temp = HOSTS_SCRIPT.get(host);
        assert temp != null;
        temp.addAll(script);
        HOSTS_SCRIPT.put(host, temp);
    }

    public static String getHostScript(String url) {
        for (Map.Entry<String, ArrayList<String>> entry : HOSTS_SCRIPT.entrySet()) {
            String host = entry.getKey();
            if (url.contains(host)) {
                List<String> list = entry.getValue();
                if (list != null && !list.isEmpty()) {
                    return list.get(0);
                }
            }
        }
        return "";
    }
}

static class TxtSubscribe {
    public static final String DEFAULT_GROUP_NAME = "直播";
    private static final String LEGACY_DEFAULT_GROUP_NAME = "Ungrouped";
    private static final Pattern NAME_PATTERN = Pattern.compile(".*,(.+?)$");
    private static final Pattern GROUP_PATTERN = Pattern.compile("group-title=\"(.*?)\"");
    private static final Pattern TVG_CHNO_PATTERN = Pattern.compile("tvg-chno=\"(.*?)\"");
    private static final Pattern TVG_LOGO_PATTERN = Pattern.compile("tvg-logo=\"(.*?)\"");
    private static final Pattern TVG_NAME_PATTERN = Pattern.compile("tvg-name=\"(.*?)\"");
    private static final Pattern TVG_URL_PATTERN = Pattern.compile("tvg-url=\"(.*?)\"");
    private static final Pattern TVG_ID_PATTERN = Pattern.compile("tvg-id=\"(.*?)\"");
    private static final Pattern HTTP_USER_AGENT_PATTERN = Pattern.compile("http-user-agent=\"(.*?)\"");
    private static final Pattern CATCHUP_PATTERN = Pattern.compile("catchup=\"(.*?)\"");
    private static final Pattern CATCHUP_SOURCE_PATTERN = Pattern.compile("catchup-source=\"(.*?)\"");
    private static final Pattern CATCHUP_REPLACE_PATTERN = Pattern.compile("catchup-replace=\"(.*?)\"");

    public static void parse(LinkedHashMap<String, LinkedHashMap<String, ArrayList<String>>> linkedHashMap, String str) {
        linkedHashMap.clear();
        JsonArray array = parseToJsonArray(str);
        if (array == null) return;
        for (JsonElement groupElement : array) {
            JsonObject groupObj = groupElement.getAsJsonObject();
            String groupName = normalizeGroupName(DefaultConfig.safeJsonString(groupObj, "group", DEFAULT_GROUP_NAME));
            LinkedHashMap<String, ArrayList<String>> channelMap = new LinkedHashMap<>();
            if (groupObj.has("channels")) {
                for (JsonElement channelElement : groupObj.getAsJsonArray("channels")) {
                    JsonObject channelObj = channelElement.getAsJsonObject();
                    String channelName = DefaultConfig.safeJsonString(channelObj, "name", "Unnamed");
                    ArrayList<String> urls = new ArrayList<String>();
                    if (channelObj.has("urls")) {
                        for (JsonElement urlElement : channelObj.getAsJsonArray("urls")) {
                            String url = urlElement.getAsString().trim();
                            if (isUrl(url) && !urls.contains(url)) urls.add(url);
                        }
                    }
                    if (!urls.isEmpty()) channelMap.put(channelName, urls);
                }
            }
            if (!channelMap.isEmpty()) linkedHashMap.put(groupName, channelMap);
        }
    }

    public static JsonArray parseToJsonArray(String str) {
        if (str == null) return new JsonArray();
        str = str.trim();
        if (str.isEmpty()) return new JsonArray();
        try {
            JsonElement element = JsonParser.parseString(str);
            if (element.isJsonArray()) return normalizeJsonArray(element.getAsJsonArray());
        } catch (Throwable ignored) {
        }
        if (str.startsWith("#EXTM3U")) return parseM3uToJsonArray(str);
        return parseTxtToJsonArray(str);
    }

    private static JsonArray normalizeJsonArray(JsonArray groups) {
        JsonArray result = new JsonArray();
        for (JsonElement groupElement : groups) {
            JsonObject groupObj = groupElement.getAsJsonObject();
            JsonObject outGroup = new JsonObject();
            String groupName = DefaultConfig.safeJsonString(groupObj, "group", "");
            if (groupName.isEmpty()) groupName = DefaultConfig.safeJsonString(groupObj, "name", DEFAULT_GROUP_NAME);
            outGroup.addProperty("group", normalizeGroupName(groupName));
            JsonArray channels = null;
            if (groupObj.has("channels") && groupObj.get("channels").isJsonArray()) {
                channels = groupObj.getAsJsonArray("channels");
            } else if (groupObj.has("channel") && groupObj.get("channel").isJsonArray()) {
                channels = groupObj.getAsJsonArray("channel");
            }
            if (channels != null) {
                for (JsonElement channelElement : channels) {
                    JsonObject channelObj = channelElement.getAsJsonObject();
                    JsonObject outChannel = new JsonObject();
                    copyIfExists(channelObj, outChannel, "name");
                    copyIfExists(channelObj, outChannel, "urls");
                    copyIfExists(channelObj, outChannel, "logo");
                    copyIfExists(channelObj, outChannel, "epg");
                    copyIfExists(channelObj, outChannel, "ua");
                    copyIfExists(channelObj, outChannel, "click");
                    copyIfExists(channelObj, outChannel, "format");
                    copyIfExists(channelObj, outChannel, "origin");
                    copyIfExists(channelObj, outChannel, "referer");
                    copyIfExists(channelObj, outChannel, "tvg-id");
                    copyIfExists(channelObj, outChannel, "tvg-name");
                    copyIfExists(channelObj, outChannel, "tvg-chno");
                    copyIfExists(channelObj, outChannel, "parse");
                    copyIfExists(channelObj, outChannel, "header");
                    copyIfExists(channelObj, outChannel, "catchup");
                    copyIfExists(channelObj, outChannel, "catchup-source");
                    copyIfExists(channelObj, outChannel, "catchup-replace");
                    addChannel(outGroup, outChannel);
                }
            }
            if (!outGroup.has("channels")) outGroup.add("channels", new JsonArray());
            result.add(outGroup);
        }
        return result;
    }

    private static void copyIfExists(JsonObject src, JsonObject dst, String key) {
        if (src.has(key)) dst.add(key, src.get(key));
    }

    private static JsonArray parseM3uToJsonArray(String str) {
        JsonArray result = new JsonArray();
        try {
            BufferedReader reader = new BufferedReader(new StringReader(str.replace("\r\n", "\n").replace("\r", "")));
            String line;
            JsonObject currentGroup = null;
            JsonObject pendingChannel = null;
            JsonObject pendingMeta = new JsonObject();
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;
                if (line.startsWith("#EXTM3U")) {
                    mergeMeta(pendingMeta, buildMeta(line));
                    continue;
                }
                if (isSetting(line)) {
                    mergeMeta(pendingMeta, buildSetting(line));
                    continue;
                }
                if (line.startsWith("#EXTINF") || line.contains("#EXTINF")) {
                    String groupName = get(line, GROUP_PATTERN);
                    groupName = normalizeGroupName(groupName);
                    currentGroup = findOrCreateGroup(result, groupName);
                    pendingChannel = new JsonObject();
                    pendingChannel.addProperty("name", get(line, NAME_PATTERN));
                    mergeMeta(pendingChannel, buildMeta(line));
                    mergeMeta(pendingChannel, pendingMeta);
                    pendingMeta = new JsonObject();
                    continue;
                }
                if (line.startsWith("#")) continue;
                if (currentGroup == null) currentGroup = findOrCreateGroup(result, DEFAULT_GROUP_NAME);
                if (pendingChannel == null) pendingChannel = new JsonObject();
                String[] parts = line.split("\\|", 2);
                String url = parts[0].trim();
                if (!isUrl(url)) continue;
                if (parts.length > 1) mergeMeta(pendingMeta, parseHeaderString(parts[1]));
                mergeMeta(pendingChannel, pendingMeta);
                JsonArray urls = pendingChannel.has("urls") ? pendingChannel.getAsJsonArray("urls") : new JsonArray();
                if (!containsUrl(urls, url)) urls.add(url);
                pendingChannel.add("urls", urls);
                addChannel(currentGroup, pendingChannel);
                pendingMeta = new JsonObject();
            }
            reader.close();
        } catch (Throwable ignored) {
        }
        return result;
    }

    private static JsonArray parseTxtToJsonArray(String str) {
        JsonArray result = new JsonArray();
        try {
            BufferedReader reader = new BufferedReader(new StringReader(str.replace("\r\n", "\n").replace("\r", "")));
            String line;
            JsonObject currentGroup = null;
            JsonObject pendingMeta = new JsonObject();
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;
                if (line.startsWith("#")) {
                    if (isSetting(line)) mergeMeta(pendingMeta, buildSetting(line));
                    continue;
                }
                if (line.contains("#genre#")) {
                    String groupName = line.split(",", 2)[0].trim();
                    currentGroup = findOrCreateGroup(result, groupName);
                    pendingMeta = new JsonObject();
                    continue;
                }
                String[] split = line.split(",", 2);
                if (split.length < 2) continue;
                if (currentGroup == null) currentGroup = findOrCreateGroup(result, DEFAULT_GROUP_NAME);
                JsonObject channel = new JsonObject();
                channel.addProperty("name", split[0].trim());
                mergeMeta(channel, pendingMeta);
                ArrayList<String> urls = new ArrayList<String>();
                for (String part : split[1].trim().split("#")) {
                    String url = part.trim();
                    if (isUrl(url) && !urls.contains(url)) urls.add(url);
                }
                if (urls.isEmpty()) continue;
                JsonArray urlArray = new JsonArray();
                for (String url : urls) urlArray.add(url);
                channel.add("urls", urlArray);
                addChannel(currentGroup, channel);
                pendingMeta = new JsonObject();
            }
            reader.close();
        } catch (Throwable ignored) {
        }
        return result;
    }

    private static JsonObject parseHeaderString(String text) {
        JsonObject wrapper = new JsonObject();
        JsonObject obj = new JsonObject();
        String[] params = text.split("&");
        for (String param : params) {
            if (!param.contains("=")) continue;
            String[] a = param.split("=", 2);
            obj.addProperty(a[0].trim().replace("\"", ""), a[1].trim().replace("\"", ""));
        }
        if (obj.entrySet().size() > 0) wrapper.add("header", obj);
        return wrapper;
    }

    private static JsonObject findOrCreateGroup(JsonArray result, String name) {
        name = normalizeGroupName(name);
        for (JsonElement element : result) {
            JsonObject group = element.getAsJsonObject();
            if (name.equals(group.get("group").getAsString())) return group;
        }
        JsonObject group = new JsonObject();
        group.addProperty("group", name);
        group.add("channels", new JsonArray());
        result.add(group);
        return group;
    }

    public static String normalizeGroupName(String name) {
        if (name == null) return DEFAULT_GROUP_NAME;
        name = name.trim();
        if (name.isEmpty() || LEGACY_DEFAULT_GROUP_NAME.equalsIgnoreCase(name)) return DEFAULT_GROUP_NAME;
        return name;
    }

    private static void addChannel(JsonObject group, JsonObject channel) {
        JsonArray channels = group.has("channels") ? group.getAsJsonArray("channels") : new JsonArray();
        String name = DefaultConfig.safeJsonString(channel, "name", "");
        JsonObject exists = name.isEmpty() ? null : findChannel(channels, name);
        if (exists == null) {
            channels.add(channel);
        } else {
            mergeChannel(exists, channel);
        }
        group.add("channels", channels);
    }

    private static JsonObject findChannel(JsonArray channels, String name) {
        for (JsonElement element : channels) {
            if (!element.isJsonObject()) continue;
            JsonObject channel = element.getAsJsonObject();
            if (name.equals(DefaultConfig.safeJsonString(channel, "name", ""))) return channel;
        }
        return null;
    }

    private static void mergeChannel(JsonObject dst, JsonObject src) {
        mergeUrls(dst, src);
        for (Map.Entry<String, JsonElement> entry : src.entrySet()) {
            String key = entry.getKey();
            if ("urls".equals(key)) continue;
            if (!dst.has(key) || isEmptyValue(dst.get(key))) dst.add(key, entry.getValue());
        }
    }

    private static void mergeUrls(JsonObject dst, JsonObject src) {
        if (!src.has("urls") || !src.get("urls").isJsonArray()) return;
        JsonArray dstUrls = dst.has("urls") && dst.get("urls").isJsonArray() ? dst.getAsJsonArray("urls") : new JsonArray();
        for (JsonElement element : src.getAsJsonArray("urls")) {
            if (!element.isJsonPrimitive()) continue;
            String url = element.getAsString().trim();
            if (isUrl(url) && !containsUrl(dstUrls, url)) dstUrls.add(url);
        }
        dst.add("urls", dstUrls);
    }

    private static boolean isEmptyValue(JsonElement element) {
        if (element == null || element.isJsonNull()) return true;
        if (element.isJsonPrimitive()) return element.getAsString().trim().isEmpty();
        if (element.isJsonArray()) return element.getAsJsonArray().size() == 0;
        return element.isJsonObject() && element.getAsJsonObject().entrySet().size() == 0;
    }

    private static boolean containsUrl(JsonArray urls, String url) {
        for (JsonElement element : urls) {
            if (url.equals(element.getAsString())) return true;
        }
        return false;
    }

    private static void mergeMeta(JsonObject dst, JsonObject src) {
        for (Map.Entry<String, JsonElement> entry : src.entrySet()) {
            dst.add(entry.getKey(), entry.getValue());
        }
    }

    private static JsonObject buildMeta(String line) {
        JsonObject obj = new JsonObject();
        put(obj, "logo", get(line, TVG_LOGO_PATTERN));
        put(obj, "epg", get(line, TVG_URL_PATTERN));
        put(obj, "tvg-id", get(line, TVG_ID_PATTERN));
        put(obj, "tvg-name", get(line, TVG_NAME_PATTERN));
        put(obj, "tvg-chno", get(line, TVG_CHNO_PATTERN));
        put(obj, "ua", get(line, HTTP_USER_AGENT_PATTERN));
        String catchup = get(line, CATCHUP_PATTERN);
        String source = get(line, CATCHUP_SOURCE_PATTERN);
        String replace = get(line, CATCHUP_REPLACE_PATTERN);
        if (!catchup.isEmpty() || !source.isEmpty() || !replace.isEmpty()) {
            JsonObject catchupObj = new JsonObject();
            put(catchupObj, "type", catchup);
            put(catchupObj, "source", source);
            put(catchupObj, "replace", replace);
            obj.add("catchup", catchupObj);
        }
        return obj;
    }

    private static JsonObject buildSetting(String line) {
        JsonObject obj = new JsonObject();
        if (line.startsWith("ua")) put(obj, "ua", getValue(line, "ua"));
        if (line.startsWith("parse")) put(obj, "parse", getValue(line, "parse"));
        if (line.startsWith("click")) put(obj, "click", getValue(line, "click"));
        if (line.startsWith("header")) {
            String value = getValue(line, "header");
            if (!value.isEmpty()) {
                try {
                    obj.add("header", JsonParser.parseString(value).getAsJsonObject());
                } catch (Throwable ignored) {
                }
            }
        }
        if (line.startsWith("format")) put(obj, "format", getValue(line, "format"));
        if (line.startsWith("origin")) put(obj, "origin", getValue(line, "origin"));
        if (line.startsWith("referer")) put(obj, "referer", getValue(line, "referer"));
        if (line.startsWith("#EXTHTTP:")) {
            try {
                obj.add("header", JsonParser.parseString(line.split("#EXTHTTP:")[1].trim()).getAsJsonObject());
            } catch (Throwable ignored) {
            }
        }
        if (line.startsWith("#EXTVLCOPT:")) {
            if (line.contains("http-user-agent")) put(obj, "ua", getValue(line, "http-user-agent"));
            if (line.contains("http-origin")) put(obj, "origin", getValue(line, "http-origin"));
            if (line.contains("http-referrer")) put(obj, "referer", getValue(line, "http-referrer"));
        }
        if (line.startsWith("#KODIPROP:") && line.contains("manifest_type=")) {
            put(obj, "format", getValue(line, "manifest_type"));
        }
        return obj;
    }

    private static boolean isSetting(String line) {
        return line.startsWith("ua") || line.startsWith("parse") || line.startsWith("click") || line.startsWith("player") || line.startsWith("header") || line.startsWith("format") || line.startsWith("origin") || line.startsWith("referer") || line.startsWith("#EXTHTTP:") || line.startsWith("#EXTVLCOPT:") || line.startsWith("#KODIPROP:");
    }

    private static boolean isUrl(String url) {
        return !url.isEmpty() && (url.startsWith("http") || url.startsWith("rtp") || url.startsWith("rtsp") || url.startsWith("rtmp"));
    }

    private static String get(String line, Pattern pattern) {
        Matcher matcher = pattern.matcher(line);
        if (matcher.find()) return matcher.group(1).trim();
        return "";
    }

    private static String getValue(String line, String key) {
        int index = line.indexOf(key + "=");
        if (index == -1) return "";
        return line.substring(index + key.length() + 1).trim().replace("\"", "");
    }

    private static void put(JsonObject obj, String key, String value) {
        if (value != null && !value.isEmpty()) obj.addProperty(key, value);
    }
}

static class AdBlocker {
    private static final List<String> AD_HOSTS = new ArrayList<>();

    public static void clear() {
        AD_HOSTS.clear();
    }

    public static boolean isEmpty() {
        return AD_HOSTS.isEmpty();
    }

    public static void addAdHost(String host) {
        AD_HOSTS.add(host);
    }

    public static boolean hasHost(String host) {
        return AD_HOSTS.contains(host);
    }

    public static boolean isAd(String url) {
        url = url.toLowerCase();
        for (String adHost : AD_HOSTS) {
            if (url.contains(adHost)) {
                return true;
            }
        }
        return false;
    }



}
static class M3u8 { private static final String TAG_DISCONTINUITY = "#EXT-X-DISCONTINUITY";
    private static final String TAG_MEDIA_DURATION = "#EXTINF";
    private static final String TAG_ENDLIST = "#EXT-X-ENDLIST";
    private static final String TAG_KEY = "#EXT-X-KEY";
    private static final String TAG_MAP = "#EXT-X-MAP";
    private static final String TAG_CUE_OUT = "#EXT-X-CUE-OUT";
    private static final String TAG_CUE_IN = "#EXT-X-CUE-IN";
private static final String TAG_DATERANGE = "#EXT-X-DATERANGE";
public static boolean isAd(String regex) {
        return regex.contains(TAG_DISCONTINUITY) || regex.contains(TAG_MEDIA_DURATION) || regex.contains(TAG_ENDLIST) || regex.contains(TAG_KEY) || regex.contains(TAG_CUE_OUT) || regex.contains(TAG_CUE_IN) || regex.contains(TAG_DATERANGE) || M3u8.isDouble(regex);
    }
private static boolean isDouble(String ad) {
        try {
            return Double.parseDouble(ad) != 0;
        } catch (Exception e) {
            return false;
        }
    } }
static class MD5 { private static final java.security.MessageDigest sDigest; static {try{sDigest=java.security.MessageDigest.getInstance("MD5");}catch(Exception e){throw new RuntimeException(e);}} public static String string2MD5(String inStr) {
        if (sDigest == null) {
            Log.e("MD5", "MD5信息摘要初始化失败");
            return null;
        } else if (TextUtils.isEmpty(inStr)) {
            Log.e("MD5", "参数strSource不能为空");
            return null;
        }
        char[] charArray = inStr.toCharArray();
        byte[] byteArray = new byte[charArray.length];

        for (int i = 0; i < charArray.length; i++)
            byteArray[i] = (byte) charArray[i];
        byte[] md5Bytes = sDigest.digest(byteArray);
        StringBuilder hexValue = new StringBuilder();
        for (byte md5Byte : md5Bytes) {
            int val = ((int) md5Byte) & 0xff;
            if (val < 16)
                hexValue.append("0");
            hexValue.append(Integer.toHexString(val));
        }
        return hexValue.toString();

    } }
static class DefaultConfig { private static final Pattern snifferMatch = Pattern.compile(
            "http((?!http).){12,}?\\.(m3u8|mp4|flv|avi|mkv|rm|wmv|mpg|m4a|mp3|aac|mpd)\\?.*|" +
            "http((?!http).){12,}\\.(m3u8|mp4|flv|avi|mkv|rm|wmv|mpg|m4a|mp3|aac|mpd)|" +
            "http((?!http).)*?video/tos*|" +
            "http((?!http).){20,}?/m3u8\\?pt=m3u8.*|" +
            "http((?!http).)*?default\\.ixigua\\.com/.*|" +
            "http((?!http).)*?dycdn-tos\\.pstatp[^\\?]*|" +
            "http.*?/player/m3u8play\\.php\\?url=.*|" +
            "http.*?/player/.*?[pP]lay\\.php\\?url=.*|" +
            "http.*?/playlist/m3u8/\\?vid=.*|" +
            "http.*?\\.php\\?type=m3u8&.*|" +
            "http.*?/download.aspx\\?.*|" +
            "http.*?/api/up_api.php\\?.*|" +
            "https.*?\\.66yk\\.cn.*|" +
            "http((?!http).)*?netease\\.com/file/.*"
    );

public static String safeJsonString(JsonObject obj, String key, String defaultVal) {
        try {
            if (obj.has(key)){
                return obj.get(key).isJsonObject() || obj.get(key).isJsonArray()?obj.get(key).toString().trim():obj.getAsJsonPrimitive(key).getAsString().trim();
            }
            else
                return defaultVal;
        } catch (Throwable th) {
        }
        return defaultVal;
    }
public static int safeJsonInt(JsonObject obj, String key, int defaultVal) {
        try {
            if (obj.has(key))
                return obj.getAsJsonPrimitive(key).getAsInt();
            else
                return defaultVal;
        } catch (Throwable th) {
        }
        return defaultVal;
    }
public static ArrayList<String> safeJsonStringList(JsonObject obj, String key) {
        ArrayList<String> result = new ArrayList<>();
        try {
            if (obj.has(key)) {
                if (obj.get(key).isJsonObject()) {
                    result.add(obj.get(key).getAsString());
                } else {
                    for (JsonElement opt : obj.getAsJsonArray(key)) {
                        result.add(opt.getAsString());
                    }
                }
            }
        } catch (Throwable th) {
        }
        return result;
    }
public static boolean isVideoFormat(String url) {
        Uri uri = Uri.parse(url);
        String path = uri.getPath();
        if (TextUtils.isEmpty(path)) {
            return false;
        }
        if (snifferMatch.matcher(url).find()) return true;
        return false;
    }
public static String checkReplaceProxy(String s){return tvbox.config.DefaultConfig.checkReplaceProxy(s);} }
static Pattern getPattern(String regex){return RegexUtils.getPattern(regex);}

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
  JsonObject vodSnapshot() {
    JsonObject result=new JsonObject();result.addProperty("scope","vod-prefix");
    JsonObject globals=new JsonObject();globals.add("spider",spider==null?JsonNull.INSTANCE:new JsonPrimitive(spider));
    globals.addProperty("jarCache",jarCache);globals.addProperty("danmaku",danmaku);globals.addProperty("wallpaper",wallpaper);
    result.add("globals",globals);result.add("sites",sources());result.add("home",sourceValue(mHomeSource));
    result.add("flags",gson.toJsonTree(vipParseFlags));JsonArray parses=new JsonArray();for(ParseBean bean:parseBeanList)parses.add(parseValue(bean));
    result.add("parses",parses);result.add("defaultParse",parseValue(mDefaultParse));
    JsonObject selection=new JsonObject();selection.addProperty("homeApi",Hawk.get(HawkConfig.HOME_API,""));selection.addProperty("defaultParse",Hawk.get(HawkConfig.DEFAULT_PARSE,""));
    result.add("selection",selection);return result;
  }

}
