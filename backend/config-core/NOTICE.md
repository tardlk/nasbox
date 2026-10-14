# Source and licensing

This isolated module is distributed under GPL-3.0-only; see LICENSE. The existing
Win-Box desktop files retain their original license. Do not relabel the combined
backend as MIT when packaging it.

ConfigParser.java, DefaultConfig.java, SubscriptionConfig.java, HistoryHelper.java,
AES.java, SourceBean.java, ParseBean.java, VodConfig.java and FullConfig.java derive from
q215613905/TVBoxOS commit ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1:

- app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java
- app/src/main/java/com/github/tvbox/osc/util/DefaultConfig.java
- app/src/main/java/com/github/tvbox/osc/bean/SourceBean.java
- app/src/main/java/com/github/tvbox/osc/bean/ParseBean.java
- app/src/main/java/com/github/tvbox/osc/util/HistoryHelper.java
- app/src/main/java/com/github/tvbox/osc/util/AES.java
- app/src/main/java/com/github/tvbox/osc/util/MD5.java
- app/src/main/java/com/github/tvbox/osc/util/FileUtils.java (reference-only saveCache method)

The safe-field methods and source loop retain upstream behavior. Changes isolate
the selected methods from Android, omit the incomplete-site logging call, expose
normalized JSON field names, and supply the local control address explicitly.
SourceBean.java and AES.java are unchanged. SubscriptionConfig isolates original
URL/decode/collection methods and delegates Android local-address/path helpers.
HistoryHelper retains original name-tab-url methods. The runtime builds these committed sources and
does not generate its implementation from the test oracle.

HistoryHelper now also includes selected original history/clear methods with
Hawk access replaced by a per-instance PreferenceStore. SubscriptionConfig's
original switch/clear logic uses the same adapter. CacheSupport includes selected
MD5.encode and readConfigFile logic; the reader's input stream is supplied as a
byte array rather than a filesystem path. The Node source subscription loader
ports original loadConfig control flow with explicit host adapters/limits; see
../subscription/README.md. Its FileSubscriptionStore atomically replaces files,
rather than using Android FileUtils' delete-then-write implementation.

VodConfig ports the original parseJson prefix ending before live processing,
plus original getSource/setSourceBean/setDefaultParse/addSuperParse/search methods.
Hawk and TextUtils calls use explicit adapters; reset clears only the selected
containers and does not claim to destroy script runtimes. ParseBean changes only
its DefaultConfig import. DefaultConfig is public for that import, and the original
proxy replacement helper receives the explicit host local address. Raw selected
home/default object snapshots are harness observations, not all ApiConfig getters.

UriUtil.java derives from the same commit's quickjs module. Copyright (C) 2016
The Android Open Source Project, licensed under Apache-2.0. Its original notice
is preserved. The package was changed, unused Android Uri operations removed,
and TextUtils.isEmpty replaced with the equivalent null/length check. See
LICENSE-APACHE-2.0 for that component's license.

The six files under src/org/json, Base64.java and android/net/Uri.java/UriCodec.java are unmodified
AOSP Android 13 copies, copyright (C) 2010 The Android Open Source Project,
Apache-2.0. Pins are recorded in compat/reference/android-platform/manifest.json;
the original notices and LICENSE-APACHE-2.0 are preserved. Host annotation
declarations under src/android/{annotation,compat} and src/libcore implement no
Android runtime behavior. Host Parcel/storage/permission service declarations under
src/android/os and content throw UnsupportedOperationException; log output is
suppressed. These unreachable bindings do not replace URI parsing behavior.

Gson 2.10.1 is a separately supplied Apache-2.0 dependency. Bouncy Castle 1.78.1 is
separately supplied under its MIT-style license (LICENSE-BOUNCY-CASTLE, extracted
from the pinned artifact's own org.bouncycastle.LICENSE class). Both artifact
checksums are pinned in runtime.json. JDK/Gson/BC binaries are not included here.

FullConfig additionally incorporates unchanged selected ApiConfig parse/reset/live/
proxy methods; the static live-index getters become instance methods for the host
preference adapter. Original LiveChannelGroup/Item, LiveSettingGroup/Item, ProxyRule,
OkProxySelector, RegexUtils, VideoParseRuler and TxtSubscribe class bodies are nested
in the host module (imports/packages adapted). Selected M3u8.isAd/isDouble, MD5.
string2MD5, DefaultConfig.isVideoFormat and AdBlocker methods are retained; Android
WebResourceResponse construction and player IJK configuration are omitted. Sources
are pinned in compat/reference/tvboxos-extra/manifest.json under the same upstream
commit. FullConfig default ad seeding retains the original JSON and ad loop.

Hawk, logging, executor and HTTP rebuild boundaries are explicit host adapters.
Empty executor clears are modeled; unbound script initialization throws and is
recorded, and HTTP client rebuilds are recorded as incomplete. Configuration state
and original matching/selection helpers are covered, not real Android executors,
HTTP/DNS machinery or media execution. The production build consumes committed
Java files and does not import or run the reference extractor.
