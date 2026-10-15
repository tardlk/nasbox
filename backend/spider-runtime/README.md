# Spider contract and executable host runtime

This module adds a working type=3 subscription → getCSP → method-call path using
JVM class JARs, translated DEX artifacts and the Android dependency's actual QuickJS engine. It is
GPL-3.0-only with the separate component licenses described in NOTICE.md.

Authority is TVBoxOS ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1. Current evidence is
selected-method comparisons on macOS ARM64 JVM, with separate Linux x86_64 NAS
init/home evidence below. Android/ART equivalence remains unverified.
136 fixed source-method observations match the independent committed runtime.
Real HTTP fixtures, native bytecode, worker restart, cleanup and deadline tests
are additional integration checks. This is an initial executable contract slice,
not completion of all TVBox scripts or Android host services.

| Area | Implemented boundary |
| --- | --- |
| Spider / SpiderApi ABI | Original classes and original method/default/overload behavior |
| CSP routing | Original case-sensitive .js / .js? / .py order; Python explicitly unsupported |
| JVM JAR | Parent-first URL class loading, Init hook, siteKey → initApi → init, original cache keys, methods, proxy and destruction |
| DEX | Isolated pinned dex2jar 2.4; raw DEX / ZIP / disguised filenames, multidex and resources; content/toolchain cache with digest verification |
| Protected init | Unchanged upstream ProtectedInitJar scanner, package whitelist/AES logic and Context/DexClassLoader binding; controlled Java-unpacked nested DEX fixture |
| QuickJS | wrapper-java 2.1.0 and its pinned native engine; original JsSpider/Async/JSUtils and selected JsLoader methods |
| JS source formats | Default object/factory, legacy assignment, __jsEvalReturn cat configuration, relative registered/local imports |
| JS bytecode | Original //bb transform and //DRPY module path, exercised with engine-produced version-67 bytecode |
| Host API | Original address/port/webParse/multiReq; headless orientation takes the original exception fallback (6) |
| JS globals | Original getProxy/js2Proxy/joinUrl/pd/pdfh/pdfa/pdfla/_http/setTimeout/context injection; original net.js and js.local |
| HTTP | Actual pinned OkHttp/Okio, synchronous JS HTTP and SpiderApi multiReq; local fixture behavior verified |
| JS Java extension | JVM class-JAR/translated-DEX Function/Method constructor and original annotated method binding |
| Ownership | Serialized process requests, registered runtime cleanup before reimport, context/classloader/process disposal |

DEX is translated to JVM classes, including dynamically opened DexClassLoader
payloads. The original file is passed to protected-JAR detection before init.
The default package identity is the pinned app's com.github.tvbox.osc.jun;
request({operation:'host',packageName:...}) can explicitly select another identity.
Packaged .so/.dll/.dylib and native library search paths are explicitly unavailable.
The dalvik.system adapters implement translation and ownership only: they are not
ART, a full Android classloader or an ARM/JNI emulator. Native-only protected init
fails instead of returning a ready Spider. Python is unavailable. Referenced
remote JARs are fetched only with the explicit remoteJars session option; remote JS modules are fetched only in the explicit module mode below. Remaining artifact schemes, full Android asset APIs, remaining crypto/translation globals, cookies, browser APIs,
subscription hosts/proxy/DOH application and live-script config effects remain
separate work. Java plugin execution uses a real JVM; it is not a security sandbox.

## Build

Use existing Node 24+, JDK 17 with headers and C/C++ compilers. Set TVBOX_JAVA_HOME
or JAVA_HOME for JNI headers, and CC/CXX when clang/clang++ are not available. This
builder does not install tools, run Gradle/CMake, fetch dependencies or build UI.
Provide the seven SHA-256-pinned jars in runtime.json under .tools/lib or
TVBOX_SPIDER_LIB_DIR, plus the config-core's existing Gson/BC prerequisites.

The JNI bridge is built from quickjs-wrapper tag 2.1.0, commit
cba8438a941254f28be5d706ae15bf70c286d045. Its Maven sources match the tag's Java
sources. The exact QuickJS submodule is c46516996da53eaf2f9aca516264870e25719d76
(VERSION 2024-02-14), with CONFIG_BIGNUM and the original CONFIG_VERSION flags.
Source hashes/licenses are in native/vendor/manifest.json. The local development library is macOS ARM64; the Linux build and runtime have
separately passed the NAS Docker checks described below.

