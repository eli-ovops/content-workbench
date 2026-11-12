import test from 'node:test';
import assert from 'node:assert/strict';
import {createBroker} from './rpc_broker.mjs';
test('parallel status requests share one worker request; connect cannot queue behind them',async()=>{
  const sent=[];const broker=createBroker(r=>sent.push(r));
  const a=broker.request('status'),b=broker.request('status');assert.equal(a,b);assert.equal(sent.length,1);
  await assert.rejects(broker.request('connect'),/重复提交/);assert.equal(sent.length,1);
  broker.receive({id:sent[0].id,ok:true,result:{phase:'connected'}});assert.equal((await a).phase,'connected');
});
test('timed-out command stays locked until its terminal worker response arrives',async()=>{
  const sent=[];const broker=createBroker(r=>sent.push(r),5);
  const operation=broker.request('prepare');await assert.rejects(operation,/尚未核实/);
  assert.equal((await broker.request('status')).phase,'result_unknown');
  await assert.rejects(broker.request('connect'),/尚未核实/);assert.equal(sent.length,1);
  broker.receive({id:sent[0].id,ok:true,result:{phase:'prepared'}});
  const status=broker.request('status');assert.equal(sent.length,2);
  broker.receive({id:sent[1].id,ok:true,result:{phase:'prepared'}});assert.equal((await status).phase,'prepared');
});
