// SPDX-License-Identifier: GPL-3.0-only
// Explicit host binding; not an Android framework implementation.
package android.content;
public class Context {
 public static final String WINDOW_SERVICE="window";
 public android.content.res.Resources getResources(){throw new UnsupportedOperationException("No Android display");}
 public Object getSystemService(String name){throw new UnsupportedOperationException("Android services unavailable");}
 public ClassLoader getClassLoader(){return getClass().getClassLoader();}
 public java.io.File getFilesDir(){return tvbox.runtime.HostServices.directory;}
 public java.io.File getCacheDir(){return tvbox.runtime.HostServices.directory;}
}
