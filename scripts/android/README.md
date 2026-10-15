# Android / ART product oracle

This is a separate instrumentation APK, package `com.github.tvbox.parity.oracle`.
It runs in the installed upstream TVBox process and calls that APK's original
`JarLoader.load(String)`, `getSpider(String,String,String,String)`, and Spider
methods through reflection. It does not patch or re-sign the upstream APK, copy
its implementation into a replacement host, or replace the Android runtime.
It verifies method execution in the original app context; direct method calls
are distinct from end-to-end UI tests.

The upstream repository publishes its build key and its passwords in
`.github/workflows/TVBoxOSC.jks` and `test.yml`. The builder verifies that its
certificate matches the installed release certificate before signing this
separate test APK. The certificate SHA-256 is
`4b9421de6d46778f6280b180179413fa6973845f0a0132c00f6800c06464e051`.
The build records key provenance, original and instrumentation APK hashes, and
source hashes. This public upstream build key is only used for this local test
APK. Keep original-product results distinct from the pinned source baseline
when their commits differ.

Build using an existing SDK and JDK; the script does not download tools:

```sh
node scripts/android/build-oracle.mjs --target-apk /absolute/path/original.apk
```

Optional arguments: `--sdk`, `--java`, `--platform` (default `android-33`),
`--build-tools` (default `35.0.0`), `--keystore`, and `--out`.

The audited release APK declares source commit
`d5f500677a4da15c5836477352030d9ebb5cb37a`; the repository's source baseline is
`ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1`. The release's
`ProtectedInitJar.bindDexLoader` accepts a missing `DexNative` class where the
pinned implementation returns false. Record that known version difference with
each original-product comparison; successful ART execution alone cannot certify
the older source's behavior. The APK audit records the exact release SHA and
per-source comparisons. Use the installed APK SHA, SDK/ABI, test APK SHA,
manifest SHA and NAS image SHA as execution evidence.

Serve a private capture manifest with the following shape to the emulator.
JAR downloads are checked against the captured SHA-256 before the app loads
them. `ext` must be the exact final string supplied to both hosts; structured
ext values must be normalized using the original config parser first.

```json
{
  "schemaVersion": 1,
  "artifacts": [{
    "id": "captured-artifact",
    "jarUrl": "http://10.0.2.2:18765/artifacts/captured.jar",
    "sha256": "64 hexadecimal characters",
    "configSha256": "optional captured config SHA-256",
    "sites": [{
      "key": "captured-site",
      "api": "csp_Example",
      "ext": "exact captured ext string",
      "extSha256": "optional exact UTF-8 ext SHA-256"
    }]
  }]
}
```

Install the unmodified upstream APK and this separate test APK. Force-stop the
target before **every artifact** so native static state cannot leak across JARs.
One instrumentation invocation selects one artifact and one site:

```sh
adb shell am force-stop com.github.tvbox.osc.jun
adb shell am instrument -w -r \
  -e manifestUrl http://10.0.2.2:18765/oracle-plan.json \
  -e artifactIndex 0 -e siteIndex 0 \
  com.github.tvbox.parity.oracle/com.github.tvbox.parity.oracle.OracleInstrumentation
```

Optional arguments: `manifestSha256`, `callTimeoutMs` (default 30000),
`autoCategory=false`, `autoDetail=false`. The default sequence is
`homeContent(true)`, then first `class.type_id` with
`categoryContent(tid,"1",true,{})`, then first returned `vod_id` with
`detailContent([vod_id])`. Category and detail arguments chosen on Android must
be reused verbatim on NAS; independently choosing each host's first result does
not establish same-input parity. To supply fixed calls, put `calls` on a site or
artifact:

```json
{"calls":[
  {"method":"homeContent","params":[true]},
  {"method":"categoryContent","params":["1","1",true,{}]},
  {"method":"searchContent","params":["example",false,"1"]}
]}
```

Allowed methods are homeContent, homeVideoContent, categoryContent,
detailContent, and both Spider searchContent signatures. At most 20 calls are
accepted. A timeout stops further calls; the host must then force-stop the app.
Legacy plans without a loader context use the captured artifact as the main JAR.
New plans preserve the original role and complete signature on each site:

```json
{
  "key": "captured-site", "api": "csp_Example", "ext": "exact final string",
  "jar": "https://original.invalid/site.jar;md5; original declaration",
  "loaderContext": {
    "role": "site",
    "signature": "https://original.invalid/site.jar;md5; original declaration",
    "main": {
      "sha256": "64 hexadecimal characters",
      "jarPath": "artifacts/main-sha.jar",
      "jarUrl": "http://10.0.2.2:18765/artifacts/main-sha.jar",
      "signature": "original complete main JAR signature"
    }
  }
}
```

