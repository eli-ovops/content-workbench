import {DEFAULT_ROOT,DEFAULT_ROOT_ID} from './default-workspace.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';import {Store} from './store.mjs';import {bundleFor,restoreWorkspace,id,fail} from './model.mjs';import {APP,SCHEMA} from './config.mjs';
const BASE=path.dirname(path.dirname(fileURLToPath(import.meta.url))),args=process.argv.slice(2),root=path.resolve(args.find(x=>!x.startsWith('--'))||DEFAULT_ROOT);
fail(root.startsWith(BASE+path.sep),'PATH','仅允许本工具数据根');fail(!(await fs.lstat(root)).isSymbolicLink(),'PATH','根链接拒绝');
const marker=JSON.parse(await fs.readFile(path.join(root,'root.json'),'utf8'));fail(marker.producerApp===APP,'ROOT','根身份不符');
const lockPath=path.join(root,'instance.lock');
if(args.includes('--unlock')){
const lock=JSON.parse(await fs.readFile(lockPath,'utf8'));fail(lock.app===APP&&lock.rootId===marker.rootId&&lock.instanceId,'LOCK','锁归属不符');
let alive=true;try{process.kill(lock.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
fail(!alive,'LOCKED','所属PID仍存在；不删除锁（含PID复用）');fail(!(await fs.lstat(lockPath)).isSymbolicLink(),'PATH','锁链接拒绝');await fs.unlink(lockPath);console.log(JSON.stringify({verifiedDeadLockRemoved:true,root}));process.exit(0);
}
const previous=path.join(root,'previous.json');fail(!(await fs.lstat(previous)).isSymbolicLink(),'PATH','备份链接拒绝');const state=JSON.parse(await fs.readFile(previous,'utf8'));
fail(state.schemaName===SCHEMA&&state.schemaVersion===1&&state.rootId===marker.rootId,'SCHEMA','备份格式/根不符');
const workspaces=state.workspaces.map(w=>restoreWorkspace(bundleFor(w)));
const parent=path.join(BASE,'data','restored');await fs.mkdir(parent,{recursive:true,mode:0o700});fail(!(await fs.lstat(parent)).isSymbolicLink(),'PATH','恢复父目录链接拒绝');
const target=path.join(parent,id());await new Store(target).init(workspaces);console.log(JSON.stringify({restoredPrevious:true,root:target,workspaces:workspaces.length,publicApprovals:'HISTORICAL_ONLY'}));
if(args.includes('--launch')){const child=spawn(process.execPath,[path.join(BASE,'src','launch.mjs'),target],{cwd:BASE,stdio:'inherit',env:process.env});await new Promise((r,j)=>child.on('exit',c=>c===0?r():j(new Error('恢复副本启动失败'))));}
