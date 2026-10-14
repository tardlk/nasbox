// Selected unchanged JsLoader lifecycle methods plus explicit artifact boundary.
import{readFileSync}from'node:fs';import{resolve}from'node:path';import{root,reference,sha256}from'./reference.mjs';import{verifyPlatformReference}from'./platform-reference.mjs';import{extractMethod}from'./oracle.mjs';
export function jsReference(){
 const{extra}=verifyPlatformReference();const loader=readFileSync(resolve(extra,'app/src/main/java/com/github/catvod/crawler/JsLoader.java'),'utf8');
 const signatures=['public synchronized Spider getSpider(','public synchronized void clear(','public Object[] proxyInvoke(','public static void stopAll('];
 const originals=signatures.map(s=>extractMethod(loader,s));
 const adapters=readFileSync(resolve(root,'scripts/compat/js-adapters.java.txt'),'utf8');
 return{source:`// SPDX-License-Identifier: GPL-3.0-only\npackage tvbox.runtime;\nimport com.github.catvod.crawler.*;import com.github.catvod.crawler.js.JsSpider;import com.github.tvbox.osc.base.App;import com.github.tvbox.osc.util.MD5;import com.github.tvbox.osc.util.LOG;import java.util.*;import java.util.concurrent.*;import java.nio.file.*;\npublic final class JsExecutor {\n${adapters}\n${originals.join('\n')}\n}\n`,extraction:signatures.map((signature,i)=>({signature,sha256:sha256(originals[i])}))};
}
export function globalReference(){
 const original=readFileSync(resolve(reference,'app/src/main/java/com/github/catvod/crawler/js/Global.java'),'utf8');
 const signatures=['public String getProxy(','public String js2Proxy(','private JSObject req(','public JSObject _http(','public void setTimeout(','private Callback getCallback(','public void setJSContext('];
 const methods=signatures.map(s=>extractMethod(original,s));
 const annotations=methods.map((m,i)=>['private JSObject req(','private Callback getCallback('].includes(signatures[i])?m:(signatures[i].startsWith('public void setJSContext')?'@ContextSetter\n':'@Function\n')+m);
 return{source:`// SPDX-License-Identifier: GPL-3.0-only\n// Selected original globals. Timer ownership and native context limits are host bindings.\npackage com.github.catvod.crawler.js;\nimport com.github.catvod.Proxy;import com.whl.quickjs.wrapper.*;import java.util.*;import java.util.concurrent.*;import java.io.IOException;import java.net.URLEncoder;import okhttp3.*;import androidx.annotation.NonNull;\npublic class Global {\nprivate QuickJSContext runtime;public ExecutorService executor;private final Timer timer;\nprivate static final java.util.List<Timer> owned=java.util.Collections.synchronizedList(new java.util.ArrayList<>());\npublic Global(ExecutorService executor){this.executor=executor;this.timer=new Timer(true);owned.add(timer);}\npublic static void closeAll(){synchronized(owned){for(Timer t:owned)t.cancel();owned.clear();}}\n${annotations.join('\n')}\n}\n`,extraction:signatures.map((signature,i)=>({signature,sha256:sha256(methods[i])}))};
}
