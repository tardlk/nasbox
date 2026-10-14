// Explicit capture; never run automatically by the tests.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, sha256 } from './reference.mjs';
import { buildOracle, queryOracle } from './oracle.mjs';

const input = readFileSync(resolve(root, 'compat/fixtures/subscription-inputs.json'));
const cases = JSON.parse(input);
const built = buildOracle();
const results = queryOracle(cases.map(item => item.request), built);
const report = {
  baseline: built.extraction.commit, platformTag: built.extraction.platformTag,
  cryptoProvider: built.extraction.cryptoProvider, inputSha256: sha256(input),
  scope: 'Selected original TVBoxOS methods and AOSP helpers on host JVM; not Android/ART or full client execution',
  cases: cases.map((item, index) => ({ ...item, expected: results[index] })),
};
writeFileSync(resolve(root, 'compat/fixtures/subscription-observations.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ capturedCases: cases.length, baseline: report.baseline }));
