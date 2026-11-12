import test from 'node:test';
import assert from 'node:assert/strict';
import {runPreparationQueue,preparationCheck,preparationFingerprint} from './app.js';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const note=platform=>({platform,draftId:'draft-one',kind:'video',title:platform+'独立标题',body:'验证正文',tags:'',assets:[{type:'video/mp4',size:2301}],fingerprint:platform+'-copy',settingsFingerprint:'none',agreementConfirmed:true});
function fixture(states={}){
 const calls=[];
 const adapter={status:async p=>states[p]||{phase:p==='xhs'?'connected':'login_observed',kind:'video'},connect:async(p,o)=>{calls.push(['connect',p,o]);return {phase:p==='xhs'?'connected':'login_observed',kind:o.kind};},prepare:async(p,n)=>{calls.push(['prepare',p,n.title]);return {phase:'prepared',preparationVerified:true,titleVerified:true,bodyVerified:true,titlePreviewVerified:true,bodyPreviewVerified:true};},applySettings:async p=>{calls.push(['settings',p]);return {optionsVerified:true};}};
 return {adapter,calls};
}
test('selected platform versions are prepared serially and no publish adapter is used',async()=>{
 const {adapter,calls}=fixture();let active=0,maxActive=0;
 const prepare=adapter.prepare;adapter.prepare=async(...a)=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();const r=await prepare(...a);active--;return r;};
 const results=await runPreparationQueue(['xhs','douyin','bilibili'].map(note),adapter);
 assert.equal(maxActive,1);assert.deepEqual(calls.map(c=>c[1]),['xhs','douyin','bilibili']);assert.ok(results.every(r=>r.state==='prepared'));
 assert.deepEqual(calls.map(c=>c[2]),['xhs独立标题','douyin独立标题','bilibili独立标题']);
});
test('login or upload failure does not prevent remaining selected platforms',async()=>{
 const {adapter,calls}=fixture({xhs:{phase:'awaiting_login'}});
 adapter.connect=async()=>({phase:'awaiting_login',message:'请本人扫码'});
 const prepare=adapter.prepare;adapter.prepare=async(p,n)=>{if(p==='douyin')throw new Error('timeout');return prepare(p,n);};
 const results=await runPreparationQueue(['xhs','douyin','bilibili'].map(note),adapter);
 assert.deepEqual(results.map(r=>r.state),['waiting_login','result_unknown','prepared']);assert.deepEqual(calls.map(c=>c[1]),['bilibili']);
});
test('same verified receipts do not reupload; another draft opens a new page retaining the previous one',async()=>{
 const a=note('douyin');a.record={fingerprint:a.fingerprint,state:'prepared',preparationVerified:true};
 const f=fixture({douyin:{phase:'prepared',draftId:a.draftId,preparationVerified:true,titleVerified:true,bodyVerified:true},bilibili:{phase:'prepared',draftId:'previous',preparationVerified:true,titleVerified:true,bodyVerified:true}});
 const r=await runPreparationQueue([a,note('bilibili')],f.adapter);
 assert.ok(r.every(x=>x.state==='prepared'));assert.deepEqual(f.calls.map(c=>c[0]),['connect','prepare']);assert.equal(f.calls[0][2].fresh,true);
});
test('uncertain upload is never automatically retried, while settings retry never reuploads video',async()=>{
 const a=note('douyin');a.record={state:'result_unknown',fingerprint:a.fingerprint};
 const b=note('bilibili');b.record={state:'settings_pending',fingerprint:b.fingerprint,preparationVerified:true};b.options={};b.settingsFingerprint='new-settings';
 const f=fixture({bilibili:{phase:'prepared',draftId:b.draftId,preparationVerified:true,titleVerified:true,bodyVerified:true}});
 const r=await runPreparationQueue([a,b],f.adapter);
 assert.deepEqual(r.map(x=>x.state),['needs_review','prepared']);assert.deepEqual(f.calls,[['settings','bilibili']]);
});
test('invalid and unsupported platforms and unconfirmed agreements do not mutate any browser',async()=>{
 const f=fixture();const x={...note('xhs'),title:'标题'.repeat(20)};const b={...note('bilibili'),agreementConfirmed:false};const d={...note('bilibili'),kind:'image'};
 const r=await runPreparationQueue([x,b,d],f.adapter);
 assert.deepEqual(r.map(x=>x.state),['invalid','waiting_agreement','invalid']);assert.deepEqual(f.calls,[]);
 assert.equal(preparationCheck({...x,platform:'../../private'}).valid,false);
});
test('upload marker is saved first; stopping completes the in-flight platform and skips later ones',async()=>{
 const f=fixture();let stop=false;const events=[];
 const prepare=f.adapter.prepare;f.adapter.prepare=async(p,n)=>{assert.equal(events.at(-1),'uploading');stop=true;return prepare(p,n);};
 const r=await runPreparationQueue([note('douyin'),note('bilibili')],f.adapter,{update:async e=>events.push(e.state),shouldStop:()=>stop});
 assert.deepEqual(r.map(x=>x.state),['prepared','stopped']);assert.deepEqual(f.calls.map(c=>c[1]),['douyin']);
});
test('XHS verified content fingerprint gives safe repeat protection without a draftId',async()=>{
 const a=note('xhs');const f=fixture({xhs:{phase:'prepared',preparationFingerprint:a.fingerprint,kind:'video',titlePreviewVerified:true,bodyPreviewVerified:true}});
 const r=await runPreparationQueue([a],f.adapter);assert.equal(r[0].state,'prepared');assert.deepEqual(f.calls,[]);
});
test('an unverified XHS preview is never marked complete from a matching fingerprint',async()=>{
 const a=note('xhs');a.record={state:'needs_review',fingerprint:a.fingerprint};
 const f=fixture({xhs:{phase:'prepared',preparationFingerprint:a.fingerprint,kind:'video',titlePreviewVerified:false,bodyPreviewVerified:true}});
 const r=await runPreparationQueue([a],f.adapter);assert.equal(r[0].state,'needs_review');assert.deepEqual(f.calls,[]);
});
test('a stopped record is not evidence that changed copy was prepared',async()=>{
 const a=note('douyin');a.record={state:'stopped',fingerprint:a.fingerprint};
 const f=fixture({douyin:{phase:'prepared',draftId:a.draftId,preparationVerified:true,titleVerified:true,bodyVerified:true}});
 const r=await runPreparationQueue([a],f.adapter);assert.equal(r[0].state,'needs_review');assert.deepEqual(f.calls,[]);
});
test('a transient login page resumes only the not-yet-uploaded platform within the same action',async()=>{
 const f=fixture();let reads=0;
 const status=f.adapter.status;f.adapter.status=async p=>p==='xhs'&&++reads===1?{phase:'awaiting_login'}:status(p);
 f.adapter.connect=async()=>({phase:'awaiting_login'});
 const r=await runPreparationQueue(['xhs','douyin','bilibili'].map(note),f.adapter);
 assert.ok(r.every(x=>x.state==='prepared'));
 assert.deepEqual(f.calls.map(c=>c[1]),['douyin','bilibili','xhs']);
});
test('edited copy with a verified previous receipt opens a new editor without overwriting it',async()=>{
 const a=note('douyin');a.record={state:'prepared',fingerprint:'previous-copy',preparationVerified:true};
 const f=fixture({douyin:{phase:'prepared',draftId:a.draftId,preparationVerified:true,titleVerified:true,bodyVerified:true}});
 const r=await runPreparationQueue([a],f.adapter);assert.equal(r[0].state,'prepared');assert.deepEqual(f.calls.map(c=>c[0]),['connect','prepare']);assert.equal(f.calls[0][2].fresh,true);
});
test('XHS fingerprint matches browser and worker, includes Unicode and ordered media',async()=>{
 const path=new URL('../evidence/工作台视频验收素材-20261012.mp4',import.meta.url);
 const media=createHash('sha256').update(readFileSync(path)).digest('hex');
 const n={kind:'video',title:'三平台🙂验证',body:'第一行\n第二行',tags:'#效率'};
 const expected=execFileSync(fileURLToPath(new URL('.venv/bin/python',import.meta.url)),['-c',"import json,sys;from xhs_worker import preparation_fingerprint;print(preparation_fingerprint(json.loads(sys.argv[1])))",JSON.stringify({...n,video_path:fileURLToPath(path),image_paths:[]})],{cwd:new URL('.',import.meta.url),encoding:'utf8'}).trim();
 assert.equal(await preparationFingerprint(n,[media]),expected);
 assert.notEqual(await preparationFingerprint(n,[media,'another']),await preparationFingerprint(n,['another',media]));
});

