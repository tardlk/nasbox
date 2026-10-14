// SPDX-License-Identifier: GPL-3.0-only
import{readFileSync,existsSync}from'node:fs';import{resolve,dirname,join}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
export function nativeToolchain(){const manifest=JSON.parse(readFileSync(join(here,'runtime.json'),'utf8')),directory=process.env.TVBOX_NATIVE_LIB_DIR||join(root,'.tools/native-runtime');const jars=manifest.dependencies.map(item=>{const path=join(directory,item.filename);if(!existsSync(path)||createHash('sha256').update(readFileSync(path)).digest('hex')!==item.sha256)throw new Error('Native dependency missing/checksum differs: '+item.filename);return path;});return{manifest,jars,directory};}
