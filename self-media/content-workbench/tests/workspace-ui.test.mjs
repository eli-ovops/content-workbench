import test from 'node:test';
import assert from 'node:assert/strict';
import {continueAfterSave,nextDraftTitle,sortWorkspaces,draftMeta} from '../public/app.js';

test('continue saves current edits before performing the requested action',async()=>{
 let dirty=true;const steps=[];
 const done=await continueAfterSave({isDirty:()=>dirty,confirmSave:async()=>{steps.push('confirm');return true;},save:async()=>{steps.push('save');dirty=false;},proceed:async()=>steps.push('switch')});
 assert(done);assert.deepEqual(steps,['confirm','save','switch']);
});
test('return to editing leaves unsaved text untouched and does not navigate',async()=>{
 const draft={body:'尚未保存的文字'},before=structuredClone(draft);const steps=[];
 assert.equal(await continueAfterSave({isDirty:()=>true,confirmSave:async()=>false,save:async()=>steps.push('save'),proceed:async()=>steps.push('switch')}),false);
 assert.deepEqual(draft,before);assert.deepEqual(steps,[]);
});
test('save errors keep the current editor and never perform the pending action',async()=>{
 let proceeded=false;
 await assert.rejects(continueAfterSave({isDirty:()=>true,confirmSave:async()=>true,save:async()=>{throw new Error('冲突');},proceed:async()=>{proceeded=true;}}),/冲突/);assert(!proceeded);
});
test('new typing while saving prevents the old editor from being replaced',async()=>{
 let dirty=true,proceeded=false;
 await assert.rejects(continueAfterSave({isDirty:()=>dirty,confirmSave:async()=>true,save:async()=>{dirty=true;},proceed:async()=>{proceeded=true;}}),/新输入/);assert(!proceeded);
});
test('saved drafts continue without an unnecessary save prompt',async()=>{
 let proceeded=false;
 assert(await continueAfterSave({isDirty:()=>false,confirmSave:async()=>{throw new Error('unexpected prompt');},save:async()=>{throw new Error('unexpected save');},proceed:async()=>{proceeded=true;}}));assert(proceeded);
});
test('new draft names avoid active and recycled names without renaming existing drafts',()=>{
 const names=[{title:'未命名稿件'},{title:'未命名稿件 2',trashedAt:'2026-10-13T00:00:00Z'},{title:'我的正文'}];const before=structuredClone(names);
 assert.equal(nextDraftTitle(names),'未命名稿件 3');assert.equal(nextDraftTitle([]),'未命名稿件');assert.deepEqual(names,before);
});
test('draft navigation sorts by actual activity and does not mutate saved objects',()=>{
 const drafts=[{id:'old',createdAt:'2026-10-12T00:00:00Z'},{id:'freeze',createdAt:'2026-10-01T00:00:00Z',versions:[{createdAt:'2026-10-13T04:00:00Z'}]},{id:'edit',updatedAt:'2026-10-13T06:00:00Z'},{id:'unknown',createdAt:'invalid'}];const before=structuredClone(drafts);
 assert.deepEqual(sortWorkspaces(drafts).map(w=>w.id),['edit','freeze','old','unknown']);assert.deepEqual(drafts,before);
});
test('navigation shows version and local day correctly across the Shanghai midnight boundary',()=>{
 const now=Date.parse('2026-10-13T01:00:00Z');
 assert.equal(draftMeta({createdAt:'2026-10-12T17:00:00Z',versions:[]},now),'草稿 · 今天 01:00');
 assert.equal(draftMeta({createdAt:'2026-10-12T15:00:00Z',versions:[]},now),'草稿 · 昨天 23:00');
 assert.equal(draftMeta({selectedVersion:'v1',versions:[{id:'v1',label:'v1',createdAt:'2026-10-13T00:00:00Z'}]},now),'v1 · 今天 08:00');
 assert.equal(draftMeta({versions:[],createdAt:'invalid'},now),'草稿');
});
