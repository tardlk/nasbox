// JSON-lines interface for inspecting baseline method behavior, no HTTP service.
import { readFileSync } from 'node:fs';
import { queryOracle } from './oracle.mjs';

const input = readFileSync(0, 'utf8').trim();
if (!input) throw new Error('Provide JSON lines on stdin: {"operation":"sites","text":"..."}');
const requests = input.split('\n').filter(Boolean).map(line => JSON.parse(line));
for (const response of queryOracle(requests)) process.stdout.write(JSON.stringify(response) + '\n');
