# Config-loading contract and current boundaries

Authority: pinned TVBoxOS ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1,
compat/reference/tvboxos/app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java.
These observations describe source, not verified Android/ART execution.

| Stage | Upstream contract | Current backend |
| --- | --- | --- |
| URL selection | configUrl rewrites file/clan, supplies missing http scheme, splits `;pk;` into request URL and key | Pending |
| Cache-first load | loadConfig may read cached UTF-8 lines; failed cache parsing falls through to network | Pending |
| Network | fetchConfigAsync uses configured OkHttp client and response.body().string(); HTTP failure or missing body is a fetch error | Probe uses bounded Node fetch only; not equivalent |
| Decode | FindResult checks org.json object first, then eight-character salt/base64, ASCII trim, 2423 CBC envelope or configured ECB; caught exceptions return the original input | Only observed salt/base64 transport probe; full behavior pending |
| Clan content | Original clan URL triggers clanContentFix before relative paths | Pending |
| Relative paths | fixContentPath uses original subscription URL, including quirks of global string replacement and doubled file slashes | Explicit JVM `fix` operation implemented and compared |
| Collections | switchApiCollectionIfNeeded extracts a JSON object for inspection; `urls` without `sites` can update persisted API lines/history and recursively select the first URL | Pending; do not pass collections to parseSites as a completed load |
| Parse/reset | parseJson clears spider cache, selected source, source/live/parse lists and search state before Gson parsing | Source map reset only; other state pending |
| Site fields | Required fields use direct Gson getters; safe optional getters preserve fallback/partial-list semantics; LinkedHashMap overwrites duplicate keys at original insertion position | Implemented with pinned Gson and Java source methods |
| Home source | Persisted home key wins when found; otherwise original first SourceBean is selected (may differ from a later duplicate replacement in the map) | Pending |
| Remaining config | Global spider/jarCache/danmaku/wallpaper, flags/parses/live/proxy and other settings are processed by the full ApiConfig | Pending; not silently dropped by a claimed full loader |
| Cache/failures | Network success parses before saving cache; parse failure reports a config error without fetch-error cache fallback. Fetch failure can fall back to cache | Pending |
| Script init | Config acceptance and referenced JAR/script download/init are separate stages | Pending |

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

Next: extend original-source oracle coverage to URL selection, decode and
collection/cache transitions, then implement those stages. Follow with controlled
Spider/SpiderApi init/method fixtures and script/JAR execution. Retain raw text
through field conversion so JavaScript numeric parsing cannot erase Gson behavior.
