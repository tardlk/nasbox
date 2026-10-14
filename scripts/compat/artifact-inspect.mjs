// Diagnostic ZIP/DEX inventory only. Never executes code or writes archive paths.
import {inflateRawSync} from 'node:zlib';
const MAX=64*1024*1024;
export function zipEntries(bytes){
 if(bytes.length>MAX)throw new Error('ZIP input limit');let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
 if(end<0)throw new Error('Missing ZIP directory');
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||count!==bytes.readUInt16LE(end+8)||count===65535||start+size>end||count>8192)throw new Error('Unsupported ZIP directory');
 const out=[];let offset=start,total=0;const names=new Set();
 for(let i=0;i<count;i++){
  if(offset+46>start+size||bytes.readUInt32LE(offset)!==0x02014b50)throw new Error('Invalid ZIP entry');
  const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),compressed=bytes.readUInt32LE(offset+20),length=bytes.readUInt32LE(offset+24),n=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
  const next=offset+46+n+extra+comment;if(next>start+size||local+30>start)throw new Error('ZIP entry range');
  const name=bytes.toString('utf8',offset+46,offset+46+n);if(names.has(name))throw new Error('Duplicate ZIP entry');names.add(name);total+=length;if(length>MAX||total>96*1024*1024)throw new Error('ZIP expansion limit');
  const read=()=>{if(flags&1||![0,8].includes(method)||bytes.readUInt32LE(local)!==0x04034b50)throw new Error('Unsupported ZIP data');const p=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);if(p+compressed>start)throw new Error('ZIP payload range');const data=bytes.subarray(p,p+compressed),value=method===0?data:inflateRawSync(data,{maxOutputLength:MAX});if(value.length!==length)throw new Error('ZIP length mismatch');return value;};
  out.push({name,bytes:length,read});offset=next;
 }if(offset!==start+size)throw new Error('ZIP directory size mismatch');return out;
}
export function dexInventory(bytes){
 if(bytes.length<112||bytes.toString('ascii',0,4)!=='dex\n')throw new Error('Invalid DEX');
 const u32=p=>{if(p<0||p+4>bytes.length)throw new Error('DEX offset');return bytes.readUInt32LE(p);};
 const stringCount=u32(56),stringOff=u32(60),typeCount=u32(64),typeOff=u32(68),classCount=u32(96),classOff=u32(100);
 if(stringCount>1000000||typeCount>65536||classCount>65536||stringOff+stringCount*4>bytes.length||typeOff+typeCount*4>bytes.length||classOff+classCount*32>bytes.length)throw new Error('DEX table range');
 const strings=Array.from({length:stringCount},(_,i)=>{let p=u32(stringOff+i*4),steps=0;while(p<bytes.length&&(bytes[p++]&128)){if(++steps>4)throw new Error('DEX string length');}const end=bytes.indexOf(0,p);if(end<0)throw new Error('DEX string range');return bytes.toString('utf8',p,end);});
 const types=Array.from({length:typeCount},(_,i)=>strings[u32(typeOff+i*4)]);if(types.some(t=>typeof t!=='string'))throw new Error('DEX type range');
 const classes=Array.from({length:classCount},(_,i)=>types[u32(classOff+i*32)]);if(classes.some(t=>typeof t!=='string'))throw new Error('DEX class range');
 return{version:bytes.toString('ascii',4,7),classCount,classes:classes.sort(),androidTypes:types.filter(t=>t.startsWith('Landroid/')).sort(),referencesDexNativeLoader:strings.includes('getLoader')&&classes.includes('Lcom/github/catvod/spider/DexNative;')};
}
export function inspectArtifact(bytes){const entries=zipEntries(bytes);return{entries:entries.length,expandedBytes:entries.reduce((n,e)=>n+e.bytes,0),dex:entries.filter(e=>e.name.endsWith('.dex')).map(e=>({name:e.name,bytes:e.bytes,...dexInventory(e.read())})),native:entries.filter(e=>/\.(so|dll|dylib)$/i.test(e.name)).map(e=>{const b=e.read();const elf=b.length>=20&&b.subarray(0,4).equals(Buffer.from([127,69,76,70]));const machine=elf?(b[5]===2?b.readUInt16BE(18):b.readUInt16LE(18)):null;return{name:e.name,bytes:e.bytes,bits:elf?b[4]===1?32:b[4]===2?64:null:null,machine,architecture:({40:'ARM',183:'AArch64',62:'x86_64',3:'x86'})[machine]||'unknown'};}),protectedPayloads:entries.filter(e=>e.name.endsWith('.guard')).map(({name,bytes})=>({name,bytes}))};}
