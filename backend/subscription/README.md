# Subscription preparation

`prepareSubscription(apiUrl, body, options)` composes the URL/key selection,
FindResult decode, original-clan content rewriting, relative path fixing and
collection identification steps in their upstream order. The input body is a
string; do not preparse it with JavaScript JSON. Returns
`{requestUrl, text, collectionLines}`. The returned text is the prepared config,
not a claim that the entire configuration or its scripts have loaded.

```js
import { prepareSubscription } from './backend/subscription/prepare.mjs';
const prepared = await prepareSubscription(configuredUrl, rawBodyText);
```

Supply `{core}` to reuse a config-core worker; otherwise this helper creates and
closes one in finally. Optional `localAddress` supplies the Android control-server
address substitute. SubscriptionPreparationError includes the failed stage,
Java exception class and partial source map. It does not include the raw config
or key in its message. The helper opens no network listener and executes no code
from the subscription. The module is GPL-3.0-only, with source/license notices in
../config-core.

Collection lines preserve the original `name + tab + url` format, ordering and
coercion, including odd inputs. The preparation helper intentionally does not
auto-follow the list or call parseSites
on it as if it were a normal source configuration.

FindResult retains Android's org.json-first detection, AOSP Base64.DEFAULT,
2423 AES-CBC and configured-key AES-ECB, including null/fallback behavior and
truncating/padding keys as the original does. AOSP helpers are pinned to Android
13 source; desktop Bouncy Castle supplies PKCS7. These are host-JVM source-method
results, not proof of equivalence with every Android OS/provider/ART version.

The read-only development HTTP probe lives in scripts/compat/subscription-probe.mjs.
It now uses this module and compares URL/decode/path/collection/site results with
the reference. Its Node fetch and explicit UTF-8 byte conversion are not Android
OkHttp response-body charset/BOM decoding, TLS/DNS/proxy/cookie/cache equivalence.

## Source subscription loader

createSourceSubscriptionLoader in loader.mjs now performs network loading,
first-line collection switching, selected history updates and prepared-config
cache fallback. Its default parser only validates source fields. Full ApiConfig
globals, home selection and live/network rule state are handled only by optional
expanded modes below; a successful default load is explicitly `source-fields` scope.

```sh
node backend/subscription/cli.mjs 'SUBSCRIPTION_URL' --data /path/to/project-data
node backend/subscription/cli.mjs --cache --data /path/to/project-data
```

The CLI defaults to .data/subscriptions, ignored by Git. It prints counts and
scope, not full configurations or keys. With no URL it loads the persisted
selection. --cache prefers that selection's cache; otherwise network is attempted
first. State/cache data is retained until the owner removes the data directory;
no listener, autostart or background service is started. The CLI exits its JVM.

```js
import { createSourceSubscriptionLoader } from './backend/subscription/loader.mjs';
import { FileSubscriptionStore } from './backend/subscription/store.mjs';
const loader = createSourceSubscriptionLoader({ store: new FileSubscriptionStore(dataDir) });
try { const result = await loader.load({ apiUrl: configuredUrl, useCache: false }); }
finally { await loader.close(); }
```

The loader serializes entire import sequences. load returns `{ok:true,apiUrl,sites}`
or the upstream callback error `{ok:false,message}`; pre-callback URL failures
reject with the Java error class. getState/getSites expose current selected state.
`core`, `fetchText`, `parseConfig` and `onEvent` are injectable; the parser hook
returns source definitions. A provided core remains caller-owned and must not be
used concurrently outside the loader. Reused workers/store directories belong to
one loader at a time; cross-process file locking is not implemented.

The six selected preference fields use original switch/history methods through
a per-worker Hawk adapter. Existing history entries retain position. Cached
collections force the selected child to load with useCache=false. A failed fresh
parse reports a config error without old-cache fallback; failed fetch/decode/path
processing can fall back to cache. Cache writes follow successful parsing and
their failures do not cancel that success, matching original saveCache behavior.
Cache keys use original UTF-8 MD5.encode, including the configured key suffix.
Cache reads use original BufferedReader line reconstruction, including final LF
and malformed UTF-8 handling. Prepared text is cached, not the network envelope.