Java/native build outputs are atomic, cached under .cache/backend/spider-runtime
and .cache/backend/spider-native, and may be removed after validation. Vendor
source is retained for reproducible platform builds; dependency binaries stay
outside Git. See docs/linux/environment.md for versions, disk use and cleanup.

DEX conversion optionally uses the exact official dex-tools-v2.4.zip bundle pinned
in dex/toolchain.json. Extract its lib directory, LICENSE.txt and NOTICE.txt into
.tools/dex2jar-v2.4, or set TVBOX_DEX_LIB_DIR to that layout. dex/toolchain.mjs checks
every retained file's SHA-256 before starting a worker. The release did not publish
an independent archive digest; the official HTTPS archive and extracted file
hashes were pinned locally. No tool is downloaded automatically. Without the
bundle, class-JAR/QuickJS execution remains available; DEX fails with
DEX_CONVERTER_UNAVAILABLE. An installed but corrupt bundle fails integrity checking.
Converter jars live in a separate platform-parent URLClassLoader inside the worker,
not the plugin classpath or a detached child process. The bundle's dx-30.0.2.jar is
used only to generate synthetic DEX fixtures from Java 8 classes.

## Direct execution

```sh
node backend/spider-runtime/cli.mjs --jar /path/to/spider.jar --api csp_Demo --method homeContent --args '[true]' --ext 'raw'
node backend/spider-runtime/cli.mjs --js /path/to/spider.js --method homeContent --args '[true]' --ext 'raw'
```

The CLI creates one worker and closes it on completion. Local JS imports must
resolve under the main script's directory. --data selects a caller-owned persistent
js.local store and verified DEX cache; otherwise temporary data is removed on close. Stdout is JSON; Java
plugin stdout is redirected to stderr to preserve the protocol. No HTTP proxy
listener, player, daemon or autostart is created. Generated proxy URLs describe
the configured control address but do not imply that a server exists there.

```js
import { createSpiderRuntime } from './backend/spider-runtime/index.mjs';
const runtime = createSpiderRuntime();
try {
  await runtime.loadMain('/path/to/ordinary-class.jar');
  const spider = await runtime.getCSP({key:'demo', type:3, api:'csp_Demo', ext:'raw', jar:''});
  const value = await runtime.call(spider.token, 'homeContent', [true]);
} finally { await runtime.close(); }
```

registerJar(signature,path) supplies a site/helper artifact. setModules({modules})
registers a URL → source map; setModules({root}) allows local files under that root.
Methods return the original strings/booleans/nulls rather than reparsing plugin
JSON. Proxy InputStreams are consumed/closed and represented as base64 plus length.
query returns `{ok,value}` or `{ok:false,errorType,message}`; request throws a
SpiderRuntimeError for the latter. getState reads registry state, clear('jar'/'js')
executes original destruction plus host resource disposal, and logs reads bounded
host diagnostics through request({operation:'logs'}). compileModule is a local
native-compiler diagnostic for controlled bytecode fixtures.

One runtime belongs to one serialized owner. ready means a Java instance or a
live JS object was obtained; it does not certify every required host capability
or successful JS initialization. Failed JS calls/casts retain original null/false
fallbacks. A failed JAR initialization yields SpiderNull, preserving the original
loader boundary. Source errors are distinct from host process/size/deadline errors.

## Subscription integration

```js
import { createExecutableSubscriptionSession } from './backend/spider-runtime/session.mjs';
const session = await createExecutableSubscriptionSession({
  artifacts: {'CONFIGURED_GLOBAL_SPIDER_SIGNATURE':'/path/to/ordinary-class.jar'},
  modules: {'https://example.invalid/demo.js':'export default {home(){return "ok"}}'},
});
try {
  await session.load({apiUrl:configuredSubscription});
  const {spider, value} = await session.call('SOURCE_KEY', 'homeContent', [true]);
} finally { await session.close(); }
```

The session parses full configuration state and initializes a selected source
lazily. Remote JS retrieval is opt-in; explicitly mapped DEX artifacts are
converted when opened. Real JAR/JS registries
participate in RuntimeCleanup before the next import, including imports that later
fail JSON parsing. A supplied runtime/core remains caller-owned; do not share it
concurrently. Subscription config effects (including HTTP reset and scripted live
initialization) remain explicitly unfulfilled; VOD method execution does not
retroactively mark them completed.

