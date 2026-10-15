# Migration status — 2026-10-15

Priority: subscription links and script execution behavior; player work deferred.

| Work | Status | Evidence |
| --- | --- | --- |
| Win-Box checkout and working branch | Done | baseline.json; branch codex/linux-core |
| Android source candidate pinned | Done | TVBoxOS ab11d28: original 20-file snapshot plus 33 auxiliary TVBoxOS files; ten auxiliary AOSP Android 13 source files pinned separately |
| Historical Win-Box APK/version identification | Unconfirmed | Source method references match named files/line ranges; no unified APK pin found |
| Executable original-source reference probe | Done for selected methods | scripts/compat/oracle.mjs |
| Synthetic reference observations | Done | 65 config + 75 subscription + 39 state + 23 source load + 51 VOD + 10 VOD load + 85 full-state/query cases/scenarios |
| Probe and backend contract tests | Done | 386 Node tests passed with native profile enabled, including automatic artifact/cache/session tests |
| Win-Box comparison | Initial audit done | config-comparison.json |
| Explicit backend core and scoped loaders | Initial modules implemented | 348/348 selected-method/scenario results match; actual platform bindings and Android async execution pending |
| Real Android/ART validation | Pending | No APK/device/emulator runtime verification |
| Subscription preparation/decrypt | Core stages implemented | URL/key, original FindResult/AES, AOSP JSON/Base64, clan/relative paths; Android network/provider parity pending |
| Source-scope collection/history/cache loading | Implemented and compared within stated scope | Original switching/history methods; new file store and CLI; 23 loadConfig scenarios use source-fields parse stub |
| Expanded VOD configuration prefix | Implemented as optional mode | Globals/spider, home/search sources, flags/parses/default selection; 51 prefix + 10 load scenarios; VOD mode intentionally ends before live |
| Full parseJson configuration state | Implemented as optional --config mode | 85 full-state/query results; live/hosts/proxy/rules/DOH/ads, partial reset and cleanup ownership; actual script/HTTP bindings pending |
| Spider/SpiderApi and controlled JAR/QuickJS execution | Initial executable contract slice | 136/136 fresh-source observations; actual JVM class JAR, QuickJS modules/bytecode, Java extensions, HTTP, restart and cleanup fixtures |
| DEX and protected initialization | Controlled host slice implemented | dex-runtime-comparison.json: 155/155 observations; raw/multidex/resources/cache and synthetic Java-unpacked nested payload; optional native profile below; ART unverified |
| Real subscription JS/module/HTML slice | Verified on host JVM | Three real JS sources init/home, exact fresh-source and live replays; original HTML globals, assets and module/cache routing |
| ARM native protected JAR | Executed on Mac and NAS | nas-native-runtime-probe.json: same captured JAR/config, 44/45 ready CSPs, five JSON homes, clear/reload and deadline cleanup; ART unverified |
| Linux x86_64 Docker core image | Delivered and verified on NAS | docker-runtime-probe.json plus nas-native-runtime-probe.json: non-root/read-only JRE, offline fixtures and real protected JAR |
| Native/Python and complete JS host parity | Pending | Optional ARM/JNI profile runs this JAR; complete Android services, other native artifacts, Python and ART comparison remain open |
| Linux container and NAS validation | Scoped validation done | Physical x86_64 NAS; genuine protected JAR init/home and timeout resource release; other architectures and full client unverified |
| Automatic subscription JAR retrieval/cache | HTTP(S) slice implemented and verified on NAS | jar-artifact-cache-probe.json: 19 fresh-source cache/identity cases; real automatic init/home plus restart with one JAR download; managed JAR quota |

The 65-case audit contains 12 matching observations, 51 differing observations
and 2 cases where both sides reject but exception/state mapping is unresolved.
These are deliberately selected edge cases, often sharing the same underlying
cause. They are neither 51 separate bugs nor a real-world source compatibility
rate. No Android/Linux parity completion is claimed.

The supplied Fantaiying link was fetched successfully with an okhttp-style UA.
The declared MIME type was image/x-ms-bmp, while its magic bytes were JPEG and
its salt+base64 payload contained the configuration. A browser UA was redirected
to an HTML homepage. Selected original-source methods accepted all 48 source
definitions; the inventory contains 45 CSP/JAR and 3 JS sources. Source field
values still differ from desktop Win-Box. The new explicit backend's path fixing
and all 48 source-field results match the selected upstream methods on this
sample. That initial import batch did not execute downloaded code; later runtime
batches below did.