`artifact` still identifies the selected JAR. Main-role contexts have `role:
"main"`, the original main signature, and `jar: ""`; they omit `main`. A
site-role context has `main` only when its original configuration had a captured
main JAR. Missing or invalid configured mains belong in the plan's unexecuted
list; do not turn them into contexts without a main. `prepare-role-fixtures.mjs`
creates these contexts from verified frozen bindings and records the references
and omitted variants. The fixture server includes both selected and main bytes.

The build statically audits the exact official APK's original keyed load,
`jarKey`, `getSpider`, and loader fields, then embeds an APK-hash-bound symbol
map. Instrumentation hashes the installed APK before using that map. Both JARs
are downloaded and SHA-verified before either executes. In one original
JarLoader, the main loads first; the site loads through the original private
`load(originalKey, File)` and original source-to-key alias is installed before
initialization. `getSpider` receives the unchanged complete site signature. This
isolates artifact execution from remote acquisition while preserving main/site
coexistence and original cache keys. Original downloads, remote MD5 retrieval,
cache ages and acquisition fallback are outside this probe.

New reports pin `loaderMode`, `jarSignatureSha256`, `jarLoadKey` (main or the
original Java low-byte MD5 of the complete signature), `mainJarSha256`, and
`mainSignatureSha256`. Pulling, replay preparation and comparison validate all
five fields. Legacy no-context main reports remain readable. Original-product
ProtectedInitJar version differences stay explicit in every new comparison.

Optional plan fields `artBudgets` and `nasBudgets` each accept `caseMs`, `loadMs`,
`initMs`, and `callMs`; actual values enter reports. ART defaults are 240000,
30000, 30000, 30000 milliseconds; NAS defaults are 240000, 90000, 30000, 30000.
New ART context transport budgets are `caseMs + 20000`; legacy runs retain the
historical 150000 transport deadline unless budgets are specified. Instrumentation
also accepts `caseTimeoutMs`, `loadTimeoutMs`, and `initTimeoutMs`.

Set `artStatePolicy: "fresh-app-data"` on a plan to clear the task AVD's target
app before every case. The runner force-stops the target, runs `pm clear`, and
requires a successful command with exactly `Success` on stdout before invoking
instrumentation. A failure stops the run. It does not grant permissions or set
preferences. Omitted policy preserves the historical
`cold-process-preserve-data` behavior. Both the run summary and instrumentation
report record `applicationStatePolicy`; pulling verifies the instrumentation
policy against the launch policy. NAS records `fresh-runtime-data` only after
creating a new case directory. Comparisons show both states independently;
old missing state metadata remains `unrecorded`, and matching preferences or
equivalent host state are not assumed. Use this only with the task-owned AVD.

ART keyed loading and Spider initialization have separate phases. The current
NAS API combines a site's cold load and initialization in `getCSP`; its report
marks `site-load-init`, `includesSpiderInit: true`, and the actual load budget.
Timeouts in these differently scoped phases do not prove the same underlying
cause. A timed-out site leaves its load state unknown if state cannot be read.
The existing NAS native worker permits one native artifact; combinations blocked
by that restriction stay failures or unresolved observations, not split-runtime
coexistence successes.

`INSTRUMENTATION_RESULT: report` and per-call status contain only metadata,
counts, class names, argument hashes, response hashes, and exception fingerprints.
Raw responses and exact method arguments stay in a private JSON output under
the target app's `externalFilesDir/parity-oracle`; the absolute path is returned
as `privateResultPath` and can be pulled by adb. Do not publish that private file.
For comparison, parse both raw strings in the same Node process and recompute
sorted-key JSON hashes there: Java and JS JSON implementations can serialize
numbers or escaped characters differently. Use raw, semantic, class and filter
hashes to distinguish full equality from stable structural equality. Remote
sites can change between calls; a difference is evidence to investigate, not
proof of a runtime defect.