FileSubscriptionStore owns state.json and configs/<MD5> only, uses versioned JSON
preferences and atomic file replacement, and leaves corrupt state files intact
while reporting the error. This is a new host store, not Android Hawk encryption
or crash/disk-failure equivalence. It bounds each stored file to 8 MiB; the default
transport bounds bodies to 6 MiB/20 seconds, follows redirects and converts UTF-8
explicitly. A 32-hop limit stops collection cycles. These host limits, serialized
imports and atomic replacement differ from Android platform machinery; they do
not certify Android thread/cancellation/network or I/O-failure parity.

Validation includes 39 source-state cases, 23 original-loadConfig scenarios with
controlled synchronous callbacks and a source-only parser substitute, real local
HTTP collection/cache fallback, disk worker restarts and concurrent import order.
No referenced JAR, JS or Python code has been executed by this loader.

## Expanded VOD prefix

```sh
node backend/subscription/cli.mjs 'SUBSCRIPTION_URL' --vod --data /path/to/project-data
node backend/subscription/cli.mjs --vod --cache --data /path/to/project-data
```

createVodSubscriptionLoader in vod-loader.mjs uses the same load/cache control
flow, with the selected original ApiConfig prefix for global spider/jarCache/
danmaku/wallpaper, site fields, home selection, flags and parses/default selection.
Its scope is `vod-prefix`; source-only CLI behavior remains the default. getConfig
returns the latest expanded snapshot and getSites returns that parser's map.
The wrapper owns a core it creates, or leaves a supplied core caller-owned.

The prefix ends before live/hosts/proxy/rules/DOH/ads. It does not validate those
fields, run JAR/JS/Python, or clear executor caches. It must not be treated as full
ApiConfig success. The raw selected home/default references intentionally retain
upstream quirks across imports, including objects no longer in the current lists.
The synthesized super parse, duplicate-name last selection, push_agent lookup and
ParseBean ext/proxy URL formatting are compared to original methods.

Optional homeApi/defaultParse preferences are persisted with version-1 files,
including mutations made before a later parse failure. Older six-field files
remain readable. The default parser hook now persists selected state in finally;
failed expanded parses still do not overwrite cached text. 51 ordered prefix
observations and 10 load scenarios cover these behaviors, with separate disk
restart/failure tests. The real subscription VOD import and new-process cache
check are recorded in docs/linux/vod-loader-smoke.json using aggregate counts only.

## Full configuration state

```sh
node backend/subscription/cli.mjs 'SUBSCRIPTION_URL' --config --data /path/to/project-data
node backend/subscription/cli.mjs --config --cache --data /path/to/project-data
```

`createFullSubscriptionLoader` in full-loader.mjs uses the complete pinned
parseJson body and selected live/network helpers. Its scope is `config-state`.
getConfig exposes partial state after failures as well as accepted state. The CLI
prints aggregate live/hosts/proxy/rules/DOH/ad counts and unbound effect names;
--config and --vod are mutually exclusive. Default source-fields mode is unchanged.

The loader first clears active Python/live keys, then invokes RuntimeCleanup in
jar → py → js order before parsing any JSON. It stops at the first failed cleanup,
retains containers and warmed-search keys, and reports the original configuration
error callback. Shutdown attempts every remaining registered resource. The wrapper
owns its cleanup registry (including a supplied registry); a supplied core remains
caller-owned. A successful cleanup releases registered resources; future engines
must register newly owned resources when created. This registry supplies resource
ownership and ordering, not JAR/JS/Python engines or their destruction semantics.

Live script initialization and HTTP client rebuilds are explicit unbound effects.
The original live helper catches failed initialization, so accepted state can
contain an unfulfilled getSpider/loadLiveJar action and no live channel. Consumers
must inspect effects; `ok:true` does not certify executable source readiness.
Proxy/DOH/hosts state currently does not modify Node's subscription transport.
No local proxy endpoint, DNS resolver, media player or script worker is started.

85 fixed full-state/query observations cover repeated imports, partial failures,
proxy precedence/auth, DNS selection, rule matching, TXT/M3U/channel merging and
cleanup order. Integration tests additionally cover cleanup failure, collections,
fresh-parse cache preservation and typed preference restart. A real full-mode
import and separate-process cache restart returned the same 48 sources, one live
group, three hosts and one rule host; see docs/linux/full-loader-smoke.json. Raw
subscription bytes and temporary state were removed after verification.
