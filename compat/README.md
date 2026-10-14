# Android behavior baseline

This directory is the first migration deliverable: a pinned source baseline,
an executable reference probe, observations and a Win-Box comparison runner.
It is **not yet a production subscription loader or a complete script runtime**.

`reference/tvboxos/manifest.json` pins 20 files from
q215613905/TVBoxOS at `ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1`.
Every source file is SHA-256 verified before extraction. Source snapshots are
immutable; use `node scripts/compat/reference.mjs --restore` to restore from the
pinned commit and verify the recorded bytes.

The reference probe executes these unchanged upstream fragments with Gson 2.10.1:

- DefaultConfig.safeJsonString / safeJsonInt / safeJsonStringList.
- ApiConfig.trimJsonObject, fixContentPath and clanToAddress.
- The source parsing loop in ApiConfig.parseJson, with original SourceBean.
- UriUtil.resolve and its helpers.

The harness substitutes only TextUtils.isEmpty, a controlled ControlManager
address and a no-op logging sink for these probes. Full ApiConfig side effects,
Android storage, networking, ART, QuickJS, Python and native execution are outside
this first probe's coverage. The site-loop output includes the raw stored timeout
and the original SourceBean's derived playTimeoutSeconds separately.

Commands (Node 24+; JDK 17 and Gson as documented in docs/linux/environment.md):

```sh
node scripts/compat/reference.mjs
node scripts/compat/verify-all.mjs
node scripts/compat/backend-report.mjs
node --import ./scripts/compat/typescript-loader.mjs --test compat/*.test.mjs
node --import ./scripts/compat/typescript-loader.mjs scripts/compat/report.mjs
node --import ./scripts/compat/typescript-loader.mjs scripts/compat/report.mjs --gate
```

The report command writes `docs/linux/config-comparison.json`. `--gate` fails while
differences or unmapped error semantics remain. Normal report generation exits
successfully so observations can be inspected; that does not mean parity passed.

`config-observations.json` is a captured reference dataset. Regenerate only
intentionally using `node scripts/compat/capture.mjs`, then review its diff. It is
not regenerated during tests. This prevents harness edits from silently changing
expected behavior.

The explicit runtime lives in backend/config-core and builds its own committed
Java sources, independently of this extractor. backend-config.test.mjs compares
its exact results (including error classes and partial maps) to all 65 frozen
observations and 17 additional live-reference requests. Its separate report is
docs/linux/backend-config-comparison.json; the existing Win-Box audit remains
unchanged. These are selected-method results on the host JVM, not full Android
or Linux/NAS execution evidence.

The report also includes 75 frozen subscription observations from original
configUrl, FindResult, parseApiCollection and clanContentFix, with original AES
and HistoryHelper methods. Seven Android 13 AOSP JSON/Base64 sources are separately
pinned and verified, and desktop Bouncy Castle supplies PKCS7. Snapshot metadata
explicitly distinguishes this auxiliary baseline from a real Android device.
The runtime uses separate unmodified copies of these helpers with host annotation
declarations. subscription-core.test.mjs verifies their hashes and the results;
ECB/CBC cases also check independently generated plaintext expectations. Explicit
capture command: `node scripts/compat/capture-subscription.mjs`; tests never
regenerate expected results.

State/cache coverage adds 39 frozen original-method observations and 23 original
loadConfig scenarios, captured explicitly with `node scripts/compat/capture-state.mjs`.
The load oracle uses planned synchronous transport callbacks, temporary cache
files and a source-fields parser substitute. Its result includes selected
preferences, callback results, partial sources, exact cache bytes and event order.
The production loader is compared against that scoped oracle. It is not a full
ApiConfig/Android async or storage-failure equivalence test. Separate disk tests
verify worker restart recovery, corrupt-state retention and temporary-file cleanup.

Inspect method behavior using JSON lines on stdin:

```json
{"operation":"sites","text":"{\"sites\":[{\"key\":\"demo\",\"type\":3,\"api\":\"csp_Demo\"}]}"}
```

Pass this to `node scripts/compat/inspect.mjs`. Other operations: `safe`, `json`,
`trim`, `fix`. This is a local command, with no network listener or background
service. Only public synthetic inputs are stored in the fixture dataset.

## Real subscription transport probe

```sh
node --import ./scripts/compat/typescript-loader.mjs scripts/compat/subscription-probe.mjs 'SUBSCRIPTION_URL' --report docs/linux/subscription-probe.json
```

This bounded HTTP probe uses the Java core for URL/key selection and decoding,
including the observed salt+base64 envelope, AES and AOSP org.json/Base64. The
source-method harness independently checks URL/decode/path/collection/site results.
It does not
execute referenced code or upload subscriptions to a remote decoder. Reports
contain response hashes/counts, not full source definitions or payloads.

Transport uses Node fetch and explicit UTF-8 response byte conversion, not Android
OkHttp. HTTP charset/BOM, TLS/DNS/proxy/cookie/cache, other Android OS/provider
versions and Android runtime-state parity remain unverified. This diagnostic is
not a claim that C1 is complete.

The user-provided Fantaiying subscription returned an image-like wrapper; its
configuration decoded to 48 type=3 sources (45 CSP/JAR and 3 JS references).
See docs/linux/fantaiying-probe.json. Reading these definitions does not verify
their scripts or native libraries run.

## Attribution

Win-Box's existing source retains its original MIT license. The Android reference
snapshot and extracted reference code retain their upstream GPL-3.0 license;
see `reference/tvboxos/LICENSE`. UriUtil retains its original Android Open Source
Project Apache-2.0 notice. This directory is not claimed to be MIT-only.
Additional AOSP JSON/Base64 sources retain their Apache-2.0 license; original
HistoryHelper retains TVBoxOS GPL-3.0. The runtime's Bouncy Castle dependency has
its own license, copied to backend/config-core/LICENSE-BOUNCY-CASTLE.
