# Linux migration scope

Prioritize subscription parsing and script execution parity with the pinned
Android TVBoxOS baseline. Player UI, media decoding and transcoding are deferred.
Win-Box is an implementation reference, not the behavioral authority.

Check existing tools before installing. Record new tools, environment paths,
disk usage, background services and autostart changes in docs/linux/environment.md.
Stop temporary services and remove temporary downloads/caches after verification.
Do not remove shared tools or unrelated user files.

Keep Android source snapshots immutable and verify their manifest hashes before
extracting reference methods. Preserve upstream license and attribution. Distinguish
host-JVM reference probes from real Android/ART and Linux/NAS validation.

Use the dependency-free Node compatibility runner for baseline work. Do not
install Electron or player dependencies just to run parser compatibility tests.
