# Environment ledger — 2026-10-14

Existing tools were inspected before installing anything. The system java/javac
entries were macOS launcher stubs with no registered Java runtime. Docker, adb,
Maven and Gradle were not available on PATH.

| Item | Path | Purpose | Retention |
| --- | --- | --- | --- |
| Existing shared Node 24.19.0 | /Users/coke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node | Dependency-free Node tests and TypeScript loading | Unmodified shared tool |
| Existing Python 3.9.6 / git / curl | System tools | Source fetching, checkout and inspection | Unmodified shared tools |
| New Eclipse Temurin JDK 17.0.20.1+1 | /Users/coke/Desktop/Projects/tvbox-linux/.tools/jdk17 | Compile/execute original reference methods and independent backend config core | Project-scoped development environment; retained for ongoing migration |
| New Gson 2.10.1 | /Users/coke/Desktop/Projects/tvbox-linux/.tools/lib/gson-2.10.1.jar | Match the Android app's actual JSON library | Project-scoped development dependency; retained |
| New Bouncy Castle 1.78.1 | /Users/coke/Desktop/Projects/tvbox-linux/.tools/lib/bcprov-jdk18on-1.78.1.jar | Support the original AES/ECB and AES/CBC PKCS7 transformations on host JVM | Project-scoped dependency; about 7.94 MiB; retained for ongoing migration |
| New dex2jar 2.4 bundle (includes dx-30.0.2.jar) | /Users/coke/Desktop/Projects/tvbox-linux/.tools/dex2jar-v2.4 | Runtime DEX translation; bundled dx only generates owned test fixtures | Project-scoped; about 19.7 MiB; retained for ongoing migration |
| New jsoup 1.14.1 | /Users/coke/Desktop/Projects/tvbox-linux/.tools/lib/jsoup-1.14.1.jar | Original Android HtmlParser dependency | Project-scoped; about 0.40 MiB; retained for runtime development |
| Public Android reference snapshot | compat/reference/tvboxos | Fixed source and license evidence | Retained project source, about 263 KB of downloaded files |
| Auxiliary source snapshots | compat/reference/android-platform and compat/reference/tvboxos-extra | Android 13 JSON/Base64/Uri and original config/live/network helper sources | Retained source, about 628 KiB including licenses; runtime helper copies are also committed |
| Generated reference classes | .cache/compat/oracle | Temporary test build | Removed after verification; rebuilt automatically |
| Generated backend classes | .cache/backend/config-core | Temporary independent runtime build | Removed after verification; rebuilt automatically |

The project-scoped tool directory currently occupies approximately 340 MiB. Exact runtime
artifact versions and checksums are recorded in compat/toolchain-integrity.json.
The JDK archive SHA-256 was verified against the official Temurin GitHub release
asset digest before extraction. Gson was verified against Maven Central's SHA-1,
and its SHA-256 is pinned for subsequent executions. Bouncy Castle was likewise
verified against Maven Central's SHA-1 before retention and its SHA-256 is checked
before reference/runtime compilation. Its license was extracted from the pinned
jar's own LICENSE class. No separate JDK, Maven, Gradle or Android SDK was installed
for the subscription work; existing tools were checked and reused first.

The JDK archive and temporary download/checksum files were removed. No system
JDK registration, package-manager change, PATH modification, background service
or autostart entry was created. No Node/Electron dependency installation was
needed. Shared Codex runtime tools were neither modified nor removed.

Run from the project root using the existing Node path, or any Node 24+ on PATH:

```sh
/Users/coke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/compat/typescript-loader.mjs --test compat/*.test.mjs
```

On another host, provide a JDK using TVBOX_JAVA_HOME or PATH. The runner uses the
platform's classpath delimiter. Provide the pinned Gson jar at .tools/lib or via
TVBOX_GSON_JAR, and Bouncy Castle via TVBOX_BC_JAR or its .tools/lib path. The local
macOS JDK is not a Linux deployment artifact.

Four test-only HTTP listeners bound to 127.0.0.1 on ephemeral ports were started
and closed by the transport tests, including their failure paths. Reference JVM
processes exit after each batch. Backend worker tests/probes create temporary JVM
children and close them, including startup failure and response-limit failure
paths. No persistent service was started. The only additional binary dependency
in the previous decode batch was the project-local Bouncy Castle jar. The state/cache
batch reused it and the existing JDK/Node; no additional tool was installed.
The VOD-prefix batch likewise reused those tools and added source code only.