`prepare-fixtures.mjs CAPTURE_DIR FIXTURE_DIR` builds the hash-bound JAR plan;
`serve-fixtures.mjs CAPTURE_DIR FIXTURE_DIR` exposes only the explicit routes on
host loopback. `run-oracle.mjs PLAN OUTPUT_DIR ADB [SERIAL] [FIXTURE_BASE]` runs
all selected artifact/site pairs serially, with a cold app process for every
case. Use a **new empty output directory for each run**. The runner deletes each
old local case before execution, pulls into a private staging directory, checks
the current status report and manifest/JAR/API/ext/site identity, verifies any
recorded response byte hashes, and only then atomically publishes the private
result. Failed pulls leave no final case file. It records `privateResultPulled`,
the collected file hash and the executed runner hash; a failed pull must be
resolved before comparison. Keep historical executions pinned to the runner
bytes they actually used. Some Android
images block adb access to another app's external data. Record the collection
method and any temporary device privilege change; never silently replace a
missing private result with an older file. Return the AVD to its prior state or
destroy the task-specific AVD after collection.

On NAS, replay these private ART results using the same captured artifact root:

```sh
node scripts/android/replay-nas.mjs PLAN ART_PRIVATE_DIR NAS_PRIVATE_DIR INPUT_ROOT
node scripts/android/compare-art-results.mjs PLAN ART_PRIVATE_DIR NAS_PRIVATE_DIR PUBLIC_REPORT.json
```

The replay creates a fresh worker for each case. Default budgets are 90 seconds
for conversion/loading, 30 seconds per script call and 240 seconds per case;
record the executed script hash and any enclosing container deadline. The
comparator validates the exact manifest/JAR/API/ext/site and reuses the original
method arguments. Count successful JSON comparisons separately from empty
results, both-side errors and unexecuted calls. Remote response differences are
observations until their cause is established. A matching response does not
prove that every Android API or an untested source is compatible.

An early replay runner validated the manifest before execution but omitted its
hash from its result metadata. Only that omission can be recovered with an
explicit outer `executionProvenance` and an independently verified launch-pin
file passed as `--replay-provenance VERIFIED_LAUNCH.json`. Both must contain the
same `manifestSha256`, executed `runnerSha256` and
`source: "captured-launch-input"`. The comparator records the original missing
field and recovery source. A conflicting reported hash, missing independent
pin, wrong runner hash or missing ART hash is rejected. Preserve original
reports and response strings; do not add invented fields inside those reports.

The separate parser instrumentation package is
`com.github.tvbox.parity.parseroracle`. Build it with
`build-parser-oracle.mjs --target-apk APK`; the build statically audits the exact
APK's R8 symbols and embeds an APK-hash-bound map. It fails for unaudited APK
bytes, rather than guessing method names. `prepare-parser-fixtures.mjs
CAPTURE_DIR FIXTURE_DIR` prepares fixed raw response routes for the same loopback
server. Run `ParserInstrumentation` with `manifestUrl`, `manifestSha256` and
`configIndex`; collect its returned private file in a fresh output directory
using the name `result-INDEX.json`. Run each case in a cold target app process.
The original fetch/preparation body and `parseJson` execute inside the unmodified
APK; only the transport URL points to the captured raw response.

Parser replay and comparison use these commands:

```sh
node scripts/android/replay-parser-nas.mjs PLAN RAW_DIRECTORY ART_PRIVATE_DIR NAS_PRIVATE_DIR
node scripts/android/compare-parser-results.mjs PLAN ART_PRIVATE_DIR NAS_PRIVATE_DIR PUBLIC_REPORT.json
```

`RAW_DIRECTORY` contains `0.bin`, `1.bin`, etc., whose hashes must match the
parser plan. NAS restores the observed `homeApi`, `defaultParse` and `liveApiUrl`
preferences before each fresh config worker. Other preferences and complete
live/parser side effects are outside this comparison. The public parser report
compares prepared bytes and observable globals/source rows, preserving value
types and source order. The audited R8 build removed `SourceBean.filterable`;
only `sites[].filterable` is excluded from the NAS projection, with that gap
explicitly reported. Original parser rejection with matching partial state is
reported separately and never counted as a successful accepted configuration.

The stock control endpoint is `POST /action` on device port 9978 (increased on
conflict), with URL-encoded `do=api&url=...`. It posts an API-change event; the
settings screen handles that event. `do=search&word=...` triggers product search.
There is no stock endpoint returning raw home/category/search JSON: screenshots,
UI hierarchy and JarLoader logs can corroborate an unmodified-product smoke test
but cannot replace the precise instrumentation response comparison.

Cleanup: remove the separate test APK and oracle app data or destroy the
task-specific AVD; stop the fixture HTTP server. Remove temporary source design
downloads, keystore copies and build outputs after verification. Record any
retained SDK/AVD/tool paths, purpose, sizes and services in the environment ledger.
