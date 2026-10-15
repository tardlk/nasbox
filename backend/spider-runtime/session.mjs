// SPDX-License-Identifier: GPL-3.0-only
import { createSpiderRuntime } from './index.mjs';
import { createFullSubscriptionLoader } from '../subscription/full-loader.mjs';
import { RuntimeCleanup } from '../subscription/runtime-cleanup.mjs';
import { JarArtifactCache } from './artifact-cache.mjs';

/** Full config → lazy type=3 execution. Automatic HTTP(S) JAR retrieval is opt-in. */
export async function createExecutableSubscriptionSession(options = {}) {
  const owned = !options.runtime;
  if (!owned && options.remoteJars && !options.artifactCache) throw new Error('Borrowed runtime requires a caller-owned artifactCache for remote JARs');
  const runtime = options.runtime || createSpiderRuntime({ dataDir: options.runtimeDataDir, timeoutMs: options.runtimeTimeoutMs ?? (options.nativeBridge ? 45000 : 10000), nativeBridge: options.nativeBridge ?? false, nativeBackend: options.nativeBackend ?? 'dynarmic' });
  const cleanup = new RuntimeCleanup(), tracked = new Set(), resolved = new Map(), registrations = new Set();
  let cache, loader, mainSignature, closed = false, queue = Promise.resolve(), closing, jarUseCache = false;
  const ownedCache = !options.artifactCache;
  try {
    cache = options.artifactCache || (options.remoteJars ? new JarArtifactCache({ ...options.jarCacheOptions, directory: options.artifactCacheDir }) : null);
    loader = createFullSubscriptionLoader({ ...options, runtimeCleanup: cleanup, beforeRuntimeClear: () => runtime.request({ operation: 'resetKeys' }) });
    if (options.modules || options.moduleRoot || options.remoteModules || options.androidModules) await runtime.setModules({ modules: options.modules, root: options.moduleRoot, android: !!options.androidModules || !!options.remoteModules, remote: !!options.remoteModules });
  } catch (error) {
    try { await loader?.close(); } finally { try { if (owned) await runtime.close(); } finally { if (ownedCache) await cache?.close(); } }
    throw error;
  }
  const serialize = action => {
    if (closed) return Promise.reject(new Error('Executable subscription session is closed'));
    const result = queue.then(action); queue = result.catch(() => {}); return result;
  };
  async function releaseArtifacts() {
    runtime.forgetJarRegistrations?.(registrations);
    registrations.clear(); resolved.clear(); mainSignature = undefined;
    await cache?.releaseAll();
  }
  async function clearJar() { await runtime.clear('jar'); await releaseArtifacts(); }
  function track(kind) {
    if (tracked.has(kind)) return;
    tracked.add(kind);
    cleanup.register(kind, { clear: async () => {
      if (kind === 'jar') await clearJar(); else await runtime.clear(kind);
      tracked.delete(kind);
    } });
  }
  async function artifact(signature, role, globals, force = false) {
    const path = options.artifacts?.[signature] || options.artifacts?.[signature.split(';md5;')[0]];
    if (path) return { path, origin: 'mapping' };
    if (!cache) throw new Error('Unresolved JAR artifact; provide an explicit mapping or enable remoteJars');
    const identity = role + ':' + signature;
    if (!force && resolved.has(identity)) return resolved.get(identity);
    const entry = await cache.acquire(signature, { role, useCache: jarUseCache, jarCache: globals.jarCache, force });
    resolved.set(identity, entry);
    return entry;
  }
  async function loadMain(signature, globals) {
    let force = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      let entry;
      try { entry = await artifact(signature, 'main', globals, force); }
      catch (error) {
        // Android retries one failed download; integrity, ownership and quota errors are final.
        if (attempt || !cache || error.code && !/^JAR_HTTP_/.test(error.code) || error.name === 'AbortError') throw error;
        force = true; continue;
      }
      const loaded = await runtime.loadMain(entry.path);
      if (loaded.loaded) { mainSignature = signature; return; }
      if (entry.origin === 'mapping' || entry.origin === 'cache' && ['md5', 'forced'].includes(entry.rule) || attempt) throw new Error('Global JAR could not be initialized');
      // Failed age-cache/download initialization gets one bounded refresh. Clear all
      // active native resources before releasing files, including site-specific jars.
      await clearJar();
      if (entry.key) await cache.invalidate(entry.key);
      force = true;
    }
    throw new Error('Global JAR could not be initialized');
  }
  async function resolveSpider(key) {
    const config = await loader.getConfig(), source = config.sites.find(s => s.key === key);
    if (!source) throw new Error('Source key does not exist');
    const kind = await runtime.request({ operation: 'route', api: source.api });
    if (kind === 'py') return runtime.getCSP(source);
    if (source.jar) track('jar');
    track(kind);
    if (source.jar) {
      const identity = 'registered:' + source.jar;
      if (!resolved.has(identity)) {
        const entry = await artifact(source.jar, 'site', config.globals);
        await runtime.registerJar(source.jar, entry.path);
        resolved.set(identity, entry);
        if (entry.origin !== 'mapping') registrations.add(source.jar);
      }
    } else if (kind === 'jar' && config.globals.spider && mainSignature !== config.globals.spider) await loadMain(config.globals.spider, config.globals);
    return runtime.getCSP(source);
  }
  return {
    scope: 'config-state + lazy host-jvm/dex/quickjs-source; optional HTTP JAR cache',
    load: (request = {}) => serialize(async () => { const result = await loader.load(request); jarUseCache = !!request.useCache; return result; }),
    getCSP: key => serialize(() => resolveSpider(key)),
    call: (key, method, args = []) => serialize(async () => { const spider = await resolveSpider(key); return { spider, value: await runtime.call(spider.token, method, args) }; }),
    getConfig: () => serialize(() => loader.getConfig()),
    getState: () => serialize(async () => ({ subscription: await loader.getState(), runtime: await runtime.getState(), ...(cache ? { artifacts: await cache.getState() } : {}) })),
    close() {
      closing ||= (async () => {
        closed = true; await queue;
        try { await loader.close(); }
        finally { try { if (owned) await runtime.close(); } finally { if (ownedCache) await cache?.close(); } }
      })(); return closing;
    },
  };
}
