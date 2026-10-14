// SPDX-License-Identifier: GPL-3.0-only
// Adapted from q215613905/TVBoxOS ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1.
// See backend/config-core/NOTICE.md and LICENSE.
package tvbox.config;
import com.google.gson.*;
import com.github.tvbox.osc.bean.SourceBean;
import java.util.LinkedHashMap;

final class ConfigParser {
    private final Gson gson = new Gson();
    private final LinkedHashMap<String, SourceBean> sourceBeanList = new LinkedHashMap<>();
    // Explicit host input replaces Android's ControlManager; no server is started.
    String localAddress = "http://127.0.0.1:9978/";
    String trimJsonObject(String content) {
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
    String fixContentPath(String url, String content) {
        if (content.contains("\"./") || content.contains("\"../")) {
            url=url.replace("file://","clan://localhost/");
            if(!url.startsWith("http") && !url.startsWith("clan://")){
                url = "http://" + url;
            }
            if(url.startsWith("clan://"))url=clanToAddress(url);
            content = content.replace("../", UriUtil.resolve(url, "../"));
            content = content.replace("./", UriUtil.resolve(url, "./"));
        }
        return content;
    }
    String clanToAddress(String lanLink) {
        if (lanLink.startsWith("clan://localhost/")) {
            return lanLink.replace("clan://localhost/", localAddress + "file/");
        } else {
            String link = lanLink.substring(7);
            int end = link.indexOf('/');
            return "http://" + link.substring(0, end) + "/file/" + link.substring(end + 1);
        }
    }
    JsonArray parseSites(String text) {
        sourceBeanList.clear();
        JsonObject infoJson = gson.fromJson(text, JsonObject.class);
        SourceBean firstSite = null;
        for (JsonElement opt : infoJson.get("sites").getAsJsonArray()) {
            JsonObject obj = (JsonObject) opt;
            if (!obj.has("key") || !obj.has("type") || !obj.has("api")) {
                // Incomplete source definitions are skipped, as on Android.
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

        return snapshot();
    }
    JsonArray snapshot() {
        JsonArray result = new JsonArray();
        for (SourceBean bean : sourceBeanList.values()) {
            JsonObject value = gson.toJsonTree(bean).getAsJsonObject();
            value.add("playUrl", value.remove("playerUrl"));
            value.add("click", value.remove("clickSelector"));
            value.addProperty("playTimeoutSeconds", bean.getPlayTimeoutSeconds());
            result.add(value);
        }
        return result;
    }
}
