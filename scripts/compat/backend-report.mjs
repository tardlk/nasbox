import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { root, sha256 } from './reference.mjs';
import { buildOracle, queryOracle } from './oracle.mjs';
import { createConfigCore } from '../../backend/config-core/index.mjs';

const input = readFileSync(resolve(root, 'compat/fixtures/config-inputs.json'));
const cases = JSON.parse(input);
const built = buildOracle();
const expected = queryOracle(cases.map(item => item.request), built);
const core = createConfigCore();
let actual;
try { actual = await Promise.all(cases.map(item => core.query(item.request))); }
finally { await core.close(); }
const rows = cases.map((item, index) => ({ id: item.id, equal: isDeepStrictEqual(actual[index], expected[index]) }));
const report = {
  baseline: built.extraction.commit, inputSha256: sha256(input),
  scope: 'Independent backend vs selected unchanged source methods on macOS ARM64 host JVM; not full Android/Linux/NAS parity',
  comparison: 'Exact result equality, including Java error class and partial source map in the same ordered session',
  total: rows.length, matching: rows.filter(row => row.equal).length,
  differences: rows.filter(row => !row.equal).length, rows,
};
const output = resolve(root, 'docs/linux/backend-config-comparison.json');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, matching: report.matching, differences: report.differences, report: output }));
if (report.differences) process.exitCode = 1;
