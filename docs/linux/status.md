# Migration status — 2026-10-15

Priority: subscription links and script execution behavior; player work deferred.

Next execution plan: [JAR compatibility continuation](jar-next-phase-plan.md).
The plan starts with a fresh frozen input batch and a complete current-image
matrix, then Android failure diagnosis, shared fixes and full method coverage.

Round 1 is complete: fresh capture/freeze (87 subscriptions, 204 role/signature
retrievals, 114 SHA artifacts: 111 valid and 3 invalid content) and 228 adjacent
old/final NAS executions are fully verified. Every valid input entered loading.
Primary baseline image f2f6208a (before ZXing repair): 95 loaded, 12 load failures, 4 load timeouts; 911 initialization
attempts, 644 ready and 2448 API/ext variants uninitialized. Old image: 93 loaded.
No definite failed-load regression; one old loaded / final timeout is unknown.
This is complete per-artifact execution on one selected role, not exhaustive
roles/ext or full business compatibility. See `jar-round1-baseline.md`,
`jar-round1-failure-priority.md`, `jar-round1-methodology.md`,
`jar-round1-freeze-v3.json`, `jar-round1-history.json` and the separate
latest-114 mapping `jar-round1-latest-history.json`.

Round 2 is active: original main/site signatures and configured main JARs are
preserved. Twenty-three fixed-input original-product ART cases completed with
23 loaded and 23 ready under ordinary application UID 10166; methods still have
empty/invalid JSON/business failures. Two selected artifacts lack their original
main JAR, and two are helper-only without an original CSP, explicitly unexecuted.
The original APK remains unchanged; official-version differences remain separate
from pinned-source parity. ART/ADB/fixture services stopped after collection;
NAS replay completed: 8 loaded and 6 ready out of those 23 failure-biased cases;
12 observed load failures (two with network causes unresolved), three without
observed completed load. Seven of nine paired successful JSON calls match;
invalid JSON, errors and unexecuted calls are separate. One worker-cleanup
failure is retained despite container-level process containment.

Fixed-source ART probe passed five owned binding cases and three byte scans:
missing DexNative returns false on pinned source and true in the official APK.
Three protection samples have corresponding static structure; no provider
runtime branch trace is claimed. Native constructor admission for d851 is a
confirmed unrepaired Linux gap. ZXing3.3.0 repairs the observed Wogg init blocker;
the same ART parameters return an equal empty home on the new derivative image.
Final repair image `808d15d8…` now has a complete adjacent 114/114-artifact rerun
against `f2f6208a…`: both 96 loaded, 12 failures and 3 timeouts among 111 valid
inputs; three invalid contents remain separate. Final image: 928 initialization
attempts, 640 ready, 2431 variants uninitialized. Repeated old image: 979/663.
Two previous ready entries timed out and left 22 later entries unexecuted. One
ready-to-failed candidate independently reproduces the same missing three-argument
Log.e ABI on both images, so is an unresolved conditional existing gap, not a
confirmed new-image regression. Original mismatches are retained. Wogg/Mogg
initialization improved. See `jar-round1-zxing-full-matrix.md`,
`jar-final-init-transitions.json` and `jar-final-init74-diagnostic.md`.
588/588 native-enabled host tests pass, no skipped tests.

