// SPDX-License-Identifier: GPL-3.0-only
package com.github.tvbox.osc.base;
public class App extends android.app.Application {private static final App INSTANCE=new App();public static App getInstance(){return INSTANCE;}public android.app.Activity getCurrentActivity(){return null;}}
