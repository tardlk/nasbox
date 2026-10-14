# Config-loading contract and current boundaries

Authority: pinned TVBoxOS ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1,
compat/reference/tvboxos/app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java.
These observations describe source, not verified Android/ART execution.

| Stage | Upstream contract | Current backend |
| --- | --- | --- |
| URL selection | configUrl rewrites file/clan, supplies missing http scheme, splits `;pk;` into request URL and key | `url` operation implemented; includes malformed/empty key quirks |
| Cache-first load | loadConfig may read cached UTF-8 lines; failed cache parsing falls through to network | Implemented for source-field parsing, using original MD5 key and Java byte/line decoding |
| Network | fetchConfigAsync uses configured OkHttp client and response.body().string(); HTTP failure or missing body is a fetch error | Bounded Node transport implemented; HTTP collection/fallback tested; Android transport equivalence pending |
| Decode | FindResult checks org.json object first, then eight-character salt/base64, ASCII trim, 2423 CBC envelope or configured ECB; its caught exceptions return the original input, while AES's own caught failures return null | Original FindResult/AES plus pinned AOSP helpers implemented; desktop BC supplies PKCS7; other Android/provider versions pending |
| Clan content | Original clan URL triggers clanContentFix before relative paths | `clanFix` implemented; preparation checks original URL exactly |
| Relative paths | fixContentPath uses original subscription URL, including quirks of global string replacement and doubled file slashes | Explicit JVM `fix` operation implemented and compared |
| Collections | switchApiCollectionIfNeeded extracts a JSON object for inspection; `urls` without `sites` can update persisted API lines/history and recursively select the first URL | Selected switching/history/clearing methods implemented with per-worker preferences and versioned host persistence; recursive source loads compared |
| Parse/reset | parseJson clears spider cache, selected source, source/live/parse lists and search state before Gson parsing | Source-only/VOD resets remain scoped; config-state runs original full reset with observable empty executor bindings and ordered owned-resource cleanup |
| Site fields | Required fields use direct Gson getters; safe optional getters preserve fallback/partial-list semantics; LinkedHashMap overwrites duplicate keys at original insertion position | Implemented with pinned Gson and Java source methods |
| Home source | Persisted home key wins when found; otherwise original first SourceBean is selected (may differ from a later duplicate replacement in the map) | Optional VOD prefix implemented; preserves duplicate/push_agent/stale-reference behavior |
| Globals/flags/parses | Global spider/jarCache/danmaku/wallpaper, flags, parses and default selection precede the live section | Optional VOD prefix implemented, including ParseBean getters/mixUrl and partial state |
| Remaining config | Live/hosts/proxy/rules/DOH/ads are processed by the rest of parseJson | Optional config-state mode executes full original body and selected helpers; actual HTTP/DNS/script effects remain unbound |
| Cache/failures | Network success parses before saving cache; parse failure reports a config error without fetch-error cache fallback. Fetch failure can fall back to cache | Implemented and compared within source-fields parser scope; cache write errors retain success; host atomic I/O differs from Android FileUtils |
| Script init | Config acceptance and referenced JAR/script download/init are separate stages | Explicit executable session now initializes mapped JVM class JAR/QuickJS sources lazily; automatic download, DEX/native/Python and full host bindings pending |

The `sites` backend operation deliberately accepts raw config text after any
caller-controlled decode/path stage. It neither trims a wrapped object implicitly
nor downloads referenced code. It returns the source map or the Java exception
class with the prefix accepted before failure. Every new sites request clears
the previous map even if Gson parsing fails. Other diagnostic operations preserve
that session map; unrelated Android global state is not modeled yet.

Run `node scripts/compat/backend-report.mjs` for the exact-result gate. This is
separate from the unchanged desktop Win-Box audit: desktop differences remain in
config-comparison.json, while the explicit backend is in
backend-config-comparison.json. Neither report is a full-client compatibility rate.

backend/subscription/prepare.mjs composes URL/key selection, decode, conditional
clan rewriting, relative fixing and collection recognition in upstream order.
It takes raw body text and performs no HTTP request or cache lookup. The development
HTTP probe also compares URL/decode/collection results now. Its Node transport
still explicitly converts bytes as UTF-8; OkHttp charset/BOM, TLS/DNS/proxy/cookie
and timeout behavior are outside current coverage.

backend/subscription/loader.mjs ports selected loadConfig control flow and uses
the full prepared body as its cache. It validates source fields only; successful
cache/collection tests do not certify parsing of other ApiConfig fields or script
initialization. Its source oracle executes unchanged loadConfig with planned
synchronous transport callbacks, temporary files and a source-fields parse stub.
That covers decision/order/state behavior under these adapters, not Android
Handler scheduling, concurrent cancellation, Hawk encryption or crash semantics.

The file store atomically replaces state/cache files. Original FileUtils deletes
the old cache before writing and swallows errors, so disk-failure/corrupt-file
outcomes are not claimed identical. The host also serializes imports and imposes
a collection hop limit. See subscription-loader-smoke.json for the real
48-source import and new-process cache check; temporary data is removed afterward.

backend/subscription/vod-loader.mjs adds the selected original VOD prefix as an
explicit optional parser. It shares subscription preferences and persists home/
default mutations even when a later parse fails. Six-field stores remain readable.
Its reference scope excludes all reset side effects except consumed containers,
and excludes processing from live onward. The 51 prefix/10 load scenarios compare
expanded partial snapshots and ordered transitions; 48-source real import/cache
counts are in vod-loader-smoke.json. This is not a script or full-client verdict.

backend/subscription/full-loader.mjs adds complete parseJson state and selected
live/network helpers. A dedicated source extractor/probe compares 85 ordered
observations and queries with frozen expectations; integration tests cover disk
restart, collections, partial-state cache preservation and cleanup failures. The
existing loadConfig oracle remains scoped to source/VOD parsing; full-mode integration
does not claim a separately executed Android asynchronous loadConfig sequence.

Empty executor clear bindings establish state order. RuntimeCleanup clears registered
owned resources before parse and stops at the first failed kind; the Java state
bridge replays the failed clear stage so old containers/warmed keys remain. No
script executor is installed. Unbound getSpider/loadLiveJar calls throw within the
original live helper's catch; an accepted parse can therefore retain incomplete
effects. HTTP reset is likewise incomplete. hosts/proxy/DOH selection and matching
are tested as state/helpers, not applied to Node fetch or a Linux network stack.

Next: controlled Spider/SpiderApi init/method fixtures, actual JAR/JS execution and
their required HTTP/Android bindings. Retain raw text through field conversion so
JavaScript numeric parsing cannot erase Gson behavior.

backend/spider-runtime/session.mjs composes the full configuration loader with
real JAR/JS runtime ownership. It resolves only caller-supplied artifacts/modules
or allowed local module files. Explicit VOD getCSP/method calls use original
routing, init ordering, cache identity and return mappings. Successful config
imports do not imply every source initialized, and script calls do not fulfill
unbound live/HTTP-reset config effects. HTTP fixture coverage of SpiderApi/selected
QuickJS globals does not certify subscription transport or parsed DNS/proxy rules.

The new 136-case runtime report is separate from the 348-case configuration report.
Fresh source probes share explicit host bindings with the independent committed
runtime, using actual JVM classes and pinned native QuickJS. Neither side runs
Android/ART. The ordinary-JS object-ext thread observation and asynchronous event
loop limits are documented rather than silently corrected from desktop assumptions.