| Work | Status | Evidence |
| --- | --- | --- |
| Win-Box checkout and working branch | Done | baseline.json; branch codex/linux-core |
| Android source candidate pinned | Done | TVBoxOS ab11d28: original 20-file snapshot plus 33 auxiliary TVBoxOS files; ten auxiliary AOSP Android 13 source files pinned separately |
| Historical Win-Box APK/version identification | Unconfirmed | Source method references match named files/line ranges; no unified APK pin found |
| Executable original-source reference probe | Done for selected methods | scripts/compat/oracle.mjs |
| Synthetic reference observations | Done | 65 config + 75 subscription + 39 state + 23 source load + 51 VOD + 10 VOD load + 85 full-state/query cases/scenarios |
| Probe and backend contract tests | Done within tested scope | 586 native-enabled Node tests passed at the fixed-method-tool checkpoint; earlier 497-test result retained below as historical evidence |
| Win-Box comparison | Initial audit done | config-comparison.json |
| Explicit backend core and scoped loaders | Initial modules implemented | 348/348 selected-method/scenario results match; actual platform bindings and Android async execution pending |
| Real Android/ART validation | Bounded original-product validation complete | android-runtime-probe.json: unchanged official ARM64 APK on Android 11 ART; 6 parser and 12 JAR cases plus UI import/category smoke; exact pinned APK unavailable |
| Subscription preparation/decrypt | Core stages implemented | URL/key, original FindResult/AES, AOSP JSON/Base64, clan/relative paths; Android network/provider parity pending |
| Source-scope collection/history/cache loading | Implemented and compared within stated scope | Original switching/history methods; new file store and CLI; 23 loadConfig scenarios use source-fields parse stub |
| Expanded VOD configuration prefix | Implemented as optional mode | Globals/spider, home/search sources, flags/parses/default selection; 51 prefix + 10 load scenarios; VOD mode intentionally ends before live |
| Full parseJson configuration state | Implemented as optional --config mode | 85 full-state/query results; live/hosts/proxy/rules/DOH/ads, partial reset and cleanup ownership; actual script/HTTP bindings pending |
| Spider/SpiderApi and controlled JAR/QuickJS execution | Initial executable contract slice | 136/136 fresh-source observations; actual JVM class JAR, QuickJS modules/bytecode, Java extensions, HTTP, restart and cleanup fixtures |
| DEX and protected initialization | Controlled host slice implemented | dex-runtime-comparison.json: 155/155 observations; raw/multidex/resources/cache and synthetic Java-unpacked nested payload; optional native profile below; ART unverified |
| Real subscription JS/module/HTML slice | Verified on host JVM | Three real JS sources init/home, exact fresh-source and live replays; original HTML globals, assets and module/cache routing |
| ARM native protected JAR | Executed on Mac and NAS | nas-native-runtime-probe.json: same captured JAR/config, 44/45 ready CSPs, five JSON homes, clear/reload and deadline cleanup; ART unverified |
| Linux x86_64 Docker core image | Delivered and verified on NAS | docker-runtime-probe.json plus nas-native-runtime-probe.json: non-root/read-only JRE, offline fixtures and real protected JAR |
| Native/Python and complete JS host parity | Pending | Optional ARM/JNI profile runs this JAR; complete Android services, other native artifacts, Python and complete ART comparison remain open |
| Linux container and NAS validation | Scoped validation done | Physical x86_64 NAS; genuine protected JAR init/home and timeout resource release; other architectures and full client unverified |
| Automatic subscription JAR retrieval/cache | Original-role routes implemented and verified on NAS | artifact-routes-probe.json: HTTP/image/assets/file/clan, cache identity/integrity/quota, real automatic init/home |
| Crash recovery and combined DEX/module cache quota | Implemented and verified on NAS | cache-lifecycle-probe.json: kernel leases, active-JVM guards, parent-death containment, cross-container PID-1 recovery, quota/pin/eviction checks |
| Broad real JAR catalogue matrix | Fresh baseline and final ZXing-image full rerun complete | jar-round1-zxing-full-matrix.json: 114 captured SHA artifacts, 111 valid, 96 loaded, 12 load failures, 3 load timeouts; one selected role per SHA, other role/ext and method coverage explicit |

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


Kernel ownership and aggregate runtime caches — 2026-10-15:

DirectoryLease uses native Java FileChannel locks, with permanent .lease/.users
inodes, rather than PID-only lock files. A tiny JRE helper owns the directory and
the executing JVM holds a shared usage guard. Live owners and surviving users
block takeover; process exit releases locks automatically. Workers monitor their
actual Node parent and halt when it exits, including during an endless call.
Old PID-only v1 files require explicit cold migration; new-format recovery does
not unlink/recreate lock files or guess that a PID is stale.

