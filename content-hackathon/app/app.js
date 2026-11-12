import { getDrafts, saveDraft, getAsset, timeComparison, exportBackup, importBackup } from './storage.js';
import { checkXhsImage,checkXhsVideo, moveAsset } from './xhs-policy.mjs';
import {normalizeBiliTags,checkBiliOptions,BILI_COVER_LIMIT,buildBiliImagePackage} from './bilibili-policy.mjs';
import {normalizeDouyinTopics,checkDouyinOptions,DOUYIN_COVER_LIMIT} from './douyin-policy.mjs';

export function aiInputRevision(source,platform){
 const v=source.versions?.[platform]||source;
 return JSON.stringify({draftId:source.id,platform,title:v.title,body:v.body,tags:v.tags,kind:source.kind,assets:source.assets.map(a=>({id:a.id,size:a.size,type:a.type}))});
}
export function canAdoptAi(source,platform,suggestion){
 return !!suggestion&&source.channels.includes(platform)&&suggestion.sourceRevision===aiInputRevision(source,platform)&&['title','body','tags'].every(k=>typeof suggestion[k]==='string');
}

export function preparationCheck(note) {
  if(!['xhs','douyin','bilibili'].includes(note.platform))return {valid:false,issues:['平台不支持']};
  if(!['image','video'].includes(note.kind))return {valid:false,issues:['当前通路不支持纯文字']};
  const check=(note.kind==='image'?checkXhsImage:checkXhsVideo)({...note,images:note.assets});
  if(check.valid&&note.platform==='bilibili'&&note.kind==='image')return {valid:false,manual:true,issues:['B站网页专栏编辑器已下线，图文需在B站App接续；本稿未自动上传']};
  return check;
}
export async function preparationFingerprint(note,media) {
  const data=new TextEncoder().encode(JSON.stringify({kind:note.kind,title:note.title,body:note.body,tags:note.tags,media}));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
}

export async function runPreparationQueue(notes,adapter,{update=async()=>{},shouldStop=()=>false,settle=true}={}) {
  const results=[];
  for(const note of notes){
    const entry={platform:note.platform,draftId:note.draftId,fingerprint:note.fingerprint,revision:note.revision,settingsFingerprint:note.settingsFingerprint,checkedAt:Date.now()};
    const report=async(state,message,extra={})=>{Object.assign(entry,{state,message,...extra});await update({...entry});};
    let uploadStarted=false,prepared=false;
    try{
      const check=preparationCheck(note);
      if(shouldStop()){await report('stopped','已停止后续准备');results.push({...entry});continue;}
      if(!check.valid){
        if(check.manual&&adapter.prepareHandoff){
          const samePackage=note.record?.packagePrepared===true&&note.record.fingerprint===note.fingerprint;
          const pack=samePackage?note.record:await adapter.prepareHandoff(note);
          if(pack.packagePrepared!==true)throw new Error('图文准备包生成未完成');
          await report('manual_handoff','本稿B站图文准备包已生成；请下载后在App接续，尚未填入App或发布',{packagePrepared:true,packageFileName:pack.packageFileName});
        }else await report(check.manual?'manual_handoff':'invalid',check.issues.join('；'));
        results.push({...entry});continue;
      }
      await report('checking','正在核对平台编辑页');
      let status=await adapter.status(note.platform);
      const recorded=note.record?.preparationVerified===true||(['uploading','result_unknown'].includes(note.record?.state)&&status.preparationVerified===true);
      const currentVerified=note.platform==='xhs'?status.titlePreviewVerified===true&&status.bodyPreviewVerified===true:status.preparationVerified===true&&status.titleVerified===true&&status.bodyVerified===true&&(note.platform!=='douyin'||note.kind!=='image'||status.imageUploadVerified===true);
      const same=status.phase==='prepared'&&currentVerified&&(note.platform==='xhs'?status.preparationFingerprint===note.fingerprint:status.draftId===note.draftId&&recorded&&note.record?.fingerprint===note.fingerprint);
      if(same)prepared=true;
      else if(status.phase==='prepared'&&!currentVerified){
        await report('needs_review',status.message||'当前编辑页回读未通过，旧成功记录不能作为当前核对；请检查，勿重传',{preparationVerified:false});results.push({...entry});continue;
      }
      else if(note.record?.preparationVerified===true&&note.record.fingerprint===note.fingerprint&&['not_connected','awaiting_login','page_pending'].includes(status.phase)){
        await report('needs_review','本稿有上次准备记录，但当前专用编辑页不在；请先核对，勿重传',{preparationVerified:true});results.push({...entry});continue;
      }else if(['uploading','result_unknown','needs_review'].includes(note.record?.state)){
        await report('needs_review','上一项准备结果待核对；请检查编辑页，或手动新开编辑页后再继续');results.push({...entry});continue;
      }else if(['preparing','result_unknown','preparation_incomplete','verification_required','unexpected_origin','error'].includes(status.phase)){
        await report('needs_review',status.message||'请先核对当前平台页，不能重传');results.push({...entry});continue;
      }else if(status.phase==='prepared'&&note.platform!=='xhs'&&status.draftId===note.draftId&&!note.record?.preparationVerified){
        await report('needs_review','本稿已在编辑页，本次未重传；请核对最新修改，或手动新开编辑页');results.push({...entry});continue;
      }else if(status.phase==='prepared'||(['xhs','douyin'].includes(note.platform)&&['connected','login_observed'].includes(status.phase)&&(status.kind||'video')!==note.kind)){
        await report('opening','正在新开编辑页，已有稿件保留');
        status=await adapter.connect(note.platform,{fresh:true,kind:note.kind});
      }else if(!['connected','login_observed'].includes(status.phase)){
        await report('connecting','正在打开专用浏览器');
        status=await adapter.connect(note.platform,{fresh:false,kind:note.kind});
      }
      if(!prepared){
        const ready=note.platform==='xhs'?status.phase==='connected'&&status.kind===note.kind:status.phase==='login_observed'&&(note.platform!=='douyin'||(status.kind||'video')===note.kind);
        if(!ready){await report('waiting_login',status.message||'请本人在专用窗口登录，再继续准备');results.push({...entry});continue;}
        if((note.platform==='bilibili'||status.agreementRequired)&&!note.agreementConfirmed){
          await report('waiting_agreement',note.platform==='bilibili'?'工作台的B站协议确认栏尚未勾选，请本人核对后确认':'请本人阅读并确认该平台上传页协议后继续');results.push({...entry});continue;
        }
        // Persist the upload marker before any remote mutation. An interrupted
        // run must never be silently treated as safe to upload again.
        await report('uploading','正在上传素材并填写平台版本');
        uploadStarted=true;
        status=await adapter.prepare(note.platform,note);
        const verified=status.phase==='prepared'&&(note.platform==='xhs'?status.titlePreviewVerified===true&&status.bodyPreviewVerified===true:status.preparationVerified===true&&status.titleVerified===true&&status.bodyVerified===true&&(note.platform!=='douyin'||note.kind!=='image'||status.imageUploadVerified===true));
        if(!verified){await report('needs_review','已尝试准备，平台回读尚未通过；请检查编辑页，勿重传');results.push({...entry});continue;}
        prepared=true;
        // Keep this receipt if settings fail or the app is closed afterwards.
        await report('video_ready','素材和文案已准备，尚未发布',{preparationVerified:true});
      }
      if(note.settingsIssues?.length){await report('settings_pending','素材和文案已准备；设置需调整：'+note.settingsIssues.join('；'),{preparationVerified:true});results.push({...entry});continue;}
      if(note.options&&!(note.record?.state==='prepared'&&note.record.settingsFingerprint===note.settingsFingerprint&&same)){
        await report('applying_settings','正在应用本稿已保存的封面和标签',{preparationVerified:true});
        const result=await adapter.applySettings(note.platform,note);
        if(result.optionsVerified!==true)throw new Error('设置回读尚未通过');
      }
      await report('prepared',note.options?'素材、文案和本稿设置已准备，尚未发布':same?'已有准备结果，本次未重复上传；尚未发布':'素材和文案已准备，尚未发布',{preparationVerified:true,settingsVerified:!!note.options});
    }catch(error){
      await report(prepared?'settings_pending':uploadStarted?'result_unknown':'failed',prepared?'素材和文案已准备；设置未完成：'+error.message:uploadStarted?'准备结果待核对：'+error.message+'；请勿重传':'未开始上传：'+error.message,{preparationVerified:prepared});
    }
    results.push({...entry});
  }
  // A persisted login can become ready while another selected platform runs.
  // Recheck only entries that never uploaded, once; uncertain jobs stay locked.
  if(settle&&!shouldStop())for(let index=0;index<results.length;index++){
    if(results[index].state!=='waiting_login')continue;
    let status;try{status=await adapter.status(notes[index].platform);}catch{continue;}
    const ready=notes[index].platform==='xhs'?status.phase==='connected'&&status.kind===notes[index].kind:status.phase==='login_observed'&&(notes[index].platform!=='douyin'||(status.kind||'video')===notes[index].kind);
    if(ready)results[index]=(await runPreparationQueue([notes[index]],adapter,{update,shouldStop,settle:false}))[0];
  }
  return results;
}

