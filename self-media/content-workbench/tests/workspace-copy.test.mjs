import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {Store} from '../src/store.mjs';import {demoWorkspace} from '../src/fixture.mjs';import {clone,hash} from '../src/model.mjs';
const base=path.resolve('evidence','workspace-copy-'+Date.now());await fs.mkdir(base,{recursive:true});
test('workspace copy preserves originals, full relations and target edits; repeated copy is idempotent',async()=>{
 const sourceRoot=path.join(base,'source'),targetRoot=path.join(base,'target');await new Store(sourceRoot).init([demoWorkspace()]);await new Store(targetRoot).init([demoWorkspace()]);let source=await new Store(sourceRoot).open(),target=await new Store(targetRoot).open();
 try{let s=source.state.workspaces[0];s=await source.freeze(s.id,s.revision);s=await source.update(s.id,s.revision,{notes:[{id:'source-note',text:'Original note',scriptVersion:s.selectedVersion,paragraphId:s.versions[0].paragraphs[0].id,sourceIds:[]}]});const originals=clone(source.state),prior=clone(target.state.workspaces[0]);
 const first=await target.copyWorkspaces(source.state.workspaces,{sourceRootId:source.marker.rootId});assert.equal(first.copied,1);assert.deepEqual(target.workspace(s.id),s);assert.deepEqual(target.workspace(prior.id),prior);assert.deepEqual(source.state,originals);assert.equal(target.approvals.size,0);
 const savedHash=hash(target.state);const again=await target.copyWorkspaces(source.state.workspaces,{sourceRootId:source.marker.rootId});assert.equal(again.copied,0);assert.equal(again.skipped,1);assert.equal(hash(target.state),savedHash);
 }finally{await source.close();await target.close();}
 target=await new Store(targetRoot).open();assert.equal(target.state.workspaces.length,2);assert.equal(target.approvals.size,0);await target.close();
});
test('a conflicting ID or invalid relation rejects the entire copy and preserves prior state',async()=>{
 const root=path.join(base,'reject');await new Store(root).init([demoWorkspace()]);const store=await new Store(root).open();try{const before=hash(store.state),collision=clone(store.state.workspaces[0]);collision.body='different content';const fresh=demoWorkspace();await assert.rejects(store.copyWorkspaces([fresh,collision]),e=>e.code==='COPY_CONFLICT');assert.equal(hash(store.state),before);const invalid=demoWorkspace();invalid.notes.push({id:'bad',text:'bad',sourceIds:['missing']});await assert.rejects(store.copyWorkspaces([fresh,invalid]));assert.equal(hash(store.state),before);}finally{await store.close();}
});