Translated DEX jar/digest pairs and original JS module-cache JSON share a default
256 MiB persistent budget, separate from the 128 MiB downloaded-JAR cache. LRU
reservation includes incoming persistent writes and protects active DEX files.
DEX pins conservatively last for the JVM lifetime. Optional module cache writes
retain original caught-failure semantics; fetched values remain usable and quota
rejections are observable. Conversion staging moved to root-specific OS temporary
directories, under Docker's separate /tmp tmpfs; native payload patches use their
own native/payload-cache namespace. Native rootfs/patches, plugin and other user
data remain outside these managed-cache budgets.

393 tests pass with native enabled. NAS verifies real SIGKILL/restart, orphan JVM
exit during an infinite callback, shared 2 KiB fixture budget with pinned DEX,
actual module eviction/write rejection and actual DEX quota failure without a
partial cache entry. Independent containers with Node PID 1 cannot steal a live
directory; after container SIGKILL a new PID-1 owner takes over. The final non-root,
read-only JRE image also passes offline doctor and imports/runs Aid home twice from
the supplied subscription, returning eight classes with 3,724,410 managed DEX
bytes, within the 256 MiB budget. See cache-lifecycle-probe.json.

NAS image tvbox-core:linux-amd64-cache-20261015 contains rebuilt Java17 classes
and the source changes. A temporary pinned ECJ compiler reused the existing JRE
for the NAS build; no compiler is retained. Only source and three prebuilt class
directories were assembled on the previous image, avoiding duplicate library
layers. Twelve executed source hashes match the checkout. Player/Web and complete
Android/ART compatibility remain unimplemented/unverified.

Next item: implement the remaining img+/assets/file/clan artifact routes with
original-source comparisons, then separate workers for multiple native artifacts
and expand real source/Android ART verification. Cache policies are host bounds,
not Android storage equivalence or a complete NAS disk quota.


Interrupted-batch resumption — 2026-10-15:

Rechecked the twelve current runtime source hashes and quota fixture. All 393
native-enabled host tests pass again, and the exact retained NAS JRE image passes
its offline doctor. Corrected the stale nasVerified flag with a bounded scope;
Android/ART remains unverified. Removed the interrupted batch's local ECJ/log
bundle and exact 19 MiB NAS temporary directory. The original four NAS containers
remain running, with no task container. See the report's resumptionVerification.


Remaining artifact routes — 2026-10-15:

Added original-role dispatch for image-wrapped main JARs and site assets/file/clan.
Image bytes follow the first original marker and AOSP DEFAULT Base64 states;
payload integrity/quota use decoded bytes, with a separate encoded-response cap.
Assets use the managed snapshot cache; local files remain caller-owned direct
paths, with external-storage precedence and explicit file-root fallback. Roots
cannot be escaped via traversal/symlinks, and nonregular files/FIFOs fail promptly.
Subscription and clan resolution share the caller's localAddress binding.

Fresh unchanged pinned ApiConfig/JarLoader/AOSP methods verify 34 route cases,
20 image vectors and 341 Base64 state combinations. 405 native-enabled host tests
pass, including actual HTTP charset/BOM responses, strict decoded digest, limits,
asset/file updates, file priority/FIFO rejection and complete session calls.
The new native regression removes automatic registrations before replacement
replay: old tokens and old auto-JAR mappings are invalid, explicit mappings remain.

NAS JRE image tvbox-core:linux-amd64-routes-20261015 passes offline doctor and runs
five fixture paths through home/resource calls, reimport and a fresh session.
Image and clan download only once; all five old tokens are rejected, and zero old
automatic registrations can instantiate a Spider after reset. The exact eight
executed Node source hashes match this checkout. The real strict-MD5 CLI also
downloads the current protected JAR and runs Aid home with eight classifications.
That CLI uses a bounded exec /data tmpfs because JNI extraction beneath explicit
runtime data needs execution permission. No user persistent volume was created.
See artifact-routes-probe.json and artifact-routes-oracle-probe.json.

