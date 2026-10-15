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

Added 20 unique Maven artifacts under
/Users/coke/Desktop/Projects/tvbox-linux/.tools/native-runtime (67,798,245 artifact
bytes, about 64.7 MiB; du rounds this directory to 65 MiB). This is a retained
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


## Linux x86_64 Docker core image batch — 2026-10-15

Checked local tools/apps/sockets first: no usable Docker, Podman, Colima, Lima or
QEMU was installed. Reused existing Node 24/JDK/clang, Python, tar/scp/ssh and all
project jars. No local container engine, VM, SDK, npm dependency or global tool
was installed. The user supplied a NAS; confirmed physical Linux x86_64, Docker
29.6.2, buildx 0.33.0 and four existing containers. Docker required a temporary
sudo session. No user/group, NAS DNS, Docker daemon, registry or autostart config
was changed. Connection address, username and password are not stored in Git.

All SSH known-host/control files, source archives, probes and transport logs were
under this project's .cache/nas-validation. NAS source/probe/DOCKER_CONFIG used
one mktemp-owned /tmp/tvbox-core-verify.* directory. SCP used the existing SSH
connection; the temporary control master was closed afterward. No global
known_hosts entry was written. Docker Hub DNS failed in the NAS builder, so a
host-side temporary registry-only CONNECT proxy, restricted to the NAS client,
was used by the isolated builder and CLI session. No proxy was embedded in the
runtime image. The loopback forward attempt failed and created no listener; the
actual temporary proxy used a LAN-bound high port and was stopped after validation.

A named docker-container buildx builder was created without changing the selected
builder, using its own config and volume. Its container, 2.588 GB build cache volume and newly
pulled 249,122,687-byte BuildKit helper image were removed after verification; no global image or
builder prune was used. Base/build-stage data was confined to that builder.
The four pre-existing NAS containers were left unchanged. Temporary test
containers used --rm and started no persistent service or published port.

Retained NAS artifact: tvbox-core:linux-amd64-20261015, purpose: command-line core
runtime and next real-source validation. Docker reports 506,134,455 bytes in its
uncompressed layers (about 483 MiB); actual physical usage depends on shared
layers. The image includes JRE/Node, pinned dependencies, source attribution and
prebuilt outputs. It has no javac/clang/npm and is not configured to autostart.
The default command executes offline doctor and exits. Base image digests are in
docker/base-images.json; this is not a fully apt-snapshot-reproducible build.

Corrected a dependency ledger duplication discovered during provisioning:
Commons IO and Commons Collections had each appeared twice in the native
manifest, with identical binary pins and an extra purpose annotation. The actual
20 unique retained jars total 67,798,245 bytes (about 64.7 MiB; du 65 MiB), not 22
physical jars. No additional Maven artifact was installed in this batch. Local
.tools remains about 404 MiB, retained for continued development; shared tools
were preserved.

367 host tests passed. Actual NAS Docker offline verification passed under UID
10001, read-only root, no network, all capabilities dropped, pids limit 256 and
2 GiB memory. /tmp tmpfs needs exec for JNI extraction/loading. Temporary fixture
DEX/JARs, build caches and raw transport/probe logs were removed locally and on
NAS; only metadata reports remain. Services still running from this task: none.
NAS Docker and its existing containers continue running. Autostart changes: none.


## Real protected JAR on NAS batch — 2026-10-15

Reused existing SSH/SCP, Python, Node/JDK and the retained NAS Docker image;
installed no tools, packages, VM, SDK or global environment. Local .tools still
occupies about 404 MiB, retained for ongoing builds and compatibility work. The
NAS image tvbox-core:linux-amd64-20261015 remains about 483 MiB in uncompressed
layers, retained for core execution; no image rebuild or additional image was
needed. The updated research probe was read-only mounted into that image.

Capture, reports, transport credentials/control files and raw logs used the
project's .cache/nas-source directory. Other local .cache/backend, compat and
container outputs were recreated by the 372-test regression and removed afterward.
The real subscription response/config/JAR, decrypted DEX and extracted libraries,
worker rootfs/preferences and raw source stderr were temporary and were removed.
Only metadata/hash/count reports were committed; no subscribed or decrypted code.

NAS inputs/output/probe scripts and logs used one task-owned /tmp/tvbox-real-source.*
directory, now deleted. Two --rm test containers ran as UID 10001 with read-only
root, exec tmpfs, dropped capabilities, no-new-privileges, pids limit 256 and 2 GiB
memory. Source HTTP requests used Docker's bridge with no published ports. The
deadline probe observed one actual JVM-owned TCP/IPv6 listener and verified it
could be rebound after timeout; worker exit and temporary-directory removal also
passed. The initial IPv4-only socket inventory was corrected and reverified.