Disk-store tests created temporary tvbox-store-* directories under the OS temp
directory, then removed each in finally. Source loadConfig probes created
temporary synthetic cache files inside their .cache/compat/oracle build directory
and deleted them after each scenario. The real CLI import/cache restart check
used .cache/cli-validation (about 14 KB of state and prepared subscription bytes)
and was cleaned after verification; only aggregate counts remain in docs/linux.
VOD restart tests similarly used tvbox-vod-* directories and removed them in
finally. The optional --vod real CLI check used .cache/vod-cli-validation and
removed its state/prepared payload after recording aggregate counts. No real
subscription payload or URL/key-bearing preference file is committed.

The delivered CLI defaults to .data/subscriptions for future user-run persistent
state/cache; it is ignored by Git. No retained .data directory was created during
this batch. Stored data size depends on imported subscriptions and is not bounded
in aggregate; files have explicit limits and the owning user controls retention.

Temporary subscription response bytes/decoded content and generated Java classes
under .cache were removed after extracting metadata and verification results.
Services still running: none. Autostart changes: none.

The full-configuration batch inspected/reused the existing Node/JDK/Gson/BC tools;
no binary, package manager environment, Android SDK or Docker was installed. Added
source snapshots include AOSP Uri/UriCodec and original TVBoxOS live/rule/proxy
helpers with pinned hashes/licenses. Retained auxiliary snapshot directories occupy
about 244 KiB (Android) and 196 KiB (TVBoxOS); these are project source, not services.
The full frozen synthetic observations occupy about 600 KiB. .tools remains about
317 MiB for continued development. No shared tool was modified.

Full-mode tests created/removed tvbox-full-* temporary directories and JVM children.
The real --config import and separate-process cache check used
.cache/full-cli-validation; its raw prepared payload/preferences were removed after
aggregate counts were saved to full-loader-smoke.json. Test build/cache outputs
were also removed. No .data directory was retained. Running services: none;
autostart changes: none. RuntimeCleanup fixtures used in-memory resources only;
no actual script engine or HTTP proxy service was launched.


## Spider runtime batch

Existing tools were checked first: the project Temurin JDK and shared Node were
reused, and Apple clang/clang++ 21.0.0 was already installed under
/Library/Developer/CommandLineTools/usr/bin. make was available; qjs, CMake, Docker,
adb, Maven and Gradle were not on PATH. No compiler, Node package, Electron,
Android SDK, DEX converter, Python environment or package-manager tool was installed.
The dependency's own native QuickJS source was compiled directly with the existing
compiler and JDK JNI headers; no standalone qjs executable was installed.

Six new project-local jars were downloaded from the exact Maven Central coordinates
in backend/spider-runtime/runtime.json, verified against published SHA-1 before
retention, and pinned by SHA-256 for every runtime/reference build:

| Added dependency | Retained path under /Users/coke/Desktop/Projects/tvbox-linux | Purpose |
| --- | --- | --- |
| OkHttp 3.12.11 | .tools/lib/okhttp-3.12.11.jar | Original SpiderApi and selected JS HTTP calls |
| Okio 2.8.0 | .tools/lib/okio-2.8.0.jar | Android baseline's OkHttp I/O dependency |
| Kotlin stdlib 1.4.0 | .tools/lib/kotlin-stdlib-1.4.0.jar | Okio runtime dependency |
| Kotlin common 1.4.0 | .tools/lib/kotlin-stdlib-common-1.4.0.jar | Declared Kotlin dependency |
| JetBrains annotations 13.0 | .tools/lib/annotations-13.0.jar | Declared Kotlin dependency |
| QuickJS wrapper-java 2.1.0 | .tools/lib/wrapper-java-2.1.0.jar | Exact source dependency's JNI-facing Java wrapper |

These jars total about 2.28 MiB. The retained .tools development directory now
occupies approximately 320 MiB (JDK/Gson/BC plus these jars). Binaries are ignored
by Git and retained for ongoing contract/runtime work. Existing shared tools were
not modified or removed. Licenses and attributions are in backend/spider-runtime.

Unmodified QuickJS wrapper 2.1.0 C++ and its exact QuickJS 2024-02-14 submodule
sources/licenses are retained under backend/spider-runtime/native/vendor (about
2.5 MiB) to reproduce macOS/Linux native builds without replacing the engine.
The source manifest records commits, file hashes and matching Maven Java sources.
This is source code, not a new background environment. Local native library and
Java products in .cache/backend/spider-native and spider-runtime are temporary;
the built library is macOS ARM64 and is not a Linux distribution artifact.