This source-only NAS derivative adds 56,865 uncompressed bytes on the retained
cache image; its Java/native libraries and prebuilt classes are unchanged. It is
not a public/reproducible release. No main assets/file/clan-only branches or site
img+ branch are invented. Caller roots, path/size/transport guards and strict MD5
are explicit host policies, not Android filesystem/OkHttp/ART certification.
Local active JARs must be atomically replaced and reimported, not truncated in place.

Next: isolate multiple protected native artifacts in separate workers, then expand
real Linux JS/Python and category/search/detail calls with Android/ART same-input
comparisons. Dynamic helper JARs remain outside automatic interception. The existing
cc/XPathGuard failure and two prior full-home-response differences remain open.
Web and player remain deferred.


Public catalogue compatibility matrix — 2026-10-15:

The supplied public catalogue has 87 entries. Captured all of them, with 84 complete
imports and 8,401 accepted source references; one partial import retains 99 sites.
Its empty lives:[] failure is reproduced unchanged by the pinned Android parser,
including a minimal failing case. Two other rejected entries contain homepage/
retirement text. The separate custom catalogue endpoint also returns HTML.

204 role/signature retrievals produce 141 successful responses and 63 failures:
56 HTTP 401/403/404/423, four fetch failures and three 15-second timeouts. These
are acquisition observations, not JAR engine failures. Of 115 decoded SHA-unique
responses, 112 are valid ZIP/JAR; three are HTML/HTML/SVG. Seventeen contain native
libraries and ten contain guard payloads, spanning multiple fty/wex/secure/fish/
cat/stub variants. Six successful retrieval records advertise a different MD5;
Android-mode acceptance and captured SHA identity remain explicit, not strict
publisher-integrity success. No source code or raw provider home is committed.

All 115 artifacts were attempted in an independent-runtime NAS matrix. A corrected
75-artifact pass gives the first site initialization its cold-conversion budget
and covers six non-csp_ JAR-route variants. Initial 8-second site conversion
failures and 30-second main-load cutoffs are preserved as budget observations;
they are not classified as permanent incompatibility. Original bytes stay fixed
between passes. Both executed runner commits/hashes and actual per-artifact limits
are retained. Each SHA uses a chosen main/site loader role, not every mixed role.

Across both passes, 91 SHA artifacts have a confirmed loaded state, 74 have at
least one ready Spider, 51 return a nonempty home, 29 a nonempty category and 15
a nonempty detail. Distinct (JAR,API,ext) initialization attempts total 889, of
which 542 are ready. The captured inventory has 3,423 variants, so 2,534 remain
uninitialized, besides wider source-method/network/ART coverage. Two artifacts
are JS/Python helper-only and cannot be judged by a standalone CSP home. Among
112 valid inputs without positive load evidence, 14 explicitly fail this path
and seven remain unknown (timeouts or helper-only no CSP); this is not a general
incompatibility rate. Captured/live network and deadline effects remain separate.

Four targeted diagnostics confirm unresolved native getLoader readiness,
PROTECTED_INIT_UNBOUND, DEX_CONVERSION_FAILED and mixed/obfuscated JVM VerifyError
initialization chains. One protected sample also calls absent
android.app.Activity.isFinishing(); it has not been proven the sole root cause.
Diagnostics save only validated Java symbols/counts/hashes. Caught log exceptions
are not failed-source counts; two stack method names from the initial regex were
excluded by independent review and the local runner regex is corrected.

Reports: catalog-matrix-probe.md (all-JAR summary), catalog-matrix-probe.json
(metadata, exact passes/hashes/budgets) and catalog-review-probe.json (independent
inventory/parser/runtime audit). All 425 native-enabled host tests pass. The
matrix reused the existing routes image unchanged and introduced no permanent
service or compiler. Four unresolved original regression JARs plus a minimal
manifest are explicitly retained privately under .data/compat-regressions/
catalog-20261015 (2,189,517 bytes, about 2.09 MiB) for the next fixes; they are
ignored by Git. All other raw captures and task transport/build caches are removed.