Both task containers are gone, the temporary SSH shell/control master is closed,
and no task JVM, HTTP server or proxy remains. NAS Docker and its four existing
containers continue running unchanged. Task services still running: none.
Autostart changes: none. No shared tool, global SSH file or NAS service setting
was modified. Connection credentials are not retained in project files or Git.


## Automatic subscription JAR/cache batch — 2026-10-15

Inspected and reused the existing Node 24/JDK 17/clang, pinned project dependencies,
SSH/SCP and NAS Docker. No tool, library, VM, SDK, npm package, global environment
or autostart item was installed. .tools remains about 404 MiB, retained for ongoing
development. Fresh Android cache-policy oracle classes were compiled in owned
temporary directories and deleted in finally; snapshots/hashes remain unchanged.

Local transport, smoke, regression and fixture material used project .cache:
backend/compat/container builds, nas-artifacts and scoped SSH host/control files.
These were removed after verification. Synthetic HTTP servers, JVMs and cache
owners were closed; live subscription/config/JAR, decrypted native payloads and
raw diagnostics were temporary and are not committed. The metadata-only
jar-artifact-cache-probe.json contains source hashes, counts and image lineage.

NAS work used one task-owned /tmp/tvbox-auto-jar.* directory, now removed. Temporary
layer containers were never started and were removed after copying five Node
modules onto the verified existing image. Intermediate images from local checks
were removed by exact ID; no shared builder/image prune or new builder was used.
Real-source and offline-doctor containers used --rm, UID 10001, read-only root,
exec tmpfs, dropped capabilities, pids 256 and 2 GiB memory, with no published port.
Both real-source sessions closed and released their exclusive disk-cache lock.
The existing four NAS containers remain unchanged.

Retained NAS artifact: tvbox-core:linux-amd64-artifacts-20261015,
sha256:0ecfc269a233b3293749fabcbe00ba96e5c0d4323fb240ff29bae8a1deb06f1d,
506,160,765 bytes (about 483 MiB) of uncompressed layers. Purpose: runnable automatic
subscription/JAR session and subsequent port work. It shares the previous retained
core image layers; the new source-only layer adds 26,310 uncompressed bytes, rather
than another full independent 483 MiB copy. No source code from subscriptions,
credentials, caches or compile outputs were added to this layer. Exactly five
in-image Node file hashes match the checked-out sources; compiled engines and
dependency/license pins remain the previous image's. Current Dockerfile builds
those modules normally; this local derivative used create/copy/commit without
downloads or build-cache creation. No public image was pushed.

386 host tests and final-image NAS real JAR/cache restart plus offline doctor pass.
Temporary files, test containers, SSH shell/control master and task services were
removed/stopped. Task services still running: none. NAS Docker and pre-existing
containers continue. No new named data volume was retained; future CLI --data or
Docker volume use is caller-owned. Downloaded-JAR cache quota defaults to 128 MiB;
runtime DEX/module/plugin data has no aggregate cap yet. Unclean-exit lock recovery
is explicit/manual until the next ownership batch. Autostart changes: none.


## Kernel ownership and aggregate runtime cache batch — 2026-10-15

Checked available tools before building. Reused local Node/JDK/clang and pinned
project libraries; .tools remains about 404 MiB. NAS has Docker and the existing
core JRE image, with no host Java/JDK/clang and no javac/compiler in the image.
Used a temporary Eclipse ECJ 3.38.0 jar (3,285,717 bytes) downloaded over HTTPS from
official Maven Central, verified its published SHA-1 and recorded SHA-256
97c566b120009c203a2fc8b291f4a9adbc171cf1ccb70f06f6b4e1828c00ce8e.
It ran on the existing NAS Java17 JRE inside a task-owned compiler container;
a temporary javac wrapper selected Java17 language/API level. Compiler/wrapper
were removed before assembling the final runtime image. No global tool, VM,
package, user/group, DNS/daemon setting or autostart configuration was installed.

Only the updated source and three verified class directories were copied onto the
previous runtime image. Intermediate images/containers were removed by their exact
task IDs. A first packaging candidate copied up unnecessary read-only library
files while normalizing permissions; it was discarded, retaining the smaller
source/classes-only derivative. No shared cache/image prune was used. The original
core and artifact images remain unchanged and share their baseline layers.

