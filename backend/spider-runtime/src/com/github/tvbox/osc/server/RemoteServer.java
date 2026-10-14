// SPDX-License-Identifier: GPL-3.0-only
// Explicit host binding.
package com.github.tvbox.osc.server;public class RemoteServer {public static int serverPort=9978;public static String getLocalIPAddress(android.content.Context context){String s=tvbox.runtime.HostServices.address(false);return android.net.Uri.parse(s).getHost();}}