Next compatibility work should target these reproducible protection/verification/
missing-API/DEX failures, then the remaining variants and Android/ART same-input
runs. Production multi-native-artifact worker scheduling, dynamic helper jars,
real Linux JS/Python and Web/API remain open. Player work stays deferred.


Fixed-input JAR repair results — 2026-10-15:

Committed 3ff2c81 addresses the four explicitly retained failure inputs. The
converter's boolean/reference conflict now retries only proven-zero single-entry
branches, with six owned semantic/control-flow regressions and a new cache version.
VerifiedJarRepair tracks exact NEW and constructor-this provenance and restores
provable ancestor forwarding chains before frame calculation. Eighteen synthetic
cases pass with -Xverify:all; custom/unknown/cross-branch cases remain untouched.
No JVM verification, source crypto/native call or failing method is skipped.

Observed Android host contracts now include Activity.isFinishing/finish and
findViewById over actual trees, and TextPaint's Paint superclass. No View is
invented when the host has no UI. The existing headless text-width approximation
is preserved; this is not Android rendering or a complete Paint SDK contract.

The small Amns JAR materializes an ARM library without embedding .so. Direct
System/Runtime.load(path) is now patched before class definition and passed to
unidbg using validated worker-owned ELF snapshots. Initialization exceptions stay
failures; unsupported name/instance native patterns fail explicitly. Native calls
and loads have lifecycle accounting. Close waits without holding either VM lock,
allowing guard→Java-thread→payload callbacks to finish; it atomically prevents new
calls at zero before destroying emulators. This fixed the observed Dynarmic
destruction race while keeping the separate VM locks required to avoid deadlock.

Final physical NAS image tvbox-core:linux-amd64-jarfix-20261015:

- 402f95 (夏夏影视): original DEX conversion failure is gone; three entrypoints
  initialize and return nonempty homes, with one nonempty category response.
- 198d4d (嗷呜/南风): three retained original-ext entrypoints now initialize and
  return nonempty homes/categories; process exits code0 with no signal.
- 0e0158 (王二小): genuine native getLoader/nested DEX is ready; three controlled
  entrypoints initialize, Local home works. Market/Bili homes remain untested
  because original provider/user ext was not retained; empty setup is not counted
  as homepage compatibility or an engine failure.
- 1ac653 (宝盒2线): unchanged Android heuristic still rejects its ordinary app-
  restart killProcess marker. Explicit jarInitPolicy:'declared' calls the real
  Init.init(Context), yielding three entrypoints/two homes/one category. Default
  and opt-in results are both retained; the opt-in is not Android-equivalent.

All five final probe workers close with exitCode0, exitSignal:null and verified
process/temporary-data removal. The exact image passes offline doctor and two
automatic strict-MD5 Aid sessions (second cached), each with the same eight
classifications. Eighteen executed source hashes match the checkout. 445 native-
enabled host tests pass. Reports are jar-repairs-probe.md and jar-repairs-probe.json.

The final JRE-only image is 513,806,227 uncompressed bytes (about490MiB), sharing
the routes image layers plus2,151,925 bytes of new source/classes. Temporary ECJ,
all17 task containers, two discarded candidate image tags, exact NAS directory,
SSH and local caches are removed. The four original regression JARs/minimal input
were SHA-verified and removed after these scoped repairs. No new service or
autostart was retained; existing development tools and rollback images remain.

The full115-artifact matrix has not been repeated after these fixes. Remaining
API/ext combinations, original provider configuration, indirect/native patterns,
formal multi-artifact workers and Android/ART same-input coverage remain necessary.
This records fixed causes and actual calls, not universal TVBox compatibility.


## Official APK and fixed-input continuation — 2026-10-15

The unchanged official ARM64 release APK was installed on an Android 11 ARM64 emulator. Separate same-certificate instrumentation called its original parser/JarLoader/Spider methods. Six captured raw configurations produced identical prepared bytes. Five accepted configurations matched all 342 observable source rows and four selected globals; the sixth failed on both hosts with the same exception type and identical 99-row partial state. Only `filterable` is excluded because this exact R8 APK eliminated its storage. Full configuration state and asynchronous UI lifecycle are outside that parser comparison.

