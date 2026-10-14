// SPDX-License-Identifier: GPL-3.0-only
package tvbox.config;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** JSON-lines host boundary. No network, Android classes or source execution. */
public final class ConfigWorker {
    private final Gson gson = new Gson();
    private final ConfigParser parser = new ConfigParser();
    private final SubscriptionConfig subscription = new SubscriptionConfig(parser);

    private JsonElement run(JsonObject request) {
        String operation = request.get("operation").getAsString();
        String text = request.has("text") && !request.get("text").isJsonNull()
                ? request.get("text").getAsString() : null;
        if (request.has("localAddress")) parser.localAddress = request.get("localAddress").getAsString();
        switch (operation) {
            case "url":
                JsonObject selected = new JsonObject();
                selected.addProperty("url", subscription.configUrl(request.get("url").getAsString()));
                selected.add("key", subscription.key() == null ? JsonNull.INSTANCE : new JsonPrimitive(subscription.key()));
                return selected;
            case "decode":
                String configKey = request.has("key") && !request.get("key").isJsonNull() ? request.get("key").getAsString() : null;
                String decoded = SubscriptionConfig.FindResult(text, configKey);
                return decoded == null ? JsonNull.INSTANCE : new JsonPrimitive(decoded);
            case "collection": return gson.toJsonTree(subscription.parseApiCollection(text));
            case "clanFix": return new JsonPrimitive(subscription.clanContentFix(subscription.clanToAddress(request.get("url").getAsString()), text));
            case "sites": return parser.parseSites(text);
            case "json": return gson.fromJson(text, JsonElement.class);
            case "trim": return new JsonPrimitive(parser.trimJsonObject(text));
            case "fix":
                if (request.has("localAddress")) {
                    parser.localAddress = request.get("localAddress").getAsString();
                }
                return new JsonPrimitive(parser.fixContentPath(request.get("url").getAsString(), text));
            case "safe":
                JsonObject object = gson.fromJson(text, JsonObject.class);
                String key = request.has("key") ? request.get("key").getAsString() : "value";
                JsonObject result = new JsonObject();
                result.addProperty("string", DefaultConfig.safeJsonString(object, key, "fallback"));
                result.addProperty("int", DefaultConfig.safeJsonInt(object, key, 17));
                result.add("list", gson.toJsonTree(DefaultConfig.safeJsonStringList(object, key)));
                return result;
            default: throw new IllegalArgumentException("Unknown operation: " + operation);
        }
    }

    public static void main(String[] args) throws IOException {
        java.security.Security.addProvider(new org.bouncycastle.jce.provider.BouncyCastleProvider());
        ConfigWorker worker = new ConfigWorker();
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        PrintWriter output = new PrintWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8), true);
        String line;
        while ((line = input.readLine()) != null) {
            JsonObject response = new JsonObject();
            try {
                JsonObject request = JsonParser.parseString(line).getAsJsonObject();
                response.add("id", request.get("id"));
                JsonElement value = worker.run(request);
                response.addProperty("ok", true);
                response.add("value", value == null ? JsonNull.INSTANCE : value);
            } catch (Throwable error) {
                response.addProperty("ok", false);
                response.addProperty("errorType", error.getClass().getName());
                response.add("partialSites", worker.parser.snapshot());
            }
            output.println(response);
        }
    }
}
