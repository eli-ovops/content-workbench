import test from 'node:test';
import assert from 'node:assert/strict';
import {providerBridge} from './provider_bridge.mjs';
test('unknown providers are refused and read-only cold status starts no login process',async()=>{
  assert.throws(()=>providerBridge('../../private'));
  for(const platform of ['douyin','bilibili']){
    const bridge=providerBridge(platform);
    assert.equal((await bridge.status()).phase,'not_connected');
    assert.deepEqual(await bridge.inspect(),{pageOpen:false});
    await assert.rejects(bridge.connect({fresh:true}),/先连接/);
    if(platform==='bilibili'){
      await assert.rejects(bridge.prepare({kind:'video',title:'x',body:'',tags:'',video:{data:'a'}}),/本人阅读确认/);
      await assert.rejects(bridge.prepare({agreementConfirmed:true,kind:'video',title:'x',body:'',tags:'',video:{data:'a'}}));
      await assert.rejects(bridge.options({draftId:'4d65ee07-f41e-4f11-a1a3-e5638d63b929',categoryPath:['人工智能'],tags:['AI工具'],coverMode:'frame',frameIndex:0}),/先准备B站视频/);
      await assert.rejects(bridge.options({draftId:'../../private'}));
    }
    else {
      await assert.rejects(bridge.prepare({}),/文案格式/);
      const mp4=Buffer.alloc(16);mp4.write('ftyp',4);
      await assert.rejects(bridge.prepare({kind:'video',title:'test',body:'',tags:'',video:{data:mp4.toString('base64')}}),/先本人登录抖音/);
    }
    assert.equal((await bridge.status()).phase,'not_connected');
    assert.equal(providerBridge(platform),bridge);
  }
});

test('image validation happens before browser mutation and Bili remains video only',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64');
 const payload={kind:'image',title:'图文',body:'正文',tags:'',images:[{data:png}]};
 await assert.rejects(providerBridge('douyin').prepare(payload),/先本人登录/);
 await assert.rejects(providerBridge('douyin').prepare({...payload,images:[{data:'aW52YWxpZA=='}]}),/有效/);
 await assert.rejects(providerBridge('douyin').prepare({...payload,images:Array(10).fill({data:png})}),/1至9/);
 await assert.rejects(providerBridge('bilibili').connect({kind:'image'}),/不支持/);
 await assert.rejects(providerBridge('bilibili').prepare({...payload,agreementConfirmed:true}),/只支持视频/);
});