test('image queue opens the matching Douyin editor and skips unsupported Bili images',async()=>{
 const f=fixture();const media=[{id:'first',type:'image/png',size:500},{id:'second',type:'image/jpeg',size:400}];
 const notes=['xhs','douyin','bilibili'].map(p=>({...note(p),kind:'image',assets:media}));
 f.adapter.prepare=async(p,n)=>{f.calls.push(['prepare',p,n.assets.map(a=>a.id)]);return {phase:'prepared',preparationVerified:true,titleVerified:true,bodyVerified:true,titlePreviewVerified:true,bodyPreviewVerified:true,imageUploadVerified:true};};
 const results=await runPreparationQueue(notes,f.adapter);
 assert.deepEqual(results.map(r=>r.state),['prepared','prepared','manual_handoff']);
 assert.deepEqual(f.calls.filter(c=>c[0]==='connect').map(c=>c[2]),[{fresh:true,kind:'image'},{fresh:true,kind:'image'}]);
 assert.deepEqual(f.calls.filter(c=>c[0]==='prepare').map(c=>c[2]),[['first','second'],['first','second']]);
 assert.ok(!f.calls.some(c=>c[1]==='bilibili'));
});
test('image readiness requires native upload verification and does not reuse video readiness',async()=>{
 const f=fixture({douyin:{phase:'login_observed',kind:'image'}});
 const n={...note('douyin'),kind:'image',assets:[{type:'image/png',size:500}]};
 const r=await runPreparationQueue([n],f.adapter);
 assert.equal(r[0].state,'needs_review');assert.equal(r[0].preparationVerified,undefined);
 const pending=fixture();pending.adapter.connect=async()=>({phase:'login_observed',kind:'video'});
 assert.equal((await runPreparationQueue([n],pending.adapter))[0].state,'waiting_login');
 assert.ok(!pending.calls.some(c=>c[0]==='prepare'));
});