Retained final NAS image: tvbox-core:linux-amd64-cache-20261015,
sha256:74c75480ee1f1a92cf3974b853af17f3a3f3338b31d39d5b973f4338c540511a,
511,597,437 uncompressed layer bytes (about 488 MiB). The incremental layer above
the previous retained image is 5,436,672 bytes (about 5.2 MiB), not another complete
copy of all tools. Purpose: crash-recoverable core execution and continuing port
work. Final image has no javac/ECJ/clang/npm; JRE-only, UID10001 and prebuilt-only
runtime were checked. Twelve runtime/source hashes match the checkout. This is
a local tested derivative, not a public/reproducible release build.

Each directory lease uses a transient JRE helper with a 16 MiB maximum Java heap;
an automatic session normally owns two such helpers. They use stdin and kernel
FileChannel locks, with no network listener or autostart. Usage guards stay held
by executing JVMs, and parent-death handling halts orphan workers. Persistent .lease
and .users are zero-byte control files, not abandoned running services. Normal
temporary roots are removed after close; explicit persistent roots retain them.
Legacy v1 PID-only lock migration remains an explicit cold-upgrade operation.

393 native-enabled host tests and final-image NAS probes passed. NAS checks include
two distinct PID-1 containers, live contention, SIGKILL/recovery, a JVM killed during
an endless call, combined DEX/module budget/pins/eviction, actual module and DEX
quota failures, real protected Aid home/cache restart and offline doctor. All
containers used --rm or were explicitly removed. Source tests use read-only root,
dropped capabilities, pids256, 2 GiB memory and /tmp exec tmpfs256MiB; lease-only
tests used pids32/memory256MiB/network-none. No port was published.

Project .cache/cache-lifecycle held transport/compiler/probe/test material, with
backend/compat/container caches generated by tests. Two task-owned /tmp log files
were removed as well. NAS used one /tmp/tvbox-cache-verify.* directory for source,
compiler, class/probe input and temporary subscription/JAR/DEX/native data. All
cleanup was interrupted by the usage limit: the local batch bundle (6.9 MiB,
including ECJ/logs/export input) and exact NAS directory (19 MiB) were still present.
On resumption, reran all 393 native-enabled host tests and the retained NAS image's
offline doctor, then removed that local bundle and /tmp/tvbox-cache-verify.PGFjIS.
The NAS has exactly the original four running containers and no task container.
The report's cleanup fields now reflect the verified result. Build/reference
caches regenerate during the next development batch and are removed at its end.
No persistent data volume was created. Existing NAS Docker/four containers remain
unchanged. A temporary scoped SSH control master serves the active continuation
and is closed at task end; no app service or autostart was added.


## Remaining artifact routes and final resumption cleanup — 2026-10-15

Reused the existing shared Node, project JDK/Gson/Android snapshots, system SSH/
SCP/tar/Python/mkfifo and the NAS Docker/JRE image. No package, toolchain, VM,
Android SDK, global environment, library or autostart item was installed. The
project development environment remains .tools, approximately 404 MiB, retained
for ongoing reference/runtime compilation. Shared Codex tools were untouched.

Fresh original-method route/image oracles create tvbox-artifact-routes-oracle-*
directories only under the OS temporary directory and delete them in finally.
Integration tests used owned tvbox-artifact-* directories, FIFOs, fixture JARs,
ephemeral loopback HTTP listeners and Java/lease workers. Their finally/after hooks
remove owned files and close every server/runtime. Generated backend/reference/
fixture/container outputs plus task transport/test logs occupied about 91 MiB
under .cache at final inspection; the entire known project cache was then removed.
No .data directory, user asset root or persistent subscription volume was created.
Caller-supplied future assetRoot/externalRoot/fileRoot directories are never deleted
by the runtime; direct local JARs remain outside managed disk-cache quotas.

The NAS used exactly one new /tmp/tvbox-artifact-routes.* directory for an owned
synthetic fixture, eight source files, source archive, metadata and temporary raw
home output. It was removed after hashes and aggregate results were recorded.
A stopped create/copy/commit container built the source-only image and was removed
by exact name; it was never used as a running app service. Every actual probe/CLI
container used --rm, UID10001, read-only root, dropped capabilities, pids256, 2GiB
memory and exec /tmp tmpfs256MiB. Offline doctor/fixture runs used network-none;
the explicit real Aid CLI used normal Docker networking and a separate ephemeral
64MiB exec /data tmpfs owned by UID10001. No port was published. An initial CLI
check without a writable data mount was corrected; a noexec data tmpfs also could
not initialize the native JAR. The selected runtime's JNI temporary extraction is
under data/runtime/tmp, so the successful native CLI used the bounded exec mount.
No real subscription/JAR/home payload, credential or temporary compiler is retained.

