// SPDX-License-Identifier: GPL-3.0-only
// Explicit host binding; not an Android framework implementation.
package com.github.tvbox.osc.base;
public class App extends android.content.Context {private static final App INSTANCE=new App();public static App getInstance(){return INSTANCE;}public android.app.Activity getCurrentActivity(){return null;}}
