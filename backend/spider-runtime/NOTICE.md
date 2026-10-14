# Attribution and adaptation

The backend and adapters are GPL-3.0-only; see LICENSE. Existing Win-Box desktop
files keep their original license and are used only as implementation references.
Do not distribute the combined port as MIT-only.

Original TVBoxOS code is pinned to q215613905/TVBoxOS commit
ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1. Spider.java and SpiderApi.java are unchanged.
SpiderNull, Proxy, JsSpider, Async, Json, Req, Res, Connect, local, MD5, JSUtils,
ContextSetter, Function and net.js derive from that commit, with hashes in the
primary/extra compat manifests. JsSpider adds only native memory/stack bounds in
createCtx. Context/platform classes, control addresses, OkHttp provider, file/
module loading and Hawk string storage use explicit host adapters. They do not
implement the full Android framework, network setup or encrypted store.

JarExecutor retains selected original JarLoader initialization/cache/proxy/parser/
destruction methods. DexClassLoader type references become JvmJarClassLoader, a
parent-first URLClassLoader admitting ordinary JVM class JARs only. Artifact
registration/resolution, protected-loader admission and classloader closure are
host boundaries; remote MD5/week cache and DEX/native protection are not claimed
implemented. JsExecutor retains selected original JsLoader cache/get/proxy/clear
methods; JS API artifacts likewise use JVM class loaders. Timer ownership and
termination waits explicitly bound host resources.

Global contains selected unchanged getProxy/js2Proxy/req/_http/setTimeout/callback/
context methods. Other Android Global APIs are not supplied. Its timers are owned,
daemon-backed and canceled on clear/close, instead of retaining unmanaged timer
threads. Source reference probes reuse these declared host bindings while freshly
extracting the pinned contract methods. They are not Android runtime validation.

UriUtil.java retains its original Apache-2.0 AOSP notice. org.json, Base64 and Uri
come from the separately pinned config-core AOSP sources. The JNI bridge derives
from HarlonWang/quickjs-wrapper 2.1.0 (Apache-2.0), commit
cba8438a941254f28be5d706ae15bf70c286d045. Its exact QuickJS submodule
c46516996da53eaf2f9aca516264870e25719d76 retains the QuickJS MIT license, copyright
Fabrice Bellard and Charlie Gordon. Both original licenses and file hashes are
preserved under native/vendor. Vendor sources are unmodified.

Separate dependency jars are not committed: OkHttp 3.12.11 / Okio 2.8.0 (Square),
Kotlin stdlib/common 1.4.0 and JetBrains annotations 13.0, and QuickJS wrapper-java
2.1.0 (Harlon Wang). Maven POMs identify their Apache-2.0 licensing; a copy is in
LICENSE-APACHE-2.0. Artifact URLs, sizes, Maven SHA-1 verification and pinned SHA-256
are in runtime.json and compat/toolchain-integrity.json. Gson/BC remain separately
licensed config-core dependencies.