Native-source archives/checksum inspection material and extracted wrapper sources
were kept only under .cache and removed after verification. Synthetic JAR/class
builds and source-probe classes under .cache/compat/spider-* were removed as well.
The temporary worker directories tvbox-spider-* and test-owned tvbox-spider-store-*
/ tvbox-dex-fixture-* were cleaned by their owning tests. No .data directory was
retained. User-selected future --data/runtimeDataDir directories retain only
explicit runtime state, with size/ownership described in the module README.

Three additional test HTTP listeners used 127.0.0.1 ephemeral ports and closed in
finally. Runtime tests started JVM children, original per-spider Java executors,
managed daemon timers and the host OkHttp client; all were closed. Infinite-loop
and unresolved-Promise fixtures were killed by their process deadline and their
temporary directories removed. No actual subscribed source code was run. No
persistent listener, daemon, global PATH change, system installation or autostart
entry was created. Services still running: none. Autostart changes: none.


## Controlled DEX and protected initialization batch — 2026-10-14

Checked existing project lib directories, WinBox resources and PATH first: no
usable DEX converter/dx/Android SDK/adb/Docker was present. Retained the official
fixed dex2jar v2.4 archive's lib and LICENSE/NOTICE files under
/Users/coke/Desktop/Projects/tvbox-linux/.tools/dex2jar-v2.4 (19.7 MiB).
The release already includes dx-30.0.2.jar, so no duplicate D8/dx, Maven, Gradle,
SDK, emulator or package manager was installed. Existing Node/JDK/clang tools
were reused without changing system PATH or shared installations.

Archive URL, byte size, SHA-256 and every retained file's hash are in
backend/spider-runtime/dex/toolchain.json. The official release did not publish
an independent digest: these are locally pinned hashes of the HTTPS fixed-release
download, not independently authenticated upstream checksum claims. Licenses and
notices are preserved under backend/spider-runtime/dex/licenses (about 20 KiB).
No archive was retained. .tools now occupies about 339 MiB including the existing
JDK/Gson/BC/HTTP/QuickJS Java libraries; these are development dependencies retained
to continue the port. The dex2jar bundle is also needed by future Linux runtime
packaging; dx is test-only. Binaries remain outside Git.

The converter runs inside each worker's isolated classloader, so no detached
conversion process or service is created. Worker heap increased to 256 MiB;
input/expanded artifact limits, request deadline and staging cleanup are documented
in the runtime README. Owned worker directories and temporary test cache/tool
roots were removed in finally. Caller-owned persistent runtime data is retained
only when explicitly selected; its aggregate DEX cache quota remains future work.

351 tests passed; dex-runtime-comparison.json records 155 matching host observations.
Synthetic DEX/guard payloads, source-probe classes, local native/Java build outputs
and verification logs under this project's .cache were removed after validation.
No .data directory remains and no actual subscription JAR/JS code was executed.
All task-owned workers and temporary listeners are stopped. Services still running:
none. Autostart changes: none. No tools from other projects were removed.


## Real subscription JS/module validation batch — 2026-10-14

Existing tools and .tools/lib were checked first. Docker/adb/Podman/QEMU were not
available; no Android/Linux runtime was installed. Existing Node, JDK, Python,
curl and the retained dex2jar/baksmali bundle handled fetching and static DEX/ELF
inspection. Added only the Android baseline's jsoup 1.14.1 jar, 415,074 bytes
(about 0.40 MiB), at the project-local path listed above. Its published Maven
Central SHA-1 was verified and SHA-256 pinned in runtime.json and the integrity
ledger. MIT license was extracted from its META-INF/LICENSE. .tools totals about
340 MiB and remains retained for ongoing runtime work; shared tools are unchanged.

Five existing resources/js-lib source assets were verified against the fixed
Android commit and reused unchanged, with an assets manifest. No duplicate asset
runtime or package-manager dependencies were installed. Retained additional source
evidence is HtmlParser, StringUtils and AOSP Android 13 TextUtils; the latter is
source-only, with selected join-body/runtime tests. These are committed source
snapshots, not background environments. Auxiliary snapshots occupy about 628 KiB.

