// SPDX-License-Identifier: GPL-3.0-only
package com.github.catvod.crawler;
/** Public boundary around the unchanged upstream package-private implementation. */
public final class ProtectedJarSupport {
 private final ProtectedInitJar delegate=new ProtectedInitJar();
 public boolean check(String path){return delegate.check(path);}
 public boolean init(Class<?> type){return delegate.init(type);}
}