// The queue is exported for isolated tests; DOM setup runs only in the workbench.
if (typeof document !== 'undefined') {
const names = { xhs: '小红书', douyin: '抖音', bilibili: 'B站' };
const $ = id => document.getElementById(id);
const emptyDraft = () => ({ id: crypto.randomUUID(), kind: 'video', title: '', body: '', tags: '', channels: [], versions: {}, assets: [], updatedAt: Date.now() });
let drafts = [], draft = emptyDraft(), activeChannel = '', dirty = false, saving = false, toastTimer, assetGeneration = 0;
let draftQuery = '';
let objectUrls = [];
let xhsPhase = 'not_connected', xhsBusy = false, loginPolls = 0, loginPollTimer;
let xhsEditorKind = 'image';
const xhsMessage = result => result.phase === 'prepared' && result.titlePreviewVerified !== true ? '图片和正文已传入；标题预览同步待人工核对。尚未发布。' : result.message;
let loginImageUrl;
let preparationBusy=false,preparationStop=false;
let aiBusy=false,tokenpayStatus={keyCreationAllowed:false,modelCallsAllowed:false,connected:false};
let pendingAi=null,paymentBusy=false;
const preparationDisabled=new Map();
const liveResults={};
const preparationLabels={checking:'核对中',opening:'新开编辑页',connecting:'连接中',uploading:'上传填写中',video_ready:'文案已准备',applying_settings:'应用设置中',prepared:'已准备',settings_pending:'设置待处理',waiting_login:'等待本人登录',waiting_agreement:'等待协议确认',needs_review:'待核对',result_unknown:'结果待核对',failed:'未开始',invalid:'需调整',manual_handoff:'需App处理',stopped:'已停止'};
function preparationRevision(source,platform){const v=source.versions[platform]||source;return JSON.stringify({kind:source.kind,title:v.title,body:v.body,tags:v.tags,assets:source.assets.map(a=>({id:a.id,type:a.type,size:a.size})),options:platform==='douyin'?source.douyinOptions:platform==='bilibili'?source.biliOptions:undefined});}
function lockPreparationUI(){
 for(const control of document.querySelectorAll('#editor-view input,#editor-view textarea,#editor-view select,#editor-view button,#connections-view button,#new-draft,#draft-list button')){
  if(control.id==='stop-preparation')continue;
  if(!preparationDisabled.has(control))preparationDisabled.set(control,control.disabled);
  control.disabled=true;
 }
}
function renderPreparation(){
 $('prepare-selected').disabled=preparationBusy||saving||xhsBusy||douyinBusy||biliBusy||douyinCoverSaving||biliCoverSaving||!draft.channels.length;
 $('stop-preparation').hidden=!preparationBusy;$('stop-preparation').disabled=preparationStop;
 $('preparation-results').replaceChildren();
 let completed=0,appPackages=0;
 for(const platform of draft.channels){
  const row=document.createElement('li'),title=document.createElement('strong'),state=document.createElement('span'),message=document.createElement('p');
  const record=draft.preparationResults?.[platform],v=draft.versions[platform]||draft;
  const check=preparationCheck({...draft,...v,platform,assets:draft.assets});
  const current=record&&record.revision===preparationRevision(draft,platform);
  const livePhase=platform==='xhs'?xhsPhase:platform==='douyin'?douyinPhase:biliPhase;
  const live=liveResults[platform];
  const liveVerified=live?.phase==='prepared'&&(platform==='xhs'?live.titlePreviewVerified===true&&live.bodyPreviewVerified===true&&live.preparationFingerprint===record?.fingerprint:live.preparationVerified===true&&live.titleVerified===true&&live.bodyVerified===true&&live.draftId===draft.id);
  const editorGone=!check.manual&&current&&record.preparationVerified&&!liveVerified;
  const code=!check.valid?(check.manual?'manual_handoff':'invalid'):editorGone?'needs_review':current?record.state:'queued';
  if(code==='prepared')completed++;
  if(code==='manual_handoff'&&current&&record.packagePrepared)appPackages++;
  row.className='preparation-row '+code;title.textContent=names[platform];state.textContent=preparationLabels[code]||'待准备';
  message.textContent=editorGone?'上次准备记录保存在本地，当前编辑页尚未通过实时核对；请刷新连接状态并核对，勿重传。':check.manual&&current&&record.packagePrepared?record.message:!check.valid?check.issues.join('；'):current?record.message:record?'本稿已修改；重新准备时将保留已有编辑稿。':'将使用本平台版本，已有稿件在原页保留。';
  row.append(title,state,message);$('preparation-results').append(row);
 }
 $('preparation-summary').textContent=preparationBusy?(preparationStop?'将完成当前平台，然后停止后续准备':'正在按平台分别准备，尚未发布'):draft.channels.length?`${completed} / ${draft.channels.length} 个平台编辑页已核对${appPackages?'；'+appPackages+'个App接续包已生成':''}；尚未发布。`:'先选择要准备的平台。';
 if(preparationBusy)lockPreparationUI();
}
async function clearPreparationRecord(platform){
 if(!draft.preparationResults?.[platform])return;
 draft.preparationResults[platform]={...draft.preparationResults[platform],state:'new_editor',preparationVerified:false,message:'已手动新开编辑页，可继续准备'};markDirty();await persist();renderPreparation();
}
async function digestBlob(blob){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');}
async function encodeBlob(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({data:reader.result.split(',')[1]});reader.onerror=()=>reject(new Error('素材读取失败'));reader.readAsDataURL(blob);});}
async function preparationNotes(platforms){
 const source=structuredClone(draft),cache=new Map(),notes=[];
 for(const platform of platforms){
  const v=source.versions[platform]||source;
  const note={platform,draftId:source.id,kind:source.kind,title:v.title,body:v.body,tags:v.tags,assets:source.assets,record:source.preparationResults?.[platform],revision:preparationRevision(source,platform),agreementConfirmed:platform==='bilibili'?$('bili-agreement').checked:platform==='douyin'?$('douyin-agreement').checked:false};
  if(preparationCheck(note).valid||preparationCheck(note).manual){
   note.blobs=[];const hashes=[];
   for(const descriptor of source.assets){
    if(!cache.has(descriptor.id)){const asset=await getAsset(descriptor.id);if(!asset?.blob)throw new Error('本地素材读取不到，请重新添加');cache.set(descriptor.id,{blob:asset.blob,hash:await digestBlob(asset.blob)});}
    const asset=cache.get(descriptor.id);note.blobs.push(asset.blob);hashes.push(asset.hash);
   }
   note.fingerprint=await preparationFingerprint(note,hashes);
   if(platform==='douyin'&&source.douyinOptions){note.options={coverMode:'keep',topics:[],...source.douyinOptions,...(source.kind==='image'?{coverMode:'keep',cover:undefined}:{})};note.settingsIssues=checkDouyinOptions(note.options).issues;}
   if(platform==='bilibili'&&source.kind==='video'&&source.biliOptions){note.options={coverMode:'frame',frameIndex:0,categoryPath:[],tags:[],...source.biliOptions};note.settingsIssues=checkBiliOptions(note.options).issues;}
   if(note.options?.coverMode==='upload'&&!note.settingsIssues.length){const cover=await getAsset(note.options.cover.id);if(!cover?.blob)note.settingsIssues.push('本地封面读取不到');else note.coverBlob=cover.blob;}
   note.settingsFingerprint=await preparationFingerprint({kind:'settings',title:JSON.stringify(note.options||null),body:'',tags:''},note.coverBlob?[await digestBlob(note.coverBlob)]:[]);
  }
  notes.push(note);
 }
 return notes;
}
const biliImagePackageCache=new Map();
let biliImagePackageBusy=false;
async function prepareBiliHandoff(note){
 const key=note.draftId+':'+note.fingerprint;
 let pack=biliImagePackageCache.get(key);
 if(!pack){
  pack=await buildBiliImagePackage(note,note.assets.map((a,i)=>({name:a.name,blob:note.blobs[i]})));
  biliImagePackageCache.clear();biliImagePackageCache.set(key,pack);
 }
 return {packagePrepared:true,packageFileName:pack.fileName};
}
const preparationAdapter={
 prepareHandoff:prepareBiliHandoff,
 status:async platform=>{const result=await xhsRequest(`/api/${platform}/status`);liveResults[platform]=result;return result;},
 connect:(platform,options)=>xhsRequest(`/api/${platform}/connect`,options),
 prepare:async(platform,note)=>{
  const media=[];for(const blob of note.blobs)media.push(await encodeBlob(blob));
  const result=await xhsRequest(`/api/${platform}/prepare`,{draftId:note.draftId,kind:note.kind,title:note.title,body:note.body,tags:note.tags,agreementConfirmed:note.agreementConfirmed,...(note.kind==='video'?{video:media[0]}:{images:media})});liveResults[platform]=result;return result;
 },
 applySettings:async(platform,note)=>{
  const cover=note.coverBlob?{type:note.coverBlob.type,...await encodeBlob(note.coverBlob)}:undefined;
  return xhsRequest(`/api/${platform}/options`,{draftId:note.draftId,...note.options,cover});
 }
};
async function startPreparation(platforms){
 if(preparationBusy||saving||aiBusy||xhsBusy||biliBusy||douyinBusy||biliCoverSaving||douyinCoverSaving)return;
 if(!platforms.length){notify('先选择要准备的平台');return;}
 preparationBusy=true;preparationStop=false;clearTimeout(loginPollTimer);for(const timer of providerTimers.values())clearTimeout(timer);renderXhsButton();
 try{
  if(dirty&&(!await persist()||dirty))throw new Error('先保存最新修改，再准备稿件');
  const notes=await preparationNotes(platforms),draftId=draft.id;
  await runPreparationQueue(notes,preparationAdapter,{shouldStop:()=>preparationStop,update:async result=>{
   if(draft.id!==draftId)throw new Error('当前草稿已切换，准备停止');
   draft.preparationResults={...draft.preparationResults,[result.platform]:result};markDirty();
   if(!await persist())throw new Error('准备记录保存失败，已停止后续操作');
   renderPreparation();
  }});
 }catch(error){notify('准备未完成：'+error.message);}
 finally{
  preparationBusy=false;for(const [control,disabled] of preparationDisabled)control.disabled=disabled;preparationDisabled.clear();
  await refreshXhs();await refreshProvider('douyin');await refreshProvider('bilibili');renderEditor();
 }
}
$('prepare-selected').addEventListener('click',()=>startPreparation([...draft.channels]));
$('stop-preparation').addEventListener('click',()=>{preparationStop=true;renderPreparation();});
const providerTimers=new Map();
let biliPhase='not_connected',biliBusy=false;
let douyinEditorKind='video',douyinPhase='not_connected',douyinBusy=false,douyinAgreementRequired=false,douyinNewEditorSupported=false;
let douyinPreparedDraftId,douyinCoverPreviewId,douyinCoverPreviewUrl,douyinCoverGeneration=0,douyinCoverSaving=false,douyinSettingsDraftId;
const douyinOptions=()=>({coverMode:'keep',topics:[],...(draft.douyinOptions||{}),...(draft.kind==='image'?{coverMode:'keep',cover:undefined}:{})});
async function renderDouyinCover(cover){
 if(cover?.id===douyinCoverPreviewId)return;douyinCoverPreviewId=cover?.id;const generation=++douyinCoverGeneration;
 if(douyinCoverPreviewUrl)URL.revokeObjectURL(douyinCoverPreviewUrl);douyinCoverPreviewUrl=undefined;$('douyin-cover-preview').hidden=true;$('douyin-cover-preview').removeAttribute('src');
 if(!cover?.id)return;try{const asset=await getAsset(cover.id);if(generation===douyinCoverGeneration&&asset?.blob){douyinCoverPreviewUrl=URL.createObjectURL(asset.blob);$('douyin-cover-preview').src=douyinCoverPreviewUrl;$('douyin-cover-preview').hidden=false;}}catch{notify('抖音封面读取未完成，请重新选择。');}
}
function renderDouyinSettings(applicable){
 if(douyinSettingsDraftId!==draft.id){douyinSettingsDraftId=draft.id;$('douyin-options-status').textContent='';}
 $('douyin-settings').hidden=!applicable;const image=draft.kind==='image';$('douyin-video-cover-controls').hidden=image;$('douyin-image-cover-hint').hidden=!image;$('douyin-settings-heading').textContent=image?'抖音图文话题':'抖音封面和话题';$('douyin-apply-options').textContent=image?'应用图文话题':'应用封面和话题';const options=douyinOptions(),check=checkDouyinOptions(options),busy=douyinBusy||douyinCoverSaving,ready=douyinPhase==='prepared'&&douyinPreparedDraftId===draft.id&&douyinEditorKind===draft.kind;
 $('douyin-cover-mode').value=options.coverMode;$('douyin-topics').value=options.topics.join('，');
 $('douyin-cover-name').textContent=options.coverMode==='upload'?(options.cover?.name||'选择2 MB以内的PNG或JPEG'):'应用话题时保留平台当前封面。';renderDouyinCover(options.coverMode==='upload'?options.cover:undefined);
 for(const id of ['douyin-cover-mode','douyin-pick-cover','douyin-topics'])$(id).disabled=busy;
 $('douyin-apply-options').disabled=busy||!ready||!check.valid;
 $('douyin-options-hint').textContent=image?(!ready?'先将本稿图文填入抖音，再应用原生话题；图片不会重传。':!check.valid?check.issues.join('；')+'。':'保留图片、标题和原文，通过原生控件添加话题；尚未发布。'):!ready?'先将本稿视频填入抖音，再应用封面和话题；这些设置不会重传视频。':!check.valid?check.issues.join('；')+'。':'原文保留，话题通过抖音原生控件添加；本地封面会分别填入横版4:3和竖版3:4，不会发布。';
}
let biliPreparedDraftId,biliCategories=[],biliCoverPreviewId,biliCoverPreviewUrl,biliCoverGeneration=0,biliCoverSaving=false,biliSettingsDraftId;
let biliFrames=[],biliFramesDraftId;
function setBiliFrames(frames,draftId){
  biliFrames.forEach(frame=>URL.revokeObjectURL(frame.url));biliFramesDraftId=draftId;
  biliFrames=frames.map(frame=>({index:frame.index,url:URL.createObjectURL(new Blob([Uint8Array.from(atob(frame.preview),c=>c.charCodeAt(0))],{type:'image/png'}))}));
}
const biliOptions=()=>({coverMode:'frame',frameIndex:0,categoryPath:[],tags:[],...(draft.biliOptions||{})});
function setBiliOptions(update){const before=biliOptions(),next={...before,...update};if(JSON.stringify(before)!==JSON.stringify(next)){draft.biliOptions=next;markDirty();$('bili-options-status').textContent='本地设置已修改，尚未应用到B站。';}renderBiliButton();}
async function renderBiliCover(cover){
  const id=cover?.id;
  if(id===biliCoverPreviewId)return;
  biliCoverPreviewId=id;const generation=++biliCoverGeneration;
  if(biliCoverPreviewUrl)URL.revokeObjectURL(biliCoverPreviewUrl);
  biliCoverPreviewUrl=undefined;$('bili-cover-preview').hidden=true;$('bili-cover-preview').removeAttribute('src');
  if(!id)return;
  try{const asset=await getAsset(id);if(generation!==biliCoverGeneration)return;if(asset?.blob){biliCoverPreviewUrl=URL.createObjectURL(asset.blob);$('bili-cover-preview').src=biliCoverPreviewUrl;$('bili-cover-preview').hidden=false;}}
  catch{notify('本地封面读取未完成，请重新选择。');}
}
function renderBiliSettings(applicable){
  $('bili-settings').hidden=!applicable;
  if(biliSettingsDraftId!==draft.id){biliSettingsDraftId=draft.id;$('bili-options-status').textContent='';}
  const options=biliOptions(),ready=biliPhase==='prepared'&&biliPreparedDraftId===draft.id,check=checkBiliOptions(options),busy=biliBusy||biliCoverSaving;
  $('bili-cover-mode').value=options.coverMode==='upload'?'upload':'frame:'+options.frameIndex;
  $('bili-cover-name').textContent=options.coverMode==='upload'?(options.cover?.name||'PNG或JPEG，最多2 MB'):'读取B站分区后，可查看当前视频的推荐帧。';renderBiliCover(options.coverMode==='upload'?options.cover:undefined);
  const frames=$('bili-frame-previews');frames.replaceChildren();frames.hidden=biliFramesDraftId!==draft.id||!ready||!biliFrames.length;
  if(!frames.hidden)for(const frame of biliFrames){const button=document.createElement('button');button.className='secondary';button.disabled=busy;button.setAttribute('aria-pressed',String(options.coverMode==='frame'&&options.frameIndex===frame.index));const image=document.createElement('img');image.src=frame.url;image.alt=`B站推荐帧${frame.index+1}`;const caption=document.createElement('span');caption.textContent=`推荐帧${frame.index+1}`;button.append(image,caption);button.addEventListener('click',()=>setBiliOptions({coverMode:'frame',frameIndex:frame.index}));frames.append(button);}
  const select=$('bili-category');select.replaceChildren(new Option('选择B站分区',''));
  const saved=options.categoryPath?.length?JSON.stringify(options.categoryPath):'';
  for(const entry of biliCategories)select.add(new Option(entry.label,JSON.stringify(entry.path)));
  if(saved&&![...select.options].some(o=>o.value===saved))select.add(new Option(options.categoryPath.join(' / ')+'（本稿已保存）',saved));
  select.value=saved;$('bili-tags').value=options.tags.join('，');
  for(const id of ['bili-cover-mode','bili-pick-cover','bili-category','bili-tags'])$(id).disabled=busy;
  $('bili-load-categories').disabled=busy||!ready;
  $('bili-apply-options').disabled=busy||!ready||!check.valid;
  $('bili-options-hint').textContent=!ready?'先将本稿视频填入B站，再应用这些设置；修改设置不会重传视频。':!check.valid?check.issues.join('；')+'。':'只更新当前稿的封面、分区和标签，视频与文案保留；不会点击投稿。';
}
function renderBiliButton(){
 const image=draft.kind==='image'&&draft.channels.includes('bilibili');
 $('bili-image-handoff').hidden=!image;
 const imageCheck=checkXhsImage({...draft,...(draft.versions.bilibili||{}),images:draft.assets});
 const record=draft.preparationResults?.bilibili;
 const currentPackage=record?.packagePrepared&&record.revision===preparationRevision(draft,'bilibili');
 $('bili-image-package').disabled=biliImagePackageBusy||preparationBusy||saving||!imageCheck.valid;
 $('bili-image-package-hint').textContent=!imageCheck.valid?imageCheck.issues.join('；'):currentPackage?'本稿准备包已生成，可下载到手机接续；尚未填入App或发布。':'导出本稿B站版本及按顺序编号的图片，不会上传B站。';

  const applicable=draft.kind==='video'&&draft.channels.includes('bilibili');
  renderBiliSettings(applicable);
  $('bili-prepare').hidden=!applicable;
  $('bili-job-status').hidden=!applicable;
  const check=checkXhsVideo({...draft,...(draft.versions.bilibili||{})});
  $('bili-prepare').disabled=biliBusy||biliPhase!=='login_observed'||!check.valid||!$('bili-agreement').checked;
  $('bili-agreement-row').hidden=!applicable;
  $('new-bili-page').disabled=biliBusy||!['login_observed','prepared'].includes(biliPhase);
  document.querySelector('[data-connect-provider="bilibili"]').disabled=biliBusy;
  document.querySelector('[data-refresh-provider="bilibili"]').disabled=biliBusy;
  $('bili-prepare-hint').hidden=!applicable;
  $('bili-prepare-hint').textContent=biliPhase==='prepared'?'上一稿已进入B站编辑页。到平台连接打开新的B站编辑页，再准备下一篇；旧页保留，尚未投稿。':!check.valid?check.issues.join('；')+'。':biliPhase!=='login_observed'?'先在平台连接登录B站并打开投稿页。':'将视频、标题和简介填入本人B站编辑页，分区、标签和声明请在该页核对；不会点击投稿。';
  if(preparationBusy)lockPreparationUI();
}
function renderDouyinButton(){
  const applicable=['image','video'].includes(draft.kind)&&draft.channels.includes('douyin');
  const check=preparationCheck({...draft,...(draft.versions.douyin||{}),platform:'douyin'});
  $('douyin-prepare').textContent=draft.kind==='image'?'将图文填入抖音':'将视频填入抖音';
  renderDouyinSettings(applicable);
  for(const id of ['douyin-prepare','douyin-prepare-hint','douyin-job-status'])$(id).hidden=!applicable;
  $('douyin-agreement-row').hidden=!applicable||!douyinAgreementRequired;
  $('douyin-prepare').disabled=douyinBusy||douyinPhase!=='login_observed'||douyinEditorKind!==draft.kind||!check.valid||(douyinAgreementRequired&&!$('douyin-agreement').checked);
  document.querySelector('[data-connect-provider="douyin"]').disabled=douyinBusy;
  document.querySelector('[data-refresh-provider="douyin"]').disabled=douyinBusy;
  $('new-douyin-page').disabled=douyinBusy||douyinCoverSaving||!douyinNewEditorSupported||!['login_observed','prepared'].includes(douyinPhase);
  $('douyin-new-page-hint').textContent=['login_observed','prepared'].includes(douyinPhase)&&!douyinNewEditorSupported?'当前连接尚未启用新页功能，上一稿继续保留。':'准备下一篇时新开编辑页，上一稿保留在原标签页；未提交的编辑页限当前浏览器会话。';
  $('douyin-prepare-hint').textContent=douyinPhase==='prepared'?'上一稿已填入抖音编辑页，重复上传已锁定；准备下一篇请在平台连接打开新的抖音编辑页。':douyinPhase==='preparation_incomplete'?'上一项上传或填写未完成，请先核对编辑页，勿重传。':!check.valid?check.issues.join('；')+'。':douyinPhase!=='login_observed'?'先在平台连接核对抖音登录与上传页。':douyinEditorKind!==draft.kind?'到平台连接打开对应内容类型的抖音编辑页，或使用多平台准备自动新开。':draft.kind==='image'?'按本地顺序上传1至9张PNG、JPEG或WebP，合计10 MB以内；标题暂限20字，正文与标签合计1000字符。不会发布。':'将视频、标题、正文及标签文字填入抖音编辑页；暂限1个100 MB以内的MP4、20字标题、正文与标签合计1000字符。不会点击发布。';
  if(preparationBusy)lockPreparationUI();
}
async function refreshProvider(platform) {
  try{const result=await xhsRequest(`/api/${platform}/status`);liveResults[platform]=result;$(platform+'-connect-status').textContent=result.message;if(platform==='bilibili'){biliPhase=result.phase;if(biliPreparedDraftId!==result.draftId)setBiliFrames([],undefined);biliPreparedDraftId=result.draftId;renderBiliButton();}else if(platform==='douyin'){douyinPhase=result.phase;douyinEditorKind=result.kind||'video';douyinPreparedDraftId=result.draftId;douyinNewEditorSupported=result.newEditorSupported===true;douyinAgreementRequired=result.agreementRequired===true;renderDouyinButton();}return result.phase;}
  catch{$(platform+'-connect-status').textContent='状态读取未完成，请刷新复查';if(platform==='douyin'){douyinPhase='result_unknown';renderDouyinButton();}return 'error';}
}
async function pollProvider(platform,count=0){
  const phase=await refreshProvider(platform);
  if(['awaiting_login','page_pending','scan_confirm'].includes(phase)&&count<60)providerTimers.set(platform,setTimeout(()=>pollProvider(platform,count+1),2000));
}
document.querySelectorAll('[data-connect-provider]').forEach(button=>button.addEventListener('click',async()=>{
  const platform=button.dataset.connectProvider;clearTimeout(providerTimers.get(platform));button.disabled=true;
  if(platform==='bilibili'){biliBusy=true;renderBiliButton();}
  if(platform==='douyin'){douyinBusy=true;renderDouyinButton();}
  $(platform+'-connect-status').textContent='正在打开专用Chrome…';
  try{const result=await xhsRequest(`/api/${platform}/connect`,platform==='douyin'?{kind:draft.kind==='image'?'image':'video'}:{});$(platform+'-connect-status').textContent=result.message;pollProvider(platform);}
  catch{$(platform+'-connect-status').textContent='入口未完成，请查看专用浏览器';}
  finally{button.disabled=false;if(platform==='bilibili'){biliBusy=false;renderBiliButton();}if(platform==='douyin'){douyinBusy=false;renderDouyinButton();}}
}));
$('new-bili-page').addEventListener('click',async()=>{
  if(biliBusy)return;
  biliBusy=true;renderBiliButton();clearTimeout(providerTimers.get('bilibili'));
  $('bilibili-connect-status').textContent='正在打开新编辑页，上一稿将保留…';
  try{
    const result=await xhsRequest('/api/bilibili/connect',{fresh:true});
    biliPhase=result.phase;$('bilibili-connect-status').textContent=result.message;
    $('bili-job-status').textContent='已打开新的B站编辑页，上一稿在原标签页保留；可选择下一篇草稿。';
    await clearPreparationRecord('bilibili');pollProvider('bilibili');
  }catch(e){$('bili-job-status').textContent='新页未就绪：'+e.message+'。请先检查原编辑页，勿重复操作。';notify('新页未就绪，请检查原编辑页。');}
  finally{biliBusy=false;await refreshProvider('bilibili');renderBiliButton();}
});
$('new-douyin-page').addEventListener('click',async()=>{
  if(douyinBusy||douyinCoverSaving||!douyinNewEditorSupported)return;
  douyinBusy=true;renderDouyinButton();clearTimeout(providerTimers.get('douyin'));
  $('douyin-connect-status').textContent='正在打开新编辑页，上一稿将保留…';
  try{
    const result=await xhsRequest('/api/douyin/connect',{fresh:true,kind:draft.kind==='image'?'image':'video'});
    douyinPhase=result.phase;douyinEditorKind=result.kind||'video';douyinPreparedDraftId=undefined;
    $('douyin-connect-status').textContent=result.message;
    $('douyin-job-status').textContent='已打开新的抖音编辑页，上一稿在原标签页保留；请新建或选择下一篇草稿。';
    await clearPreparationRecord('douyin');pollProvider('douyin');
  }catch(e){$('douyin-job-status').textContent='新页未就绪：'+e.message+'。请先检查原编辑页，勿重复操作。';notify('新页未就绪，请检查原编辑页。');}
  finally{douyinBusy=false;await refreshProvider('douyin');renderDouyinButton();}
});
document.querySelectorAll('[data-refresh-provider]').forEach(button=>button.addEventListener('click',()=>refreshProvider(button.dataset.refreshProvider)));
Promise.all(['douyin','bilibili'].map(refreshProvider));
function renderXhsButton() {
  renderBiliButton();
  renderDouyinButton();
  const video=draft.kind==='video';
  const applicable=['image','video'].includes(draft.kind) && draft.channels.includes('xhs');
  $('prepare-xhs').hidden=!applicable;
  $('prepare-xhs-hint').hidden=!applicable;
  $('xhs-job-status').hidden=!applicable;
  const check=(video?checkXhsVideo:checkXhsImage)({...draft,...(draft.versions.xhs||{}),images:draft.assets});
  $('xhs-check-heading').textContent=video?'小红书视频检查':'小红书图文检查';
  $('xhs-check-note').textContent=video?'暂收1个100 MB以内的MP4，封面使用平台默认帧。':'按当前连接器限制检查。首图与图片顺序以左侧素材为准。';
  $('prepare-xhs').textContent=video?'将视频填入小红书':'将图文填入小红书';
  $('xhs-check').hidden=!applicable;
  $('xhs-check-list').replaceChildren();
  if (applicable) for(const item of check.checks) {
    const row=document.createElement('li'); row.className=item.ok?'check-good':'check-bad';
    const label=document.createElement('span'); label.textContent=item.label;
    const value=document.createElement('span'); value.textContent=item.value+' · '+(item.ok?'通过':'需调整');
    row.append(label,value); $('xhs-check-list').append(row);
  }
  $('xhs-check-summary').textContent=check.valid?'内容检查通过':'还有'+check.issues.length+'项需调整';
  $('prepare-xhs').disabled = xhsBusy || xhsPhase !== 'connected' || xhsEditorKind!==draft.kind || !applicable || !check.valid;
  $('new-xhs-page').disabled=xhsBusy || !['connected','prepared'].includes(xhsPhase);
  $('connect-xhs').disabled=xhsBusy;
  $('prepare-xhs-hint').textContent = xhsPhase==='prepared' ? '编辑页已有上一稿。到平台连接打开新的编辑页，再准备下一稿。' : applicable && !check.valid ? check.issues.join('；')+'。调整后即可继续。' : xhsPhase!=='connected' ? '先到平台连接登录小红书，再将稿件填入编辑页。' : xhsEditorKind!==draft.kind ? '到平台连接打开对应内容类型的编辑页。' : '将素材、标题、正文与标签传入本人小红书编辑页；最终发布由你确认。';
  renderPreparation();
}
function clearLoginImage() { if(loginImageUrl) URL.revokeObjectURL(loginImageUrl); loginImageUrl=undefined; $('xhs-login-preview').hidden=true; $('xhs-login-image').removeAttribute('src'); }
async function showLoginPreview() {
  try {
    const response = await fetch('/api/xhs/login-preview',{headers:{'X-Eli-Request':'local-workbench'}}); const data=await response.json();
    if (!response.ok || !data.available) return;
    clearLoginImage(); const binary=atob(data.image); const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)); loginImageUrl=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
    $('xhs-login-image').src=loginImageUrl; $('xhs-login-preview').hidden=false; $('xhs-login-hint').textContent=data.qrVisible?'请用本人小红书 App 扫描官方登录二维码，并在手机确认。二维码不落盘。':'请在专用 Chrome 窗口切换为扫码登录，然后刷新连接状态。';
  } catch { /* QR preview is optional; original official browser remains available. */ }
}
async function xhsRequest(path, payload) {
  const options = payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type':'application/json', 'X-Eli-Request':'local-workbench' }, body: JSON.stringify(payload) };
  const response = await fetch(path, options); const result = await response.json();
  if (!response.ok) throw new Error(result.error || '连接器请求失败');
  return result;
}
async function refreshXhs() {
  try { const result = await xhsRequest('/api/xhs/status');liveResults.xhs=result; xhsPhase = result.phase; xhsEditorKind=result.kind||'image'; $('xhs-connect-status').textContent = xhsMessage(result); renderXhsButton(); if(xhsPhase!=='awaiting_login')clearLoginImage(); }
  catch { $('xhs-connect-status').textContent = '无法读取连接状态，请确认本地服务仍在运行'; xhsPhase = 'error'; renderXhsButton(); }
}
async function pollLogin() {
  await refreshXhs();
  if (xhsPhase === 'awaiting_login' && ++loginPolls < 60) loginPollTimer = setTimeout(pollLogin, 2000);
}
function notify(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function markDirty() { dirty = true; $('save-state').textContent = '有未保存修改'; }
function values() { return activeChannel && draft.versions[activeChannel] || { title: draft.title, body: draft.body, tags: draft.tags }; }
function canExport() { return draft.channels.some(c => { const v = draft.versions[c] || draft; return !!(v.title.trim() || v.body.trim()); }); }
function renderDrafts() {
  $('draft-list').replaceChildren(); $('draft-count').textContent = drafts.length;
  if (!drafts.length && !draftQuery) { const p = document.createElement('p'); p.className = 'draft-empty'; p.textContent = '第一份内容，从这里开始。'; $('draft-list').append(p); }
  const matches=drafts.filter(item=>!draftQuery || [item.title,item.body,item.tags,...Object.values(item.versions||{}).flatMap(v=>[v.title,v.body,v.tags])].join(' ').toLocaleLowerCase().includes(draftQuery));
  $('draft-search-status').hidden=!draftQuery; $('draft-search-status').textContent=`找到 ${matches.length} 份草稿`;
  if (draftQuery && !matches.length) { const p=document.createElement('p');p.className='draft-empty';p.textContent='没有匹配的草稿，换个关键词。';$('draft-list').append(p); }
  for (const item of matches) {
    const b = document.createElement('button'); b.className = 'draft-item' + (item.id === draft.id ? ' selected' : '');
    const strong = document.createElement('strong'); strong.textContent = (item.title || '未命名内容')+(item.restoredFrom?'（恢复副本）':'');
    const span = document.createElement('span'); span.textContent = ({ video: '短视频', image: '图文', text: '纯文字' })[item.kind] + ' · ' + (item.channels.map(c => names[c]).join('、') || '未选平台');
    b.append(strong, span); b.addEventListener('click', () => switchDraft(item)); $('draft-list').append(b);
  }
}
function renderVersion() {
  renderXhsButton();
  $('preview-tabs').replaceChildren();
  if (!draft.channels.includes(activeChannel)) activeChannel = draft.channels[0] || '';
  for (const c of draft.channels) {
    const b = document.createElement('button'); b.textContent = names[c]; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(c === activeChannel)); b.id = 'tab-' + c; b.setAttribute('aria-controls', 'version-editor');
    b.addEventListener('click', () => { activeChannel = c; renderVersion(); }); $('preview-tabs').append(b);
  }
  $('preview-empty').hidden = !!activeChannel; $('version-editor').hidden = !activeChannel;
  $('export-copy').disabled = !canExport();
  if (!activeChannel) {renderAi();return;}
  $('version-editor').setAttribute('role', 'tabpanel'); $('version-editor').setAttribute('aria-labelledby', 'tab-' + activeChannel);
  const v = values(), linked = !draft.versions[activeChannel]; $('use-master').checked = linked;
  for (const key of ['title', 'body', 'tags']) { $('version-' + key).value = v[key]; $('version-' + key).readOnly = linked; }
  $('copy-title').textContent = v.title || '尚未填写标题'; $('copy-body').textContent = v.body || '尚未填写正文'; $('copy-tags').textContent = v.tags;
  $('copy-version').disabled = !(v.title.trim() || v.body.trim());
  renderAi();
}
function renderAi(){
 const suggestion=draft.aiSuggestions?.[activeChannel],valid=canAdoptAi(draft,activeChannel,suggestion);
 const exhausted=Number.isInteger(tokenpayStatus.maxCalls)&&tokenpayStatus.maxCalls>0&&tokenpayStatus.callsAttempted>=tokenpayStatus.maxCalls;
 $('ai-generate').disabled=aiBusy||preparationBusy||saving||!activeChannel||!tokenpayStatus.connected||!tokenpayStatus.modelCallsAllowed||exhausted;
 $('ai-candidate').textContent=suggestion?[suggestion.title,suggestion.body,suggestion.tags].join('\n\n'):'';
 $('ai-review').hidden=!suggestion;
 $('ai-adopt').disabled=aiBusy||preparationBusy||saving||!valid||!$('ai-facts-confirmed').checked;
 $('ai-undo').disabled=aiBusy||preparationBusy||saving||!draft.aiPreviousVersions?.[activeChannel];
 $('ai-status').textContent=suggestion?valid?'候选尚未采用，请核对事实、数字和语气。':'生成后本稿已修改；旧候选不能覆盖当前稿。':exhausted?'本轮已确认的调用次数已用完，需再次确认才能继续。':tokenpayStatus.modelCallsAllowed&&tokenpayStatus.connected?'只生成候选，本人核对后再采用；不会自动上传。':'AI调用未启用，本地编辑正常可用。';
}
async function refreshTokenpay(){
 try{tokenpayStatus=await xhsRequest('/api/tokenpay/status');$('tokenpay-status').textContent=tokenpayStatus.connected?'本机Key已保存；实际AI效果和收益尚待验证。':'尚未连接，本地编辑不调用模型。';}
 catch{tokenpayStatus={keyCreationAllowed:false,modelCallsAllowed:false,connected:false};$('tokenpay-status').textContent='接入状态无法读取；授权和调用保持关闭。';}
 $('tokenpay-authorize').disabled=!tokenpayStatus.keyCreationAllowed||tokenpayStatus.connected||aiBusy;renderAi();renderTokenpayPayment();
}
function renderTokenpayPayment(){
 const payment=tokenpayStatus.payment||{},r=tokenpayStatus.receipt;
 if(!pendingAi&&tokenpayStatus.pendingRetry&&draft.aiPendingRequest)pendingAi=structuredClone(draft.aiPendingRequest);
 $('tokenpay-receipt').textContent=r?`模型 ${r.model}；输入 ${r.inputTokens??'待核'} / 输出 ${r.outputTokens??'待核'} tokens；${r.usageRecordMatched?'用量记录已匹配':'用量记录待匹配'}；后台应用归因及收益仍待核实。`:'尚无真实调用回执，归因和收益未核实。';
 $('tokenpay-usage').disabled=paymentBusy||!r;
 $('tokenpay-recharge').hidden=!tokenpayStatus.pendingRetry&&!payment.sessionCreated&&payment.phase!=='creation_unknown';
 $('tokenpay-amount').max=payment.maxRechargeYuan||1;
 $('tokenpay-create-payment').disabled=paymentBusy||!tokenpayStatus.pendingRetry||!payment.rechargeAllowed||payment.phase!=='not_started'||!$('tokenpay-payment-confirm').checked;
 $('tokenpay-check-payment').disabled=paymentBusy||!payment.sessionCreated||!payment.rechargeAllowed||['paid','failed','closed','refunded','expired'].includes(payment.phase);
 $('tokenpay-resume').disabled=paymentBusy||aiBusy||preparationBusy||!pendingAi||!tokenpayStatus.pendingRetry||!payment.paid||!$('tokenpay-retry-confirm').checked||!tokenpayStatus.modelCallsAllowed;
 $('tokenpay-payment-status').textContent=payment.phase==='creation_unknown'?'创建结果不明，请到官网核对，勿重复创建。':payment.paid?'官网已确认到账；原请求仍暂停，需本人确认重试。':payment.sessionCreated?`充值 ¥${payment.amount} · ${payment.phase}；仅官网paid状态算到账。`:'尚未创建支付会话。';
}
for(const id of ['tokenpay-payment-confirm','tokenpay-retry-confirm'])$(id).addEventListener('change',renderTokenpayPayment);
$('tokenpay-create-payment').addEventListener('click',async()=>{
 if(paymentBusy||$('tokenpay-create-payment').disabled)return;
 paymentBusy=true;renderTokenpayPayment();
 try{
  const r=await xhsRequest('/api/tokenpay/payment',{amount:Number($('tokenpay-amount').value),confirmed:$('tokenpay-payment-confirm').checked});
  if(typeof r.qrDataUrl==='string'&&r.qrDataUrl.startsWith('data:image/svg+xml;base64,')){$('tokenpay-payment-qr').src=r.qrDataUrl;$('tokenpay-payment-qr').hidden=false;}
  const mobile=matchMedia('(pointer:coarse)').matches;
  if(mobile){$('tokenpay-payment-qr').hidden=true;if(r.alipayUrl){const u=new URL(r.alipayUrl);if(u.protocol==='alipays:'&&u.hostname==='platformapi'&&u.pathname==='/startapp'){$('tokenpay-alipay').href=u.href;$('tokenpay-alipay').hidden=false;}}else notify('请改用电脑扫码支付，或稍后核对。');}
 }catch{notify('充值会话未核实；没有自动付款或重复创建。');}
 finally{paymentBusy=false;await refreshTokenpay();}
});
$('tokenpay-check-payment').addEventListener('click',async()=>{
 if(paymentBusy||$('tokenpay-check-payment').disabled)return;paymentBusy=true;renderTokenpayPayment();
 try{const r=await xhsRequest('/api/tokenpay/payment-check',{});if(!matchMedia('(pointer:coarse)').matches&&typeof r.qrDataUrl==='string'&&r.qrDataUrl.startsWith('data:image/svg+xml;base64,')){$('tokenpay-payment-qr').src=r.qrDataUrl;$('tokenpay-payment-qr').hidden=false;}}catch{notify('到账状态未核实，不会重试模型。');}finally{paymentBusy=false;await refreshTokenpay();}
});
$('tokenpay-usage').addEventListener('click',async()=>{
 if(paymentBusy||$('tokenpay-usage').disabled)return;paymentBusy=true;renderTokenpayPayment();
 try{await xhsRequest('/api/tokenpay/usage-receipt',{});}catch{notify('本次用量记录未核实，不能认定归因或收益。');}finally{paymentBusy=false;await refreshTokenpay();}
});
$('tokenpay-resume').addEventListener('click',async()=>{
 if($('tokenpay-resume').disabled||!pendingAi)return;
 const frozen=pendingAi;aiBusy=true;renderAi();renderTokenpayPayment();
 try{
  const r=await xhsRequest('/api/tokenpay/resume',{confirmed:$('tokenpay-retry-confirm').checked});
  if(r.balanceRequired){notify('仍需核对额度；没有自动重试或创建新充值。');return;}
  if(r.reviewRequired!==true||draft.id!==frozen.draftId||r.candidate?.platform!==frozen.platform)throw new Error('stale_retry');
  draft.aiSuggestions={...draft.aiSuggestions,[frozen.platform]:{...r.candidate,...frozen,model:r.model,appUrl:r.appUrl,receivedAt:Date.now()}};delete draft.aiPendingRequest;markDirty();await persist();pendingAi=null;$('ai-facts-confirmed').checked=false;notify('原请求候选已返回，须本人审阅后采用，尚未上传。');
 }catch{notify('重试结果未核实；原文保留，不会自动再试。');}finally{aiBusy=false;$('tokenpay-retry-confirm').checked=false;await refreshTokenpay();}
});
$('tokenpay-authorize').addEventListener('click',async()=>{
 if(!tokenpayStatus.keyCreationAllowed||tokenpayStatus.connected)return;
 try{const r=await xhsRequest('/api/tokenpay/authorize',{});const url=new URL(r.authorizationUrl);if(url.origin!=='https://tokendance.space'||url.pathname!=='/auth')throw new Error('授权地址不匹配');location.assign(url.href);}catch(e){notify('授权未开始或需核对，请刷新状态，不会自动重试。');}
});
$('tokenpay-refresh').addEventListener('click',refreshTokenpay);
$('ai-generate').addEventListener('click',async()=>{
 if(aiBusy||preparationBusy||saving||!activeChannel||!tokenpayStatus.connected||!tokenpayStatus.modelCallsAllowed)return;
 const platform=activeChannel,v=structuredClone(values()),sourceRevision=aiInputRevision(draft,platform),draftId=draft.id,requestedAt=Date.now();
 aiBusy=true;renderAi();
 try{
  const r=await xhsRequest('/api/tokenpay/suggest',{platform,title:v.title,body:v.body,tags:v.tags});
  if(r.balanceRequired){pendingAi={platform,draftId,sourceRevision,requestedAt};draft.aiPendingRequest=structuredClone(pendingAi);markDirty();await persist();await refreshTokenpay();showView('wallet');notify('余额不足，请本人确认充值金额；原文保留，不会自动付款。');return;}
  if(draft.id!==draftId||r.reviewRequired!==true||r.candidate?.platform!==platform)throw new Error('候选结果待核对');
  draft.aiSuggestions={...draft.aiSuggestions,[platform]:{...r.candidate,sourceRevision,model:r.model,appUrl:r.appUrl,requestedAt,receivedAt:Date.now()}};markDirty();
  $('ai-facts-confirmed').checked=false;await persist();notify('候选已返回，原文保留，尚未采用。');
 }catch{notify('AI结果未核实；没有自动重试或覆盖原文。');}
 finally{aiBusy=false;await refreshTokenpay();}
});
$('ai-facts-confirmed').addEventListener('change',renderAi);
$('ai-adopt').addEventListener('click',async()=>{
 const platform=activeChannel,s=draft.aiSuggestions?.[platform];
 if(aiBusy||preparationBusy||saving||!$('ai-facts-confirmed').checked||!canAdoptAi(draft,platform,s))return;
 const before=structuredClone(draft);
 draft.aiPreviousVersions={...draft.aiPreviousVersions,[platform]:{linked:!draft.versions[platform],version:structuredClone(values())}};
 draft.versions[platform]={title:s.title,body:s.body,tags:s.tags};draft.aiPreviousVersions[platform].appliedRevision=aiInputRevision(draft,platform);
 draft.aiHistory=[...(draft.aiHistory||[]),{...s,adoptedAt:Date.now(),platform}];delete draft.aiSuggestions[platform];markDirty();
 if(!await persist()){draft=before;markDirty();}else notify('候选已采用为本平台版本，采用前文案保留；尚未上传。');
 $('ai-facts-confirmed').checked=false;renderVersion();
});
$('ai-undo').addEventListener('click',async()=>{
 const platform=activeChannel,previous=draft.aiPreviousVersions?.[platform];if(aiBusy||preparationBusy||saving||!previous)return;
 if(previous.appliedRevision!==aiInputRevision(draft,platform)){notify('采用后文案已有新修改，请先另存副本，避免覆盖。');return;}
 const before=structuredClone(draft);if(previous.linked)delete draft.versions[platform];else draft.versions[platform]=previous.version;
 delete draft.aiPreviousVersions[platform];markDirty();if(!await persist()){draft=before;markDirty();}renderVersion();
});
async function renderAssets() {
  const generation = ++assetGeneration;
  objectUrls.forEach(URL.revokeObjectURL); objectUrls = []; $('asset-list').replaceChildren();
  for (const [index,descriptor] of draft.assets.entries()) {
    let asset;
    try { asset = await getAsset(descriptor.id); } catch { notify('素材读取失败，请重试'); return; }
    if (generation !== assetGeneration) return;
    const entry = document.createElement('div'); entry.className = 'asset';
    if (asset?.blob) {
      const url = URL.createObjectURL(asset.blob); objectUrls.push(url);
      const media = document.createElement(asset.type.startsWith('video/') ? 'video' : 'img'); media.src = url;
      if (media.tagName === 'VIDEO') { media.controls = true; media.preload = 'metadata'; } else media.alt = descriptor.name;
      entry.append(media);
    }
    const label = document.createElement('span'); label.textContent = descriptor.name + (!asset ? '（文件读取不到）' : ''); entry.append(label);
    const editControls=document.createElement('div');editControls.className='asset-order';
    for(const action of ['replace','remove']){
      const b=document.createElement('button');b.className='secondary';b.textContent=action==='replace'?'替换':'移除';b.disabled=saving||preparationBusy;
      b.setAttribute('aria-label',`${b.textContent}素材 ${descriptor.name}`);
      b.addEventListener('click',()=>{
        if(saving||preparationBusy)return;
        if(action==='remove')changeAsset(descriptor.id,null);
        else {const input=document.createElement('input');input.type='file';input.accept=descriptor.type.startsWith('video/')?'video/mp4':'image/png,image/jpeg,image/webp';input.addEventListener('change',()=>{if(input.files[0])changeAsset(descriptor.id,input.files[0]);});input.click();}
      });editControls.append(b);
    }
    entry.append(editControls);
    if(draft.kind==='image') {
      const caption=document.createElement('span');caption.className='asset-position';caption.textContent=index===0?'第1张 · 首图':`第${index+1}张`;entry.append(caption);
      const controls=document.createElement('div');controls.className='asset-order';
      for(const [direction,text] of [[-1,'前移'],[1,'后移']]) {
        const button=document.createElement('button');button.textContent=text;button.className='secondary';button.disabled=direction===-1?index===0:index===draft.assets.length-1;
        button.setAttribute('aria-label',`${text}第${index+1}张图片`);button.dataset.assetId=descriptor.id;button.dataset.direction=String(direction);
        button.addEventListener('click',()=>reorderAsset(descriptor.id,direction));controls.append(button);
      }
      entry.append(controls);
    }
    $('asset-list').append(entry);
  }
}
async function changeAsset(id,file){
 if(saving||preparationBusy)return;
 const index=draft.assets.findIndex(a=>a.id===id);if(index<0)return;
 if(file&&!(file.type.startsWith('image/')||(draft.kind==='video'&&file.type==='video/mp4'))){notify('请选择当前内容类型支持的素材');return;}
 const before=draft.assets.slice(),history=draft.assetHistory||[];
 const additions=file?[{id:crypto.randomUUID(),name:file.name,type:file.type,size:file.size,blob:file}]:[];
 const next=before.slice();if(file){const {blob,...descriptor}=additions[0];next[index]=descriptor;}else next.splice(index,1);
 if(next.reduce((s,a)=>s+a.size,0)>100*1024*1024){notify('素材合计超过100 MB');return;}
 draft.assetHistory=[...history,{assets:before,at:Date.now()}];draft.assets=next;markDirty();
 if(!await persist(additions)){draft.assets=before;draft.assetHistory=history;markDirty();}
 renderEditor();
}
$('undo-assets').addEventListener('click',async()=>{
 if(saving||preparationBusy||!draft.assetHistory?.length)return;
 const before=draft.assets,history=draft.assetHistory.slice();draft.assets=history.at(-1).assets;draft.assetHistory=history.slice(0,-1);markDirty();
 if(!await persist()){draft.assets=before;draft.assetHistory=history;markDirty();}renderEditor();
});
async function reorderAsset(id,direction) {
  if(saving){notify('正在保存，请稍后调整顺序');return;}
  const before=draft.assets;draft.assets=moveAsset(before,id,direction);markDirty();
  if(!await persist()){draft.assets=before;markDirty();}
  await renderAssets();renderXhsButton();
  const control=[...$('asset-list').querySelectorAll('button')].find(b=>b.dataset.assetId===id&&!b.disabled);
  control?.focus();
}
function renderEditor() {
  $('undo-assets').disabled=!draft.assetHistory?.length||saving||preparationBusy;
  renderTimeComparison();
  for (const key of ['title', 'body', 'tags']) $('master-' + key).value = draft[key];
  document.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === draft.kind)));
  $('asset-section').hidden = draft.kind === 'text'; $('upload-label').textContent = draft.kind === 'image' ? '添加图片' : '添加视频或封面';
  $('asset-input').accept = draft.kind === 'image' ? 'image/*' : 'image/*,video/*';
  document.querySelectorAll('#channels input').forEach(i => i.checked = draft.channels.includes(i.value));
  renderDrafts(); renderVersion(); renderAssets();
}
function renderTimeComparison(){
 const r=timeComparison(draft.timeObservations);
 $('time-summary').textContent=r.count?`本稿 ${r.count} 次真实对照：手动 ${r.baseline.toFixed(1)} 分钟，工作台含额外成本 ${r.actual.toFixed(1)} 分钟，净省时 ${r.net.toFixed(1)} 分钟${r.percent===null?'':`（${r.percent.toFixed(1)}%）`}。结果仅覆盖这些记录。`:'尚无真实对照，省时效果待验证。';
}
$('record-time').addEventListener('click',async()=>{
 if(saving||preparationBusy)return;
 const fields=['manual','workbench','overhead'],values=fields.map(k=>$('time-'+k).value.trim());
 if(values.some(v=>!v)||values.some(v=>!Number.isFinite(Number(v))||Number(v)<0)){notify('请填写三项实际耗时，允许0；不要填写估计值。');return;}
 const old=draft.timeObservations||[];
 draft.timeObservations=[...old,{manualMinutes:Number(values[0]),workbenchMinutes:Number(values[1]),overheadMinutes:Number(values[2]),note:$('time-note').value,reuse:$('time-reuse').value,channels:[...draft.channels],kind:draft.kind,at:Date.now()}];markDirty();
 if(!await persist()){draft.timeObservations=old;markDirty();return;}
 fields.forEach(k=>$('time-'+k).value='');$('time-note').value='';renderTimeComparison();notify('实际使用对照已保存');
});
async function persist(newAssets = []) {
  if (saving) return false;
  const snapshot = structuredClone(draft);snapshot.updatedAtBeforeSave=draft.updatedAt; snapshot.updatedAt = Date.now(); saving = true;
  $('save-draft').disabled = true; $('new-draft').disabled = true; $('save-state').textContent = '保存中…';
  try {
    const before=JSON.stringify(draft);await saveDraft(snapshot, newAssets);
    const old = drafts.findIndex(d => d.id === snapshot.id); if (old >= 0) drafts[old] = snapshot; else drafts.unshift(snapshot);
    if(draft.id===snapshot.id){draft.revision=snapshot.revision;draft.updatedAt=snapshot.updatedAt;if(JSON.stringify({...draft,updatedAt:JSON.parse(before).updatedAt,revision:JSON.parse(before).revision})===before)dirty=false;}
    $('save-state').textContent = dirty ? '有未保存修改' : '已保存在此浏览器'; renderDrafts(); return true;
  } catch (e) { $('save-state').textContent=e.code==='DRAFT_CONFLICT'?'保存冲突 · 修改仍在':'保存失败';$('save-conflict-copy').hidden=e.code!=='DRAFT_CONFLICT';notify(e.code==='DRAFT_CONFLICT'?e.message:'保存失败：浏览器存储不可用或空间不足。请先导出文案。');return false; }
  finally { saving = false; $('save-draft').disabled = false; $('new-draft').disabled = false; }
}
$('save-conflict-copy').addEventListener('click',async()=>{
 if(saving||preparationBusy)return;
 const original=draft;draft={...structuredClone(draft),id:crypto.randomUUID(),title:draft.title+'（冲突副本）'};delete draft.revision;markDirty();
 if(await persist()){drafts=await getDrafts();$('save-conflict-copy').hidden=true;renderEditor();notify('你的修改已另存副本，原稿未覆盖');}else{draft=original;markDirty();}
});
$('backup-export').addEventListener('click',async()=>{
 if(saving||preparationBusy)return;
 if(dirty&&(!await persist()||dirty))return;
 try{const data=await exportBackup(),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Eli-完整草稿备份-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notify(`已发起 ${data.drafts.length} 份草稿与 ${data.assets.length} 个素材的完整备份下载`);}catch(e){notify('备份失败：'+e.message);}
});
$('backup-import').addEventListener('change',async e=>{
 if(saving||preparationBusy)return;const file=e.target.files[0];if(!file)return;
 if(dirty&&(!await persist()||dirty))return;
 try{if(file.size>700*1024*1024)throw new Error('备份文件超过700 MB');const count=await importBackup(JSON.parse(await file.text()));drafts=await getDrafts();renderDrafts();notify(`已恢复 ${count} 份独立副本，现有草稿未覆盖；平台历史状态须重新核对`);}catch(error){notify('恢复失败：'+error.message);}finally{e.target.value='';}
});
async function switchDraft(item) {
  if (saving||preparationBusy||aiBusy) return;
  if (dirty) { const saved = await persist(); if (!saved || dirty) { if (saved) notify('保存期间还有新修改，请保存后再切换'); return; } }
  draft = structuredClone(drafts.find(d => d.id === item.id)); dirty = false; activeChannel = '';
  $('xhs-job-status').textContent='';
  $('save-state').textContent = '已保存在此浏览器'; showView('editor'); renderEditor();
}
async function addAssets(files) {
  if (preparationBusy)return;
  if (saving) { notify('正在保存，请稍后添加素材'); return; }
  const allowed = Array.from(files).filter(f => f.type.startsWith('image/') || (draft.kind === 'video' && f.type.startsWith('video/')));
  if (allowed.length !== files.length) { notify('请按当前内容类型选择图片或视频文件'); return; }
  if (!allowed.length) return;
  const bytes = draft.assets.reduce((s, a) => s + a.size, 0) + allowed.reduce((s, f) => s + f.size, 0);
  if (bytes > 100 * 1024 * 1024) { notify('这份草稿的素材超过100 MB，请先缩小素材再添加'); return; }
  if (draft.assets.length + allowed.length > 20) { notify('每份草稿最多20个素材'); return; }
  const additions = allowed.map(f => ({ id: crypto.randomUUID(), name: f.name, type: f.type, size: f.size, blob: f }));
  const before = [...draft.assets]; draft.assets.push(...additions.map(({ blob, ...metadata }) => metadata)); markDirty();
  if (!await persist(additions)) { draft.assets = before; markDirty(); } else { renderAssets(); }
  renderXhsButton();
  $('asset-input').value = '';
}
function showView(view) {
  ['editor', 'connections', 'wallet'].forEach(v => $(v + '-view').hidden = view !== v);
  document.querySelectorAll('.nav').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'); });
  $('workspace-name').textContent = ({ editor: '内容工作台', connections: '平台连接', wallet: 'Token 钱包' })[view];
}
function format(v) { return [v.title, v.body, v.tags].filter(s => s.trim()).join('\n\n'); }
for (const key of ['title', 'body', 'tags']) {
  $('master-' + key).addEventListener('input', e => { draft[key] = e.target.value; markDirty(); renderVersion(); });
  $('version-' + key).addEventListener('input', e => { if (!draft.versions[activeChannel]) return; draft.versions[activeChannel][key] = e.target.value; markDirty(); $('copy-' + key).textContent = e.target.value; $('copy-version').disabled = !(values().title.trim() || values().body.trim()); $('export-copy').disabled = !canExport(); renderXhsButton(); });
}
document.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { if (saving||preparationBusy) return; draft.kind = b.dataset.kind; markDirty(); renderEditor(); }));
document.querySelectorAll('#channels input').forEach(i => i.addEventListener('change', () => { draft.channels = [...document.querySelectorAll('#channels input:checked')].map(i => i.value); markDirty(); renderVersion(); }));
$('use-master').addEventListener('change', e => {
 if(e.target.checked){draft.savedVersions={...draft.savedVersions,[activeChannel]:structuredClone(draft.versions[activeChannel])};delete draft.versions[activeChannel];}
 else draft.versions[activeChannel]=structuredClone(draft.savedVersions?.[activeChannel]||{title:draft.title,body:draft.body,tags:draft.tags});
 markDirty();renderVersion();
});
$('save-draft').addEventListener('click', async () => { if (await persist()) notify(dirty ? '之前的修改已保存，最新输入还需保存' : '草稿已保存'); });
$('new-draft').addEventListener('click', async () => { if (saving||preparationBusy||aiBusy) return; if (dirty) { const saved = await persist(); if (!saved || dirty) { if (saved) notify('保存期间还有新修改，请保存后再新建'); return; } } draft = emptyDraft(); activeChannel = ''; markDirty(); showView('editor'); renderEditor(); $('master-title').focus(); });
document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
$('draft-search').addEventListener('input',e=>{draftQuery=e.target.value.trim().toLocaleLowerCase();renderDrafts();});
$('asset-input').addEventListener('change', e => addAssets(e.target.files));
for (const event of ['dragenter', 'dragover']) $('dropzone').addEventListener(event, e => { e.preventDefault(); $('dropzone').classList.add('dragover'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragover'));
$('dropzone').addEventListener('drop', e => { e.preventDefault(); $('dropzone').classList.remove('dragover'); addAssets(e.dataTransfer.files); });
$('copy-version').addEventListener('click', async () => { try { await navigator.clipboard.writeText(format(values())); notify('已复制' + names[activeChannel] + '文案'); } catch { notify('复制未成功。可手动选择文字，或导出文案。'); } });
$('bili-image-package').addEventListener('click',async()=>{
 if(biliImagePackageBusy||preparationBusy||saving||draft.kind!=='image')return;
 biliImagePackageBusy=true;preparationBusy=true;renderXhsButton();
 try{
  if(dirty&&(!await persist()||dirty))throw new Error('请先保存最新稿件');
  const [note]=await preparationNotes(['bilibili']);
  if(!preparationCheck(note).manual)throw new Error('请检查图文素材和文案');
  const receipt=await prepareBiliHandoff(note),pack=biliImagePackageCache.get(note.draftId+':'+note.fingerprint);
  const url=URL.createObjectURL(pack.blob),a=document.createElement('a');a.href=url;a.download=pack.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  draft.preparationResults={...draft.preparationResults,bilibili:{...draft.preparationResults?.bilibili,...receipt,platform:'bilibili',draftId:note.draftId,fingerprint:note.fingerprint,revision:note.revision,state:'manual_handoff',message:'本稿B站图文准备包已生成；请下载后在App接续，尚未填入App或发布'}};
  markDirty();await persist();renderPreparation();notify('准备包已生成，下载已发起；请在B站App接续，尚未发布。');
 }catch(error){notify('准备包未完成：'+error.message);}
 finally{biliImagePackageBusy=false;preparationBusy=false;for(const [control,disabled] of preparationDisabled)control.disabled=disabled;preparationDisabled.clear();renderEditor();}
});
$('export-copy').addEventListener('click', () => {
  const text = draft.channels.map(c => '【' + names[c] + '】\n' + format(draft.versions[c] || draft)).join('\n\n────\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = (draft.title || '发布文案').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) + '.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  notify('已导出所选平台文案');
});
async function openXhs(fresh=false) {
  if(xhsBusy)return;
  clearTimeout(loginPollTimer); xhsBusy=true;renderXhsButton(); $('xhs-connect-status').textContent = '正在打开专用浏览器…';
  try { const result = await xhsRequest('/api/xhs/connect', {fresh,kind:draft.kind==='video'?'video':'image'}); xhsPhase = result.phase; xhsEditorKind=result.kind||'image'; $('xhs-connect-status').textContent = xhsMessage(result); if(fresh){$('xhs-job-status').textContent='新的编辑页已打开，上一稿保留在原标签页。';await clearPreparationRecord('xhs');} loginPolls = 0; }
  catch (e) { $('xhs-connect-status').textContent = '未连接：' + e.message; xhsPhase = 'error'; renderXhsButton(); }
  finally { xhsBusy=false;renderXhsButton();pollLogin(); }
}
$('connect-xhs').addEventListener('click',()=>openXhs());
$('new-xhs-page').addEventListener('click',()=>openXhs(true));
$('refresh-xhs').addEventListener('click', async()=>{await refreshXhs(); if(xhsPhase==='awaiting_login')await showLoginPreview();});
$('prepare-xhs').addEventListener('click',()=>startPreparation(['xhs']));

refreshXhs();
$('bili-agreement').addEventListener('change',renderBiliButton);
$('bili-cover-mode').addEventListener('change',e=>{const value=e.target.value;setBiliOptions(value==='upload'?{coverMode:'upload'}:{coverMode:'frame',frameIndex:Number(value.split(':')[1])});});
$('bili-category').addEventListener('change',e=>setBiliOptions({categoryPath:e.target.value?JSON.parse(e.target.value):[]}));
$('bili-tags').addEventListener('input',e=>{draft.biliOptions={...biliOptions(),tags:normalizeBiliTags(e.target.value)};markDirty();$('bili-options-status').textContent='本地设置已修改，尚未应用到B站。';const check=checkBiliOptions(biliOptions()),ready=biliPhase==='prepared'&&biliPreparedDraftId===draft.id;$('bili-apply-options').disabled=biliBusy||!ready||!check.valid;$('bili-options-hint').textContent=!ready?'先将本稿视频填入B站，再应用这些设置。':!check.valid?check.issues.join('；')+'。':'只更新当前稿的封面、分区和标签，视频与文案保留；不会点击投稿。';});
$('bili-pick-cover').addEventListener('click',()=>$('bili-cover-input').click());
$('bili-cover-input').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  if(saving||biliBusy||!['image/png','image/jpeg'].includes(file.type)||file.size>BILI_COVER_LIMIT){notify('请选择2 MB以内的PNG或JPEG封面，或等待当前任务结束。');e.target.value='';return;}
  const asset={id:crypto.randomUUID(),name:file.name,type:file.type,size:file.size,blob:file},before=biliOptions();
  biliCoverSaving=true;draft.biliOptions={...before,coverMode:'upload',cover:{id:asset.id,name:asset.name,type:asset.type,size:asset.size}};markDirty();renderBiliButton();
  $('bili-options-status').textContent='本地封面已选择，尚未应用到B站。';
  try{if(!await persist([asset])){draft.biliOptions=before;markDirty();}}
  finally{biliCoverSaving=false;biliCoverPreviewId=undefined;e.target.value='';renderBiliButton();}
});
$('bili-load-categories').addEventListener('click',async()=>{
  if(biliBusy)return;biliBusy=true;renderBiliButton();$('bili-options-status').textContent='正在读取当前B站分区…';
  try{const result=await xhsRequest('/api/bilibili/catalog',{});biliCategories=result.categories;setBiliFrames(result.frames||[],result.draftId);if(draft.id===result.draftId)$('bili-options-status').textContent=`已从当前投稿页读取${biliCategories.length}个分区和推荐封面，请选择。`;else notify('上一稿的分区和推荐封面已读取。');}
  catch(e){$('bili-options-status').textContent='分区读取未完成：'+e.message;}
  finally{biliBusy=false;renderBiliButton();}
});
$('bili-apply-options').addEventListener('click',async()=>{
  if(biliBusy||biliPreparedDraftId!==draft.id)return;
  if(!checkBiliOptions(biliOptions()).valid)return;
  if(dirty&&(!await persist()||dirty)){notify('请先保存最新设置');return;}
  const snapshot={draftId:draft.id,...structuredClone(biliOptions())};
  biliBusy=true;renderBiliButton();$('bili-options-status').textContent='正在更新B站封面、分区和标签，不会重传视频…';
  try{
    let cover;
    if(snapshot.coverMode==='upload'){
      const asset=await getAsset(snapshot.cover.id);if(!asset?.blob)throw new Error('本地封面读取不到');
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('封面读取失败'));reader.readAsDataURL(asset.blob);});
      cover={type:asset.type,data};
    }
    const result=await xhsRequest('/api/bilibili/options',{draftId:snapshot.draftId,categoryPath:snapshot.categoryPath,tags:snapshot.tags,coverMode:snapshot.coverMode,frameIndex:snapshot.frameIndex,cover});
    if(draft.id===snapshot.draftId)$('bili-options-status').textContent=result.message;else notify('上一份B站稿件的设置已更新，尚未投稿。');
  }catch(e){$('bili-options-status').textContent='设置未完成：'+e.message+'。请检查当前编辑页，不要重传视频。';}
  finally{biliBusy=false;await refreshProvider('bilibili');renderBiliButton();}
});
$('bili-prepare').addEventListener('click',()=>startPreparation(['bilibili']));

