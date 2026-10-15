// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { JAR_CACHE_AGE_MS } from '../../backend/spider-runtime/artifact-cache.mjs';
const md5 = value => createHash('md5').update(value).digest('hex');
export const policyCases = (() => {
  const base = { now: 1800000000000, downloadedAt: 1800000000000 - JAR_CACHE_AGE_MS, cached: true, role: 'main', useCache: false, jarCache: 'true', signature: 'http://fixture.invalid/a' };
  const items = [
    { id: 'main-exact-age-boundary' }, { id: 'main-expired', downloadedAt: base.downloadedAt - 1 },
    { id: 'main-future-mtime', downloadedAt: base.now + 1000 }, { id: 'main-cache-disabled', jarCache: 'false' },
    { id: 'main-case-true', jarCache: 'TRUE' }, { id: 'main-blank-true', jarCache: ' true ' },
    { id: 'main-md5-match', signature: base.signature + ';md5; ' + md5('old').toUpperCase() + ' ' },
    { id: 'main-md5-change', signature: base.signature + ';md5;' + md5('new') },
    { id: 'main-forced-mismatch', useCache: true, signature: base.signature + ';md5;' + md5('new') },
    { id: 'main-md5-is-literal-url', signature: base.signature + ';md5;http://fixture.invalid/md5', remoteMd5: md5('old') },
    { id: 'main-no-cache', cached: false },
    { id: 'site-age-ignores-global-switch', role: 'site', jarCache: 'false' },
    { id: 'site-expired', role: 'site', downloadedAt: base.downloadedAt - 1 },
    { id: 'site-forced-does-not-override-md5', role: 'site', useCache: true, signature: base.signature + ';md5;' + md5('new') },
    { id: 'site-md5-url', role: 'site', signature: base.signature + ';md5;http://fixture.invalid/md5', remoteMd5: ' ' + md5('old').toUpperCase() + '\n' },
    { id: 'site-empty-md5-url-age-fallback', role: 'site', signature: base.signature + ';md5;http://fixture.invalid/md5', remoteMd5: '' },
    { id: 'site-md5-match-expired', role: 'site', downloadedAt: 1, signature: base.signature + ';md5;' + md5('old') },
    { id: 'main-unicode-url-identity', signature: 'http://fixture.invalid/中文.jar' },
    { id: 'site-surrogate-url-identity', role: 'site', signature: 'http://fixture.invalid/📦.jar' },
  ];
  return items.map(value => ({ ...base, ...value }));
})();