Original settings imported a controlled one-source, hash-pinned Aid fixture. The original UI showed seven home classes and ten first-category items. Player execution remains deferred. The official APK declares a newer source commit than the pinned baseline, with a known ProtectedInitJar difference; original-product ART results do not certify the exact pinned source version. See android-runtime-probe.json and android-parser-comparison-probe.json.

The refreshed catalogue captured 114 exact SHA artifacts and ran 228 adjacent old/new NAS attempts. Four confirmed load regressions were repaired and all four replayed on the final image. The combined evidence across the complete earlier matrix and later subsets shows 93 loaded artifacts and 609 ready API/ext entries; these are different units, and this is not a complete 114-artifact run on the final image. Independent timeout checks recovered four previously hidden anime entries and Ddyy; XBPQ remains an unresolved timeout even under a separately labelled 30-second diagnostic.

The original ART comparison covers 12 cases across five JAR families and 26 observed methods. Its initial NAS replay had 17 paired successful JSON calls, of which 15 were byte/semantic identical; failures, invalid JSON and unreplayed methods are separately counted. The one confirmed executed-method blocker, PanConfigGuard.categoryContent, is repaired: final NAS home/category/detail all return JSON, including 12 category rows. Java2D logo PNGs differ from Android Skia, two status remarks and one detail content field also differ, so exact method equivalence remains unverified. The release-specific ProtectedInitJar change explains two additional initialization differences without changing the pinned Android default policy. See android-panconfig-repair-probe.json and post-repair-catalog-comparison.json.

## Configured scripts inside eight working-media JARs — 2026-10-16

Completed all 25 frozen configured scenarios across eight selected artifacts and
ten API classes on final image `808d15d8…`; no core or image change. Fifteen retain
their original main/site context: ART15 ready, NAS10 ready, nine with nonempty
business responses. Ten lack original main bytes and are separately labelled
standalone diagnostics: both hosts10 ready, NAS eight with nonempty responses.
All250 planned business slots remain visible, including12 not reached after ART
timeout. Main NAS observations are96 nonempty,29 empty,3 method timeouts and122
not-tested; default/unimplemented ART methods are separately identified.

Golden/SP33 is the sole original-context sample with all10 steps nonempty and
ART/NAS semantic JSON equality. Nmvod has eight implemented, parameterized steps
nonempty and equal; its recommendation method is unimplemented and filters lack
input. TuXiaoBei and Kugou have working subsets. BuKa/XBPQ has10 nonempty steps
only as a missing-main standalone diagnostic. Other variants have empty results,
timeouts or untested later calls. Player validation inspects return data only.

Five original-blocked cases additionally run with main deliberately omitted;
all are ready, with36 nonempty/8 empty/6 not-tested methods. They never replace
original coexistence failures. Nineteen independent remaining-method cases add
8 nonempty/1 empty/10 timeouts. Five earlier guard rejections happened before JAR
execution due to missing plan metadata, remain harness failures, and were rerun
under a new corrected plan. All49 accepted NAS cases closed/exited cleanly;
all54 task containers including rejected attempts were removed.

Static inspection lists354 structural Spider candidates, only ten configured;
the other344 have unknown ext and remain untested. See
`working-sources-summary-20261016.md`,
`working-sources-business-20261015.{json,md}`,
`working-sources-supplemental-20261015.{json,md}` and
`working-sources-static-inventory.json`. Resume from these exact private inputs
and responses for coexistence and method-timeout fixes; do not refetch or treat
nonempty data as proof that every embedded script or media URL works.

646 native-enabled host tests pass without skips. Task emulator/ADB/HTTP/NAS
containers/SSH and caches are removed; original services and shared tools remain.
Exact evidence is retained privately under
`.data/jar-working-sources-evidence-20261016` (12,447,337 logical bytes) until the
remaining fixes and final verification finish; both public reports rebuild
exactly from it. See `working-sources-cleanup-20261016.json` and environment.md.
