// SPDX-License-Identifier: GPL-3.0-only
// Explicit host binding; not an Android framework implementation.
package com.github.catvod.net;
public class OkHttp {public static okhttp3.OkHttpClient client(){return tvbox.runtime.HostServices.client;}public static okhttp3.Dns dns(){return client().dns();}}
