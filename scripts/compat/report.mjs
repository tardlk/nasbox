import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, sha256 } from './reference.mjs';
import { buildOracle, queryOracle } from './oracle.mjs';
import { queryWinbox, compareResult } from './compare.mjs';

const input = readFileSync(resolve(root, 'compat/fixtures/config-inputs.json'));
const cases = JSON.parse(input);
const built = buildOracle();
const expected = queryOracle(cases.map(item => item.request), built);
const rows = cases.map((item, index) => {
  const actual = queryWinbox(item.request);
  return { id: item.id, ...compareResult(expected[index], actual), androidSource: expected[index], winbox: actual };
});
const report = { baseline: built.extraction.commit, winbox: '136fadcacb2b3a9bd96320578d93e9735452d9e9',
  inputSha256: sha256(input),
  scope: 'Host-JVM selected source-method comparison only; not full Android, Linux or NAS verification',
  total: rows.length, matching: rows.filter(row => row.equal).length,
  differences: rows.filter(row => row.status === 'different').length,
  unmappedErrors: rows.filter(row => row.status === 'unmapped-error').length, rows };
const output = resolve(root, 'docs/linux/config-comparison.json');
mkdirSync(resolve(root, 'docs/linux'), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, matching: report.matching, differences: report.differences, unmappedErrors: report.unmappedErrors, report: output }));
// A diagnostic report can be generated with existing differences. --gate makes
// parity a CI gate and deliberately fails until all recorded differences close.
if (process.argv.includes('--gate') && (report.differences || report.unmappedErrors)) process.exitCode = 1;
