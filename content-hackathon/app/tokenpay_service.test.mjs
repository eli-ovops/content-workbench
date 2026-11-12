import test from 'node:test';
import assert from 'node:assert/strict';
import {pkceChallenge,createTokenPayService,TOKENPAY_APP_URL,protectedKeyStore} from './tokenpay_service.mjs';
import {mkdtemp,stat,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {handleTokenPay} from './tokenpay_http.mjs';
import {aiInputRevision,canAdoptAi} from './app.js';
const vault=()=>{let value;return {has:async()=>!!value,read:async()=>value,save:async v=>{if(value)throw new Error('already_stored');value=v;}};};
test('PKCE matches RFC7636 published test vector',()=>{
 assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
 assert.throws(()=>pkceChallenge('short'));
});
test('all external actions are denied by default without touching the network',async()=>{
 let calls=0;const service=createTokenPayService({store:vault(),fetchImpl:async()=>{calls++;}});
 await assert.rejects(service.startAuthorization(),/not_authorized/);
 await assert.rejects(service.finishAuthorization({code:'fixture',flowId:'fixture'}),/not_authorized/);
 await assert.rejects(service.suggest({}),/not_authorized/);assert.equal(calls,0);
});
test('OAuth binds nonce, fixed app identity and S256; a successful callback cannot be replayed',async()=>{
 const store=vault();let calls=0,exchanged;
 const service=createTokenPayService({permissions:{keyCreation:true},store,fetchImpl:async(url,request)=>{calls++;exchanged=JSON.parse(request.body);assert.equal(url,'https://tokendance.space/portal/api/v1/auth/keys');return {ok:true,json:async()=>({key:'offline-fixture-only'})};}});
 const start=await service.startAuthorization(),url=new URL(start.authorizationUrl),id=new URL(url.searchParams.get('callback_url')).searchParams.get('flow');
 assert.equal(url.searchParams.get('app_url'),TOKENPAY_APP_URL);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 await assert.rejects(service.finishAuthorization({flowId:'wrong',code:'fixture'}),/invalid/);assert.equal(calls,0);
 const done=await service.finishAuthorization({flowId:id,code:'fixture'});assert.deepEqual(done,{connected:true,appUrl:TOKENPAY_APP_URL});assert.equal(pkceChallenge(exchanged.code_verifier),url.searchParams.get('code_challenge'));
 await assert.rejects(service.finishAuthorization({flowId:id,code:'fixture'}),/invalid/);await assert.rejects(service.startAuthorization(),/existing_key/);assert.equal(calls,1);assert.ok(!JSON.stringify(done).includes('offline-fixture-only'));
});
test('expired OAuth and uncertain exchange never trigger blind repeats or leak provider errors',async()=>{
 let now=0,calls=0;const service=createTokenPayService({permissions:{keyCreation:true},store:vault(),now:()=>now,fetchImpl:async()=>{calls++;throw new Error('sensitive-provider-body');}});
 const getId=async()=>new URL(new URL((await service.startAuthorization()).authorizationUrl).searchParams.get('callback_url')).searchParams.get('flow');
 const old=await getId();now=600001;await assert.rejects(service.finishAuthorization({flowId:old,code:'fixture'}),/invalid/);assert.equal(calls,0);
 await assert.rejects(service.startAuthorization(),/already_pending/);
 const unknown=createTokenPayService({permissions:{keyCreation:true},store:vault(),now:()=>now,fetchImpl:async()=>{calls++;throw new Error('sensitive-provider-body');}});
 const id=new URL(new URL((await unknown.startAuthorization()).authorizationUrl).searchParams.get('callback_url')).searchParams.get('flow');
 await assert.rejects(unknown.finishAuthorization({flowId:id,code:'fixture'}),/^Error: key_exchange_unknown_do_not_retry$/);
 now+=700000;await assert.rejects(unknown.startAuthorization(),/already_pending/);await assert.rejects(unknown.finishAuthorization({flowId:id,code:'fixture'}),/invalid/);assert.equal(calls,1);
});
test('model request is explicitly limited, attributed, review-only and never reports revenue',async()=>{
 const store=vault();await store.save('offline-fixture-only');let calls=0;
 const service=createTokenPayService({permissions:{modelCalls:true,model:'offline-fixture-model',maxCalls:1,maxOutputTokens:512},store,fetchImpl:async(url,r)=>{
  calls++;assert.equal(url,'https://tokendance.space/gateway/v1/chat/completions');assert.equal(r.headers['X-App-URL'],TOKENPAY_APP_URL);assert.equal(r.redirect,'error');assert.equal(JSON.parse(r.body).max_tokens,512);
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({title:'候选标题',body:'离线候选正文',tags:''})}}]})};
 }});
 const r=await service.suggest({platform:'xhs',title:'原标题',body:'原正文',tags:''});assert.equal(r.reviewRequired,true);assert.equal(r.revenueVerified,false);assert.ok(!JSON.stringify(r).includes('offline-fixture-only'));
 await assert.rejects(service.suggest({platform:'xhs',title:'原标题',body:'原正文',tags:''}),/limit/);assert.equal(calls,1);
});
test('AI candidates cannot overwrite another draft, edited copy, or changed media',()=>{
 const source={id:'draft-one',channels:['xhs'],versions:{},title:'原标题',body:'原正文',tags:'',kind:'image',assets:[{id:'image-one',size:10,type:'image/png'}]};
 const candidate={title:'候选',body:'候选正文',tags:'',sourceRevision:aiInputRevision(source,'xhs')};
 assert.equal(canAdoptAi(source,'xhs',candidate),true);
 for(const changed of [{...source,id:'another'},{...source,body:'已修改'},{...source,assets:[{id:'replaced',size:10,type:'image/png'}]}])assert.equal(canAdoptAi(changed,'xhs',candidate),false);
 assert.equal(canAdoptAi(source,'douyin',candidate),false);
});
test('HTTP routes reject cross-origin mutation and scrub callback codes from redirects',async()=>{
 let called=0;const service={status:async()=>({keyCreationAllowed:false}),startAuthorization:async()=>{called++;},finishAuthorization:async()=>{throw new Error('fixture-private-code');}};
 const invoke=async(url,headers={},method='POST')=>{
  const req=Readable.from([Buffer.from('{}')]);Object.assign(req,{url,method,headers:{host:'127.0.0.1:4197',...headers}});
  const result={headers:{},code:200,body:''};const res={setHeader:(k,v)=>result.headers[k]=v,writeHead:(c,h)=>{result.code=c;Object.assign(result.headers,h);},end:b=>result.body=b||''};
  assert.equal(await handleTokenPay(req,res,service),true);return result;
 };
 const denied=await invoke('/api/tokenpay/authorize',{origin:'https://example.invalid','x-eli-request':'local-workbench','content-type':'application/json'});assert.equal(denied.code,403);assert.equal(called,0);
 const callback=await invoke('/api/tokenpay/callback?flow=fixture&code=fixture-private-code',{},'GET');assert.equal(callback.code,303);assert.equal(callback.headers.Location,'/?tokenpay=needs-review#wallet');assert.ok(!JSON.stringify(callback).includes('fixture-private-code'));
});
test('protected store modes, exchange lock and call budget survive service restarts',async()=>{
 const dir=await mkdtemp(tmpdir()+'/eli-tokenpay-qa-');
 // Only these exact test-created files are removed; no recursive cleanup.
 console.log('QA-only created paths: '+JSON.stringify([dir,dir+'/exchange-started.json',dir+'/key.json',dir+'/call-attempts.json']));
 try{
  const first=protectedKeyStore(dir);await first.lockExchange();
  let fetches=0;const restarted=createTokenPayService({permissions:{keyCreation:true},store:protectedKeyStore(dir),fetchImpl:async()=>{fetches++;}});
  await assert.rejects(restarted.startAuthorization(),/previous_key_exchange/);assert.equal(fetches,0);
  await first.save('offline-fixture-only');assert.equal((await stat(dir+'/key.json')).mode&0o077,0);assert.equal(await protectedKeyStore(dir).read(),'offline-fixture-only');
  await assert.rejects(first.save('second-offline-fixture'),/EEXIST/);
  assert.equal(await first.reserveCall(1),1);await assert.rejects(protectedKeyStore(dir).reserveCall(1),/limit/);
  assert.equal((await stat(dir+'/call-attempts.json')).mode&0o077,0);
 }finally{
  for(const name of ['exchange-started.json','key.json','call-attempts.json'])try{await unlink(dir+'/'+name);}catch(e){if(e.code!=='ENOENT')throw e;}
  await rmdir(dir);
 }
});
test('invalid model output is never returned as an adoptable candidate and never automatically retried',async()=>{
 const store=vault();await store.save('offline-fixture-only');let calls=0;
 const service=createTokenPayService({permissions:{modelCalls:true,model:'offline-fixture',maxCalls:1,maxOutputTokens:512},store,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:'not JSON'}}]})};}});
 const input={platform:'douyin',title:'原文',body:'正文',tags:''};
 await assert.rejects(service.suggest(input),/^Error: model_result_unverified_do_not_retry_automatically$/);await assert.rejects(service.suggest(input),/limit/);assert.equal(calls,1);
});
test('HTTP 402 pauses the frozen request for recharge without a retry or a candidate',async()=>{
 const store=vault();await store.save('offline-fixture-only');let calls=0;
 const service=createTokenPayService({permissions:{modelCalls:true,accountRead:true,model:'offline-fixture',maxCalls:2,maxOutputTokens:512},store,fetchImpl:async url=>{if(url.includes('/user/balance'))return {ok:true,json:async()=>({balance:{balance:0}})};calls++;return {ok:false,status:402,json:async()=>({error:{code:'insufficient_balance'}})};}});
 const input={platform:'xhs',title:'原文',body:'正文',tags:''};
 const result=await service.suggest(input);
 assert.equal(result.balanceRequired,true);assert.equal(result.candidate,undefined);assert.equal(calls,1);
 assert.equal((await service.status()).pendingRetry,true);
});
test('usage matching is exact and never asserts app attribution or revenue from a generic usage row',async()=>{
 const store=vault();await store.save('offline-fixture-only');let mismatch=true;
 const service=createTokenPayService({permissions:{modelCalls:true,accountRead:true,model:'offline-fixture',maxCalls:1,maxOutputTokens:512},store,fetchImpl:async url=>{
  if(url.includes('/usage?'))return {ok:true,json:async()=>({items:[{id:mismatch?'another-call':'exact-call',cost:120}]})};
  return {ok:true,json:async()=>({id:'exact-call',usage:{prompt_tokens:80,completion_tokens:30},choices:[{message:{content:JSON.stringify({title:'候选',body:'原事实',tags:''})}}]})};
 }});
 await service.suggest({platform:'xhs',title:'原文',body:'原事实',tags:''});assert.equal((await service.usageReceipt()).matched,false);
 mismatch=false;const r=await service.usageReceipt();assert.equal(r.usageRecordMatched,true);assert.equal(r.costMicros,120);assert.equal(r.attributionVerified,false);assert.equal(r.revenueVerified,false);
});
test('all new HTTP mutation routes enforce origin and no authorization means no network',async()=>{
 let calls=0;const service=createTokenPayService({store:vault(),fetchImpl:async()=>{calls++;}});
 for(const path of ['payment','payment-check','resume','balance','usage-receipt']){
  for(const origin of ['https://example.invalid','http://127.0.0.1:4197']){
   const req=Readable.from([Buffer.from('{}')]);Object.assign(req,{url:'/api/tokenpay/'+path,method:'POST',headers:{host:'127.0.0.1:4197',origin,'x-eli-request':'local-workbench','content-type':'application/json'}});
   const result={code:200,body:''},res={setHeader:()=>{},writeHead:c=>result.code=c,end:b=>result.body=b};
   await handleTokenPay(req,res,service);assert.equal(result.code,origin.startsWith('https')?403:400);assert.ok(!result.body.includes('offline-fixture-only'));
  }
 }
 assert.equal(calls,0);
});
