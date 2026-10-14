import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { root, sha256 } from './reference.mjs';
import { buildOracle, queryOracle } from './oracle.mjs';
import { createConfigCore } from '../../backend/config-core/index.mjs';
import { runLoadScenario } from './load-runner.mjs';
import { fullCases } from './full-cases.mjs';
import { buildFullOracle, queryFullOracle } from './full-oracle.mjs';

const built = buildOracle();
const datasets = ['config', 'subscription', 'state', 'load', 'vod', 'vod-load'].map(name => {
  const input = readFileSync(resolve(root, `compat/fixtures/${name}-inputs.json`));
  return { name, inputSha256: sha256(input), cases: JSON.parse(input) };
});
const rows = [];
for (const dataset of datasets) {
  const expected = queryOracle(dataset.cases.map(item => item.request), built);
  let actual;
  if (dataset.name === 'load' || dataset.name === 'vod-load') {
    actual = [];
    for (const item of dataset.cases) actual.push({ ok: true, value: await runLoadScenario(item.request) });
  } else {
    const core = createConfigCore();
    try { actual = await Promise.all(dataset.cases.map(item => core.query(item.request))); }
    finally { await core.close(); }
  }
  rows.push(...dataset.cases.map((item, index) => ({ dataset: dataset.name, id: item.id, equal: isDeepStrictEqual(actual[index], expected[index]) })));
}
const fullBuilt = buildFullOracle();
const fullExpected = queryFullOracle(fullCases.map(c => c.request), fullBuilt);
const fullCore = createConfigCore();
try {
  const actual = await Promise.all(fullCases.map(c => fullCore.query(c.request)));
  rows.push(...fullCases.map((c, i) => ({ dataset: 'full', id: c.id, equal: isDeepStrictEqual(actual[i], fullExpected[i]) })));
} finally { await fullCore.close(); }
const report = {
  baseline: built.extraction.commit, datasets: datasets.map(({ cases, ...item }) => ({ ...item, cases: cases.length })).concat([{ name: 'full', inputSha256: sha256(JSON.stringify(fullCases)), cases: fullCases.length }]),
  platformTag: built.extraction.platformTag, cryptoProvider: built.extraction.cryptoProvider,
  host: { platform: process.platform, architecture: process.arch },
  scope: 'Independent backend vs selected unchanged source methods and AOSP helpers on host JVM; not full Android/Linux/NAS parity',
  comparison: 'Exact result equality, including Java error class and partial source map in the same ordered session',
  loadScope: 'Original loadConfig with controlled synchronous transport, temporary filesystem/Hawk adapters and source-fields parse substitute; full ApiConfig/Android async and I/O-failure behavior not certified',
  vodScope: 'Original parseJson prefix before live/hosts/proxy/rules/DOH/ads with selected reset/Hawk adapters; no executor clearing or script execution',
  fullScope: fullBuilt.extraction.scope,
  total: rows.length, matching: rows.filter(row => row.equal).length,
  differences: rows.filter(row => !row.equal).length, rows,
};
const output = resolve(root, 'docs/linux/backend-config-comparison.json');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, matching: report.matching, differences: report.differences, report: output }));
if (report.differences) process.exitCode = 1;
