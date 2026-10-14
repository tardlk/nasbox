// Explicitly regenerate reference observations when the pinned baseline changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, sha256 } from './reference.mjs';
import { buildOracle, queryOracle } from './oracle.mjs';

const input = readFileSync(resolve(root, 'compat/fixtures/config-inputs.json'));
const cases = JSON.parse(input);
const built = buildOracle();
const actual = queryOracle(cases.map(item => item.request), built);
const report = {
  baseline: built.extraction.commit,
  inputSha256: sha256(input),
  execution: 'Selected unchanged upstream Java methods on host JVM + upstream Gson 2.10.1; no Android runtime',
  cases: cases.map((item, index) => ({ ...item, expected: actual[index] })),
};
writeFileSync(resolve(root, 'compat/fixtures/config-observations.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ capturedCases: cases.length, baseline: report.baseline }));
