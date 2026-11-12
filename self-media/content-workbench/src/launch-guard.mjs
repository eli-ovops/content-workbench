import fs from 'node:fs/promises';
import path from 'node:path';
import {APP} from './config.mjs';
import {AppError,hash,id} from './model.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)throw new AppError('LOCK_OWNER','锁中的进程身份不可核，保留现场');try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
async function lockInfo(file,rootId){const st=await fs.lstat(file);if(st.isSymbolicLink()||!st.isFile()||st.uid!==process.getuid()||(st.mode&0o077))throw new AppError('LOCK_OWNER','启动锁归属或权限不可核，保留现场');const lock=JSON.parse(await fs.readFile(file,'utf8'));if(lock.app!==APP||lock.rootId!==rootId)throw new AppError('LOCK_OWNER','启动锁身份不符，保留现场');return lock;}
export async function withLaunchLock(root,rootId,fn){
 const runtime=path.join(root,'runtime');await fs.mkdir(runtime,{recursive:true,mode:0o700});const st=await fs.lstat(runtime);if(st.isSymbolicLink()||!st.isDirectory()||st.uid!==process.getuid()||(st.mode&0o077))throw new AppError('LOCK_OWNER','运行目录归属或权限不可核');
 const file=path.join(runtime,'launch.lock'),instanceId=id();let acquired=false;
 for(let i=0;i<100;i++){
  try{const h=await fs.open(file,'wx',0o600);try{await h.writeFile(JSON.stringify({app:APP,rootId,pid:process.pid,instanceId}));}finally{await h.close();}acquired=true;break;}
  catch(e){if(e.code!=='EEXIST')throw e;let old;try{old=await lockInfo(file,rootId);}catch(readError){if(readError.code==='ENOENT'||(readError instanceof SyntaxError&&i<3)){await delay(50);continue;}throw readError;}if(!alive(old.pid)){try{await fs.rename(file,file+'.stale.'+id());}catch(renameError){if(renameError.code!=='ENOENT')throw renameError;}}else await delay(100);}
 }
 if(!acquired)throw new AppError('LAUNCH_BUSY','另一启动器正在启动，请稍后再打开');
 try{return await fn();}finally{const current=await lockInfo(file,rootId);if(current.instanceId===instanceId)await fs.unlink(file);}
}
export async function preserveDeadInstanceLock(root,rootId){
 const file=path.join(root,'instance.lock');let lock;try{lock=await lockInfo(file,rootId);}catch(e){if(e.code==='ENOENT')return;throw e;}
 if(alive(lock.pid))throw new AppError('LOCKED','该工作空间仍有进程占用，保留现场，不重复启动');
 // Preserve the proved-dead runtime artifacts. Never remove an unknown lock.
 const socket=path.join('/tmp/eli-cw-pair-'+process.getuid(),hash(rootId).slice(0,24)+'.sock');
 try{const s=await fs.lstat(socket);if(!s.isSocket()||s.uid!==process.getuid()||(s.mode&0o077))throw new AppError('PAIR_PATH','残留本机通道归属不可核，保留现场');await fs.rename(socket,socket+'.stale.'+id());}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.rename(file,file+'.stale.'+id());
}
