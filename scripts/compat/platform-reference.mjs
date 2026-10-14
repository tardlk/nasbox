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

// Annotation declarations only; no Android API behavior is mocked by these.
const annotations = {
  'android/compat/annotation/UnsupportedAppUsage.java': 'package android.compat.annotation; public @interface UnsupportedAppUsage {}',
  'android/annotation/SystemApi.java': 'package android.annotation; public @interface SystemApi { enum Client { MODULE_LIBRARIES } Client client(); }',
  'libcore/util/NonNull.java': 'package libcore.util; @java.lang.annotation.Target(java.lang.annotation.ElementType.TYPE_USE) public @interface NonNull {}',
  'libcore/util/Nullable.java': 'package libcore.util; @java.lang.annotation.Target(java.lang.annotation.ElementType.TYPE_USE) public @interface Nullable {}',
};

export function copyPlatformReference(target) {
  const verified = verifyPlatformReference();
  const sources = [];
  for (const file of verified.manifest.files) {
    const relative = file.path.replace(/^(?:libcore|frameworks-base)\//, '');
    const path = resolve(target, relative);
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(resolve(verified.platform, file.path), path);
    sources.push(path);
  }
  for (const [relative, source] of Object.entries(annotations)) {
    const path = resolve(target, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '// Host-only annotation declaration.\n' + source + '\n');
    sources.push(path);
  }
  return { ...verified, sources };
}
