import {DEFAULT_ROOT,DEFAULT_ROOT_ID} from './default-workspace.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Store} from './store.mjs';
import {APP,APP_VERSION,PLATFORMS,CONFIG_VERSION,PLATFORM_SOURCE,LIMIT} from './config.mjs';
import {AppError,hash,id} from './model.mjs';
import {readAuthority} from './authority.mjs';
import {BrowserPairing} from './pairing.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),BASE=path.dirname(HERE);
const staticFiles={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/preview-data.js':'preview-data.js','/start':'session-start.html','/session-start.js':'session-start.js'};
export async function createApp({root=DEFAULT_ROOT,port=0,storeOptions={},writeRuntime=true,pairNow}={}){
const store=await new Store(root,storeOptions).open(),sessions=new Map(),boot=id();
let previousAuthority=store.state.workspaces[0]?.authority||[];const cache=path.join(store.root,'authority-cache.json');
try{previousAuthority=JSON.parse(await fs.readFile(cache,'utf8'));}catch{}
const startupAuthority=await readAuthority(previousAuthority,storeOptions.authorityPaths);store.authorityCache=startupAuthority;
const cacheText=JSON.stringify(startupAuthority,null,2);if(await store.totalBytes()+Buffer.byteLength(cacheText)*2+2048<=store.limits.hard){const tmp=cache+'.'+id()+'.tmp';const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(cacheText);await h.sync();}finally{await h.close();}await fs.rename(tmp,cache);}
const pairing=new BrowserPairing({rootId:store.marker.rootId,now:pairNow});
const cookieName='cw_'+hash(APP+store.marker.rootId).slice(0,16);
const sessionCookie=()=>{const token=randomBytes(32).toString('hex');sessions.set(token,{app:APP,rootId:store.marker.rootId,boot,expires:Date.now()+8*3600000});return cookieName+'='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800';};
let url;
const body=async req=>{let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>LIMIT.payload)throw new AppError('PAYLOAD','载荷超过1MiB，编辑保留',413);chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new AppError('JSON','请求JSON错误');}};
const json=(res,status,o)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o));};
const authenticated=req=>{const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));const token=cookie?.slice(cookieName.length+1),s=sessions.get(token);return s&&s.boot===boot&&s.rootId===store.marker.rootId&&s.app===APP&&s.expires>Date.now()?token:null;};
const server=http.createServer(async(req,res)=>{
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.setHeader('Cache-Control','no-store');
try{
if(req.headers.host!==new URL(url).host)throw new AppError('HOST','Host不符',403);
const pathname=new URL(req.url,url).pathname;
if(req.method==='GET'&&pathname==='/health'){json(res,200,{app:APP,appVersion:APP_VERSION,rootId:store.marker.rootId,pid:process.pid});return;}
if(pathname==='/session/start'){
if(req.method!=='POST')throw new AppError('METHOD','请从启动器打开',405);
if(req.headers.origin!==url||(req.headers['content-type']||'').split(';')[0]!=='application/json')throw new AppError('ORIGIN','启动会话必须来自此工作台',403);
const d=await body(req);pairing.consumeStartup(d.ticket);res.setHeader('Set-Cookie',sessionCookie());json(res,200,{connected:true});return;
}
if(pathname==='/pair/request'){
if(req.method!=='POST')throw new AppError('METHOD','请使用连接按钮',405);
if(req.headers.origin!==url||(req.headers['content-type']||'').split(';')[0]!=='application/json')throw new AppError('ORIGIN','连接请求必须来自此工作台',403);
await body(req);const p=pairing.request(req);res.setHeader('Set-Cookie',pairing.cookieName+'='+p.ticket+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=300');json(res,200,{code:p.code,expiresAt:new Date(p.expires).toISOString()});return;
}
if(pathname==='/pair/status'){
if(req.method!=='GET')throw new AppError('METHOD','方法不支持',405);
if(req.headers.origin&&req.headers.origin!==url)throw new AppError('ORIGIN','连接核对必须同源',403);
if(authenticated(req)){json(res,200,{connected:true});return;}
const p=pairing.status(req);if(p.approved)res.setHeader('Set-Cookie',[sessionCookie(),pairing.cookieName+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0']);json(res,200,{connected:p.approved,expiresAt:new Date(p.expires).toISOString()});return;
}
if(req.method==='GET'&&staticFiles[pathname]){
const f=path.join(BASE,'public',staticFiles[pathname]);const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
res.writeHead(200,{'Content-Type':types[path.extname(f)]+'; charset=utf-8'});res.end(await fs.readFile(f));return;
}
if(!pathname.startsWith('/api/'))throw new AppError('NOT_FOUND','入口不存在',404);
const session=authenticated(req);if(!session)throw new AppError('AUTH','会话已过期，请从启动入口重新打开；你的编辑仍保留',401);
if(req.headers.origin&&req.headers.origin!==url)throw new AppError('ORIGIN','Origin不符',403);
if(req.method!=='GET'&&req.headers.origin!==url)throw new AppError('ORIGIN','写入必须同源',403);
if(req.method==='GET'&&pathname==='/api/state'){
json(res,200,{app:APP,appVersion:APP_VERSION,rootId:store.marker.rootId,root:store.root,startupAuthority,configVersion:CONFIG_VERSION,platformSource:PLATFORM_SOURCE,platforms:PLATFORMS,state:{...store.state,workspaces:store.state.workspaces.filter(w=>!w.trashedAt)},trashedWorkspaces:store.state.workspaces.filter(w=>w.trashedAt),exports:store.listExports(),publicConfirmations:[...store.approvals.keys()],bootNote:'公开确认仅本次启动有效；历史许可需复核。'});return;
}
if(req.method==='GET'&&pathname.startsWith('/api/export/')){
const parts=pathname.split('/');const eid=parts[3],pub=parts[4]==='public';const pkg=await store.getExport(eid,pub);
json(res,200,pkg);return;
}
if(req.method!=='POST')throw new AppError('METHOD','方法不支持',405);
const d=await body(req);let value;
switch(pathname){
case '/api/create':value=await store.create(String(d.title||'未命名草稿'));break;
case '/api/trash':value=await store.trash(d.id,d.base);break;
case '/api/untrash':value=await store.untrash(d.id,d.base);break;
case '/api/save':value=await store.update(d.id,d.base,d.changes);break;
case '/api/freeze':value=await store.freeze(d.id,d.base);break;
case '/api/refresh':value=await store.refresh(d.id);break;
case '/api/approve':value=store.approve(d.id,d.platformId);break;
case '/api/revoke':value=await store.revoke(d.id,d.sourceId);break;
case '/api/export':value=await store.export(d.id,d.base,{mode:d.mode,platformIds:d.platformIds||[]});break;
case '/api/restore':{const dest=path.join(path.dirname(store.root),'restored',id());await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});value=await store.restorePackage(d.package,dest);break;}
case '/api/logout':sessions.delete(session);res.setHeader('Set-Cookie',cookieName+'=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/');value={loggedOut:true};break;
default:throw new AppError('NOT_FOUND','入口不存在',404);
}
json(res,200,value);
}catch(e){const status=e.status||503;json(res,status,{error:e.code||'IO_FAILED',message:e instanceof AppError?e.message:'写入/读取失败，编辑保留；请核查数据介质',deviations:[]});}
});
await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(port,'127.0.0.1',resolve);});url='http://127.0.0.1:'+server.address().port;
if(writeRuntime){try{await pairing.listen();}catch(e){await new Promise(r=>server.close(r));await store.close();throw e;}}
const runtime=path.join(store.root,'runtime');await fs.mkdir(runtime,{recursive:true,mode:0o700});
if(writeRuntime){
await fs.writeFile(path.join(runtime,'running.json'),JSON.stringify({app:APP,rootId:store.marker.rootId,pid:process.pid,url,pairSocket:pairing.socketPath,launchProtocol:'one-time-http-v1',startedAt:new Date().toISOString()},null,2),{mode:0o600});
}
return {url,store,cookieName,pairing,close:async()=>{await pairing.close();await new Promise(r=>server.close(r));await store.close();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
const args=process.argv.slice(2);const root=args.includes('--root')?args[args.indexOf('--root')+1]:DEFAULT_ROOT;
const app=await createApp({root,port:Number(process.env.CONTENT_WORKBENCH_PORT||0)});
console.log(JSON.stringify({app:APP,url:app.url,root:app.store.root}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
}