The actual subscription/global JAR, drpy engine, four remote dependency modules,
three rule bodies and baksmali inspection files were temporary under .cache or
owned tvbox-real-source-* directories. They were removed after verification;
only hashes, structure, ELF metadata and result counts remain in the report.
Real QuickJS code was executed for three init/home calls; the native-containing
JAR was inventoried and rejected before init, with no native execution/decryption.
Captured-input replays matched fresh-source and production and matched live
results. 363 tests passed; all temporary HTTP listeners and JVM workers closed.

Project .cache build/test material was removed after verification. No .data or
remote artifact cache is retained. jsoup and the previous development dependencies
remain for further work. Caller-selected future --data/runtimeDataDir may retain
module-cache JSON; aggregate persistent disk quota/eviction is still pending.
Services still running: none. Autostart changes: none. System PATH changes: none.


## ARM/JNI native JAR batch — 2026-10-15

Checked existing PATH, project libraries and WinBox resources before installing.
Reused Node 24, project JDK 17, clang, Python, curl, dex2jar/dx/baksmali, BC and
QuickJS. Docker/Podman/QEMU/adb/Maven/Gradle remain unavailable and were not
installed. No global PATH, shared runtime or other project's tools were changed.

Added 22 Maven artifacts under
/Users/coke/Desktop/Projects/tvbox-linux/.tools/native-runtime (69,282,171 artifact
bytes, about 66.1 MiB; du rounds this directory to 65 MiB). This is a retained
project development/runtime dependency environment for ARM/JNI and headless JVM
compatibility: unidbg 0.9.9 android/api/unicorn2/dynarmic; Unicorn 1.0.15;
Capstone 3.1.8; Keystone 0.9.7; demumble 1.0.4; Commons Codec 1.21.0;
Fastjson 1.2.83; apk-parser 2.6.10; JNA 5.10.0; native-lib-loader 2.3.5;
SLF4J api/simple 2.0.16; ASM 9.7; Android API 4.1.1.4;
Commons IO 2.21.0; Commons Collections4 4.5.0; SQLite JDBC 3.46.1.0.
The first native dependency set follows WinBox; Commons IO/Collections are
required by the official unidbg API POM, and SQLite follows WinBox's pinned
version. The Android jar provides symbols/throwing stubs, not an Android system.
SQLite retains its Darwin/Linux payloads, unlike WinBox's Windows sanitizer.

Official Maven SHA-1 values were checked and all sizes/SHA-256 are pinned in
backend/spider-runtime/native-bridge/runtime.json and the integrity ledger.
fetch-runtime.mjs first verifies/reuses installed files and downloads only missing
ones; builds remain offline. Versioned POMs, available embedded license/notices,
source-header attribution, source-archive hashes and WinBox MIT attribution are
retained under native-bridge/licenses (about 400 KiB). Downloaded source archives
were inspected in memory and discarded. Binaries stay outside Git. .tools totals
about 404 MiB including earlier retained tools; these remain for ongoing port work.
Distribution license/source obligations are recorded in native-bridge/NOTICE;
no Docker/release image was produced.

The pinned source inputs are checked unchanged; generated host adaptations and
compile products are task caches. NativeLibLoader/SQLite extraction uses owned
worker/test tmp directories. Optional workers have a 768 MiB Java heap maximum
plus native emulator memory; no permanent OS environment was installed. Actual
ARM64 Dynarmic and Unicorn2 plus ARM32 Unicorn2 probes ran on macOS ARM64.
Bundled Linux x86_64 backend files were inventoried, not executed on Linux.

The real subscription JAR and decoded config, decrypted runtime DEX/classes,
extracted ARM libraries, native patches/rootfs, SQLite/preference data and raw logs
were temporary under project .cache/native-bridge or owned tvbox-native-* worker
folders. The source JAR started a temporary HTTP listener and plugin threads.
Native JAR reset now exits the entire old worker before replacement; all listeners
and remaining plugin threads disappear with that process. Default worker data and
all task-owned test dirs are deleted in finally; explicitly selected persistent
data is retained only at the caller's request. Only metadata/counts/hashes remain
in docs/linux/native-runtime-probe.json. No subscribed/decrypted code is committed.

365 tests passed with native integration enabled. Project .cache build/probe/test
material was removed after final validation; no .data or remote artifact cache
is retained. All task-owned JVMs, plugin listeners and temporary test services
are stopped. Services still running: none. Autostart changes: none. Shared tools
and unrelated project files were preserved.
