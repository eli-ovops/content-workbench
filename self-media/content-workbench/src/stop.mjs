import {DEFAULT_ROOT,DEFAULT_ROOT_ID} from './default-workspace.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const base=path.dirname(path.dirname(fileURLToPath(import.meta.url))),root=process.argv[2]||DEFAULT_ROOT;const r=JSON.parse(await fs.readFile(path.join(root,'runtime','running.json'),'utf8'));
const response=await fetch(r.url+'/health');if(!response.ok)throw new Error('本应用入口不可核，不终止进程');const h=await response.json();if(h.app!==r.app||h.rootId!==r.rootId||h.pid!==r.pid)throw new Error('本应用/数据根/进程身份不符，不终止进程');process.kill(r.pid,'SIGTERM');console.log('已请求停止本工具进程。');
