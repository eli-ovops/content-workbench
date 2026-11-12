import test from 'node:test';
import assert from 'node:assert/strict';
import {checkXhsImage,moveAsset} from './xhs-policy.mjs';
const note={kind:'image',title:'图文标题',body:'正文',tags:'',images:[{type:'image/png',size:10}]};
test('combined body and tags including separators stay within the preparation limit',()=>{
  assert.equal(checkXhsImage({...note,body:'字'.repeat(998),tags:'#'}).valid,false);
  assert.equal(checkXhsImage({...note,body:'字'.repeat(1000)}).valid,true);
});
test('unsupported images and both per-image and combined sizes are rejected',()=>{
  for(const images of [[{type:'image/gif',size:100}],[{type:'image/png',size:9*1024*1024}],[{type:'image/png',size:6*1024*1024},{type:'image/png',size:6*1024*1024}]]) assert.equal(checkXhsImage({...note,images}).valid,false);
});
test('reordering preserves all asset identities and the original list',()=>{
  const assets=[{id:'a'},{id:'b'},{id:'c'}];
  assert.deepEqual(moveAsset(assets,'b',-1).map(a=>a.id),['b','a','c']);
  assert.deepEqual(assets.map(a=>a.id),['a','b','c']);
  assert.deepEqual(moveAsset(assets,'a',-1),assets);
});
