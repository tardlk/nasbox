// SPDX-License-Identifier: GPL-3.0-only
import { createInterface } from 'node:readline';
import { createConfigCore } from './index.mjs';

const core = createConfigCore();
const input = createInterface({ input: process.stdin });
try {
  for await (const line of input) {
    if (!line.trim()) continue;
    try { console.log(JSON.stringify(await core.query(JSON.parse(line)))); }
    catch (error) { console.log(JSON.stringify({ ok: false, hostError: error.message })); }
  }
} finally {
  input.close();
  await core.close();
}
