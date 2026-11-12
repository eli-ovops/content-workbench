import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeDouyinTopics,checkDouyinOptions,validateDouyinOptions} from './douyin-policy.mjs';
const draftId='e4cc8edc-0660-4a3e-9eee-2b5950ef7afb';
test('Douyin topics deduplicate and keep order; unsafe or oversized topics are rejected',()=>{
 assert.deepEqual(normalizeDouyinTopics('#AI工具，效率工具，AI工具'),['AI工具','效率工具']);
 assert.equal(checkDouyinOptions({coverMode:'keep',topics:[]}).valid,true);
 for(const topics of [['a b'],['x'.repeat(21)],['1','2','3','4','5','6']])assert.equal(checkDouyinOptions({coverMode:'keep',topics}).valid,false);
});
test('Douyin cover validates bytes and draft scope; caller paths have no effect',()=>{
 const data=Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
 const result=validateDouyinOptions({draftId,topics:['AI'],coverMode:'upload',cover:{data,type:'image/png',path:'/private'}});
 assert.equal(result.coverType,'image/png');assert.equal(result.cover.path,undefined);
 assert.throws(()=>validateDouyinOptions({draftId:'../private',coverMode:'keep'}));
 assert.throws(()=>validateDouyinOptions({draftId,coverMode:'upload',cover:{data,type:'image/jpeg'}}));
});
