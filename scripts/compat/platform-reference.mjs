import { readFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { root, sha256 } from './reference.mjs';

export function verifyPlatformReference() {
  const platform = resolve(root, 'compat/reference/android-platform');
  const manifest = JSON.parse(readFileSync(resolve(platform, 'manifest.json'), 'utf8'));
  if (sha256(readFileSync(resolve(platform, manifest.license.path))) !== manifest.license.sha256) throw new Error('Android reference license changed');
  for (const file of manifest.files) {
    if (sha256(readFileSync(resolve(platform, file.path))) !== file.sha256) throw new Error(`Android source changed: ${file.path}`);
  }
  const extra = resolve(root, 'compat/reference/tvboxos-extra');
  const additional = JSON.parse(readFileSync(resolve(extra, 'manifest.json'), 'utf8'));
  const baseline = JSON.parse(readFileSync(resolve(root, 'compat/baseline.json'), 'utf8'));
  if (additional.commit !== baseline.android.commit) throw new Error('Additional TVBoxOS reference commit differs');
  for (const file of additional.files) {
    if (sha256(readFileSync(resolve(extra, file.path))) !== file.sha256) throw new Error(`Additional reference changed: ${file.path}`);
  }
  return { platform, manifest, extra, additional };
}

// Host annotations and unreachable Android service bindings. Service APIs fail explicitly.
const annotations = {
  'android/compat/annotation/UnsupportedAppUsage.java': 'package android.compat.annotation; public @interface UnsupportedAppUsage {}',
  'android/annotation/SystemApi.java': 'package android.annotation; public @interface SystemApi { enum Client { MODULE_LIBRARIES } Client client() default Client.MODULE_LIBRARIES; }',
  'android/annotation/NonNull.java': 'package android.annotation; public @interface NonNull {}',
  'android/annotation/Nullable.java': 'package android.annotation; public @interface Nullable {}',
  'android/os/Parcelable.java': 'package android.os; public interface Parcelable {int describeContents();void writeToParcel(Parcel p,int flags);interface Creator<T>{T createFromParcel(Parcel p);T[] newArray(int n);}}',
  'android/os/Parcel.java': 'package android.os; public class Parcel {public int readInt(){throw new UnsupportedOperationException("Parcel unavailable");} public String readString8(){throw new UnsupportedOperationException("Parcel unavailable");}public void writeString8(String s){throw new UnsupportedOperationException("Parcel unavailable");}public String readString(){throw new UnsupportedOperationException("Parcel unavailable");}public void writeInt(int n){throw new UnsupportedOperationException("Parcel unavailable");}public void writeString(String s){throw new UnsupportedOperationException("Parcel unavailable");}}',
  'android/os/Environment.java': 'package android.os; public class Environment {public static boolean isExternalStorageEmulated(){throw new UnsupportedOperationException("Android storage unavailable");}public static java.io.File getLegacyExternalStorageDirectory(){throw new UnsupportedOperationException("Android storage unavailable");}public static java.io.File getExternalStorageDirectory(){throw new UnsupportedOperationException("Android storage unavailable");}}',
  'android/os/StrictMode.java': 'package android.os; public class StrictMode {public static void onFileUriExposed(android.net.Uri uri,String location){throw new UnsupportedOperationException("Android StrictMode unavailable");}public static void onContentUriWithoutPermission(android.net.Uri uri,String location){throw new UnsupportedOperationException("Android StrictMode unavailable");}}',
  'android/content/Intent.java': 'package android.content; public class Intent {public static boolean isAccessUriMode(int flags){throw new UnsupportedOperationException("Android permissions unavailable");}}',
  'android/util/Log.java': 'package android.util; public class Log {public static int w(String tag,String message,Throwable t){return 0;}}',
  'libcore/util/NonNull.java': 'package libcore.util; @java.lang.annotation.Target(java.lang.annotation.ElementType.TYPE_USE) public @interface NonNull {}',
  'libcore/util/Nullable.java': 'package libcore.util; @java.lang.annotation.Target(java.lang.annotation.ElementType.TYPE_USE) public @interface Nullable {}',
};

export function copyPlatformReference(target) {
  const verified = verifyPlatformReference();
  const sources = [];
  for (const file of verified.manifest.files) {
    if (file.sourceOnly) continue;
    const relative = file.path.replace(/^(?:libcore|frameworks-base)\//, '');
    const path = resolve(target, relative);
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(resolve(verified.platform, file.path), path);
    sources.push(path);
  }
  for (const [relative, source] of Object.entries(annotations)) {
    const path = resolve(target, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '// Host-only declaration; Android service APIs are unavailable.\n' + source + '\n');
    sources.push(path);
  }
  return { ...verified, sources };
}
