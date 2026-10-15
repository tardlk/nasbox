# Optional ARM/JNI host profile

This profile ports the pinned WinBox bridge onto the existing isolated backend
worker: DEX → class JAR → JNI method rewrite → unidbg ARM execution → genuine
getLoader → nested DEX translation/frame repair → genuine getSpider/init/calls.
The ordinary profile still rejects native plugins and requires none of these jars.
JVM verification remains enabled. The bridge does not substitute HideUtils crypto
with identity functions, force a platform field, or skip the GoProxy library path.

Provision only missing project dependencies (existing files are verified first):

```sh
node backend/spider-runtime/native-bridge/fetch-runtime.mjs
TVBOX_TEST_NATIVE=1 node --test compat/native-bridge.test.mjs
node scripts/compat/native-source-probe.mjs 'http://www.饭太硬.net/tv' report.json
```

`TVBOX_NATIVE_LIB_DIR` overrides `.tools/native-runtime`. All 23 artifacts are
pinned by SHA-256, size and the published Maven SHA-1 in runtime.json. Builds are
offline, check original source hashes and stage generated adaptations atomically.
The provisioning command is explicit; importing or running ordinary scripts never
downloads native dependencies. It adds no service, PATH change or autostart item.
See NOTICE and licenses for upstream attribution and release packaging boundaries.

The host classpath now includes the original Gradle coordinate
`com.google.zxing:core:3.3.0` after an exact-role ART/NAS replay reached Wogg's
missing `ChecksumException`. Genuine QR encoding/decoding, error correction and
irrecoverable checksum failures are tested. The repaired NAS entry initializes
and returns the same empty home as ART; this does not imply nonempty business
content. See `docs/linux/jar-round2-zxing-repair.json`.

```js
const runtime = createSpiderRuntime({nativeBridge: true, timeoutMs: 45000});
try {
  const result = await runtime.loadMain('/path/to/spider.jar');
  if (!result.loaded) throw new Error(JSON.stringify(result));
  const spider = await runtime.getCSP(source);
  const home = await runtime.call(spider.token, 'homeContent', [true]);
} finally { await runtime.close(); }
```

The CLI accepts `--native --backend dynarmic|unicorn2 --timeout 45000`; the
executable subscription session accepts nativeBridge/nativeBackend/runtimeTimeoutMs
along with its existing explicit artifact mappings. The profile uses a 768 MiB
maximum Java heap, plus native backend memory. Default ordinary workers use 256 MiB.

Build adaptations are explicit in build.mjs: POSIX classpath delimiters and host
cache mapping, package identity/Context assets, typed persistent preferences,
application/looper/handler host contracts, corrected Android layout hierarchy,
in-process baksmali, original SpiderDebug overloads, ARM32 CounterFile-only epoll
compile fixes, JNI observations, and tracked ServerSocket construction/factories.
No original WinBox reference file is edited. The full Android SDK stub artifact
fills missing symbols; unsupported SDK methods can still throw `Stub!`.

Loops dispatch real delayed callbacks and support cancellation/quit. They are
headless host queues: Handler without a prepared looper falls back to the host
main queue, and exceptions are logged. Preferences retain primitive types and
StringSets in atomic worker-owned JSON; apply persists synchronously. Neither
host adaptation is claimed to exactly reproduce all Android threading semantics.
SQLite JDBC stores actual databases and supports the tested host adapter subset;
the Android TVBox app's pre-existing read-only `tv` database is not provisioned.

One native artifact is supported per worker. Different native/site JARs need
separate workers or a JAR reset. clear('jar') replaces the entire native-profile
JVM: it cleans tracked listeners/callbacks/loaders/emulators and waits for process
exit before starting a new worker. This also invalidates JS Spider instances.
Generation-prefixed tokens prevent an old token from aliasing a new instance.
Explicit host/module/artifact settings are replayed; caller data and the owned
session directory persist until final close. This process-isolation policy is a
host boundary, not Android loader/thread semantics. The ordinary profile retains
its existing clear behavior.

Socket instrumentation covers direct ServerSocket constructors and methods named
createServerSocket returning ServerSocket in translated DEX. Other factories,
reflection, arbitrary native/plugin threads and SDK services are not a complete
resource ownership boundary; process exit is the final cleanup guarantee. Owned
callbacks are canceled, listeners are closed and owned threads are interrupted
and briefly joined before loaders are released. Shutdown exits after cleanup;
Node deadlines terminate a stuck worker. Host Java is not a Java security sandbox.

