# XML / JSON CMS sources

The Linux subscription session now dispatches type0 XML and type1 JSON sources
directly to this module. It does not load their global JAR or create a Spider.
Use the existing `backend/spider-runtime/subscription-cli.mjs` or Docker `session`
command with the original source key, method and arguments.

```sh
node backend/spider-runtime/subscription-cli.mjs --url CONFIG_URL --source SOURCE_KEY --method homeContent --args '[true]'
node backend/spider-runtime/subscription-cli.mjs --url CONFIG_URL --source SOURCE_KEY --method categoryContent --args '["CATEGORY","1",true,{}]'
```

The fixed TVBoxOS `ab11d289…` SourceViewModel HTTP branches and JSON model
conversion bodies are the authority. The source-only snapshot and hashes are in
`compat/reference/tvboxos-cms`. The six runtime model copies retain their JSON
conversion bodies; only XStream imports/annotations are removed. Gson2.10.1 and
JDK17 are the existing verified dependencies. No Python, Electron, new parser
package or Android library is installed. `buildCmsParser()` creates portable
Java17 classes; container builds precompile them and the JRE runtime fails closed
if the matching output is absent.

| Call | Protocol |
| --- | --- |
| `homeContent([filter])` | GET original API, return classes and initial list; no first-category fallback |
| `homeVideoContent([])` | Use original home list IDs for a separate detail request; no list means empty recommendation |
| `categoryContent([id,page,filter,extend])` | XML `ac=videolist`, JSON `ac=detail`, `t`, `pg`, individual filter fields and `f` JSON; empty filter still sends `f=` |
| `detailContent([[ids]])` | Detail action and joined IDs; nonempty original extend is resolved/cached and sent |
| `searchContent([keyword,quick,page?])` | XML sends `wd`; JSON also sends `ac=detail`; quick/page are not CMS protocol parameters |
| `playerContent([flag,id,vipFlags])` | Returns unchanged URL, source playUrl and baseline video-format parse decision; no media request |

The JSON wire projection uses `class`, `filters`, `list`, pagination and original
vod fields for consistency with the existing session API. It preserves nulls,
opaque IDs and play strings; it does not invent IDs from names or repair bad
server bodies. XML uses a documented JDK DOM binding that handles CDATA, entities,
list attributes and multiple `<dd flag>` lines, ignores unknown elements and
rejects DOCTYPE, external entities and XInclude. This is not a general XStream
implementation. Runtime serialization returns strings like the type3 path;
configuration descriptors indicate only validated configuration, not business
success.

HTTP is a bounded Node host adapter: default20s,6MiB response and5 redirects.
Charset/BOM decoding is explicit. Non-2xx, timeouts, malformed payloads and
unbound local ext fail explicitly; no retry through DoH or TLS bypass is added.
Runtime close aborts HTTP, and reimport clears recommendation/extend caches.
The pinned Android hosts/proxy/DOH/cookies, UI preferences/async cache behavior,
loopback external-storage root, push/header/thunder transformations and general
Android/ART equivalence remain outside this adapter. Python/type4 remain
unsupported. Search overload coverage does not establish search pagination.

`cms-doctor.mjs` checks both types through real loopback HTTP/session calls and
teardown on the NAS image with its network disabled. `cms-source-probe.mjs`
records private actual HTTP bodies, finite response-derived arguments and
separate success/empty/error/untested results. Complete responses can be replayed
with network disabled. A pre-response transport failure has no response bytes;
the current response-sequence replay cannot reconstruct it, and such a replay is
reported as incomplete harness input, never as source failure or success.

See `docs/linux/cms-delivery-20261016.md` and the per-method report for actual
results and the exact final image. Old JAR reports remain attached to their
historical image; the full JAR matrix is not repeated for this CMS addition.