test('Bili image manual handoff is explicit and invalid image assets still require adjustment',async()=>{
 const f=fixture();const n={...note('bilibili'),kind:'image',assets:[{type:'image/png',size:500}]};
 const check=preparationCheck(n);assert.equal(check.manual,true);assert.match(check.issues[0],/网页专栏编辑器已下线/);
 const r=await runPreparationQueue([n],f.adapter);assert.equal(r[0].state,'manual_handoff');assert.deepEqual(f.calls,[]);
 assert.equal(preparationCheck({...n,assets:[{type:'video/mp4',size:500}]}).manual,undefined);
});

test('Bili image package joins the same queue, stays manual and reuses a matching package',async()=>{
 const f=fixture();let packages=0;
 f.adapter.prepareHandoff=async()=>{packages++;return {packagePrepared:true,packageFileName:'B站.zip'};};
 const n={...note('bilibili'),kind:'image',assets:[{type:'image/png',size:500}]};
 const first=(await runPreparationQueue([note('douyin'),n],f.adapter))[1];
 assert.equal(first.state,'manual_handoff');assert.equal(first.packagePrepared,true);assert.equal(first.preparationVerified,undefined);assert.equal(packages,1);
 assert.ok(!f.calls.some(c=>c[1]==='bilibili'));
 await runPreparationQueue([{...n,record:first}],f.adapter);assert.equal(packages,1);
 await runPreparationQueue([{...n,fingerprint:'changed',record:first}],f.adapter);assert.equal(packages,2);
});

test('a verified unchanged draft is never reuploaded after its native editor session closes',async()=>{
 const n=note('douyin');n.record={state:'prepared',preparationVerified:true,fingerprint:n.fingerprint};
 const f=fixture({douyin:{phase:'not_connected'}});
 const r=await runPreparationQueue([n],f.adapter);assert.equal(r[0].state,'needs_review');assert.equal(r[0].preparationVerified,true);assert.deepEqual(f.calls,[]);
});
test('fresh negative or missing readback overrides historical success without any remote mutation',async()=>{
 for(const platform of ['douyin','bilibili'])for(const flags of [{preparationVerified:false,titleVerified:false,bodyVerified:false},{}]){
  const n=note(platform);n.record={state:'prepared',fingerprint:n.fingerprint,preparationVerified:true};
  const f=fixture({[platform]:{phase:'prepared',draftId:n.draftId,...flags}});
  const r=await runPreparationQueue([n],f.adapter);
  assert.equal(r[0].state,'needs_review');assert.notEqual(r[0].preparationVerified,true);assert.deepEqual(f.calls,[]);
 }
});
