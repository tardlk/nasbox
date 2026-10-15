# Subscription JAR retrieval and bounded cache

`createExecutableSubscriptionSession({remoteJars:true})` now resolves the global
`spider` and a selected site's `jar` automatically. Explicit `artifacts` mappings
still take precedence. Import parses config; the first selected method call fetches
and opens its artifact. Files remain pinned until the runtime has cleared them.
An already loaded instance is unchanged until reimport, matching loader identity.

```js
const session = await createExecutableSubscriptionSession({
  remoteJars: true,
  nativeBridge: true,
  artifactCacheDir: '/your/data/artifacts', // Omit for automatically removed temporary data.
  jarCacheOptions: {maxBytes: 128 * 1024 * 1024, integrity: 'android'},
});
try {
  await session.load({apiUrl: subscriptionUrl});
  const result = await session.call('Aid', 'homeContent', [true]);
} finally { await session.close(); }
```

The new CLI performs that flow without a JAR path:

```sh
node backend/spider-runtime/subscription-cli.mjs --native --url 'http://www.饭太硬.net/tv' --source Aid --method homeContent --args '[true]' --data /your/data/session
```

`--cache` requests cached subscription/global JAR loading. `--strict-md5` selects
stronger advertised-digest checking; `--jar-cache-bytes BYTES` changes the quota.
`--remote-modules` also enables the separately implemented remote JS module mode.
Without `--data`, all CLI-owned subscription/artifact/runtime state is temporary.
A supplied runtime requires a caller-owned `artifactCache`, whose lifetime must
outlast that runtime; one cache belongs to one session owner.

The behavior authority is Android TVBoxOS ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1,
not WinBox. Fresh original-method fixture execution checks 19 cache choices:

| Rule | Global spider / ApiConfig.loadJar | Site jar / JarLoader.parseJar |
| --- | --- | --- |
| Disk identity | Original string2MD5 of source URL, main namespace | Same string2MD5, separate site namespace |
| Loaded identity | One main loader until clear | Original full-signature loader and site-key identity remain in JVM |
| `useCache` | Reuses valid local bytes even if advertised MD5 differs | Does not override MD5 selection |
| Advertised MD5 | Literal trimmed text, compared without case | May fetch `http…` digest text; failed request becomes empty in Android mode |
| No MD5 | `jarCache` Boolean.parseBoolean controls age reuse | Age reuse independent of global `jarCache` |
| Age boundary | Expired only when age is greater than **3 days** | Same FileUtils.isWeekAgo method and boundary |
| Successful download | Android mode records a mismatch but accepts it | Same Android mode acceptance |

URL identity preserves original `MD5.string2MD5`: each UTF-16 character is cast
to one low byte before hashing, including surrogate pairs. It is not UTF-8 MD5.
The fresh-source gate includes Chinese and emoji URL paths.

Default `integrity:'android'` deliberately preserves the cache-selection and
successful-download behavior. Android does not uniformly reject newly downloaded
bytes on MD5 mismatch. `integrity:'strict'` instead rejects invalid/mismatched MD5,
including forced-cache and fallback mismatches, before any runtime load. These
modes must not be presented as identical. SHA-256/MD5/size sidecars always detect
local cache corruption before reuse; they do not authenticate an unpinned remote
URL or replace a trusted digest. MD5 is retained for upstream compatibility.

Cache files live only under `artifactCacheDir/jar-artifacts-v1` (or an owned
`tvbox-jar-cache-*` temporary directory). Sidecars retain hashes, size and download
time, without URL credentials. Kernel-backed directory leases prevent concurrent
writers and recover after crashes. Lock inodes remain; no PID/TTL guessing or
manual deletion is needed for new-format locks. Existing old-version PID-only
locks require explicit cold migration. See [ownership and runtime quota](CACHE.md).

Defaults: 64 MiB per artifact, 128 MiB per cache, 25 seconds per HTTP request,
4 KiB for a remote digest. The LRU quota includes managed JAR/JSON pairs and
reserves both temporary-write and replacement peaks before writing. Pinned entries
and the previous version being replaced cannot be evicted; insufficient free
budget produces `JAR_CACHE_QUOTA`. Use a larger quota or clear inactive runtime
resources rather than deleting a file still referenced by a loader. Staging is
removed on normal failure and on the next owned startup. A crash between the two
atomic file renames is detected by sidecar validation and refetched.

