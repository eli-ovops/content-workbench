import {APP_VERSION} from '../src/config.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {BrowserPairing,approveBrowser} from '../src/pairing.mjs';import {Store} from '../src/store.mjs';import {createApp} from '../src/server.mjs';
const base=path.resolve('evidence','pairing-'+Date.now());await fs.mkdir(base,{recursive:true});
const cookie=r=>(r.headers.get('set-cookie')||'').split(';')[0];
test('HTTP pairing requires owner approval, binds one browser, rejects other origins and replay',async()=>{
 const root=path.join(base,'data');await new Store(root).init([]);const app=await createApp({root,writeRuntime:false});
 try{
  assert.equal((await fetch(app.url+'/api/state')).status,401);
  const request=await fetch(app.url+'/pair/request',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:'{}'});
  assert.equal(request.status,200,'actual HTTP page must offer a browser-specific pairing request');
  const pending=await request.json(),pc=cookie(request);assert.match(pending.code,/^[A-F0-9]{8}$/);assert(pc);assert(!JSON.stringify(pending).includes('token'));
  assert.equal((await fetch(app.url+'/api/state',{headers:{Cookie:pc}})).status,401);
  assert.equal((await fetch(app.url+'/pair/request',{method:'POST',headers:{Origin:'https://external.invalid'}})).status,403);
  assert.equal((await fetch(app.url+'/pair/request',{method:'POST'})).status,403);
  const status=()=>fetch(app.url+'/pair/status',{headers:{Cookie:pc}});
  assert.equal((await (await status()).json()).connected,false);
  assert.equal((await fetch(app.url+'/pair/status')).status,401);
  await app.pairing.approve(pending.code);
  const paired=await status(),session=cookie(paired);assert.equal((await paired.json()).connected,true);assert(session.startsWith(app.cookieName+'='));
  assert.equal((await fetch(app.url+'/api/state',{headers:{Cookie:session}})).status,200);
  const otherTab=await fetch(app.url+'/pair/status',{headers:{Cookie:session}});assert.equal(otherTab.status,200);assert.equal((await otherTab.json()).connected,true,'a second tab in the already paired browser must recognize the same session');
  assert.equal((await status()).status,401,'completed pending ticket cannot issue another session');
  assert.throws(()=>app.pairing.approve(pending.code));
  const sameOrigin=await fetch(app.url+'/api/logout',{method:'POST',headers:{Cookie:session,Origin:app.url,'Content-Type':'application/json'},body:'{}'});assert.equal(sameOrigin.status,200);assert.equal((await fetch(app.url+'/api/state',{headers:{Cookie:session}})).status,401);
 }finally{await app.close();}
});

test('pairing expires, caps pending requests, and owner socket checks root and file permissions',async()=>{
 let clock=0;const pairing=new BrowserPairing({rootId:'synthetic-root-'+Date.now(),now:()=>clock,ttl:1000});const request=pairing.request({headers:{}});clock=1001;assert.throws(()=>pairing.approve(request.code),e=>e.code==='PAIR_EXPIRED');
 for(let i=0;i<8;i++)pairing.request({headers:{}});assert.throws(()=>pairing.request({headers:{}}),e=>e.status===429);
 clock=3000;const fresh=pairing.request({headers:{}});await pairing.listen();
 try{const socket=await fs.lstat(pairing.socketPath);assert.equal(socket.mode&0o777,0o600);await assert.rejects(approveBrowser({socketPath:pairing.socketPath,rootId:'wrong-root',code:fresh.code}));
 await approveBrowser({socketPath:pairing.socketPath,rootId:pairing.rootId,code:fresh.code});assert.equal(pairing.status({headers:{cookie:pairing.cookieName+'='+fresh.ticket}}).approved,true);
 }finally{await pairing.close();}
});