$('douyin-cover-mode').addEventListener('change',e=>{draft.douyinOptions={...douyinOptions(),coverMode:e.target.value};markDirty();$('douyin-options-status').textContent='本地设置已修改，尚未应用到抖音。';renderDouyinButton();});
$('douyin-topics').addEventListener('input',e=>{draft.douyinOptions={...douyinOptions(),topics:normalizeDouyinTopics(e.target.value)};markDirty();$('douyin-options-status').textContent='本地设置已修改，尚未应用到抖音。';const check=checkDouyinOptions(douyinOptions());$('douyin-apply-options').disabled=douyinBusy||douyinCoverSaving||douyinPhase!=='prepared'||douyinPreparedDraftId!==draft.id||douyinEditorKind!==draft.kind||!check.valid;});
$('douyin-pick-cover').addEventListener('click',()=>$('douyin-cover-input').click());
$('douyin-cover-input').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;
 if(douyinBusy||douyinCoverSaving||!['image/png','image/jpeg'].includes(file.type)||file.size>DOUYIN_COVER_LIMIT){notify('请选择2 MB以内的PNG或JPEG封面，或等待当前任务结束。');e.target.value='';return;}
 const before=douyinOptions(),asset={id:crypto.randomUUID(),name:file.name,type:file.type,size:file.size,blob:file};douyinCoverSaving=true;draft.douyinOptions={...before,coverMode:'upload',cover:{id:asset.id,name:asset.name,type:asset.type,size:asset.size}};markDirty();renderDouyinButton();$('douyin-options-status').textContent='本地封面已选择，尚未应用到抖音。';
 try{if(!await persist([asset])){draft.douyinOptions=before;markDirty();}}finally{douyinCoverSaving=false;douyinCoverPreviewId=undefined;e.target.value='';renderDouyinButton();}
});
$('douyin-apply-options').addEventListener('click',async()=>{
 if(douyinBusy||douyinPhase!=='prepared'||douyinPreparedDraftId!==draft.id||douyinEditorKind!==draft.kind||!checkDouyinOptions(douyinOptions()).valid)return;
 if(dirty&&(!await persist()||dirty)){notify('请先保存最新设置');return;}
 const snapshot={draftId:draft.id,...structuredClone(douyinOptions())};douyinBusy=true;renderDouyinButton();$('douyin-options-status').textContent='正在应用抖音设置，素材不会重传…';
 try{
  let cover;if(snapshot.coverMode==='upload'){const asset=await getAsset(snapshot.cover.id);if(!asset?.blob)throw new Error('本地封面读取不到');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('封面读取失败'));reader.readAsDataURL(asset.blob);});cover={type:asset.type,data};}
  const result=await xhsRequest('/api/douyin/options',{draftId:snapshot.draftId,coverMode:snapshot.coverMode,topics:snapshot.topics,cover});
  if(draft.id===snapshot.draftId)$('douyin-options-status').textContent=result.message;else notify('上一稿的抖音设置已应用，尚未发布。');
 }catch(e){$('douyin-options-status').textContent='设置未完成：'+e.message+'。请先核对当前编辑页，勿重传素材。';}
 finally{douyinBusy=false;await refreshProvider('douyin');renderDouyinButton();}
});
$('douyin-agreement').addEventListener('change',renderDouyinButton);
$('douyin-prepare').addEventListener('click',()=>startPreparation(['douyin']));

window.addEventListener('beforeunload', e => { if (dirty || saving || preparationBusy || aiBusy) { e.preventDefault(); e.returnValue = ''; } });
try { drafts = await getDrafts(); if (drafts.length) draft = structuredClone(drafts[0]); $('save-state').textContent = drafts.length ? '已保存在此浏览器' : '新草稿'; renderEditor(); }
catch { $('save-state').textContent = '无法读取本地草稿'; renderEditor(); notify('本地存储不可用，编辑后请导出文案，避免丢失。'); }
refreshTokenpay();
if(location.hash==='#wallet')showView('wallet');

}
