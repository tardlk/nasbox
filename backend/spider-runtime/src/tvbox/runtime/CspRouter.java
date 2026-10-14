// SPDX-License-Identifier: GPL-3.0-only
// Original getCSP; loaders are explicit host bindings.
package tvbox.runtime;
import com.github.catvod.crawler.Spider;import com.github.tvbox.osc.bean.SourceBean;
final class CspRouter {
 final JarExecutor jarLoader;final JsExecutor jsLoader;final PyUnavailable pyLoader=new PyUnavailable();String currentPyKey="";
 CspRouter(JarExecutor jar,JsExecutor js){jarLoader=jar;jsLoader=js;}
 static class PyUnavailable {void setRecentPyKey(String key){}Spider getSpider(String key,String api,String ext){throw new UnsupportedOperationException("Python execution is not implemented in this runtime");}}
    public Spider getCSP(SourceBean sourceBean) {
        if (sourceBean.getApi().endsWith(".js") || sourceBean.getApi().contains(".js?")){
            currentPyKey = "";
            return jsLoader.getSpider(sourceBean.getKey(), sourceBean.getApi(), sourceBean.getExt(), sourceBean.getJar());
        }
        else if (sourceBean.getApi().contains(".py")) {
            currentPyKey = sourceBean.getKey();
            pyLoader.setRecentPyKey(currentPyKey);
            return pyLoader.getSpider(sourceBean.getKey(), sourceBean.getApi(), sourceBean.getExt());
        }
        else {
            currentPyKey = "";
            return jarLoader.getSpider(sourceBean.getKey(), sourceBean.getApi(), sourceBean.getExt(), sourceBean.getJar());
        }
    }

}
