// SPDX-License-Identifier: GPL-3.0-only
import { resolve, join } from 'node:path';
import { createExecutableSubscriptionSession } from './session.mjs';
import { FileSubscriptionStore } from '../subscription/store.mjs';
const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (['--native', '--cache', '--strict-md5', '--remote-modules'].includes(flag)) { options[flag.slice(2)] = true; continue; }
  if (!['--url', '--source', '--method', '--args', '--data', '--timeout', '--jar-cache-bytes'].includes(flag) || args[i + 1] === undefined) throw new Error('Invalid session CLI option');
  options[flag.slice(2)] = args[++i];
}
if (!options.url || !options.source || !options.method) throw new Error('Usage: session --url URL --source KEY --method METHOD [--args JSON] [--native] [--cache] [--strict-md5] [--data DIR] [--timeout MS] [--jar-cache-bytes BYTES]');
const data = options.data ? resolve(options.data) : null;
const session = await createExecutableSubscriptionSession({
  remoteJars: true, remoteModules: !!options['remote-modules'], nativeBridge: !!options.native,
  runtimeTimeoutMs: options.timeout ? Number(options.timeout) : undefined,
  runtimeDataDir: data ? join(data, 'runtime') : undefined,
  artifactCacheDir: data ? join(data, 'artifacts') : undefined,
  store: data ? new FileSubscriptionStore(join(data, 'subscription')) : undefined,
  jarCacheOptions: { integrity: options['strict-md5'] ? 'strict' : 'android', ...(options['jar-cache-bytes'] ? { maxBytes: Number(options['jar-cache-bytes']) } : {}) },
});
try {
  const imported = await session.load({ apiUrl: options.url, useCache: !!options.cache });
  if (!imported.ok) throw new Error('Subscription import failed');
  const result = await session.call(options.source, options.method, JSON.parse(options.args || '[]'));
  console.log(JSON.stringify({ scope: session.scope, ready: result.spider.ready, value: result.value, artifacts: (await session.getState()).artifacts }));
  if (!result.spider.ready) process.exitCode = 1;
} finally { await session.close(); }
