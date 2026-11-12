import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBiliTags,checkBiliOptions,validateBiliOptions} from './bilibili-policy.mjs';
const draftId='f52ebfd8-f1cc-4d1e-a710-94f4fbc24a28';
const base={draftId,categoryPath:['科技','软件应用'],tags:['AI工具','效率工具'],coverMode:'frame',frameIndex:0};
test('Bili tags keep order and internal spaces, collapse duplicates without changing text',()=>{
  assert.deepEqual(normalizeBiliTags(' AI工具，AI工具, AI Tools\n效率工具 '),['AI工具','AI Tools','效率工具']);
  assert.equal(checkBiliOptions(base).valid,true);
  assert.equal(checkBiliOptions({...base,tags:Array.from({length:11},(_,i)=>'标签'+i)}).valid,false);
  assert.equal(checkBiliOptions({...base,tags:['x'.repeat(21)]}).valid,false);
});
test('settings reject arbitrary paths, missing category and oversized or disguised covers',()=>{
  assert.throws(()=>validateBiliOptions({...base,draftId:'../../private'}));
  assert.throws(()=>validateBiliOptions({...base,categoryPath:[]}));
  assert.throws(()=>validateBiliOptions({...base,coverMode:'upload',cover:{type:'image/png',data:Buffer.from('not an image').toString('base64')}}));
  assert.equal(checkBiliOptions({...base,coverMode:'upload',cover:{type:'image/png',size:2*1024*1024+1}}).valid,false);
  const png=Buffer.from('89504e470d0a1a0a','hex');
  const accepted=validateBiliOptions({...base,coverMode:'upload',cover:{type:'image/png',data:png.toString('base64'),path:'/private',name:'../../private'}});
  assert.deepEqual(accepted.cover,png);
  assert.equal(accepted.categoryPath[1],'软件应用');
  assert.equal(accepted.coverPath,undefined);
});
