# Android-compatible configuration core

An explicit backend module for the Linux migration. It runs Java 17+ and the
Android baseline's Gson 2.10.1 without Electron. It currently covers safe field
conversion, source definitions, JSON parsing, object trimming and relative-path
fixing. It is not the full ApiConfig load sequence: network/decryption, collection
switching, home-source preferences, parses/live/proxy rules and scripts are pending.

Preserve the raw configuration text when passing it to this module. Parsing it
with JavaScript first loses Gson numeric lexical values and overflow behavior.
The `json` inspection operation returns JS numbers over JSON; use `sites` on the
original text for source-field conversion. Each core instance owns one serialized
session. A failed sites load clears the previous source map and retains the prefix
accepted before the failure. Other operations leave that map unchanged.

Prerequisites: Node 24+, JDK 17+, the pinned Gson jar. The build is offline and
does not install anything. Supply TVBOX_JAVA_HOME (or JAVA_HOME/PATH) and
TVBOX_GSON_JAR; the project's .tools paths are development fallbacks. Both Unix
and Windows classpath delimiters are supported. Current execution evidence is
macOS ARM64 host JVM only; Linux x86_64 Docker/NAS and Android/ART remain untested.

```sh
node backend/config-core/cli.mjs <<'EOF'
{"operation":"sites","text":"{sites:[{key:'demo',type:3,api:'csp_Demo',timeout:1}]}"}
EOF
```

```js
import { createConfigCore } from './backend/config-core/index.mjs';
const core = createConfigCore();
try { const sites = await core.parseSites(rawConfigText); }
finally { await core.close(); }
```

`query` accepts operations `sites`, `safe`, `json`, `trim`, `fix` and returns
`{ok:true,value}` or `{ok:false,errorType,partialSites}`. `safe` is a diagnostic
operation with fixed fallback values. `parseSites` throws ConfigParseError with
the Java error class and partial source map. Multiple pending requests use IDs
and execute in submission order. Host timeout, process failure and protocol
errors reject pending requests and stop the worker. Input/output size limits and
a 128 MiB JVM heap bound the host bridge; these are host constraints, not Android
network equivalence. `fix` accepts `url`, `text`, optional `localAddress` (default
http://127.0.0.1:9978/); it does not start a control server.

Build products live in .cache/backend/config-core and can be deleted after use.
Always close workers in finally; the CLI closes on EOF. No background service,
autostart entry or script execution is created. See NOTICE.md for licensing.