Retained NAS image: tvbox-core:linux-amd64-routes-20261015,
sha256:b6e3df0f9f7a9e2fa71bd040551899b1cfebe811dc1034d69a2a133ddbaf534a,
511,654,302 uncompressed bytes (about 488 MiB). Purpose: run the new artifact routes
and continue multi-artifact/runtime migration. It shares all previous layers and
adds 56,865 bytes (about 56KiB), with no duplicated Java/native dependency or class
directory. Existing images remain for rollback/reference. This local tested
derivative is not a public push or a reproducible release build. The existing
Dockerfile already copies the new backend/container sources for normal builds.

405 native-enabled host tests pass; the NAS verifies five route executions through
home/resource/reimport/restart, old token/registration invalidation, offline doctor
and the real strict-MD5 Aid home (eight classes). Eight in-image Node source hashes
match the checkout. Reports contain hashes/counts/fixture outputs, not subscription
configuration or raw source homes. Android/ART remains unverified.

Final check: no task container or stopped build container remains; NAS still has
exactly moviepilot, qbittorrent, emby and dockge-dockge-1. Their configuration and
lifecycle were not changed. The scoped SSH control master, script and host-key
bundle were stopped/removed; local project .cache is absent. Task services still
running: none. NAS Docker and the original four containers continue. Autostart
changes: none. No shared image/builder/cache prune was used.


## Public source catalogue matrix — completed, 2026-10-15

Checked/reused shared Node, project JDK/libraries and system Python/curl/SSH/SCP/
tar, plus the existing NAS routes JRE image. No tool, dependency, VM, Android SDK,
global environment, builder, image, daemon configuration or autostart was added.
The existing .tools development environment remains about 404 MiB for continued
migration; shared Codex tools were not modified. Public catalogue snapshots,
prepared/partial subscriptions, raw provider responses, 115 downloaded files,
JAR cache, transport manifests/logs and generated test/build outputs were owned
by .cache/source-matrix and the project .cache. The matrix bundle peaked at about
380 MiB and project cache at about 398 MiB during inspection. They are removed
at completion after report/hash verification; no unrelated cache/tool was pruned.

NAS work used exactly /tmp/tvbox-source-matrix.PePqXj. Broad task containers
were tvbox-matrix-20261015-0/1/2; corrected tasks were
 tvbox-matrix-retry-20261015-0/1/2. They ran three at a time, UID10001, read-only
root, dropped capabilities, no-new-privileges, pids256, memory2GiB, exec owned
/tmp tmpfs384MiB, read-only fixed input mount and writable metadata-only output.
No port or persistent data volume was created. An additional diagnostic container
(tvbox-matrix-diagnostic-20261015) was capped at 0.5 CPU and 1536MiB, otherwise
under the same filesystem/process restrictions. It retained only validated Java
symbols, hashes and counts; original logs stayed in memory. No raw source home,
decrypted payload or database is retained. Calls used normal Docker networking.

All 190 matrix artifact attempts (115 broad +75 corrected) and four targeted
runs verified worker close and owned temporary-data removal. All seven exact
task containers exited and were removed; the exact NAS directory, captured input
archives/JARs, mounted probe scripts and output bundle were removed. The scoped
SSH control master was stopped and its project host-key/control/script material
removed. The final NAS inventory still contains exactly moviepilot, qbittorrent,
emby and dockge-dockge-1; their lifecycle/configuration was not changed. The
existing image remains sha256:b6e3df0f9f7a9e2fa71bd040551899b1cfebe811dc1034d69a2a133ddbaf534a,
about488MiB uncompressed with shared layers. No new image or public push was made.

Purposeful retained regression inputs: .data/compat-regressions/catalog-20261015
under this project, 2,189,517 bytes (about2.09MiB). Four original SHA-pinned JARs
and a minimal three-site initialization manifest reproduce the four specific
unresolved native/protection/DEX/verification failures. This is ignored private
project test data, not a tool/environment/service. It contains no full subscription,
provider response, decrypted code, database or credential. Reuse these fixed bytes
for the next fixes and Android comparison, then delete these exact inputs after
regression verification; avoid refetching mutable artifacts to claim identical
inputs. The report records file hashes, purpose and retention policy. No other
user asset root or project data was removed.

Retained deliverables are the probe/collector/aggregator/diagnostic source and
metadata-only catalogue/review reports. 425 native-enabled local tests pass;
115 real captured artifacts and the corrected follow-up ran on the physical NAS.
Task services still running: none. Original NAS Docker/four containers continue.
Autostart changes: none. Local project .cache is absent after final verification.
