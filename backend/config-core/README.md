# Android-compatible configuration core

An explicit backend module for the Linux migration. It runs Java 17+ and the
Android baseline's Gson 2.10.1 without Electron. It currently covers safe field
conversion, source definitions, JSON parsing, object trimming and relative-path
fixing, subscription URL/key selection, original FindResult decryption and
collection recognition, selected collection/history state and cache utilities.
The scoped network/cache loaders are in ../subscription. The optional VOD prefix
covers global spider/jarCache/danmaku/wallpaper, home-source selection, flags and
parses. The optional config-state mode extends this to the complete original
parseJson body and selected live, host, proxy, rule, DOH and ad helpers. Actual
script runtimes and Android HTTP client bindings remain pending.

Preserve the raw configuration text when passing it to this module. Parsing it
with JavaScript first loses Gson numeric lexical values and overflow behavior.
The `json` inspection operation returns JS numbers over JSON; use `sites` on the
original text for source-field conversion. Each core instance owns one serialized
session. A failed sites load clears the previous source map and retains the prefix
accepted before the failure. Other operations leave that map unchanged.

Prerequisites: Node 24+, JDK 17+, pinned Gson and Bouncy Castle jars. The build is offline and
does not install anything. Supply TVBOX_JAVA_HOME (or JAVA_HOME/PATH) and
TVBOX_GSON_JAR and TVBOX_BC_JAR; the project's .tools paths are development fallbacks. Both Unix
and Windows classpath delimiters are supported. Current execution evidence is
macOS ARM64 host JVM only; Linux x86_64 Docker/NAS and Android/ART remain untested.

```sh
node backend/config-core/cli.mjs <<'EOF'
{"operation":"sites","text":"{sites:[{key:'demo',type:3,api:'csp_Demo',timeout:1}]}"}
EOF
```

```js
import { createConfigCore } from './backend/config-core/index.mjs';
const core = createConfigCore();
try { const sites = await core.parseSites(rawConfigText); }
finally { await core.close(); }
```

`query` accepts operations `sites`, `safe`, `json`, `trim`, `fix`, `url`, `decode`,
`collection`, `clanFix`, `state`, `collectionSwitch`, `clearLines`, `history`,
`cacheKey`, `cacheRead`, `fetchBody`, `siteState`, `vod`, `vodState`, `vodSource`,
`vodSearch`, `full`, `fullState`, `fullInspect`, `fullResetKeys` and returns
`{ok:true,value}` or `{ok:false,errorType,partialSites}`. `safe` is a diagnostic
operation with fixed fallback values. `parseSites` throws ConfigParseError with
the Java error class and partial source map. Multiple pending requests use IDs
and execute in submission order. Host timeout, process failure and protocol
errors reject pending requests and stop the worker. Input/output size limits and
a 128 MiB JVM heap bound the host bridge; these are host constraints, not Android
network equivalence. `fix` accepts `url`, `text`, optional `localAddress` (default
http://127.0.0.1:9978/); it does not start a control server.

`url` takes `url`, returns the upstream-selected request URL and key (including
null). `decode` takes `text` and optional `key`, returning a string or null as
FindResult does. `collection` returns the original name-tab-url lines, not a
persisted selection. `clanFix` takes the original clan `url` and body `text`.
Any operation can set the worker's `localAddress`. AOSP JSON/Base64 sources are
committed unmodified. Uri/UriCodec are also pinned AOSP sources; host Android
Parcel/storage/permission declarations fail explicitly if called. AES.java is the original
TVBoxOS file; desktop Bouncy Castle 1.78.1 supplies PKCS7 (not Android's provider).
UTF-8 is explicitly set for host byte/string conversions. JVM locale and all
Android/provider differences are not certified by these limited source probes.

`state` returns the six selected preferences, or restores them from `state` when
provided. `collectionSwitch` takes `url`/`text`, returns `switched` and the updated
preferences. `clearLines` takes `url` and clears unmatched collection lines.
`history` takes `kind` (api/live) and `entry`. `cacheKey` takes the configured `url`;
`cacheRead` takes base64-encoded raw `bytes` and uses Java UTF-8/BufferedReader.
`siteState` snapshots current source definitions without resetting them.
`fetchBody` takes `url`, `text`, optional `key`, combines decode/clan/relative
processing and returns `{success,text}` or `{success:false,error}` with Java's
fetch-preparation failure message. These preferences/cache operations are local;
they do not themselves perform persistence or network requests.

`vod` takes raw `text` and optional `url`, returning `{accepted,config,errorType?}`
as the operation value. Its config snapshot includes globals, sites, raw selected
home, flags, parses, default parse and home/default preference values. `vodState`
returns the latest snapshot; `vodSource` takes `key` and uses original getSource
(including the push_agent fallback); `vodSearch` uses original lazy search-source
filtering. `parseVod(text,apiUrl)` returns the config or throws ConfigParseError
with partialConfig and partialSites. Source-only and VOD views have separate maps.

This is the original parseJson prefix ending before the live section. Reset
adaptation clears its source/parse/search containers only; no script executor is
cleared. Original mHomeSource/mDefaultParse lifetime is preserved, including stale
references after empty/failed imports and duplicate source keys. ParseBean keeps
original getter/mixUrl methods, with its DefaultConfig import adapted to this
module. Effective proxy URLs use the explicit localAddress; mixed URLs retain raw
proxy prefixes and Android Base64 flags. Optional homeApi/defaultParse preferences
are restored without changing older six-field state snapshots when absent.

`parseFull(text,apiUrl)` executes the complete original parseJson method with host
bindings, returning a `config-state` snapshot or ConfigParseError with partialConfig.
`full` returns `{accepted,config,errorType?}`; `fullState` reads that state. Separate
source-only, VOD and full-state maps share the worker's selected preferences. Use
one mode per session. Initialization is lazy so legacy modes keep their old state.

The snapshot includes live channel/settings beans, hosts and the DNS host-map
reference, ordered proxy rules, grouped sniff/filter rules, M3U ad rules, script
rules, DNS names, cumulative ad hosts, typed preferences, active runtime keys and
effects. Missing rules retain previous rules; absent hosts reset hosts; ads accumulate.
Failures preserve mutations up to the original failure boundary. Live channel
merging and TXT/M3U/native JSON ingestion use original methods; `full` actions
`liveContent`, `lives` and `liveApi` expose them for local integration.

`fullInspect` takes `action`: `doh` with `index`; `proxy`, `ad`, `script` with `url`;
`video`/`filter` with `webUrl` and `url`; `userInfo` with proxy `host`. These execute
original selection/matching helpers. Proxy fallback is the host's existing Java
ProxySelector. They do not perform network requests or apply these settings to
Node fetch. Original live URLs can contain localhost:9978; no server is started.

Executor bindings currently contain no engines. Empty registry clears are recorded
in jar → py → js order, followed by warmed-search clearing in the original method.
Unbound getSpider/loadLiveJar calls throw at their original caught boundary and
remain `completed:false` effects. HTTP client reset is also an unbound effect.
Accepted configuration state does not mean those effects ran. `fullResetKeys` and
diagnostic `clearFailure` allow the subscription wrapper to preserve partial reset
state around real owned-resource cleanup; this is not yet executor compatibility.

Build products live in .cache/backend/config-core and can be deleted after use.
Builds publish completed classes atomically to avoid partial reads by other workers.
Always close workers in finally; the CLI closes on EOF. No background service,
autostart entry or script execution is created. See NOTICE.md for licensing.
