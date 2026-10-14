// Explicit capture, never run by tests.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, sha256 } from './reference.mjs';
import { buildOracle, queryOracle } from './oracle.mjs';
const built = buildOracle();
for (const name of ['vod', 'vod-load']) {
  const input = readFileSync(resolve(root, `compat/fixtures/${name}-inputs.json`));
  const cases = JSON.parse(input), results = queryOracle(cases.map(item => item.request), built);
  writeFileSync(resolve(root, `compat/fixtures/${name}-observations.json`), JSON.stringify({ baseline: built.extraction.commit,
    inputSha256: sha256(input), scope: 'Original ApiConfig prefix before live/hosts/proxy/rules/DOH/ads, with selected reset/Hawk adapters; no script execution or full Android behavior',
    cases: cases.map((item, index) => ({ ...item, expected: results[index] })),
  }, null, 2) + '\n');
  console.log(JSON.stringify({ dataset: name, cases: cases.length }));
}