Host additions/differences remain explicit: HTTP status/size/time limits,
SHA integrity, atomic replacement, strict opt-in MD5 and bounded retries. A failed
age-cache or downloaded global initialization gets at most one refresh; the
upstream age-cache failure branch can recurse on the same bad file. Failed global
network fetch may use SHA-verified old bytes in Android mode; strict mode also
requires the declared digest to match. A failed site fetch is surfaced instead of
executing the upstream downloader's potentially partial file. These failure paths
are not included in the 19 successful-load reference choices and are integration
tested separately. Node HTTP/DNS/TLS/charset behavior is not certified OkHttp parity.

Automatic retrieval follows the original role-specific dispatch:

| Input | Global spider | Site JAR |
| --- | --- | --- |
| HTTP(S) | Binary bytes; removes all literal `img+` substrings before requesting | Binary bytes |
| `img+http…` | First eight-alphanumeric-plus-`**` marker, then original Android Base64.DEFAULT semantics | Unsupported by original site loader |
| `assets://…` / `assets/…` | No dedicated route | Copies from explicit `assetRoot` into the managed cache |
| `file:/…` | No dedicated route | Direct caller file: `externalRoot` first, then `fileRoot` |
| `clan://…` | No dedicated route | Original localhost/remote address conversion, then HTTP |

The subscription's existing original-source preprocessing can convert file/clan
strings to HTTP before this dispatch. An unsupported main scheme fails before
the HTTP adapter instead of pretending the main loader has site-only branches.
The `img+` identity stays the original source string; downloaded payload SHA/MD5,
size and cache quota apply to decoded JAR bytes. The encoded response has a
separate `maxImageBytes` cap (default ceil(maxArtifactBytes × 4/3) + 1 MiB).
Missing/empty/invalid payloads never publish a partial pair. Main HTTP requests
use the original `okhttp/3.15` user-agent. Image text uses declared charset and
UTF-8/UTF-16 BOM handling; full OkHttp charset/network equivalence is unverified.

Pass `jarCacheOptions:{assetRoot,externalRoot,fileRoot}` to bind Android storage
namespaces to explicit directories. These roots must already exist. Paths cannot
escape their root through `..` or a symlink; nonregular inputs, including FIFOs,
are rejected without blocking. These are host filesystem bounds, not a claim of
identical Android storage services. `fileRoot` represents the Android absolute/
relative file fallback namespace; leading slashes are interpreted within it.
Local file JARs are size/digest checked, then loaded directly; they are neither
copied into nor counted against the managed cache. Avoid truncating an active
JAR in place: atomically replace the caller file and reimport before using its
new generation. Caller files are never evicted or removed by the session.

Set top-level `localAddress:'http://your-file-service/'` for both subscription
preprocessing and the cache's clan localhost route. This binds to an existing
file service; the CLI does not start one. `jarCacheOptions.localAddress` can
override just the artifact binding. CLI equivalents are `--asset-root DIR`,
`--external-root DIR`, `--file-root DIR` and `--local-address URL`.

Fresh unchanged ApiConfig/JarLoader methods cover 34 dispatch cases and 20 image
vectors; an additional 341 Base64 state combinations use original AOSP decoding
as the oracle. These are host-JVM fixture comparisons, not Android/ART tests.
Native clear discards automatic registrations before replaying the replacement
worker's settings; explicit caller mappings still replay. Old automatic files
can then be evicted without leaving a stale worker mapping.

Dynamically requested helper JARs from inside scripts are not intercepted. Multiple
protected native artifacts still need independent-worker design. The quota covers
this downloaded-JAR cache. A separate 256 MiB aggregate DEX/module budget is now
implemented in CACHE.md. Native rootfs/patches, plugin files and the entire NAS
data volume remain outside these policies.
Android/ART and complete TVBox parity remain unverified.

## Explicit initializer policy

`jarInitPolicy:'android'` is the default. It retains the fixed Android loader's
protection scanner and init method body. Some ordinary JARs include app-restart
code using killProcess and are therefore classified as protected despite having
no usable protected-loader contract. The captured 1ac653… input demonstrates this:
the unchanged default fails with PROTECTED_INIT_UNBOUND.

`createExecutableSubscriptionSession({jarInitPolicy:'declared', ...})` or
`session --jar-init-policy declared` explicitly enables the tested alternative.
It calls the JAR's real public static void Init.init(Context) when the scanner
matches and recognized DexNative/DexClassLoader bindings are absent. A failed
initializer remains a failure. It does not forge a package/whitelist, skip native
business code or manufacture a Spider. Actual calls still need verification.
This is a separate host policy; it must not be reported as Android-equivalent.
