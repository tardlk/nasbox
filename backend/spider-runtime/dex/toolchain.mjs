// SPDX-License-Identifier: GPL-3.0-only
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
export function dexToolchain({directory=process.env.TVBOX_DEX_LIB_DIR||join(root,'.tools/dex2jar-v2.4'),required=false}={}){
 if(!existsSync(directory)){if(required)throw new Error('DEX converter is not installed');return null;}
 const manifest=JSON.parse(readFileSync(join(here,'toolchain.json'),'utf8'));
 for(const entry of manifest.files){const path=join(directory,entry.path);if(!existsSync(path)||hash(readFileSync(path))!==entry.sha256)throw new Error('DEX tool checksum differs: '+entry.path);}
 return{classpath:manifest.files.filter(e=>e.path.endsWith('.jar')).map(e=>join(directory,e.path)).join(delimiter),fingerprint:hash(JSON.stringify({manifest,adapterSha256:hash(readFileSync(join(here,'../src/tvbox/runtime/DexArtifacts.java')))})),manifest,directory};
}
