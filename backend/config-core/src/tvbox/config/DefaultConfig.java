// SPDX-License-Identifier: GPL-3.0-only
// Adapted from q215613905/TVBoxOS ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1.
// See backend/config-core/NOTICE.md and LICENSE.
package tvbox.config;
import com.google.gson.*;
import java.util.ArrayList;
public final class DefaultConfig {
static String localAddress = "http://127.0.0.1:9978/";
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
public static String checkReplaceProxy(String urlOri) {
        if (urlOri.startsWith("proxy://"))
            return urlOri.replace("proxy://", localAddress + "proxy?");
        return urlOri;
    }
}
