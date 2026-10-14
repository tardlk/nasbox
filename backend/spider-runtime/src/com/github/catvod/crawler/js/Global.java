// SPDX-License-Identifier: GPL-3.0-only
// Selected original globals. Timer ownership and native context limits are host bindings.
package com.github.catvod.crawler.js;
import com.github.catvod.Proxy;import com.whl.quickjs.wrapper.*;import java.util.*;import java.util.concurrent.*;import java.io.IOException;import java.net.URLEncoder;import okhttp3.*;import androidx.annotation.NonNull;
public class Global {
private QuickJSContext runtime;public ExecutorService executor;private final Timer timer;
private static final java.util.List<Timer> owned=java.util.Collections.synchronizedList(new java.util.ArrayList<>());
public Global(ExecutorService executor){this.executor=executor;this.timer=new Timer(true);owned.add(timer);}
public static void closeAll(){synchronized(owned){for(Timer t:owned)t.cancel();owned.clear();}}
@Function
public String getProxy(boolean local) {
        return Proxy.getUrl(local) + "?do=js";
    }
@Function
public String js2Proxy(Boolean dynamic, Integer siteType, String siteKey, String url, JSObject headers) {
        boolean local = dynamic == null || !dynamic;
        return getProxy(local) + "&from=catvod" + "&siteType=" + siteType + "&siteKey=" + siteKey + "&header=" + URLEncoder.encode(headers.stringify()) + "&url=" + URLEncoder.encode(url);
    }
private JSObject req(String url, JSObject options) {
        try {
            Req req = Req.objectFrom(JSUtils.toJsonObject(options).toString());
            Response res = Connect.to(url, req).execute();
            return Connect.success(runtime, req, res);
        } catch (Exception e) {
            return Connect.error(runtime);
        }
    }
@Function
public JSObject _http(String url, JSObject options) {
        JSFunction complete = options.getJSFunction("complete");
        if (complete == null) return req(url, options);
        Req req = Req.objectFrom(JSUtils.toJsonObject(options).toString());
        Connect.to(url, req).enqueue(getCallback(complete, req));
        return null;
    }
@Function
public void setTimeout(JSFunction func, Integer delay) {
        func.hold();
        timer.schedule(new TimerTask() {
            @Override
            public void run() {
                if (!executor.isShutdown()) executor.submit(() -> {func.call();});
            }
        }, delay);
    }
private Callback getCallback(JSFunction complete, Req req) {
        return new Callback() {
            @Override
            public void onResponse(@NonNull Call call, @NonNull Response res) {
                executor.submit(() -> {
                    complete.call(Connect.success(runtime, req, res));
                });
            }

            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                executor.submit(() -> {
                    complete.call(Connect.error(runtime));
                });
            }
        };
    }
@ContextSetter
public void setJSContext(QuickJSContext runtime) {
        this.runtime = runtime;
    }
}
