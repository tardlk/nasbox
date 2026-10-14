// SPDX-License-Identifier: GPL-3.0-only
// Explicit host binding; not an Android framework implementation.
package com.github.tvbox.osc.server;
public class ControlManager {private static final ControlManager INSTANCE=new ControlManager();public static ControlManager get(){return INSTANCE;}public String getAddress(boolean local){return tvbox.runtime.HostServices.address(local);}}
