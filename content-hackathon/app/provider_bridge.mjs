import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createBroker} from './rpc_broker.mjs';
import {mkdir,writeFile,chmod} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {validateVideo,validateNote} from './xhs_bridge.mjs';
import {validateBiliOptions} from './bilibili-policy.mjs';
import {validateDouyinOptions} from './douyin-policy.mjs';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('.',import.meta.url));
const providers=new Map();
export function providerBridge(platform) {
  if(!['douyin','bilibili'].includes(platform))throw new Error('平台不支持');
  if(providers.has(platform))return providers.get(platform);
  let child,busy=false;
  const broker=createBroker(request=>{
    if(!child){
      child=spawn(root+'.venv/bin/python',['-u',root+'provider_worker.py',platform],{cwd:root,stdio:['pipe','pipe','pipe']});
      child.stderr.on('data',()=>{});
      createInterface({input:child.stdout}).on('line',line=>{try{broker.receive(JSON.parse(line));}catch{}});
      const fail=()=>{child=undefined;broker.abort();};
      child.on('exit',fail);child.on('error',fail);child.stdin.on('error',fail);
    }
    child.stdin.write(JSON.stringify(request)+'\n');
  },200000);
  const mutation=async fn=>{if(busy)throw new Error('已有平台任务进行中');busy=true;try{return await fn();}finally{busy=false;}};
  const bridge={status:()=>busy?Promise.resolve({phase:'preparing',message:'正在操作专用浏览器，请勿重复提交'}):child?broker.request('status'):Promise.resolve({phase:'not_connected',message:'尚未连接，准备流程待验收'}),connect:({fresh=false,kind="video"}={})=>mutation(async()=>{
    if(!['image','video'].includes(kind)||(platform==='bilibili'&&kind!=='video'))throw new Error('该平台不支持此内容类型');
    if(fresh){
      const name=platform==='douyin'?'抖音':'B站';
      if(!child)throw new Error('请先连接并登录'+name);
      if(!['login_observed','prepared'].includes((await broker.request('status')).phase))throw new Error('请先核对'+name+'登录与当前编辑页');
    }
    return broker.request('connect',{fresh:fresh===true,kind});
  }),inspect:()=>child?broker.request('inspect'):Promise.resolve({pageOpen:false}),settingsInspect:()=>child?broker.request('settings_inspect'):Promise.resolve({pageOpen:false}),catalog:()=>mutation(async()=>{
    if(platform!=='bilibili'||!child)throw new Error('请先准备B站视频');
    return broker.request('catalog');
  }),options:payload=>mutation(async()=>{
    const note=platform==='douyin'?validateDouyinOptions(payload):validateBiliOptions(payload);
    if(!child)throw new Error('请先准备'+(platform==='douyin'?'抖音':'B站')+'视频');
    const status=await broker.request('status');
    if(platform==='douyin'&&status.kind==='image'&&note.coverMode!=='keep')throw new Error('抖音图文暂用首张图片作为封面，请在本地调整图片顺序');
    if(status.phase!=='prepared'||status.draftId!==note.draftId)throw new Error('当前平台编辑页对应另一份稿件，请先准备本稿');
    const id=randomUUID(),dir=root+'.runtime/'+platform+'/jobs/'+id;
    await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
    const coverPath=note.cover?dir+(note.coverType==='image/png'?'/cover.png':'/cover.jpg'):null;
    if(coverPath)await writeFile(coverPath,note.cover,{mode:0o600,flag:'wx'});
    await writeFile(dir+'/job.json',JSON.stringify({draft_id:note.draftId,category_path:note.categoryPath,tags:note.tags,topics:note.topics,cover_mode:note.coverMode,frame_index:note.frameIndex,cover_path:coverPath,cover_choice:note.cover?createHash('sha256').update(note.cover).digest('hex'):'frame:'+note.frameIndex,receipt_path:dir+'/settings.png'}),{mode:0o600,flag:'wx'});
    return broker.request('options',{job_id:id});
  }),close:()=>child?.stdin.end(),prepare:payload=>mutation(async()=>{
    if(platform==='bilibili'&&payload?.agreementConfirmed!==true)throw new Error('B站页面注明上传即同意使用协议与社区公约，请先本人阅读确认');
    if(platform==='bilibili'&&payload?.kind!=='video')throw new Error('B站当前只支持视频');
    const kind=payload?.kind==='image'?'image':'video';
    const note=platform==='douyin'&&kind==='image'?validateNote(payload):validateVideo(payload);
    if(!child)throw new Error('请先本人登录'+(platform==='douyin'?'抖音':'B站'));
    const status=await broker.request('status');
    if(status.phase==='prepared')throw new Error('上一稿已填入，请先在平台编辑页核对，不能重复上传');
    if(status.phase!=='login_observed')throw new Error('请先打开并核对'+(platform==='douyin'?'抖音':'B站')+'视频投稿页');
    if(platform==='douyin'&&(status.kind||'video')!==kind)throw new Error('请先打开对应内容类型的抖音编辑页');
    const id=randomUUID(),dir=root+'.runtime/'+platform+'/jobs/'+id;
    await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
    const imagePaths=[];
    for(const [i,image] of (note.images||[]).entries()){const path=dir+'/'+i+'.'+image.ext;await writeFile(path,image.buffer,{mode:0o600,flag:'wx'});imagePaths.push(path);}
    if(note.video)await writeFile(dir+'/0.mp4',note.video,{mode:0o600,flag:'wx'});
    await writeFile(dir+'/job.json',JSON.stringify({kind,draft_id:payload.draftId||null,title:note.title,body:note.body,tags:note.tags,agreement_confirmed:payload.agreementConfirmed===true,image_paths:imagePaths,video_path:note.video?dir+'/0.mp4':undefined,receipt_path:dir+'/prepared.png'}),{mode:0o600,flag:'wx'});
    return broker.request('prepare',{job_id:id});
  })};
  providers.set(platform,bridge);return bridge;
}
export function closeProviders(){for(const p of providers.values())p.close();}