The initial desktop comparison exposed null coercion, boolean/integer conversion,
partial numeric strings, list conversion stopping at invalid entries, raw timeout
storage, duplicate source keys, required-field failure behavior, Gson's lenient
syntax and the upstream whole-text relative-path replacement.

The independent backend uses committed Java sources and pinned Gson directly,
without importing the reference extractor or desktop engine. The 348-case backend
gate passes, as do 17 additional live-reference requests covering state changes,
numeric lexemes and path cases. This does not close the desktop audit or certify
the rest of ApiConfig. See config-pipeline.md for the stage-by-stage boundary.

The 75 subscription cases cover malformed URL/key splits, org.json-first decode
ordering, Base64 padding/skipped characters, independently generated ECB/CBC
ciphertexts, failed decrypt nulls, UTF-8 plaintext and collection coercion.
AOSP Android 13 helpers are an auxiliary source baseline motivated by compileSdk
33, not a pin of the user's Android OS. Bouncy Castle 1.78.1 is the desktop crypto
provider, not Android's provider. prepareSubscription composes the covered steps
without fetching, caching or running referenced code. The HTTP probe now uses
that pipeline, including removing configured keys from the actual request URL.

The source subscription loader now performs collection switching/history updates,
cache-first reads, invalid-cache recovery and fetch-error fallback. Fresh parse
failure does not fall back to old cache. Keys use original MD5.encode of the
configured URL; bytes are cached after decode/path fixing and read with Java's
original line reconstruction. The versioned host file store survives worker
restarts and atomically replaces files. Its I/O/crash behavior is not Android Hawk
or FileUtils equivalence. Imports are serialized and collection cycles bounded.

The development CLI imported the supplied subscription and a new CLI process
loaded its disk cache, both returning 48 type=3 sources. The temporary data was
removed after verification. See subscription-loader-smoke.json. All loading
successes retain their explicit parser scope. The default mode remains source-fields.

The optional --vod loader now parses original global spider/jarCache/danmaku/
wallpaper, home/search sources, flags and parses/default selection. It preserves
upstream duplicate-home and stale-default object lifetimes and original ParseBean
proxy/ext formatting. Optional selection fields persist through restart and even
through later parse failures. The supplied subscription returned 48 sources, a
global spider and a selected home in this mode; a new CLI process reproduced those
counts from cache. No parses/flags were declared by that particular response.
See vod-loader-smoke.json; temporary prepared payloads were removed afterward.

VOD scope still ends before live/hosts/proxy/rules/DOH/ads. The separate --config
mode now runs the complete original parseJson body and selected live/network helpers.
It preserves live index quirks, typed player/timeout/header state, exact URI/Base64
processing, channel merging, hosts-map/DNS reference lifetimes, proxy ordering/auth,
rule grouping/matching, DOH preference resets and cumulative ads. AOSP Uri/UriCodec
are pinned separately; host-only Parcel/storage/permission bindings fail explicitly.

Its 85 ordered observations include failures and matching queries. Actual registered
resources clear in jar → py → js order before parsing; failure retains containers
and warmed-search state while active keys have already been cleared. No real
executor exists yet, so these lifecycle fixtures establish ordering and ownership,
not engine destruction compatibility. Standalone live TXT/M3U/native JSON helpers
are available through core operations, without downloading playlists or media.

The real --config import and separate-process cache restart both returned 48 sources,
one live group, three hosts, one rule host and four DNS options. See full-loader-smoke.json.
HTTP client rebuild remained an explicit incomplete effect. Node fetch does not yet
apply parsed hosts/proxy/DOH state; script initialization effects also remain unbound.
Successful config-state acceptance must not be interpreted as a runnable client.

The new backend/spider-runtime now executes controlled ordinary JVM JARs and the
actual QuickJS wrapper/engine used by the source dependency. Original Spider and
SpiderApi classes, selected JarLoader/JsLoader lifecycle and full JsSpider/Async
methods are compiled independently of the Win-Box runtime. JAR initApi precedes
init; webParse retains Base64 padding. Win-Box's reverse init order and padding
removal are not adopted. Cache identity follows Android's key behavior, including
same-key API/ext reuse until clear. This remains a host contract, not a port of
all Android services or plugins.

