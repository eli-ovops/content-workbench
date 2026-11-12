import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {BrowserPairing} from '../src/pairing.mjs';
import * as pairingModule from '../src/pairing.mjs';
const requestStartup=(...args)=>pairingModule.requestStartup(...args);
const base=path.resolve('evidence','startup-session-'+Date.now());await fs.mkdir(base,{recursive:true});
const run=promisify(execFile),cookie=r=>(r.headers.get('set-cookie')||'').split(';')[0];
const launchEnv={...process.env,CONTENT_WORKBENCH_NO_OPEN:'1'};

test('owner startup ticket establishes an HttpOnly session once, with origin/root/expiry checks',async()=>{
 const root=path.join(base,'ticket');await new Store(root).init([]);let now=0;const app=await createApp({root,pairNow:()=>now});
 try{
  const post=(ticket,origin=app.url)=>fetch(app.url+'/session/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({ticket})});
  assert.equal((await fetch(app.url+'/api/state')).status,401);
  await assert.rejects(requestStartup({socketPath:app.pairing.socketPath,rootId:'wrong-root'}));
  const ticket=await requestStartup({socketPath:app.pairing.socketPath,rootId:app.store.marker.rootId});
  assert.equal((await post(ticket.ticket,'https://external.invalid')).status,403);assert.equal((await post('bad')).status,401);
  const response=await post(ticket.ticket);assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.match(response.headers.get('set-cookie'),/Max-Age=28800/);
  assert.equal((await fetch(app.url+'/api/state',{headers:{Cookie:cookie(response)}})).status,200);assert.equal((await post(ticket.ticket)).status,401);
  const expired=await requestStartup({socketPath:app.pairing.socketPath,rootId:app.store.marker.rootId});now=60001;assert.equal((await post(expired.ticket)).status,401);
  assert.equal((await fetch(app.url+'/start')).status,200);assert.equal((await fetch(app.url+'/runtime/open.html')).status,404);
  assert(!(await fs.readdir(path.join(root,'runtime'))).includes('open.html'),'new boots do not write legacy file credentials');
 }finally{await app.close();}
});

test('restart rejects old sessions and old launch tickets; fresh automatic launch retains saved drafts and versions',async()=>{
 const root=path.join(base,'restart');await new Store(root).init([]);let app=await createApp({root,writeRuntime:false});let session;
 const connect=async()=>{const ticket=app.pairing.issueStartup();const r=await fetch(app.url+'/session/start',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({ticket:ticket.ticket})});assert.equal(r.status,200);session=cookie(r);};
 const post=async(route,data)=>{const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{Cookie:session,Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal(r.status,200);return r.json();};
 try{await connect();let w=await post('create',{title:'自动启动测试稿'});w=await post('save',{id:w.id,base:w.revision,changes:{body:'第一版'}});w=await post('freeze',{id:w.id,base:w.revision});w=await post('save',{id:w.id,base:w.revision,changes:{body:'第二版'}});w=await post('freeze',{id:w.id,base:w.revision});
  const old=app.pairing.issueStartup();await app.close();app=await createApp({root,writeRuntime:false});assert.equal((await fetch(app.url+'/api/state',{headers:{Cookie:session}})).status,401);
  assert.equal((await fetch(app.url+'/session/start',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({ticket:old.ticket})})).status,401);
  await connect();const saved=await(await fetch(app.url+'/api/state',{headers:{Cookie:session}})).json();assert.deepEqual(saved.state.workspaces[0],w);
  const t=await post('trash',{id:w.id,base:w.revision});const restored=await post('untrash',{id:w.id,base:t.revision});assert.deepEqual(restored.versions,w.versions);
 }finally{await app.close();}
});

test('concurrent double-click starts one service and abrupt exit recovers preserved stale locks on the same port',async()=>{
 const root=path.join(base,'launcher');await new Store(root).init([]);let current;
 const launch=()=>run(process.execPath,['src/launch.mjs',root],{env:{...launchEnv,CONTENT_WORKBENCH_PORT:'0'},timeout:15000});
 try{
  const launched=await Promise.all([launch(),launch()]);current=JSON.parse(await fs.readFile(path.join(root,'runtime/running.json'),'utf8'));assert(launched.every(r=>r.stdout.includes(current.url)));assert.equal((await(await fetch(current.url+'/health')).json()).pid,current.pid);
  const old=current;process.kill(current.pid,'SIGKILL');for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,50));try{process.kill(current.pid,0);}catch{break;}}
  const restarted=await run(process.execPath,['src/launch.mjs',root],{env:launchEnv,timeout:15000});current=JSON.parse(await fs.readFile(path.join(root,'runtime/running.json'),'utf8'));assert.notEqual(current.pid,old.pid);assert.equal(current.url,old.url);assert(restarted.stdout.includes(old.url));
  assert((await fs.readdir(root)).some(n=>n.startsWith('instance.lock.stale.')));assert(!(await fs.readdir(path.join(root,'runtime'))).includes('open.html'));
 }finally{if(current){try{const h=await(await fetch(current.url+'/health')).json();if(h.pid===current.pid)process.kill(current.pid,'SIGTERM');}catch{}}}
});

test('startup tickets are bounded and stale launch lock with unknown ownership is not removed',async()=>{
 let now=0;const p=new BrowserPairing({rootId:'ticket-cap',now:()=>now});for(let i=0;i<16;i++)p.issueStartup();assert.throws(()=>p.issueStartup(),e=>e.status===429);now=60001;assert(p.issueStartup().ticket);
 const root=path.join(base,'unknown-lock');await new Store(root).init([]);await fs.mkdir(path.join(root,'runtime'),{mode:0o700});const lock=path.join(root,'runtime/launch.lock'),original=JSON.stringify({app:'another-app',pid:99999999});await fs.writeFile(lock,original,{mode:0o600});
 await assert.rejects(run(process.execPath,['src/launch.mjs',root],{env:launchEnv,timeout:15000}));assert.equal(await fs.readFile(lock,'utf8'),original);
});
