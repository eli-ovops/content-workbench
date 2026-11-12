import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {demoWorkspace} from '../src/fixture.mjs';
import {createApp} from '../src/server.mjs';

const evidence=path.resolve('evidence','trash-'+Date.now());
await fs.mkdir(evidence,{recursive:true});
async function setup(name,options={}){const root=path.join(evidence,name);await new Store(root).init([demoWorkspace()]);return new Store(root,options).open();}

test('trash and restore survive restart and retain full content, relations and versions',async()=>{
 let store=await setup('roundtrip');const root=store.root;
 try{
  let w=store.state.workspaces[0];w=await store.freeze(w.id,w.revision);w=await store.update(w.id,w.revision,{body:w.body+'\n第二版'});w=await store.freeze(w.id,w.revision);const original=structuredClone(w);
  const trashed=await store.trash(w.id,w.revision);assert(trashed.trashedAt);assert.equal(trashed.revision,w.revision+1);assert.throws(()=>store.workspace(w.id),e=>e.code==='NOT_FOUND');
  await assert.rejects(store.update(w.id,w.revision,{body:'旧窗口'}),e=>e.code==='NOT_FOUND');
  await store.close();store=await new Store(root).open();assert(store.state.workspaces[0].trashedAt);
  const restored=await store.untrash(w.id,trashed.revision);assert(!restored.trashedAt);assert.equal(restored.id,original.id);assert.equal(restored.revision,original.revision+2);
  const {revision,...a}=original,{revision:restoredRevision,...b}=restored;assert.deepEqual(b,a);
  await assert.rejects(store.update(w.id,original.revision,{body:'旧窗口'}),e=>e.code==='CONFLICT');
  await store.close();store=await new Store(root).open();assert.deepEqual(store.workspace(w.id),restored);
 }finally{await store.close();}
});

test('trash rejects stale revisions and failed writes keep the active draft and approval',async()=>{
 let failWrite=false;const store=await setup('failures',{hook:async phase=>{if(failWrite&&phase==='beforePersist')throw new Error('simulated write failure');}});
 try{
  const w=store.state.workspaces[0],before=structuredClone(store.state);store.approvals.set(w.id+':youtube','fixture-approval');
  await assert.rejects(store.trash(w.id,w.revision-1),e=>e.code==='CONFLICT');assert.deepEqual(store.state,before);
  failWrite=true;await assert.rejects(store.trash(w.id,w.revision));assert.deepEqual(store.state,before);assert.equal(store.approvals.get(w.id+':youtube'),'fixture-approval');
  failWrite=false;const t=await store.trash(w.id,w.revision);assert(!store.approvals.has(w.id+':youtube'));
  await assert.rejects(store.untrash(w.id,t.revision-1),e=>e.code==='CONFLICT');assert(store.state.workspaces[0].trashedAt);
  await store.untrash(w.id,t.revision);assert(!store.approvals.has(w.id+':youtube'));
 }finally{await store.close();}
});

test('authenticated trash API hides the last draft, lists it for recovery and enforces origin',async()=>{
 const root=path.join(evidence,'api');await new Store(root).init([demoWorkspace()]);const app=await createApp({root,writeRuntime:false});
 try{
  const post=(route,data,cookie='',origin=app.url)=>fetch(app.url+'/api/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});
  const w=app.store.state.workspaces[0];assert.equal((await post('trash',{id:w.id,base:w.revision})).status,401);
  const request=await fetch(app.url+'/pair/request',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:'{}'});const pending=(request.headers.get('set-cookie')||'').split(';')[0],pair=await request.json();app.pairing.approve(pair.code);
  const paired=await fetch(app.url+'/pair/status',{headers:{Cookie:pending}});const cookie=(paired.headers.get('set-cookie')||'').split(';')[0];
  assert.equal((await post('trash',{id:w.id,base:w.revision},cookie,'https://other.invalid')).status,403);
  const moved=await post('trash',{id:w.id,base:w.revision},cookie);assert.equal(moved.status,200);const t=await moved.json();
  const state=async()=> (await fetch(app.url+'/api/state',{headers:{Cookie:cookie}})).json();let s=await state();assert.equal(s.state.workspaces.length,0);assert.equal(s.trashedWorkspaces[0].id,w.id);assert.equal(s.trashedWorkspaces[0].body,w.body);
  assert.equal((await post('save',{id:w.id,base:w.revision,changes:{title:'旧编辑'}},cookie)).status,404);
  assert.equal((await post('untrash',{id:w.id,base:t.revision},cookie)).status,200);s=await state();assert.equal(s.state.workspaces.length,1);assert.equal(s.trashedWorkspaces.length,0);
 }finally{await app.close();}
});