QuickJS wrapper-java 2.1.0 is pinned to its matching source tag and exact QuickJS
2024-02-14 submodule. Native version-67 bytecode tests cover bb and DRPY paths;
relative modules, cat cfg, legacy/default source modules, Promise return paths,
Java extensions and proxy streams run for real. Real local HTTP fixtures cover
SpiderApi multiReq ordering/six workers, forms, headers, error bodies, charset/BOM
and synchronous QuickJS HTTP/signed-byte/Base64 handling. A session composes
subscription import with lazy real VOD source calls and clears both actual runtime
registries before reimport. Java classloader/context/process resources are closed;
infinite loops and unresolved Promises are bounded by a process deadline.

136 runtime observations match a fresh source probe on the same explicit host
bindings. The earlier 348 configuration observations remain passing, for 484
scoped observations across the two reports; this is not a full-client compatibility
rate. The previous batch had 337 passing tests; the current total is 351. That batch did not download or execute real subscribed code.
See spider-runtime-comparison.json and backend/spider-runtime/README.md.

A source/JVM finding remains: ordinary JS object-ext initialization invokes parsing
outside the owning QuickJS thread and is silently caught, while cat cfg works.
The fixture preserves this observation; an Android APK/device comparison is needed
before drawing conclusions or changing behavior. General asynchronous HTTP/timer
execution, full HTML/crypto globals, remote code/cache behavior and Android APIs
remain incomplete. ready only describes an obtained instance/script object.
Subscription hosts/proxy/DOH and scripted-live configuration effects remain unbound.

Controlled DEX and protected initialization now run through an isolated pinned
dex2jar 2.4 boundary. The unchanged upstream ProtectedInitJar checks the original
DEX/ZIP, plain/AES package whitelists and binds Context and a real nested translated
DexClassLoader. An owned AES fixture confirms normal init was skipped, the payload
received siteKey/initApi/ext, optional hooks ran and clear destroyed/closed it.
Native-only protected init remains false/SpiderNull. No -noverify was enabled.

155/155 observations in dex-runtime-comparison.json are 136 mixed contract results
with the JAR fixture replaced by DEX plus 19 explicitly specified protection
observations on fresh-source and production helpers sharing the declared host.
This is not an Android compatibility rate or native-shell certification. Additional
integration tests cover raw/disguised/multidex, resources, signatures, dependency
integrity, cache identity/restart/rebuild, malformed/duplicate DEX and cleanup.
That batch had 351 passing tests and did not run actual subscription code. Worker heap is now 256 MiB;
persistent caller-owned cache quota and Android/ART verification remain pending.

Real subscription validation now identifies the concrete CSP blocker: the shared
1,254,922-byte JAR matches its advertised MD5 and contains ARMv7/AArch64 native
libraries plus an opaque 1,135,068-byte .guard payload. Admission returns
NATIVE_PLUGIN_UNAVAILABLE. The 45 CSP definitions depend on this one artifact;
they were not individually executed and native payload decryption is not supplied.
The upstream killProcess-based protection heuristic returns false for this artifact;
that does not make its independently detected native dependency executable.

The three actual JS sources initially failed on missing modules and pdfh. Original
HtmlParser + Global joinUrl/pd/pdfh/pdfa/pdfla, exact Android assets and selected
FileUtils module/cache methods now enable init/home. Huya/Douyu/Tuxiaobei return
4/9/4 classes. All three exact captured-input production/source replays match each
other and the live URL-ext results. Scope is classification/filters only; no
category/detail/search/player or full-client parity is inferred. The report records
hashes, ELF metadata and counters without retaining subscription code.

All 363 tests pass. Twelve new tests cover source bodies, HTML, aliases, real
relative HTTP imports, cache restart/debug/expiry/corruption, HTTP status/charset,
limits, offline host HTTP and session cleanup. Module mode is explicitly enabled;
JAR artifacts still require mappings. Current environment remains macOS ARM64.

ARM native batch — 2026-10-15:

The pinned WinBox bridge is now an optional backend classpath profile. The supplied
MD5-matching JAR registers eight native methods, executes AArch64 getLoader,
returns a genuine nested DexClassLoader, and executes ARM32 payload support.
In-process dex2jar/baksmali repair plus ASM frames keeps JVM verification enabled.
The Android layout-parameter hierarchy and original SpiderDebug overloads fix
observed payload VerifyErrors without disabling the verifier.

