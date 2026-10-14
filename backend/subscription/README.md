# Subscription preparation

`prepareSubscription(apiUrl, body, options)` composes the URL/key selection,
FindResult decode, original-clan content rewriting, relative path fixing and
collection identification steps in their upstream order. The input body is a
string; do not preparse it with JavaScript JSON. Returns
`{requestUrl, text, collectionLines}`. The returned text is the prepared config,
not a claim that the entire configuration or its scripts have loaded.

```js
import { prepareSubscription } from './backend/subscription/prepare.mjs';
const prepared = await prepareSubscription(configuredUrl, rawBodyText);
```

Supply `{core}` to reuse a config-core worker; otherwise this helper creates and
closes one in finally. Optional `localAddress` supplies the Android control-server
address substitute. SubscriptionPreparationError includes the failed stage,
Java exception class and partial source map. It does not include the raw config
or key in its message. The helper opens no network listener and executes no code
from the subscription. The module is GPL-3.0-only, with source/license notices in
../config-core.

Collection lines preserve the original `name + tab + url` format, ordering and
coercion, including odd inputs. Recognition is implemented; persisted history,
switching to the first line, recursion, network fetch and cache fallback remain
pending. The helper intentionally does not auto-follow the list or call parseSites
on it as if it were a normal source configuration.

FindResult retains Android's org.json-first detection, AOSP Base64.DEFAULT,
2423 AES-CBC and configured-key AES-ECB, including null/fallback behavior and
truncating/padding keys as the original does. AOSP helpers are pinned to Android
13 source; desktop Bouncy Castle supplies PKCS7. These are host-JVM source-method
results, not proof of equivalence with every Android OS/provider/ART version.

The read-only development HTTP probe lives in scripts/compat/subscription-probe.mjs.
It now uses this module and compares URL/decode/path/collection/site results with
the reference. Its Node fetch and explicit UTF-8 byte conversion are not Android
OkHttp response-body charset/BOM decoding, TLS/DNS/proxy/cookie/cache equivalence.
