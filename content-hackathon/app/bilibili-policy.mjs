export const BILI_COVER_LIMIT=2*1024*1024;
export function normalizeBiliTags(value){
  const parts=Array.isArray(value)?value:typeof value==='string'?value.split(/[,，\n]/):[];
  return [...new Set(parts.filter(v=>typeof v==='string').map(v=>v.trim()).filter(Boolean))];
}
export function checkBiliOptions(options={}){
  const tags=normalizeBiliTags(options.tags),path=options.categoryPath;
  const issues=[];
  if(!Array.isArray(path)||path.length<1||path.length>2||path.some(v=>typeof v!=='string'||!v.trim()||v.length>50||/[\x00-\x1f]/.test(v)))issues.push('请从B站分区列表选择一个分区');
  if(tags.length<1||tags.length>10||tags.some(v=>v.length>20||/[\x00-\x1f]/.test(v)))issues.push('标签暂收1至10个，每个最多20字符');
  if(options.coverMode==='upload'){
    if(!options.cover||!['image/png','image/jpeg'].includes(options.cover.type)||!(options.cover.size>0)||options.cover.size>BILI_COVER_LIMIT)issues.push('本地封面须为2 MB以内的PNG或JPEG');
  }else if(options.coverMode!=='frame'||![0,1,2].includes(options.frameIndex))issues.push('请选择平台推荐帧或本地图片作为封面');
  return {valid:issues.length===0,issues,tags};
}
export function validateBiliOptions(payload){
  if(typeof payload?.draftId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.draftId))throw new Error('请先保存并准备当前B站草稿');
  let cover;
  if(payload.coverMode==='upload'){
    const data=payload.cover?.data;
    if(typeof data!=='string'||data.length>Math.ceil(BILI_COVER_LIMIT/3)*4||! /^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length%4)throw new Error('封面数据无效或过大');
    cover=Buffer.from(data,'base64');
    const png=cover.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
    const jpeg=cover.length>=3&&cover[0]===0xff&&cover[1]===0xd8&&cover[2]===0xff;
    if(!(payload.cover?.type==='image/png'&&png||payload.cover?.type==='image/jpeg'&&jpeg))throw new Error('封面须为有效PNG或JPEG');
  }
  const check=checkBiliOptions({...payload,cover:cover?{type:payload.cover.type,size:cover.length}:undefined});
  if(!check.valid)throw new Error(check.issues.join('；'));
  return {draftId:payload.draftId,categoryPath:payload.categoryPath.slice(),tags:check.tags,coverMode:payload.coverMode,frameIndex:payload.frameIndex,cover,coverType:payload.cover?.type};
}

// Local-only App handoff. It never contacts Bili or submits a cloud draft.
function zipCRC(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function zipHeader(size,signature){const b=new Uint8Array(size);new DataView(b.buffer).setUint32(0,signature,true);return b;}
function zip16(b,at,value){new DataView(b.buffer).setUint16(at,value,true);}
function zip32(b,at,value){new DataView(b.buffer).setUint32(at,value,true);}
export function safeBiliPackageName(name){return String(name||'图文').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'-').slice(0,70)||'图文';}
export async function buildBiliImagePackage(note,assets){
  if(note?.kind!=='image'||!note.title?.trim()||[...note.title].length>20||typeof note.body!=='string'||typeof note.tags!=='string')throw new Error('图文标题或正文格式无效');
  if(!Array.isArray(assets)||!assets.length||assets.length>9)throw new Error('准备包须含1至9张图片');
  if([note.body,note.tags].filter(t=>t.trim()).join('\n\n').length>1000)throw new Error('正文和标签合计暂限1000字符');
  const encoder=new TextEncoder(),images=[],manifest=[];
  for(const [i,asset] of assets.entries()){
    const type=asset.blob?.type,ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[type];
    if(!ext||asset.blob.size<=0||asset.blob.size>8*1024*1024)throw new Error('仅接受8 MB以内的PNG、JPEG或WebP图片');
    const data=new Uint8Array(await asset.blob.arrayBuffer());
    const png=[137,80,78,71,13,10,26,10].every((b,j)=>data[j]===b),jpeg=data[0]===255&&data[1]===216&&data[2]===255,webp=String.fromCharCode(...data.slice(0,4))==='RIFF'&&String.fromCharCode(...data.slice(8,12))==='WEBP';
    if(!(ext==='png'?png:ext==='jpg'?jpeg:webp))throw new Error('图片内容与格式不一致');
    const base=safeBiliPackageName(asset.name||'图片').replace(/\.(png|jpe?g|webp)$/i,'');
    const name='图片/'+String(i+1).padStart(2,'0')+'-'+base+'.'+ext;
    images.push({name,data});manifest.push({order:i+1,file:name,originalName:asset.name||'图片',type,size:data.length});
  }
  if(images.reduce((n,a)=>n+a.data.length,0)>10*1024*1024)throw new Error('准备包图片合计暂限10 MB');
  const instruction='B站图文专栏 · App手动接续\n\n此包只在本机生成，没有上传B站，没有填入App，也没有发布。\n\n1. 将此ZIP传到手机并解压。\n2. 在B站App进入图文/专栏创作入口（按钮名称以本人App实际版本为准）。\n3. 按图片文件名01、02…的顺序选图；首图使用01文件。\n4. 分别复制标题.txt、正文.txt和话题标签.txt。工作台使用本稿B站版本；视频分区/封面设置未混入。\n5. 在App逐项核对标题、正文、图片顺序、封面和声明。准备完成仍停留编辑页，发布由本人另行决定。\n\n官方网页编辑器目前提示：旧版编辑器已下线，请升级App后继续创作。\n';
  const files=[{name:'标题.txt',data:encoder.encode(note.title)},{name:'正文.txt',data:encoder.encode(note.body)},{name:'话题标签.txt',data:encoder.encode(note.tags)},{name:'接续说明.txt',data:encoder.encode(instruction)},{name:'素材清单.json',data:encoder.encode(JSON.stringify({draftId:note.draftId,platform:'bilibili',kind:'image',appDraftPrepared:false,published:false,images:manifest},null,2))},...images];
  const local=[],central=[];let offset=0,centralSize=0;
  for(const file of files){
    const name=encoder.encode(file.name),crc=zipCRC(file.data),size=file.data.length;
    const h=zipHeader(30,0x04034b50);zip16(h,4,20);zip16(h,6,0x800);zip16(h,12,33);zip32(h,14,crc);zip32(h,18,size);zip32(h,22,size);zip16(h,26,name.length);
    const c=zipHeader(46,0x02014b50);zip16(c,4,20);zip16(c,6,20);zip16(c,8,0x800);zip16(c,14,33);zip32(c,16,crc);zip32(c,20,size);zip32(c,24,size);zip16(c,28,name.length);zip32(c,42,offset);
    local.push(h,name,file.data);central.push(c,name);offset+=h.length+name.length+size;centralSize+=c.length+name.length;
  }
  const end=zipHeader(22,0x06054b50);zip16(end,8,files.length);zip16(end,10,files.length);zip32(end,12,centralSize);zip32(end,16,offset);
  return {blob:new Blob([...local,...central,end],{type:'application/zip'}),fileName:'B站图文-'+safeBiliPackageName(note.title)+'.zip',imageCount:images.length};
}