## Observed limits

The original ordinary-JS init calls ctx.parse(objectExt) outside its owning
QuickJS executor. On this host wrapper it throws and the original catch silently
skips init. Primitive/array text and cat cfg initialization behave differently and
are captured explicitly. Android behavior is not inferred from this probe.

Already-resolved/rejected Promise paths work. An unresolved Promise, infinite
loop or blocked async path is stopped by the host deadline; general asynchronous
HTTP/timer event-loop parity is not established. No change to those upstream
semantics is hidden as an optimization. Full Global HTML/crypto/persistent/browser
bindings and broader real source validation are required before declaring full JS compatibility.

Host constraints include 256 MiB JVM heap, 64 MiB per QuickJS context, 512 KiB JS
stack, 8 MiB protocol messages, 2 MiB proxy bodies and a default 10-second request
clock. The original JsSpider is changed only to set native memory/stack bounds
before compilation. Multiple contexts still require an aggregate NAS resource
policy. Host string persistence is versioned JSON with atomic replacement, not
Android Hawk encryption/crash equivalence. Closing attempts all owned resources;
timed-out workers are killed and their temporary data is removed.


## DEX and protection evidence

Run node scripts/compat/dex-report.mjs to reproduce dex-runtime-comparison.json.
The report has 155 matching observations: the existing mixed JAR/QuickJS 136-case
sequence with its class-JAR fixture replaced by a DEX archive, plus 19 specified
protection observations. The latter run on both the production copy and a freshly
copied upstream helper with the same explicit host bindings. A synthetic pure-Java
AES payload exercises real nested DEX loading, context/loader injection, optional
hooks, initApi/siteKey/ext propagation, calls and destroy/loader closure. It does
not establish compatibility with proprietary native protection. Additional tests
cover multidex, resource retention, cache reuse/rebuild, rejected native libraries,
malformed/duplicate DEX classes and dependency integrity. The DEX report uses owned
fixtures; actual subscription JS evidence is documented below. Android/ART and Linux x86_64/NAS comparisons remain necessary.
R8/obfuscated constructors, reflection and missing Android dependencies may fail;
verification is enabled and no WinBox -noverify/blank native success is adopted.

