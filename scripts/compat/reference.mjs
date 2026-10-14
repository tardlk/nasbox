import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const reference = resolve(root, 'compat/reference/tvboxos');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyReference() {
  const manifest = JSON.parse(readFileSync(resolve(reference, 'manifest.json'), 'utf8'));
  const baseline = JSON.parse(readFileSync(resolve(root, 'compat/baseline.json'), 'utf8'));
  if (manifest.commit !== baseline.android.commit) throw new Error('Reference commit differs from baseline');
  for (const file of manifest.files) {
    const actual = sha256(readFileSync(resolve(reference, file.path)));
    if (actual !== file.sha256) throw new Error(`Reference source changed: ${file.path}`);
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--restore')) {
    const manifest = JSON.parse(readFileSync(resolve(reference, 'manifest.json'), 'utf8'));
    for (const file of manifest.files) {
      const path = resolve(reference, file.path);
      if (existsSync(path) && sha256(readFileSync(path)) === file.sha256) continue;
      const response = await fetch(`https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/${file.path}`);
      if (!response.ok) throw new Error(`Download failed (${response.status}): ${file.path}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== file.sha256) throw new Error(`Download checksum differs: ${file.path}`);
      mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
    }
  }
  const manifest = verifyReference();
  console.log(JSON.stringify({ commit: manifest.commit, verifiedFiles: manifest.files.length }));
}