Verification includes ARM64 Unicorn2 instructions returning 42; actual ARM32
signal/eventfd/epoll/proc/nanosleep syscall probes; POSIX shared-file/symlink bounds;
SQLite transactions/reopen; typed preference process restart; queued callbacks;
real accept-thread shutdown; and worker exit. Real source report:
`docs/linux/native-runtime-probe.json`: 44/45 Spider instances, five JSON homes,
real DexClassLoader and clear/reload. `cc` returned SpiderNull in the later unchanged official APK/ART check as well; this is not by itself a Linux missing-class finding. Remaining
HTTP, readonly-database and background class-loading/shutdown diagnostics are
retained in the report; they are not counted as full API parity. Home data
is dynamic; counts/hashes describe the recorded run. Category/detail/search/player
and every native API are not established. The engine-only Docker doctor now passes on a physical Linux x86_64 NAS; see
`docs/linux/docker-runtime-probe.json`. The real protected JAR now also runs on
NAS; see nas-native-runtime-probe.json. Automatic HTTP JAR resolution and bounded
download caching are documented in ../ARTIFACTS.md and jar-artifact-cache-probe.json.
Bounded original-product ART evidence is now in docs/linux/android-runtime-probe.json; full parity remains outstanding. Managed runtime cache quotas are described in
../CACHE.md; native/plugin data remains outside those budgets.

## Captured failure repairs — 2026-10-15

The current profile adds VerifiedJarRepair for provable constructor ancestry,
Activity finish/query contracts and TextPaint's Paint superclass. It keeps JVM
verification enabled and the original reference snapshots immutable. Frame and
constructor repairs preserve uncertain/custom-constructor cases for explicit
failure rather than guessing new behavior.

DynamicNativeSupport detects direct System/Runtime.load(path) and static native
declarations before defining an outer JAR without embedded libraries. Actual
worker-owned ARM ELF content is snapshotted, validated and handed to the bridge;
the host JVM never loads those captured direct paths. Initialization failure is
propagated. Unknown name-based loaders, instance native signatures and indirect/
reflective paths are not certified. Normal Java JARs remain outside this path.

NativeLifecycle tracks active execution and loading in build-time adaptations.
Close first cancels owned callbacks/listeners, then waits for active work to finish
without holding a VM lock. At zero, new entries are atomically rejected before
emulator destruction. The guard and ARM32 payload retain independent locks: a
guard can await a payload call on another Java thread. Deadline exhaustion is an
explicit close failure; it never destroys a JIT that is still executing.

See docs/linux/jar-repairs-probe.json for fixed-input NAS evidence and the default
Android versus explicit declared initializer policy. The final recorded workers
exit with code0 and no signal. Complete Android rendering and general SDK/ART
semantics remain open. Managed cache budgets are described in ../CACHE.md.


## Original-product ART findings — 2026-10-15

Unreadable or unsupported `.class` entries are preserved byte-for-byte as opaque resources. They cannot prove constructor ancestry and are not passed to native patch planning. If requested as classes, they still fail normal JVM definition/verification. Only syntactically readable classes participate in the checked repairs.

A native declaration without a library-load instruction does not activate the dynamic bridge. When a path load is present, only static-native/load classes are patched. Instance-only SDK classes remain in the original archive; mixed classes retain their original instance native declarations, including annotations. Invoking unresolved instance JNI still throws `UnsatisfiedLinkError`. No successful empty native bodies are substituted.

Observed headless graphics calls now use actual Java2D ARGB rasterization and in-memory PNG encoding. The supported subset includes vector paths, basic shapes, linear gradients, host-font glyphs and the Paint return descriptors needed by Android-compiled callers. Legacy TextPaint descriptors are preserved. Each bitmap is limited to 16 million pixels (64 MiB pixel storage); that is not an aggregate worker-memory bound. Unsupported bitmap configurations, compression formats, shaders and custom font mappings fail explicitly. Font metrics, antialiasing, pixels and PNG bytes are host behavior and are not asserted to match Android Skia. No rendering/player UI is provided by these adapters.

See docs/linux/android-art-comparison-probe.json for the fixed JAR/API/ext and exact method-parameter comparison. The official APK source differs from the pinned Android snapshot, notably ProtectedInitJar; those observations are separate from exact pinned-source ART certification.

The PanConfig continuation also binds the real Sardine Android 0.4 and Simple XML 2.7.1 libraries for JVM resolution of WebDAV helper signatures. These are supplemental host dependencies; static auditing found no Sardine definitions in the official APK. Existing OkHttp/Okio are reused. Pinned complete AAR and extracted classes.jar hashes, licenses and genuine authenticated loopback PROPFIND/XML/GET/PUT/MKCOL tests cover this addition. It is not certification of every WebDAV provider or Android dependency version.
