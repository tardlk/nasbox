# Attribution and adaptation

The backend and adapters are GPL-3.0-only; see LICENSE. Existing Win-Box desktop
files keep their original license and are used only as implementation references.
Do not distribute the combined port as MIT-only.

Original TVBoxOS code is pinned to q215613905/TVBoxOS commit
ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1. Spider.java and SpiderApi.java are unchanged.
ProtectedInitJar (unchanged), SpiderNull, Proxy, JsSpider, Async, Json, Req, Res, Connect, local, MD5, JSUtils,
ContextSetter, Function and net.js derive from that commit, with hashes in the
primary/extra compat manifests. JsSpider adds only native memory/stack bounds in
createCtx. Context/platform classes, control addresses, OkHttp provider, file/
module loading and Hawk string storage use explicit host adapters. They do not
implement the full Android framework, network setup or encrypted store.

JarExecutor retains selected original JarLoader initialization/cache/proxy/parser/
destruction methods. DexClassLoader type references become JvmJarClassLoader, a
parent-first URLClassLoader admitting class JARs or explicitly translated DEX. Artifact
registration/resolution, protected-loader admission and classloader closure are
host boundaries. ProtectedJarSupport exposes the unchanged upstream helper;
Context/package identity and dalvik.system loaders use explicit host adapters.
Remote MD5/week cache and native/ARM protection remain unimplemented. JsExecutor retains selected original JsLoader cache/get/proxy/clear
methods; JS API artifacts likewise use JVM class loaders. Timer ownership and
termination waits explicitly bound host resources.

Global contains selected unchanged getProxy/js2Proxy/req/_http/setTimeout/callback/
context and joinUrl/pd/pdfh/pdfa/pdfla methods. HtmlParser is unchanged;
StringUtils supplies selected original empty checks. SourceModuleLoader retains
unchanged FileUtils loadModule/getCache/setCache bodies over bounded host bindings.
Other Android Global APIs are not supplied. Its timers are owned,
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


Optional dex2jar 2.4 is from the official pxb1988/dex2jar fixed release; archive
and extracted hashes/size are in dex/toolchain.json. Its Apache-2.0 LICENSE and
NOTICE and the distribution's bundled third-party license text (including BSD,
ASM and other notices) are retained under dex/licenses (text line endings normalized). Binary jars are not
committed. The bundled dx-30.0.2.jar is used only in test fixture generation.
Pure-Java protected fixtures and classloader/cache bindings are project code;
they do not incorporate or emulate a proprietary native protection library.


jsoup 1.14.1 is the exact dependency declared by the Android baseline. Maven
Central's published SHA-1 was verified before SHA-256 pinning; its MIT license
from META-INF/LICENSE is retained as LICENSE-JSOUP. TextUtils.join retains the
Android 13 original body with parameter annotations omitted; its full source is
pinned for evidence and is not compiled into config-core. Apache-2.0 attribution
and license remain under compat/reference/android-platform and LICENSE-APACHE-2.0.

assets/manifest.json records fixed Android provenance and byte identity of five
existing resources/js-lib assets. Their original source files remain unchanged;
the build verifies hashes before copying them to the runtime classpath. This
manifest does not relicense upstream or embedded third-party components. No
remotely subscribed JAR, drpy engine, rule or dependency module is committed;
real-source-runtime-probe.json retains diagnostic metadata only.
