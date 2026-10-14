// SPDX-License-Identifier: GPL-3.0-only
import {readFileSync} from 'node:fs';import{resolve,dirname,join}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
export function androidAssets(){const manifest=JSON.parse(readFileSync(join(here,'manifest.json'),'utf8'));const files=manifest.files.map(entry=>{const source=resolve(root,entry.source);if(createHash('sha256').update(readFileSync(source)).digest('hex')!==entry.sha256)throw new Error('Android JS asset checksum differs: '+entry.path);return{...entry,source};});return{manifest,files};}
