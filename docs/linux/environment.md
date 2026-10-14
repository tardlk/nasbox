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
| Auxiliary source snapshots | compat/reference/android-platform and compat/reference/tvboxos-extra | Android 13 JSON/Base64 and original HistoryHelper | Retained source, about 124 KB plus licenses; runtime helper copies are also committed |
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

Three test-only HTTP listeners bound to 127.0.0.1 on ephemeral ports were started
and closed by the transport tests, including their failure paths. Reference JVM
processes exit after each batch. Backend worker tests/probes create temporary JVM
children and close them, including startup failure and response-limit failure
paths. No persistent service was started. The only additional binary dependency
in this batch is the project-local Bouncy Castle jar; no global tool was changed.

Temporary subscription response bytes/decoded content and generated Java classes
under .cache were removed after extracting metadata and verification results.
Services still running: none. Autostart changes: none.
