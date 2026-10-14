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
| Public Android reference snapshot | compat/reference/tvboxos | Fixed source and license evidence | Retained project source, about 263 KB of downloaded files |
| Auxiliary source snapshots | compat/reference/android-platform and compat/reference/tvboxos-extra | Android 13 JSON/Base64/Uri and original config/live/network helper sources | Retained source, about 440 KiB including licenses; runtime helper copies are also committed |
| Generated reference classes | .cache/compat/oracle | Temporary test build | Removed after verification; rebuilt automatically |
| Generated backend classes | .cache/backend/config-core | Temporary independent runtime build | Removed after verification; rebuilt automatically |

The project-scoped tool directory occupies approximately 317 MiB. Exact runtime
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
