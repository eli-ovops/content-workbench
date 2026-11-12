import test from 'node:test';
import assert from 'node:assert/strict';
import {timeComparison} from './storage.js';
test('savings include failure, handoff and maintenance cost and do not invent missing baselines',()=>{
 assert.deepEqual(timeComparison(),{count:0,baseline:0,actual:0,net:0,percent:null});
 const r=timeComparison([{manualMinutes:10,workbenchMinutes:4,overheadMinutes:8},{workbenchMinutes:1},{manualMinutes:20,workbenchMinutes:2,overheadMinutes:NaN}]);
 assert.equal(r.count,1);assert.equal(r.net,-2);assert.equal(r.percent,-20);
 assert.equal(timeComparison([{manualMinutes:0,workbenchMinutes:0,overheadMinutes:0}]).count,1);
});
