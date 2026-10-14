# Spider contract and executable host runtime

This module adds a working type=3 subscription → getCSP → method-call path using
ordinary JVM class JARs and the Android dependency's actual QuickJS engine. It is
GPL-3.0-only with the separate component licenses described in NOTICE.md.

Authority is TVBoxOS ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1. Current evidence is
macOS ARM64 host JVM, not Android/ART, Linux x86_64, Docker or NAS execution.
136 fixed source-method observations match the independent committed runtime.
Real HTTP fixtures, native bytecode, worker restart, cleanup and deadline tests
are additional integration checks. This is an initial executable contract slice,
not completion of all TVBox scripts or Android host services.

| Area | Implemented boundary |
| --- | --- |
| Spider / SpiderApi ABI | Original classes and original method/default/overload behavior |
| CSP routing | Original case-sensitive .js / .js? / .py order; Python explicitly unsupported |
| JVM JAR | Parent-first URL class loading, Init hook, siteKey → initApi → init, original cache keys, methods, proxy and destruction |
| QuickJS | wrapper-java 2.1.0 and its pinned native engine; original JsSpider/Async/JSUtils and selected JsLoader methods |
| JS source formats | Default object/factory, legacy assignment, __jsEvalReturn cat configuration, relative registered/local imports |
| JS bytecode | Original //bb transform and //DRPY module path, exercised with engine-produced version-67 bytecode |
| Host API | Original address/port/webParse/multiReq; headless orientation takes the original exception fallback (6) |
| JS globals | Original getProxy/js2Proxy/_http/setTimeout/context injection; original net.js and js.local |
| HTTP | Actual pinned OkHttp/Okio, synchronous JS HTTP and SpiderApi multiReq; local fixture behavior verified |
| JS Java extension | JVM class-JAR Function/Method constructor and original annotated method binding |
| Ownership | Serialized process requests, registered runtime cleanup before reimport, context/classloader/process disposal |

Ordinary JARs must contain JVM .class entries. Packaged .dex/.so/.dll/.dylib files
are rejected before initialization. There is no DEX converter, protected-JAR
loader, Android native emulator or Python interpreter in this module. Referenced
remote JARs/modules are not automatically fetched. Artifact lookup, Android's
MD5/week cache behavior, full assets, HTML/crypto globals, cookies, browser APIs,
subscription hosts/proxy/DOH application and live-script config effects remain
separate work. Java plugin execution uses a real JVM; it is not a security sandbox.

## Build

Use existing Node 24+, JDK 17 with headers and C/C++ compilers. Set TVBOX_JAVA_HOME
or JAVA_HOME for JNI headers, and CC/CXX when clang/clang++ are not available. This
builder does not install tools, run Gradle/CMake, fetch dependencies or build UI.
Provide the six SHA-256-pinned jars in runtime.json under .tools/lib or
TVBOX_SPIDER_LIB_DIR, plus the config-core's existing Gson/BC prerequisites.

The JNI bridge is built from quickjs-wrapper tag 2.1.0, commit
cba8438a941254f28be5d706ae15bf70c286d045. Its Maven sources match the tag's Java
sources. The exact QuickJS submodule is c46516996da53eaf2f9aca516264870e25719d76
(VERSION 2024-02-14), with CONFIG_BIGNUM and the original CONFIG_VERSION flags.
Source hashes/licenses are in native/vendor/manifest.json. Linux build code is
provided but has not been run on Linux. The local library is macOS ARM64 only.

Java/native build outputs are atomic, cached under .cache/backend/spider-runtime
and .cache/backend/spider-native, and may be removed after validation. Vendor
source is retained for reproducible platform builds; dependency binaries stay
outside Git. See docs/linux/environment.md for versions, disk use and cleanup.

## Direct execution

```sh
node backend/spider-runtime/cli.mjs --jar /path/to/spider.jar --api csp_Demo --method homeContent --args '[true]' --ext 'raw'
node backend/spider-runtime/cli.mjs --js /path/to/spider.js --method homeContent --args '[true]' --ext 'raw'
```

The CLI creates one worker and closes it on completion. Local JS imports must
resolve under the main script's directory. --data selects a caller-owned persistent
js.local store; otherwise temporary data is removed on close. Stdout is JSON; Java
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
lazily. It does not implicitly download or convert code. Real JAR/JS registries
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
bindings and real source validation are required before declaring JS compatibility.

Host constraints include 192 MiB JVM heap, 64 MiB per QuickJS context, 512 KiB JS
stack, 8 MiB protocol messages, 2 MiB proxy bodies and a default 10-second request
clock. The original JsSpider is changed only to set native memory/stack bounds
before compilation. Multiple contexts still require an aggregate NAS resource
policy. Host string persistence is versioned JSON with atomic replacement, not
Android Hawk encryption/crash equivalence. Closing attempts all owned resources;
timed-out workers are killed and their temporary data is removed.
