import process from 'node:process';
import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import {randomBytes} from 'node:crypto';import {hash,AppError} from './model.mjs';
export class BrowserPairing{
 constructor({rootId,now=()=>Date.now(),ttl=5*60*1000}){this.rootId=rootId;this.now=now;this.ttl=ttl;this.pending=new Map();this.startup=new Map();this.cookieName='cwp_'+hash(rootId).slice(0,16);}
 issueStartup(){
  for(const [ticket,expires] of this.startup)if(expires<=this.now())this.startup.delete(ticket);
  if(this.startup.size>=16)throw new AppError('LAUNCH_BUSY','启动请求过多，请稍后重新打开',429);
  const ticket=randomBytes(32).toString('hex'),expires=this.now()+60000;this.startup.set(ticket,expires);return {ticket,expiresAt:new Date(expires).toISOString(),rootId:this.rootId};
 }
 consumeStartup(ticket){const expires=this.startup.get(ticket);if(typeof ticket!=='string'||!expires||expires<=this.now()){this.startup.delete(ticket);throw new AppError('LAUNCH_EXPIRED','启动链接已失效，请重新双击启动器',401);}this.startup.delete(ticket);}
 prune(){for(const [ticket,p] of this.pending)if(p.expires<=this.now())this.pending.delete(ticket);}
 ticket(req){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(this.cookieName+'='))?.slice(this.cookieName.length+1);}
 request(req){this.prune();const old=this.pending.get(this.ticket(req));if(old)return {ticket:this.ticket(req),...old};if(this.pending.size>=8)throw new AppError('PAIR_BUSY','已有连接请求，请稍后重试',429);const ticket=randomBytes(32).toString('hex');let code;do{code=randomBytes(4).toString('hex').toUpperCase();}while([...this.pending.values()].some(p=>p.code===code));const p={code,expires:this.now()+this.ttl,approved:false};this.pending.set(ticket,p);return {ticket,...p};}
 approve(code){this.prune();const p=[...this.pending.values()].find(p=>p.code===code);if(!p||p.approved)throw new AppError('PAIR_EXPIRED','连接编号不存在、已确认或已过期，请在网页重新连接',409);p.approved=true;return {approved:true,rootId:this.rootId};}
 status(req){this.prune();const ticket=this.ticket(req),p=this.pending.get(ticket);if(!p)throw new AppError('PAIR_EXPIRED','连接请求已过期，请重新连接',401);if(p.approved)this.pending.delete(ticket);return p;}
 async listen(){
  const dir='/tmp/eli-cw-pair-'+process.getuid();try{await fs.mkdir(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const d=await fs.lstat(dir);if(d.isSymbolicLink()||!d.isDirectory()||d.uid!==process.getuid()||(d.mode&0o077))throw new AppError('PAIR_PATH','本机配对目录权限异常，停止连接',403);
  this.socketPath=path.join(dir,hash(this.rootId).slice(0,24)+'.sock');
  this.server=http.createServer(async(req,res)=>{try{if(req.method!=='POST'||!['/approve','/launch'].includes(req.url))throw new AppError('NOT_FOUND','本机启动入口不存在',404);let data='';for await(const b of req){data+=b;if(Buffer.byteLength(data)>128)throw new AppError('PAYLOAD','连接确认载荷过大',413);}const o=JSON.parse(data);if(o.rootId!==this.rootId)throw new AppError('ROOT','配对根身份不符',403);if(req.url==='/approve'&&typeof o.code!=='string')throw new AppError('ROOT','缺少连接编号',403);const out=req.url==='/launch'?this.issueStartup():this.approve(o.code);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(out));}catch(e){res.writeHead(e.status||400,{'Content-Type':'application/json'});res.end(JSON.stringify({message:e.message}));}});
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.socketPath,resolve);});await fs.chmod(this.socketPath,0o600);return this.socketPath;
 }
 async close(){this.pending.clear();this.startup.clear();if(this.server?.listening)await new Promise(r=>this.server.close(r));}
}
async function ownerRequest({socketPath,rootId,code},route){
 const expected=path.join('/tmp/eli-cw-pair-'+process.getuid(),hash(rootId).slice(0,24)+'.sock');if(socketPath!==expected)throw new AppError('PAIR_PATH','连接确认路径不符',403);
 const dir=await fs.lstat(path.dirname(socketPath)),s=await fs.lstat(socketPath);if(dir.isSymbolicLink()||dir.uid!==process.getuid()||(dir.mode&0o077)||!s.isSocket()||s.uid!==process.getuid()||(s.mode&0o077))throw new AppError('PAIR_PATH','连接确认通道权限异常',403);
 return new Promise((resolve,reject)=>{const req=http.request({socketPath,path:route,method:'POST',headers:{'Content-Type':'application/json'}},res=>{let data='';res.on('data',b=>data+=b);res.on('end',()=>{try{const o=JSON.parse(data);if(res.statusCode!==200||o.rootId!==rootId||(route==='/approve'?!o.approved:!(/^[a-f0-9]{64}$/.test(o.ticket)&&Number.isFinite(Date.parse(o.expiresAt)))))throw new Error(o.message||'连接根身份不符');resolve(o);}catch(e){reject(e);}});});req.setTimeout(3000,()=>req.destroy(new Error('本机连接确认超时')));req.once('error',reject);req.end(JSON.stringify({rootId,code}));});
}
export const approveBrowser=options=>ownerRequest(options,'/approve');
export const requestStartup=options=>ownerRequest(options,'/launch');
