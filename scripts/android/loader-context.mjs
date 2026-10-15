// SPDX-License-Identifier: GPL-3.0-only
// Fixed-byte loader setup identities; signatures remain private inputs.
import { createHash } from 'node:crypto';
import { jarSignature, jarUrlKey } from '../../backend/spider-runtime/artifact-cache.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
export const officialOracleApkSha256 = '5fb63e491f280c0e271091da5490fcdf0923d6c2f8773ef03553b20a333db657';
const identityError = reason => Object.assign(new Error('INPUT_CHECKSUM: loader context differs: ' + reason), { code: 'INPUT_CHECKSUM' });
const fields = ['loaderMode', 'jarSignatureSha256', 'jarLoadKey', 'mainJarSha256', 'mainSignatureSha256'];

export function loaderContextOf(artifact, site) {
  const value = site?.loaderContext;
  const legacy = value === undefined;
  if (!legacy && (!value || !['main', 'site'].includes(value.role) || typeof value.signature !== 'string')) throw identityError('malformed role or signature');
  const role = legacy ? 'main' : value.role, signature = legacy ? '' : value.signature;
  if (!legacy && (typeof site.jar !== 'string' || site.jar !== (role === 'site' ? signature : ''))) throw identityError('source JAR signature');
  if (role === 'site' && !signature) throw identityError('empty site signature');
  const main = value?.main;
  if (main !== undefined && (role !== 'site' || !main || !hashPattern.test(main.sha256) || typeof main.jarPath !== 'string' || !main.jarPath || typeof main.jarUrl !== 'string' || !main.jarUrl || typeof main.signature !== 'string' || !main.signature)) throw identityError('malformed main artifact');
  const identity = {
    loaderMode: role, jarSignatureSha256: sha(signature), jarLoadKey: role === 'main' ? 'main' : jarUrlKey(signature),
    mainJarSha256: main?.sha256 ?? null, mainSignatureSha256: main ? sha(main.signature) : null,
  };
  if (site.expectedLoaderIdentity !== undefined) for (const field of fields) {
    if (!Object.hasOwn(site.expectedLoaderIdentity, field) || site.expectedLoaderIdentity[field] !== identity[field]) throw identityError('planned ' + field);
  }
  return { legacy, role, signature, source: role === 'site' ? jarSignature(signature, { role: 'site' }).source : '', main, identity };
}

export function assertLoaderIdentity(meta, artifact, site) {
  const context = loaderContextOf(artifact, site);
  if (!meta || meta.loaderMode !== context.role) throw identityError('loader mode');
  // Historical plans/reports used main unconditionally and did not emit these pins.
  const hasNewFields = fields.slice(1).some(field => Object.hasOwn(meta, field));
  if (!context.legacy || hasNewFields) for (const field of fields) {
    if (!Object.hasOwn(meta, field) || meta[field] !== context.identity[field]) throw identityError(field);
  }
  if (!context.legacy && meta.loadSuccess === true && (meta.jarBytesVerified !== true || context.main && meta.mainJarBytesVerified !== true)) throw identityError('successful load lacks verified input bytes');
  return context;
}
