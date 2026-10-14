// Explicit source observation capture; never invoked by tests.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, sha256 } from './reference.mjs';
import { buildOracle, queryOracle } from './oracle.mjs';
const built = buildOracle();
for (const name of ['state', 'load']) {
  const input = readFileSync(resolve(root, `compat/fixtures/${name}-inputs.json`));
  const cases = JSON.parse(input);
  const results = queryOracle(cases.map(item => item.request), built);
  const report = { baseline: built.extraction.commit, inputSha256: sha256(input),
    scope: name === 'load' ? 'Original loadConfig with controlled synchronous transport, filesystem/Hawk adapters and source-fields parser substitute; not full ApiConfig/Android async behavior'
      : 'Selected original collection/history/cache methods on host JVM with an in-memory Hawk adapter',
    cases: cases.map((item, index) => ({ ...item, expected: results[index] })) };
  writeFileSync(resolve(root, `compat/fixtures/${name}-observations.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ dataset: name, cases: cases.length }));
}
