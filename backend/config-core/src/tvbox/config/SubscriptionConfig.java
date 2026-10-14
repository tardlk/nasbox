// SPDX-License-Identifier: GPL-3.0-only
// Adapted from pinned TVBoxOS; see backend/config-core/NOTICE.md.
package tvbox.config;
import com.google.gson.*;
import com.github.tvbox.osc.util.AES;
import android.util.Base64;
import java.util.ArrayList;
import java.util.regex.*;

final class SubscriptionConfig {
    private final Gson gson = new Gson();
    private final ConfigParser parser;
    private String TempKey = null;
    private final PreferenceStore preferences = new PreferenceStore();
    private final HistoryHelper history = new HistoryHelper(preferences);
    PreferenceStore preferences() { return preferences; }
    SubscriptionConfig(ConfigParser parser) { this.parser = parser; }
    String key() { return TempKey; }
    private static Pattern getPattern(String value) { return Pattern.compile(value); }
    private static boolean isEmpty(String value) { return value == null || value.length() == 0; }
    private String trimJsonObject(String text) { return parser.trimJsonObject(text); }
    String clanToAddress(String url) { return parser.clanToAddress(url); }
    String configUrl(String apiUrl){
        TempKey = null;
        String configUrl = "", pk = ";pk;";
        apiUrl=apiUrl.replace("file://", "clan://localhost/");
        if (apiUrl.contains(pk)) {
            String[] a = apiUrl.split(pk);
            TempKey = a[1];
            if (apiUrl.startsWith("clan")){
                configUrl = clanToAddress(a[0]);
            }else if (apiUrl.startsWith("http")){
                configUrl = a[0];
            }else {
                configUrl = "http://" + a[0];
            }
        } else if (apiUrl.startsWith("clan")) {
            configUrl = clanToAddress(apiUrl);
        } else if (!apiUrl.startsWith("http")) {
            configUrl = "http://" + apiUrl;
        } else {
            configUrl = apiUrl;
        }
        return configUrl;
    }
    public static String FindResult(String json, String configKey) {
        String content = json;
        try {
            if (AES.isJson(content)) return content;
            Pattern pattern = getPattern("[A-Za-z0-9]{8}\\*\\*");
            Matcher matcher = pattern.matcher(content);
            if(matcher.find()){
                content=content.substring(content.indexOf(matcher.group()) + 10);
                content = new String(Base64.decode(content, Base64.DEFAULT));
            }
            content = content.trim();
            if (content.startsWith("2423")) {
                content = content.replaceAll("\\s+", "");
                String data = content.substring(content.indexOf("2324") + 4, content.length() - 26);
                content = new String(AES.toBytes(content)).toLowerCase();
                String key = AES.rightPadding(content.substring(content.indexOf("$#") + 2, content.indexOf("#$")), "0", 16);
                String iv = AES.rightPadding(content.substring(content.length() - 13), "0", 16);
                json = AES.CBC(data, key, iv);
            }else if (configKey !=null && !AES.isJson(content)) {
                json = AES.ECB(content, configKey);
            }
            else{
                json = content;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return json;
    }
    ArrayList<String> parseApiCollection(String jsonStr) {
        ArrayList<String> apiLines = new ArrayList<>();
        try {
            String json = trimJsonObject(jsonStr);
            if (isEmpty(json)) {
                return apiLines;
            }
            JsonObject infoJson = gson.fromJson(json, JsonObject.class);
            if (infoJson == null || infoJson.has("sites") || !infoJson.has("urls") || !infoJson.get("urls").isJsonArray()) {
                return apiLines;
            }
            JsonArray urls = infoJson.get("urls").getAsJsonArray();
            for (JsonElement element : urls) {
                String name = "";
                String url = "";
                if (element.isJsonObject()) {
                    JsonObject item = element.getAsJsonObject();
                    name = DefaultConfig.safeJsonString(item, "name", "");
                    url = DefaultConfig.safeJsonString(item, "url", "");
                    if (isEmpty(url)) {
                        url = DefaultConfig.safeJsonString(item, "api", "");
                    }
                } else if (element.isJsonPrimitive()) {
                    url = element.getAsString();
                }
                if (!isEmpty(url)) {
                    apiLines.add(HistoryHelper.buildApiLine(name, url));
                }
            }
        } catch (Throwable ignored) {
        }
        return apiLines;
    }
    String clanContentFix(String lanLink, String content) {
        String fix = lanLink.substring(0, lanLink.indexOf("/file/") + 6);
        return content.replace("clan://localhost/", fix).replace("file://", fix);
    }
boolean switchApiCollectionIfNeeded(String apiUrl, String jsonStr) {
        ArrayList<String> apiLines = parseApiCollection(jsonStr);
        if (apiLines.isEmpty()) {
            return false;
        }
        String firstApi = history.getApiLineUrl(apiLines.get(0));
        if (isEmpty(firstApi) || firstApi.equals(apiUrl)) {
            return false;
        }
        preferences.put(PreferenceKeys.API_LINE_LIST, apiLines);
        preferences.put(PreferenceKeys.API_LINE_SOURCE, apiUrl);
        preferences.put(PreferenceKeys.API_URL, firstApi);
        history.setApiHistory(apiUrl);
        String liveApiUrl = preferences.get(PreferenceKeys.LIVE_API_URL, "");
        if (isEmpty(liveApiUrl) || liveApiUrl.equals(apiUrl)) {
            preferences.put(PreferenceKeys.LIVE_API_URL, firstApi);
            history.setLiveApiHistory(firstApi);
        }
        return true;
    }
void clearApiLinesIfUnmatched(String apiUrl) {
        ArrayList<String> apiLines = preferences.get(PreferenceKeys.API_LINE_LIST, new ArrayList<String>());
        if (apiLines.isEmpty()) {
            return;
        }
        for (String apiLine : apiLines) {
            if (apiUrl.equals(history.getApiLineUrl(apiLine))) {
                return;
            }
        }
        history.clearApiLineList();
    }
}
