// Original full parseJson and selected helpers, with explicit host boundaries.
// Runtime copies are committed separately; oracle extraction is used only in tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, reference, verifyReference, sha256 } from './reference.mjs';
import { verifyPlatformReference } from './platform-reference.mjs';
import { extractMethod } from './oracle.mjs';
import { vodReference } from './vod-reference.mjs';

export function fullConfigReference() {
  verifyReference();
  const { extra } = verifyPlatformReference();
  const read = name => readFileSync(resolve(extra, 'app/src/main/java/com/github/tvbox/osc', name + '.java'), 'utf8');
  const api = readFileSync(resolve(reference, 'app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java'), 'utf8');
  const defaults = readFileSync(resolve(reference, 'app/src/main/java/com/github/tvbox/osc/util/DefaultConfig.java'), 'utf8');
  const network = readFileSync(resolve(reference, 'app/src/main/java/com/github/tvbox/osc/util/OkGoHelper.java'), 'utf8');
  const signatures = ['private void parseJson(String apiUrl, String jsonStr)', 'private void resetConfigData(',
    'public void clearLoader(', 'public void clearSpiderCache(', 'private void loadProxyRules(',
    'private void initLiveSettings(', 'public void refreshLiveApiHistoryItems(', 'public void loadLiveApi(',
    'public void loadLives(', 'private boolean mergeLiveChannel(', 'private LiveChannelItem findLiveChannel(',
    'private void mergeLiveChannelUrls(', 'private boolean isLiveSpiderApi(',
    'private void parseLiveConfigContent(String apiUrl, String content)', 'private boolean isLiveJsonContent(',
    'private void parseLiveText(', 'private String extractLiveTextEpg(', 'private String extractQuotedAttr(', 'private void parseLiveJson(',
    'private String trimJsonObject(', 'public static String getLiveGroupIndexKey(', 'public static int getLiveGroupIndex('];
  const originals = signatures.map(s => extractMethod(api, s));
  const methods = originals.map(s => s.replace('public static String getLiveGroupIndexKey', 'public String getLiveGroupIndexKey').replace('public static int getLiveGroupIndex', 'public int getLiveGroupIndex'));
  const vod = vodReference(api);
  const defaultAds = extractMethod(api, 'private void loadDefaultConfig(').split('// IJK解码配置')[0] + '\n}';
  const classBody = (text, name) => text.slice(text.indexOf('public class ' + name)).replace('public class ' + name, 'static class ' + name);
  const helpers = ['bean/LiveChannelGroup', 'bean/LiveChannelItem', 'bean/LiveSettingGroup', 'bean/LiveSettingItem', 'bean/ProxyRule',
    'util/net/OkProxySelector', 'util/RegexUtils', 'util/VideoParseRuler', 'util/live/TxtSubscribe'].map(name => classBody(read(name), name.split('/').at(-1)));
  let ad = classBody(read('util/AdBlocker'), 'AdBlocker');
  ad = ad.replace(extractMethod(ad, 'public static WebResourceResponse createEmptyResource('), '');
  helpers.push(ad);
  const m3u = read('util/M3u8');
  helpers.push(`static class M3u8 { ${m3u.slice(m3u.indexOf('private static final String TAG_DISCONTINUITY'), m3u.indexOf('private static final String TAG_DATERANGE')).trim()}\nprivate static final String TAG_DATERANGE = "#EXT-X-DATERANGE";\n${extractMethod(m3u,'public static boolean isAd(')}\n${extractMethod(m3u,'private static boolean isDouble(')} }`);
  const md5 = read('util/MD5');
  helpers.push(`static class MD5 { private static final java.security.MessageDigest sDigest; static {try{sDigest=java.security.MessageDigest.getInstance("MD5");}catch(Exception e){throw new RuntimeException(e);}} ${extractMethod(md5,'public static String string2MD5(')} }`);
  const dnsConstant = network.slice(network.indexOf('private static final String dnsConfigJson'), network.indexOf(';', network.indexOf('private static final String dnsConfigJson')) + 1);
  const dnsMethods = ['public static String getDohUrl(', 'public static void setDnsList('].map(s => extractMethod(network, s).replace('public static', 'public').replace('ApiConfig.get().getMyHost()', 'FullConfig.this.myHosts'));
  const sniffer = defaults.slice(defaults.indexOf('private static final Pattern snifferMatch'), defaults.indexOf('public static boolean isVideoFormat'));
  const defaultMethods = ['public static String safeJsonString(', 'public static int safeJsonInt(', 'public static ArrayList<String> safeJsonStringList(', 'public static boolean isVideoFormat('].map(s => extractMethod(defaults, s));
  helpers.push(`static class DefaultConfig { ${sniffer}\n${defaultMethods.join('\n')}\npublic static String checkReplaceProxy(String s){return tvbox.config.DefaultConfig.checkReplaceProxy(s);} }`);
  const adapters = readFileSync(resolve(root, 'scripts/compat/full-config-adapters.java.txt'), 'utf8');
  const fields = vod.fields.replace(/  \/\/ Adapter[\s\S]*$/, '');
  const observations = vod.observations.replace('JsonObject snapshot() {','JsonObject vodSnapshot() {').replace('Hawk.get(', 'Hawk.get(');
  // Only observation wrapper is replaced; parse methods remain unchanged.
  const observationPrefix = observations.slice(0, observations.indexOf('  void apply('));
  const source = `// SPDX-License-Identifier: GPL-3.0-only\n// Pinned TVBoxOS methods with host bindings. See NOTICE.md for scope.\npackage tvbox.config;\nimport com.google.gson.*;\nimport com.google.gson.reflect.TypeToken;\nimport com.google.gson.annotations.SerializedName;\nimport com.github.tvbox.osc.bean.SourceBean;\nimport com.github.tvbox.osc.bean.ParseBean;\nimport android.net.Uri;\nimport android.util.Base64;\nimport java.util.*;\nimport java.util.regex.*;\nimport java.io.*;\nimport java.lang.reflect.Type;\nimport java.net.*;\nimport java.util.concurrent.CopyOnWriteArrayList;\nfinal class FullConfig {\n${fields}\n${adapters}\n${methods.join('\n')}\n${vod.helpers.join('\n')}\n${defaultAds}\nclass OkGoHelper { final OkProxySelector selector = new OkProxySelector(); final ArrayList<String> dnsHttpsList=new ArrayList<>(); Map<String,String> myHosts; ${dnsConstant}\n${dnsMethods.join('\n')}\nvoid setProxyList(List<ProxyRule> rules){selector.clear();if(rules!=null&&!rules.isEmpty())selector.addAll(rules); effect("http.reset",new JsonArray(),false);}\n}\n${helpers.join('\n')}\nstatic Pattern getPattern(String regex){return RegexUtils.getPattern(regex);}\n${observationPrefix}\n}\n`;
  return { source: source.replace(/[ \t]+$/gm, ''), originals, extraction: { methods: signatures.map((signature, i) => ({ signature, sha256: sha256(originals[i]) })),
    scope: 'Host-JVM full parseJson; same pinned live/rule/proxy/DNS helpers. Empty executor clear hooks; unbound script init throws and is recorded. No Android/ART or actual OkHttp transport.' } };
}
