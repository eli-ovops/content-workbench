import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {hash} from '../src/model.mjs';
const base=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function fingerprint(){
const names=['workspace.json','启动已验收工作台.command','停止已验收工作台.command','package.json','启动内容工作台.command','停止内容工作台.command','恢复上一副本.command'];
for(const dir of ['src','public'])for(const name of await fs.readdir(path.join(base,dir)))names.push(dir+'/'+name);
const files=[];for(const name of names.sort()){const b=await fs.readFile(path.join(base,name));files.push({relativePath:name,sha256:hash(b.toString('utf8')),bytes:b.length});}return {hash:hash(files),files,nodeVersion:process.version};
}
