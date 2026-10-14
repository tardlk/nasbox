// SPDX-License-Identifier: GPL-3.0-only
package tvbox.config;
import com.google.gson.*;
import java.util.*;

/** Per-worker host adapter for the selected Hawk keys; no global/static state. */
final class PreferenceStore {
    private final LinkedHashMap<String, Object> values = new LinkedHashMap<>();
    PreferenceStore() { restore(new JsonObject()); }
    @SuppressWarnings("unchecked")
    <T> T get(String key, T fallback) { return values.containsKey(key) ? (T) values.get(key) : fallback; }
    void put(String key, Object value) { values.put(key, value); }
    void restore(JsonObject input) {
        LinkedHashMap<String, Object> next = new LinkedHashMap<>();
        for (String key : Arrays.asList("apiUrl", "liveApiUrl", "apiLineSource")) {
            next.put(key, input.has(key) ? input.get(key).getAsString() : "");
        }
        for (String key : Arrays.asList("homeApi", "defaultParse")) {
            if (input.has(key)) next.put(key, input.get(key).getAsString());
        }
        for (String key : Arrays.asList("apiLineList", "apiHistory", "liveApiHistory")) {
            ArrayList<String> list = new ArrayList<>();
            if (input.has(key)) for (JsonElement element : input.getAsJsonArray(key)) {
                list.add(element.isJsonNull() ? null : element.getAsString());
            }
            next.put(key, list);
        }
        values.clear(); values.putAll(next);
    }
    JsonObject snapshot() { return new Gson().toJsonTree(values).getAsJsonObject(); }
}
final class PreferenceKeys {
    static final String API_URL = "apiUrl", LIVE_API_URL = "liveApiUrl", API_LINE_SOURCE = "apiLineSource",
        API_LINE_LIST = "apiLineList", API_HISTORY = "apiHistory", LIVE_API_HISTORY = "liveApiHistory",
        HOME_API = "homeApi", DEFAULT_PARSE = "defaultParse";
}
