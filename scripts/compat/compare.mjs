import { safeJsonString, safeJsonInt, safeJsonStringList, parseJsonLenient } from '../../src/engine/util/json.ts';
import { trimJsonObject, fixContentPath } from '../../src/engine/config/ApiConfigParser.ts';
import { parseSite } from '../../src/engine/config/SiteParser.ts';
import { isDeepStrictEqual } from 'node:util';

export function queryWinbox(request) {
  try {
    let value;
    switch (request.operation) {
      case 'safe': {
        const object = parseJsonLenient(request.text), key = request.key || 'value';
        value = { string: safeJsonString(object, key, 'fallback'), int: safeJsonInt(object, key, 17), list: safeJsonStringList(object, key) };
        break;
      }
      case 'json': value = parseJsonLenient(request.text); break;
      case 'trim': value = trimJsonObject(request.text); break;
      case 'fix': value = fixContentPath(request.url, request.text); break;
      case 'sites': {
        const config = parseJsonLenient(request.text);
        if (!Array.isArray(config?.sites)) throw new Error('sites is not an array');
        value = config.sites.map((item, index) => parseSite(item, index).bean).filter(Boolean).map(bean => {
          const { homePage, ...result } = bean;
          // Compare equivalent fields, including the effective playback timeout,
          // but preserve the raw stored timeout as a separate field.
          return { ...result, playTimeoutSeconds: bean.timeout > 0 ? Math.max(5, Math.min(60, bean.timeout)) : 15 };
        });
        break;
      }
      default: throw new Error('Unknown operation');
    }
    return { ok: true, value };
  } catch (error) { return { ok: false, errorType: error.name }; }
}

export function compareResult(expected, actual) {
  if (expected.ok !== actual.ok) return { equal: false, status: 'different', reason: 'success/error behavior differs' };
  if (!expected.ok) return { equal: false, status: 'unmapped-error', reason: 'Both reject; error classes and partial-state semantics require Android mapping' };
  const equal = isDeepStrictEqual(expected.value, actual.value);
  return { equal, status: equal ? 'matching' : 'different', reason: 'value comparison' };
}
