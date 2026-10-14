// SPDX-License-Identifier: GPL-3.0-only
// Explicit host binding.
package com.lzy.okgo;public class OkGo {private static final OkGo INSTANCE=new OkGo();public static OkGo getInstance(){return INSTANCE;}public void cancelTag(Object tag){for(okhttp3.Call call:tvbox.runtime.HostServices.client.dispatcher().queuedCalls())if(tag.equals(call.request().tag()))call.cancel();for(okhttp3.Call call:tvbox.runtime.HostServices.client.dispatcher().runningCalls())if(tag.equals(call.request().tag()))call.cancel();}}
