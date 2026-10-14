// Compatibility tests need Node >=24; no Electron/TypeScript installation.
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron') throw new Error('Compatibility core must not load Electron');
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const target = new URL(specifier, context.parentURL);
      for (const suffix of ['', '.ts', '/index.ts']) {
        const url = new URL(target.href + suffix);
        try {
          if (statSync(fileURLToPath(url)).isFile()) return { url: url.href, shortCircuit: true };
        } catch {}
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return {
      format: 'module',
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }),
      shortCircuit: true,
    };
    return next(url, context);
  },
});
