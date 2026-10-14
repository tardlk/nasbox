# Source and licensing

This isolated module is distributed under GPL-3.0-only; see LICENSE. The existing
Win-Box desktop files retain their original license. Do not relabel the combined
backend as MIT when packaging it.

ConfigParser.java, DefaultConfig.java and SourceBean.java derive from
q215613905/TVBoxOS commit ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1:

- app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java
- app/src/main/java/com/github/tvbox/osc/util/DefaultConfig.java
- app/src/main/java/com/github/tvbox/osc/bean/SourceBean.java

The safe-field methods and source loop retain upstream behavior. Changes isolate
the selected methods from Android, omit the incomplete-site logging call, expose
normalized JSON field names, and supply the local control address explicitly.
SourceBean.java is unchanged. The runtime builds these committed sources and
does not generate its implementation from the test oracle.

UriUtil.java derives from the same commit's quickjs module. Copyright (C) 2016
The Android Open Source Project, licensed under Apache-2.0. Its original notice
is preserved. The package was changed, unused Android Uri operations removed,
and TextUtils.isEmpty replaced with the equivalent null/length check. See
LICENSE-APACHE-2.0 for that component's license.

Gson 2.10.1 is a separately supplied Apache-2.0 dependency; its artifact checksum
is pinned in runtime.json. JDK/Gson binaries are not included in this directory.
