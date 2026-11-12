import {DEFAULT_ROOT,DEFAULT_ROOT_ID} from './default-workspace.mjs';
import {APP,APP_VERSION} from './config.mjs';
import {requestStartup} from './pairing.mjs';
import {withLaunchLock,preserveDeadInstanceLock} from './launch-guard.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const base=path.dirname(path.dirname(fileURLToPath(import.meta.url))),root=path.resolve(process.argv[2]||DEFAULT_ROOT);
const marker=JSON.parse(await fs.readFile(path.join(root,'root.json'),'utf8'));
if(!process.argv[2]&&marker.rootId!==DEFAULT_ROOT_ID)throw new Error('默认工作空间身份不符，停止启动');
if(marker.producerApp!==APP)throw new Error('工作空间身份不符，停止启动');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function localUrl(r){try{const u=new URL(r.url);return r.app===APP&&r.rootId===marker.rootId&&u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&u.port&&Number.isSafeInteger(r.pid)&&r.pid>0;}catch{return false;}}
async function healthy(r){if(!r||!localUrl(r))return null;try{process.kill(r.pid,0);const response=await fetch(r.url+'/health',{signal:AbortSignal.timeout(2000)}),h=await response.json();return response.ok&&h.app===APP&&h.rootId===marker.rootId&&h.pid===r.pid?h:null;}catch{return null;}}
const running=await withLaunchLock(root,marker.rootId,async()=>{
 let current,previous;try{previous=JSON.parse(await fs.readFile(path.join(root,'runtime/running.json'),'utf8'));current=previous;}catch{}
 let health=await healthy(current);
 if(health&&(health.appVersion!==APP_VERSION||current.launchProtocol!=='one-time-http-v1')){
  process.kill(current.pid,'SIGTERM');let stopped=false;for(let i=0;i<50;i++){await delay(100);try{process.kill(current.pid,0);}catch(e){if(e.code==='ESRCH'){stopped=true;break;}throw e;}}if(!stopped)throw new Error('旧版服务未停止，保留现场，不重复启动');health=null;current=null;
 }
 if(health)return current;
 await preserveDeadInstanceLock(root,marker.rootId);
 const env={...process.env};if(!env.CONTENT_WORKBENCH_PORT&&previous&&localUrl(previous))env.CONTENT_WORKBENCH_PORT=new URL(previous.url).port;
 const log=await fs.open(path.join(base,'docs/server-output.log'),'a',0o600),child=spawn(process.execPath,[path.join(base,'src/server.mjs'),'--root',root],{cwd:base,env,detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();let childError=false;child.once('error',()=>{childError=true;});
 for(let i=0;i<40;i++){await delay(125);if(childError||child.exitCode!==null)break;try{const next=JSON.parse(await fs.readFile(path.join(root,'runtime/running.json'),'utf8')),h=await healthy(next);if(next.pid===child.pid&&h?.appVersion===APP_VERSION&&next.launchProtocol==='one-time-http-v1'&&next.pairSocket)return next;}catch{}}
 throw new Error('启动未完成。查看docs/server-output.log；不会创建空库或清除未知锁。');
});
console.log('内容工作台：'+running.url+'；数据根：'+root);
if(!process.env.CONTENT_WORKBENCH_NO_OPEN){
 const launch=await requestStartup({socketPath:running.pairSocket,rootId:running.rootId});
 // Never print or persist the ticket. The HTTP fragment is consumed once.
 await new Promise((resolve,reject)=>{const child=spawn('/usr/bin/open',['-a','Google Chrome',running.url+'/start#'+launch.ticket],{stdio:'ignore'});child.once('error',()=>reject(new Error('无法打开Chrome，请确认已安装后重新双击启动器')));child.once('exit',code=>code===0?resolve():reject(new Error('浏览器未打开，请重新双击启动器')));});
}