native-runtime-probe.json records 45 attempted CSP definitions: 44 ready Spider
instances; cc retains SpiderNull because XPathGuard is missing. Five real home
calls return JSON classification/filter/list data. This does not establish all
methods of all 44 sources. The Android app's readonly tv database is absent;
readonly opens fail and the plugin catches them. The report also retains class-loading,
HTTP and interrupted/background shutdown diagnostic counts; these are not full API
compatibility successes. No empty database is fabricated.

Native plugins start their own threads/listeners. Native JAR clear therefore
replaces the entire JVM, waits for exit, replays explicit settings and rejects old
generation tokens. Tracked sockets/callbacks/loaders/emulators are cleaned first;
process exit bounds remaining plugin resources. JS instances are also invalidated
by native-profile JAR reset. Ordinary workers keep their previous clear semantics.
The recorded clear changes PID, releases the listener and permits real reload.

All 365 tests pass with native tests enabled: the earlier 363 tests plus source
pins and optional native host/syscall/storage/lifecycle integration. Native tests
exercise ARM64 code, ARM32 signal/eventfd/epoll/proc/nanosleep, POSIX filesystem
bounds/symlinks, SQLite transactions, typed preference restart, queued callbacks,
translated listener shutdown, real process replacement and stale-token rejection.
The default suite skips the optional native integration without those dependencies.

Next batch planned after the Mac ARM batch (updated by subsequent batches below):

1. Verify the native profile on actual Linux x86_64 and compare real Android/ART
   behavior using the same JAR/config; preserve missing classes and unsupported
   APIs as diagnosed failures. No current Docker/NAS success is claimed.
2. Add production JAR retrieval/integrity/cache identity and persistent disk quotas;
   support multiple native artifacts via separate workers and expand real methods.
3. Package Docker and build the Web API/UI after the runtime has Linux evidence.
   Player work remains deferred. Full TVBox compatibility is still unconfirmed.


Linux x86_64 Docker core image batch — 2026-10-15:

Built a minimal multi-stage core image on the user's physical x86_64 NAS, with
pinned official Node/JDK/JRE image digests. No desktop/player/npm dependencies are
included. Build tools stay in the builder; the final non-root JRE image uses
prebuilt outputs and fails closed instead of recompiling on a missing cache.
Normalized artifact permissions make root-built caches readable to the runtime UID.
A stable provisioning layer checks/reuses dependencies and isolates source changes
from downloads. Corrected two duplicate manifest entries: 20 unique native JARs,
67,798,245 bytes; no duplicate physical files had been installed.

The actual final image passes offline config, QuickJS, DEX/resource, ARM64
Unicorn2/Dynarmic, ARM32 Unicorn2, worker replacement and stale-token checks with
network disabled, read-only root, UID 10001, dropped capabilities and a 2 GiB
memory limit. Native extraction requires exec on the owned /tmp tmpfs. javac,
clang and npm are absent. docker-runtime-probe.json records actual image ID,
base digests, architecture, constraints and results. Image size is about 483 MiB
in uncompressed layers; shared physical disk use may differ.

367 host tests pass, including JRE-only prebuilt-cache reuse/missing-output failure
and the complete offline doctor with compilers removed from PATH. The supplied
real protected JAR was not executed in this container batch. Next item is the
same-input real subscription/JAR comparison on Linux, followed by Android/ART
comparison and automatic production artifact/cache management. Web/player work
remains deferred.


Real protected JAR on NAS — 2026-10-15:

The subscription's JAR changed upstream. Captured the new 1,279,598-byte artifact
once (SHA-256 eba70fffdb728dd0657ef27b22d97de7530d96160e31bef6c08ccca21e479ab0;
MD5 25f4460aed52987f02865f02a1e83aa8 matches the advertised value), then reimported
the same captured subscription responses on Mac and NAS without refetching config
or JAR. This avoids comparing different upstream releases. All 48 definitions
parse; this execution batch covers the 45 CSP definitions, not the three JS ones.

