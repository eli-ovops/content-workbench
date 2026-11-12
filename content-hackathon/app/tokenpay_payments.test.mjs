import test from 'node:test';
import assert from 'node:assert/strict';
import {createTokenPayPayments,paymentStatusUrl,parsePayment,localPaymentQr} from './tokenpay_payments.mjs';
import {createTokenPayService} from './tokenpay_service.mjs';
const session=(status='pending',extra={})=>({session:{id:'offline-session',amount:1,status,expired_at:10000,status_url:paymentStatusUrl('offline-session'),payment_url:'https://example.invalid/fixture',...extra}});
const vault=()=>{let state;return {read:async()=>'offline-fixture-only',has:async()=>true,readPayment:async()=>state,savePayment:async s=>state=structuredClone(s)};};
const permissions={recharge:true,maxRechargeYuan:1};
test('payment creation requires authorization, exact amount and a suspended balance failure',async()=>{
 let calls=0;const make=p=>createTokenPayPayments({permissions:p,store:vault(),fetchImpl:async()=>{calls++;}});
 await assert.rejects(make({}).create({amount:1,confirmed:true,balanceRequired:true}),/not_authorized/);
 for(const bad of [{amount:1,confirmed:false,balanceRequired:true},{amount:2,confirmed:true,balanceRequired:true},{amount:1.1,confirmed:true,balanceRequired:true},{amount:1,confirmed:true,balanceRequired:false}])await assert.rejects(make(permissions).create(bad),/confirmation_required/);
 assert.equal(calls,0);
});
test('payment is only paid after an identity-matched official status; no automatic model call',async()=>{
 const calls=[];let paid=false;const store=vault();
 const service=createTokenPayPayments({permissions,store,now:()=>1000,qr:async()=> 'data:image/svg+xml;base64,Zml4dHVyZQ==',fetchImpl:async(u,r)=>{calls.push([u,r.method]);return {ok:true,json:async()=>session(paid?'paid':'pending')};}});
 const created=await service.create({amount:1,confirmed:true,balanceRequired:true});assert.equal(created.paid,false);assert.equal(created.amount,1);assert.ok(created.qrDataUrl);assert.ok(!JSON.stringify(created).includes('offline-fixture-only'));
 await assert.rejects(service.create({amount:1,confirmed:true,balanceRequired:true}),/existing_payment/);
 paid=true;assert.equal((await service.check()).paid,true);assert.equal(calls.length,2);assert.equal(calls[1][0],paymentStatusUrl('offline-session'));assert.ok(!calls.some(([u])=>u.includes('example.invalid')));
 const restarted=createTokenPayPayments({permissions,store,fetchImpl:async()=>{throw Error('must not fetch');}});assert.equal((await restarted.status()).paid,true);assert.equal((await restarted.check()).paid,true);
});
test('uncertain session creation is durable and cannot be repeated after a restart',async()=>{
 let calls=0;const store=vault(),make=()=>createTokenPayPayments({permissions,store,fetchImpl:async()=>{calls++;throw Error('private-provider-error');}});
 await assert.rejects(make().create({amount:1,confirmed:true,balanceRequired:true}));assert.equal((await make().status()).phase,'creation_unknown');
 await assert.rejects(make().create({amount:1,confirmed:true,balanceRequired:true}),/existing_payment/);assert.equal(calls,1);
});
test('foreign status URLs, mismatched payment identities and false paid responses are rejected',()=>{
 assert.throws(()=>parsePayment(session('paid',{status_url:'https://evil.invalid/'}),null),/unsafe/);
 assert.throws(()=>parsePayment(session('paid',{amount:2}),{id:'offline-session',amount:1}),/identity/);
 assert.throws(()=>parsePayment(session('paid',{id:'different-session'}),{id:'offline-session',amount:1}),/identity/);
 assert.throws(()=>paymentStatusUrl('../user/balance'),/invalid/);
});
test('expired and failed sessions stop; checks are bounded to one per three seconds',async()=>{
 let time=1000,calls=0;const service=createTokenPayPayments({permissions,store:vault(),now:()=>time,qr:async()=>'fixture',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>session()};}});
 await service.create({amount:1,confirmed:true,balanceRequired:true});await service.check();await assert.rejects(service.check(),/frequent/);
 time=10000001;assert.equal((await service.check()).phase,'expired');assert.equal(calls,2);
});
test('payment retries the original request only after explicit consent and confirmed payment',async()=>{
 let paid=false,modelCalls=0;const originals=[];
 const service=createTokenPayService({permissions:{...permissions,modelCalls:true,accountRead:true,model:'fixture-model',maxCalls:2,maxOutputTokens:512},store:vault(),paymentQr:async()=>'fixture',now:()=>1000,fetchImpl:async(u,r)=>{
  if(u.endsWith('/user/balance'))return {ok:true,json:async()=>({balance:{balance:0}})};
  if(u.includes('/payment/sessions'))return {ok:true,json:async()=>session(paid?'paid':'pending')};
  originals.push(JSON.parse(r.body));modelCalls++;
  if(modelCalls===1)return {ok:false,status:402};
  return {ok:true,json:async()=>({id:'offline-call',usage:{prompt_tokens:80,completion_tokens:30},choices:[{message:{content:JSON.stringify({title:'候选',body:'原事实',tags:''})}}]})};
 }});
 const input={platform:'xhs',title:'母稿',body:'原事实',tags:''};assert.equal((await service.suggest(input)).balanceRequired,true);
 await service.createPayment({amount:1,confirmed:true});await assert.rejects(service.resume({confirmed:true}),/not_verified/);assert.equal(modelCalls,1);
 paid=true;await service.checkPayment();await assert.rejects(service.resume({confirmed:false}),/confirmation/);assert.equal(modelCalls,1);
 assert.equal((await service.resume({confirmed:true})).reviewRequired,true);assert.deepEqual(originals[0],originals[1]);assert.equal(modelCalls,2);
});
test('a Key limit with positive account balance does not offer a recharge',async()=>{
 const service=createTokenPayService({permissions:{modelCalls:true,accountRead:true,model:'fixture',maxCalls:1,maxOutputTokens:512},store:vault(),fetchImpl:async u=>u.endsWith('/user/balance')?{ok:true,json:async()=>({balance:{balance:10000}})}:{ok:false,status:402}});
 const r=await service.suggest({platform:'xhs',title:'原文',body:'正文',tags:''});assert.equal(r.balanceRequired,false);assert.equal(r.needsReview,true);assert.equal((await service.status()).pendingRetry,false);
});
test('conservative price reservation and input size block excess calls before model requests',async()=>{
 let calls=0;const p={modelCalls:true,model:'fixture',maxCalls:3,maxOutputTokens:512,maxCostMicros:1,inputPrice:.8,outputPrice:2.7};
 const service=createTokenPayService({permissions:p,store:vault(),fetchImpl:async()=>{calls++;}});
 await assert.rejects(service.suggest({platform:'xhs',title:'标题',body:'原文',tags:''}));assert.equal(calls,0);
});
test('QR generation uses the existing local encoder and emits only an SVG matrix',async()=>{
 const r=await localPaymentQr('https://example.invalid/offline-payment');assert.ok(r.startsWith('data:image/svg+xml;base64,'));const svg=Buffer.from(r.split(',')[1],'base64').toString();assert.match(svg,/viewBox=/);assert.ok(!svg.includes('example.invalid'));assert.ok(!svg.includes('<script'));
});
