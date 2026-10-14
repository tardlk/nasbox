import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { root, sha256 } from './reference.mjs';
import { buildOracle, queryOracle } from './oracle.mjs';
import { createConfigCore } from '../../backend/config-core/index.mjs';

const built = buildOracle();
const datasets = ['config', 'subscription'].map(name => {
  const input = readFileSync(resolve(root, `compat/fixtures/${name}-inputs.json`));
  return { name, inputSha256: sha256(input), cases: JSON.parse(input) };
});
const core = createConfigCore();
const rows = [];
try {
  for (const dataset of datasets) {
    // Separate sessions reset their source maps explicitly before observations.
    await core.query({ operation: 'sites', text: '{sites:[]}' });
    const expected = queryOracle(dataset.cases.map(item => item.request), built);
    const actual = await Promise.all(dataset.cases.map(item => core.query(item.request)));
    rows.push(...dataset.cases.map((item, index) => ({ dataset: dataset.name, id: item.id, equal: isDeepStrictEqual(actual[index], expected[index]) })));
  }
}
finally { await core.close(); }
const report = {
  baseline: built.extraction.commit, datasets: datasets.map(({ cases, ...item }) => ({ ...item, cases: cases.length })),
  platformTag: built.extraction.platformTag, cryptoProvider: built.extraction.cryptoProvider,
  host: { platform: process.platform, architecture: process.arch },
  scope: 'Independent backend vs selected unchanged source methods and AOSP helpers on host JVM; not full Android/Linux/NAS parity',
  comparison: 'Exact result equality, including Java error class and partial source map in the same ordered session',
  total: rows.length, matching: rows.filter(row => row.equal).length,
  differences: rows.filter(row => !row.equal).length, rows,
};
const output = resolve(root, 'docs/linux/backend-config-comparison.json');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, matching: report.matching, differences: report.differences, report: output }));
if (report.differences) process.exitCode = 1;