Artifacts are capped at 64 MiB compressed/input, 96 MiB expanded/converted and 8192
entries. Transformation staging is removed on success/failure; cache writes use
atomic moves. DEX cache keys include source SHA-256, converter pins and adapter
version; stored output digests are checked before reuse. Default owned worker data
(including cache and synthetic unpacked payloads) is removed on close or timeout.
Caller-owned --data/runtimeDataDir retains dex-cache/*.jar and .sha256 plus any
plugin-created files; aggregate persistent cache quota/eviction is still pending.
Clear closes nested classloaders but does not delete caller-owned data. One runtime
worker owns one conversion at a time. The process deadline includes conversion;
converter work cannot outlive that JVM in a detached process.


## Android JS modules and real subscription evidence

Enable the Android module boundary with setModules({android:true}); enable remote
HTTP(S) module retrieval with setModules({remote:true}). The default remains the
explicit registered/local mode. Registered modules take precedence. The enabled
mode uses unchanged pinned FileUtils.loadModule/getCache/setCache bodies with
bounded host I/O. Original gbk.js/模板.js/cat.js aliases, URL matching, seven-day
cache setting and debug bypass are preserved. The upstream expired-cache read
returns old data once while deleting the file; this is deliberately tested.
HTTP uses pinned OkHttp, closes every response, and retains response bodies for
HTTP error statuses plus charset/BOM handling. Remote URI validation, 6 MiB per
module, 32 MiB received/retained module budgets and atomic cache writes are host
bounds. Explicit registered module maps remain caller-controlled. The normal
worker request deadline covers all imports; raise runtimeTimeoutMs for a remote
session when necessary. clear('js') closes contexts and resets module budgets.

Five existing resources/js-lib assets were checked byte-for-byte against the
fixed Android commit; assets/manifest.json pins their source paths/hashes. Offline
builds verify them and copy them into the runtime classpath. No new copy of third
party source was downloaded into a persistent environment. A standalone package
must carry these manifest inputs. HtmlParser is an unchanged pinned original class,
using the upstream's jsoup 1.14.1 (MIT; LICENSE-JSOUP). StringUtils methods and
Android 13 TextUtils.join body are source-checked. Other Android assets/services
and the full Global surface are still incomplete.

```js
const session = await createExecutableSubscriptionSession({
  remoteModules: true,
  runtimeTimeoutMs: 60000,
});
try {
  await session.load({apiUrl: 'http://www.饭太硬.net/tv'});
  const result = await session.call('虎牙js', 'homeContent', [true]);
} finally { await session.close(); }
```

Run the explicit live probe (not part of offline tests):

```sh
node scripts/compat/real-source-probe.mjs 'http://www.饭太硬.net/tv' docs/linux/real-source-runtime-probe.json
```

This probe targets the supplied subscription's drpy dependency layout. It imports
48 sources, inventories the shared JAR without executing native code, runs the
three JS init/home paths, captures module/rule inputs temporarily, and compares
fresh-source and production replays. The replay passes captured raw rule text as
ext instead of a URL and disables the declared host OkHttp binding; both replays
also match the separately verified live URL-ext results. This HTTP control is not
a general Java sandbox. Only hashes/structure/counters are retained in the report;
remote JAR/JS/rule bodies and worker caches are deleted in finally.

Previous JS-only batch result: three ready JS sources return nonempty class/filter data (4, 9
and 4 classes); all three match fresh source and live replay exactly. Category,
detail, search and player behavior are not established. The 45 CSP definitions
share one MD5-matching JAR containing ARMv7/AArch64 libraries and an opaque .guard payload;
admission fails with NATIVE_PLUGIN_UNAVAILABLE. This is one artifact failure,
not 45 separately executed failures, and no native payload was decrypted. The
upstream ProtectedInitJar killProcess heuristic returns false for this artifact;
native admission is checked independently and remains unavailable in the ordinary profile. The optional native profile below now executes this artifact.
Android/ART, Linux x86_64, Docker and NAS execution remain unverified.

Caller-owned data retains module-cache/qjscache_<md5>.js JSON (data/expires) and
js.local/DEX state. Default temporary worker data is removed on close or timeout.
Persistent module-cache aggregate disk quota/eviction is pending, like DEX cache.
The automatic session JAR resolver is described below; no HTTP listener or autostart is added.


## ARM native JAR profile — 2026-10-15

The opt-in WinBox-derived ARM/JNI profile now runs the supplied protected JAR:
real native registration/getLoader, decrypted nested DEX translation/frame repair,
and real getSpider/init/calls. [Native profile guide](native-bridge/README.md)
describes provisioning, APIs, lifecycle, source adaptations and limitations.

```sh
node backend/spider-runtime/native-bridge/fetch-runtime.mjs
node backend/spider-runtime/cli.mjs --native --jar /path/to/spider.jar --api csp_FirstAidGuard --method homeContent --args '[true]' --timeout 45000
TVBOX_TEST_NATIVE=1 node --import ./scripts/compat/typescript-loader.mjs --test compat/*.test.mjs
```

createExecutableSubscriptionSession accepts nativeBridge: true plus explicit JAR
artifact mappings. Its native default request deadline is 45 seconds. JAR clear
replaces the entire native worker, invalidates JAR/JS Spider tokens and replays
explicit host/module/artifact settings. Owned data is deleted on final close;
caller-selected data persists. Default ordinary workers remain independent of
native dependencies and retain existing Android-source loader behavior.

The metadata-only native-runtime-probe.json records 44 ready instances out of 45
CSP definitions and five successful home JSON results. cc references unavailable
XPathGuard. Real registered native methods returned a DexClassLoader and 44
underlying Spider objects. Clear/reload changes the worker PID and releases its
listener. All 365 tests pass with native verification enabled. This is host macOS
ARM64 evidence, not Android parity certification or Linux/NAS/Docker validation.
That Mac-only batch preceded the automatic retrieval work below. Aggregate
runtime cache quotas and full API parity remain outstanding.


## Linux x86_64 Docker core image — 2026-10-15

[docker/README.md](../../docker/README.md) provides the pinned multi-stage image,
CLI commands and offline verification script. The final non-root JRE image has
passed on a physical x86_64 NAS with read-only root, no network and no compilers.
The synthetic doctor exercises config/QuickJS/DEX plus real ARM64 and ARM32
machine-code backends and worker replacement. Runtime outputs must be prebuilt;
missing outputs fail closed. See docker-runtime-probe.json for the image ID and
limits. Real protected subscription JAR execution also passes on NAS; see
nas-native-runtime-probe.json and jar-artifact-cache-probe.json. Android/ART
comparison remains pending.


## Automatic subscription JAR cache — 2026-10-15

The session now supports lazy HTTP(S) global/site JAR retrieval and bounded,
SHA-verified persistent caching. [Artifact guide](ARTIFACTS.md) explains the pinned
three-day age behavior, distinct global/site rules, Android/strict MD5 modes,
active-file protection, CLI usage and limits. The optional native profile works
with this resolver; manual JAR mappings are no longer required for HTTP sources.

386 tests pass with native integration enabled. Nineteen cache choices match
fresh unchanged Android methods; real class-JAR HTTP/session tests cover update,
restart, failure and native-worker replay after eviction. The physical NAS also
imports the supplied 48-source subscription, automatically downloads and strictly
checks its JAR, executes Aid home, then reproduces it from disk cache in a new
session with one total JAR fetch. See jar-artifact-cache-probe.json. This does not
certify other source methods, unsupported schemes, aggregate runtime cache quotas
or Android/ART behavior.


## Crash recovery and aggregate runtime cache — 2026-10-15

[Cache ownership and limits](CACHE.md) describes kernel leases, JVM usage guards,
parent-death containment, legacy migration and the combined 256 MiB translated
DEX/module budget. The 128 MiB downloaded-JAR budget remains separate. Native
payload patch files are kept outside the managed translated-DEX namespace.

393 tests pass with native integration enabled. New tests kill real owners/JVM
loops, block live takeover, recover abandoned staging, exercise combined quota
eviction/pins and run actual module/DEX quota rejection. The physical NAS passes
the same boundaries, cross-container PID-1 contention/kill recovery, real protected
Aid home across restart and offline doctor. See cache-lifecycle-probe.json.


## Image, asset, local-file and clan artifacts — 2026-10-15

[Artifact routes](ARTIFACTS.md) now preserve the distinct original global/site
branches: image-wrapped global JARs, copied site assets, direct local site files
and HTTP clan conversion. Storage roots and local file-service address are
explicit caller bindings. A fresh original-method oracle covers 34 route cases,
20 image vectors and 341 Base64 state combinations. Native import drops automatic
registrations before replacement-worker replay while retaining explicit mappings.

405 native-enabled host tests pass. The actual Linux amd64 NAS JRE image executes
five fixture routes through home/resource calls, reimport and restart; image/clan
download once, all five old tokens fail and no old automatic registration survives.
The same image's real strict-MD5 subscription CLI obtains Aid home with eight
classes; its offline doctor also passes. See artifact-routes-probe.json.
These are route and selected-call checks, not Android/ART or complete source parity.


## Fixed captured JAR repairs — 2026-10-15

The four failure inputs from the public catalogue now have positive runtime
evidence on the NAS. DEX boolean/reference zero-branch inference is repaired only
after the pinned converter reports that exact conflict. Proven NEW/ancestor and
constructor-this calls are repaired before frame calculation, preserving strict
JVM verification. The Android host supplies Activity finish/query contracts and
the TextPaint/Paint hierarchy needed by the captured code. Headless font metrics
remain the previous approximation, not Android rendering.

JARs with direct path-based native library loading can prepare their patch before
defining classes even without embedded .so files. Worker-owned ARM ELF snapshots
execute through unidbg; original initialization exceptions propagate. Name-based
loadLibrary and instance native signatures fail explicitly. Native shutdown now
waits for active calls/loads without merging the guard and payload VM locks,
allowing cross-thread JNI callbacks to finish before destruction.

The unchanged Android protection heuristic can reject an ordinary Init merely
because another method restarts the app via killProcess. Default behavior stays
Android-compatible. Explicit `jarInitPolicy:'declared'` (CLI `--jar-init-policy
declared`) calls the real Init.init(Context) for the tested ordinary contract
without recognized shell-loader bindings; this is a host opt-in, not parity.

445 native-enabled tests pass. Fixed-input NAS results, exact image/source hashes,
default-versus-opt-in comparisons and two automatic Aid cache sessions are in
docs/linux/jar-repairs-probe.json. They establish scoped loading/call/cleanup
repairs, not a rerun or certification of every catalogue source.
