# Cache ownership, recovery and runtime disk budget

JAR downloads and runtime DEX/module caches now use kernel-backed directory
ownership. A small JRE helper holds an exclusive `FileChannel` lock on `.lease`.
A separate `.users` shared lock is also held by each JVM using that directory.
The inodes remain in place after close; file existence does not mean a live owner.
Do not delete these files to break a live lock: that creates a second lock inode.

The OS releases locks on process death, including SIGKILL. A new owner can take
an idle directory without PID/age guesses or unlink-and-recreate races. A surviving
JVM's usage lock blocks takeover even after its helper exits. Workers monitor their
actual Node parent with ProcessHandle; parent exit halts even an executing endless
callback, releasing the JVM's locks. Staging from a failed write/conversion is
removed by the next exclusive owner. Session shutdown closes workers before cache
owners. A borrowed runtime/cache must retain that ownership order.

This was tested on macOS and physical Linux x86_64 NAS Docker, including separate
containers whose Node owners both have PID 1, live contention and container SIGKILL.
File systems must support Java/native advisory locks; network/distributed file
system semantics are not certified. An unsupported lock fails closed.

The old PID-only `.lock` format cannot prove liveness across namespaces. Stop all
old-version clients before migrating their persistent directories. A remaining
old JAR `.lock` produces `LEGACY_JAR_LOCK_REQUIRES_MIGRATION`; after stopping those
clients, explicitly use `--recover-legacy-lock` or `recoverLegacyLock:true` once.
New-format crashes require no manual lock removal.

| Budget | Default | Configuration |
| --- | --- | --- |
| Downloaded JAR + JSON sidecars | 128 MiB | jarCacheOptions.maxBytes / --jar-cache-bytes |
| Combined translated DEX + JS module cache | 256 MiB | runtimeCacheMaxBytes / --runtime-cache-bytes |
| Direct runtime combined cache | 256 MiB | createSpiderRuntime({cacheMaxBytes}) |

The aggregate runtime budget covers managed `dex-cache/<SHA256>.jar/.sha256` pairs
and `module-cache/qjscache_<MD5>.js` JSON files. LRU eviction uses access timestamps;
DEX JAR modification times remain unchanged on reuse. Reservation includes incoming
persistent staging/replacement bytes before writing. A rejected reservation leaves
the previous version intact, with no partial entry published. Startup applies the
configured budget to inactive entries left by previous workers.

Converted DEX files remain pinned conservatively for the JVM lifetime, including
nested loaders. If those pins prevent admission, it returns `RUNTIME_CACHE_QUOTA`
rather than deleting a live class file. Close/restart releases pins; native JAR
clear already replaces the worker. Ordinary clear alone does not release these
conservative DEX pins, since JS/nested class references may still exist.

Module source is already materialized in memory when its disk cache is evicted.
Original FileUtils cache-write exceptions remain caught: over-budget writes skip
persistence while the fetched module result still works. Original expiry/debug,
JSON and cache-read semantics are preserved. Cache metrics expose rejected writes
rather than treating optional-cache rejection as a script failure.

Use `session.getState().runtimeCache` or runtime request `{operation:'cacheState'}`
for bytes, DEX/module breakdown, active DEX pins, eviction and rejection counts.
The existing runtime state snapshot/Android method contract is unchanged.

Conversion staging uses a root-specific owned directory under the OS temporary
folder. In Docker that is `/tmp`, subject to the existing 256 MiB tmpfs bound;
it is outside the persistent cache budget. Normal failure removes it, and the next
exclusive owner removes abandoned stages belonging to the same runtime root.
Unrelated files/stages are preserved. Native payload patches now use a separate
`native/payload-cache` namespace instead of the managed translated-DEX directory.

This is a host resource policy, not Android cache/storage equivalence. Native
patches/rootfs, plugin-created files, preferences/SQLite, explicit artifacts and
subscription history/cache are outside these two budgets; this is not a NAS-volume
quota. Unknown files and legacy native-patch directories are not silently deleted.
Default temporary worker/cache data disappears on close; --data persists caller data.

Each owned directory uses one transient JRE lease helper with a 16 MiB Java heap
maximum (additional process/RSS overhead applies). A normal automatic JAR session
has two helpers plus its worker/config processes, within the tested 2 GiB container
limit. Helpers expose no network listener and create no service/autostart setting.
They reuse the installed/prebuilt JRE and stop with their Node owner.