test('confirmed browser can create/save/reload and retain both versions; restart requires fresh pairing',async()=>{
 const root=path.join(base,'saved-flow');await new Store(root).init([]);let app=await createApp({root,writeRuntime:false});let session;
 const connect=async()=>{const r=await fetch(app.url+'/pair/request',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:'{}'});const p=await r.json();app.pairing.approve(p.code);session=cookie(await fetch(app.url+'/pair/status',{headers:{Cookie:cookie(r)}}));};
 const post=async(route,body)=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{Cookie:session,Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 try{await connect();let w=await post('create',{title:'SYNTHETIC UI acceptance draft'});w=await post('save',{id:w.id,base:w.revision,changes:{body:'合成测试 v1：准备材料，整理三列，逐条检查。'}});w=await post('freeze',{id:w.id,base:w.revision});const v1=w.versions[0].body;
 w=await post('save',{id:w.id,base:w.revision,changes:{body:v1+'\n合成测试 v2：未知信息单独列出。'}});w=await post('freeze',{id:w.id,base:w.revision});assert.equal(w.versions.length,2);assert.equal(w.versions[0].body,v1);
 const saved=await (await fetch(app.url+'/api/state',{headers:{Cookie:session}})).json();assert.equal(saved.state.workspaces[0].body,w.body);
 await app.close();app=await createApp({root,writeRuntime:false});assert.equal((await fetch(app.url+'/api/state',{headers:{Cookie:session}})).status,401);await connect();const reopened=await (await fetch(app.url+'/api/state',{headers:{Cookie:session}})).json();assert.deepEqual(reopened.state.workspaces[0].versions,w.versions);assert.equal(reopened.state.workspaces[0].body,w.body);
 }finally{await app.close();}
});

test('launcher cold-start reports verified child, repeated launch reuses that exact service',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile),root=path.join(base,'launcher');await new Store(root).init([]);let running;
 try{const first=await run(process.execPath,['src/launch.mjs',root],{cwd:path.resolve('.'),env:{...process.env,CONTENT_WORKBENCH_NO_OPEN:'1',CONTENT_WORKBENCH_PORT:'0'},timeout:10000});assert(first.stdout.includes('内容工作台：http://127.0.0.1:'));
 running=JSON.parse(await fs.readFile(path.join(root,'runtime/running.json'),'utf8'));const health=await (await fetch(running.url+'/health')).json();assert.equal(health.pid,running.pid);assert.equal(health.rootId,running.rootId);assert.equal(health.appVersion,APP_VERSION);assert((await fs.lstat(running.pairSocket)).isSocket());
 const second=await run(process.execPath,['src/launch.mjs',root],{env:{...process.env,CONTENT_WORKBENCH_NO_OPEN:'1'},timeout:10000});assert(second.stdout.includes(running.url));const same=JSON.parse(await fs.readFile(path.join(root,'runtime/running.json'),'utf8'));assert.equal(same.pid,running.pid);
 process.kill(running.pid,'SIGTERM');for(let i=0;i<30;i++){try{await fetch(running.url+'/health');await new Promise(r=>setTimeout(r,50));}catch{break;}}
 const third=await run(process.execPath,['src/launch.mjs',root],{env:{...process.env,CONTENT_WORKBENCH_NO_OPEN:'1'},timeout:10000});assert(third.stdout.includes(running.url),'restart retains the same app/root entry address');const restarted=JSON.parse(await fs.readFile(path.join(root,'runtime/running.json'),'utf8'));assert.notEqual(restarted.pid,running.pid);assert.equal(restarted.url,running.url);running=restarted;
 }finally{if(running){const health=await (await fetch(running.url+'/health')).json();if(health.pid===running.pid&&health.rootId===running.rootId)process.kill(running.pid,'SIGTERM');}}
});

test('failed startup cannot borrow a stale metadata URL returning HTTP 200',async()=>{
 const http=await import('node:http');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);const root=path.join(base,'startup-failure');await new Store(root).init([]);const marker=JSON.parse(await fs.readFile(path.join(root,'root.json'),'utf8'));const fake=http.createServer((req,res)=>{res.writeHead(req.url==='/health'?404:200);res.end('{}');});await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 try{await fs.mkdir(path.join(root,'runtime'),{mode:0o700});await fs.writeFile(path.join(root,'runtime/running.json'),JSON.stringify({app:'eli-content-workbench',rootId:marker.rootId,pid:99999999,url:'http://127.0.0.1:'+fake.address().port,bootstrap:'unused'}));await fs.writeFile(path.join(root,'current.json'),'{synthetic corruption');
 await assert.rejects(run(process.execPath,['src/launch.mjs',root],{env:{...process.env,CONTENT_WORKBENCH_NO_OPEN:'1',CONTENT_WORKBENCH_PORT:'0'},timeout:10000}),e=>e.code===1&&!e.stdout.includes('内容工作台：http')&&e.stderr.includes('启动未完成'));
 }finally{await new Promise(r=>fake.close(r));}
});