The retained Linux amd64 JRE image runs the genuine native getLoader/nested DEX/
getSpider path. Both hosts create 44/45 Spiders; cc/csp_XPathGuard returns SpiderNull
on both. Five selected homes return JSON, with identical classification and filter
hashes. Full JSON matches three of five: WoGG differs, and Seedhub returns zero
list items on Mac versus 20 on NAS. Live source responses were not captured or
replayed, so the causes of those two full-response differences remain unresolved.
Ready is an obtained instance, not proof that every method works.

Clear replaces the JVM, invalidates old tokens and releases the bridge; reloading
the actual JAR and Aid home succeeds. A separate 15-second synthetic endless
QuickJS call, in a worker already initialized with the real native JAR, triggers
the deadline. Its worker exits, its one owned TCP/IPv6 listener can be rebound,
and its temporary data disappears. This is timeout containment evidence, not an
observation that the real source hangs. The probe reads both /proc TCP tables;
the initial IPv4-only counter was zero and was corrected/reverified separately.

nas-native-runtime-probe.json records both host reports, input hashes, comparison,
the separate deadline run and exact executed probe hashes. The updated research
probe was read-only mounted into the existing image; the image was not rebuilt.
It now preserves per-source/home errors, verifies captured-input integrity, rejects
different-input comparisons and fails its CLI gate on lifecycle/cleanup errors.
372 host tests pass with native integration enabled; no Android/ART execution
or category/detail/search/player compatibility is claimed.

Next implementation item: production subscription artifact retrieval, MD5/SHA
integrity, cache identity/update behavior and bounded persistent disk usage, wired
into the existing session rather than relying on a research probe. Android/ART
same-input validation, multiple native artifacts, Linux real JS verification and
Web API/UI remain outstanding. Player work stays deferred.


Automatic JAR artifacts and managed disk quota — 2026-10-15:

The executable session now lazily downloads HTTP(S) global/site JARs, retaining
explicit mappings as the first choice. It serializes cache access, checks SHA/MD5/
size sidecars before reuse, writes through temporary files and protects loaded
files from LRU eviction until successful runtime clear. Identity separates main
and site namespaces and preserves original string2MD5's UTF-16 low-byte behavior.
New subscription-cli.mjs and Docker `session` execute a selected source without a
manually downloaded JAR. Native registration replay forgets automatic paths after
clear, so later evictions do not break the next worker replacement.

Nineteen successful-load cache/URL-identity cases match fresh unchanged ApiConfig
loadJar, JarLoader.parseJar, FileUtils.isWeekAgo and MD5.string2MD5. The actual
expiry threshold is three days, not seven. Global useCache/jarCache and literal
MD5 rules differ from site remote-digest rules and are preserved. Android mode
does not uniformly reject a newly downloaded MD5 mismatch; strict mode explicitly
adds that check before execution. These are separate modes, not claimed parity.

Defaults are 64 MiB/artifact, 128 MiB/managed cache and 25 seconds/HTTP request.
Quota accounting includes JAR/sidecar pairs and temporary replacement peaks;
loaded and replaced files remain protected. Corruption recovery, remote failures,
strict mismatch, malformed JAR bounded retry, actual HTTP limits, restart/update
and native replay after eviction are tested. 386 tests pass with native enabled.

On the physical x86_64 NAS, a source-only derived core image automatically imports
the supplied 48-source subscription, downloads the advertised-MD5-matching real
protected JAR and executes Aid home. A new disk-cache session returns the same
eight classifications with one total JAR fetch. No manual JAR mapping is used.
The image's offline doctor also passes. jar-artifact-cache-probe.json records the
image lineage, exact Node source hashes, policy extraction and real run metadata.

Scope remains HTTP(S) binary JAR/DEX retrieval; img+/assets/file/clan still require
explicit mappings. Failed site downloads are surfaced rather than executing a
partial file; invalid-age global load refresh is bounded instead of upstream
recursion. SHA/atomicity/transport/quotas are explicit host additions. Crash-left
cache locks require confirming the previous owner has stopped before manual
removal; cross-container stale-lock recovery is not implemented. The quota is for
downloaded artifacts, not DEX/module/native/plugin files or the whole data volume.

Next runtime item: robust crash/restart cache ownership and aggregate DEX/module
cache limits, then the remaining artifact schemes and isolated native-artifact
workers. Android/ART same-input evidence, Linux real JS and broader source calls
remain necessary before full TVBox parity; Web API/UI and player are still pending.
