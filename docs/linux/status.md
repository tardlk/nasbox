# Migration status — 2026-10-14

Priority: subscription links and script execution behavior; player work deferred.

| Work | Status | Evidence |
| --- | --- | --- |
| Win-Box checkout and working branch | Done | baseline.json; branch codex/linux-core |
| Android source candidate pinned | Done | TVBoxOS ab11d28; 20 hashed source files |
| Historical Win-Box APK/version identification | Unconfirmed | Source method references match named files/line ranges; no unified APK pin found |
| Executable original-source reference probe | Done for selected methods | scripts/compat/oracle.mjs |
| Synthetic reference observations | Done | 65 cases in config-observations.json |
| Probe integrity/contract tests | Done | 77 Node tests passed, including temporary local HTTP transport fixtures |
| Win-Box comparison | Initial audit done | config-comparison.json |
| Production parser parity fixes | Not started | Difference report is diagnostic, not a passed parity gate |
| Real Android/ART validation | Pending | No APK/device/emulator runtime verification |
| Subscription network/decrypt pipeline | Initial probe only | User sample fetched and salt+base64 decoded; full Android network/AES parity pending |
| JS/QuickJS/Python/JAR/native execution parity | Pending | Sources pinned; runtimes not ported |
| Linux container and NAS validation | Pending | Current host is macOS ARM64; no Docker available |

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
values still differ from Win-Box, and no downloaded source code was executed.

Observed migration issues include null coercion, boolean/integer conversion,
partial numeric strings, list conversion stopping at invalid entries, raw timeout
storage, duplicate source keys, required-field failure behavior, Gson's lenient
syntax and the upstream whole-text relative-path replacement.

Next batch:

1. Lock the expected behavior of the full config-loading sequence, including its
   Gson parser, decode order and persistent state, before changing the parser.
2. Implement Android-compatible parsing as an explicit backend path rather than
   silently calling desktop-oriented normalization.
3. Introduce controlled HTTP subscription fixtures and initialize the method
   contract/host API comparison for scripts.
4. Obtain real subscription samples and an Android runtime to expand the evidence.
