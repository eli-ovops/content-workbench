export const XHS_IMAGE_LIMITS = Object.freeze({ title:20, body:1000, images:9, imageBytes:8*1024*1024, totalBytes:10*1024*1024 });
export const VIDEO_MAX_BYTES=100*1024*1024;
const supported = new Set(['image/png','image/jpeg','image/webp']);
function textChecks(note) {
  const title = typeof note.title === 'string' ? note.title : '';
  const body = typeof note.body === 'string' ? note.body : '';
  const tags = typeof note.tags === 'string' ? note.tags : '';
  const combined = [body,tags].filter(s=>s.trim()).join('\n\n');
  return [
    {key:'title',label:'标题',value:`${[...title].length} / 20 字`,ok:!!title.trim() && [...title].length<=20,message:'标题须为1至20字'},
    {key:'body',label:'正文与标签',value:`${combined.length} / 1000 字符`,ok:combined.length<=1000,message:'正文与标签合计暂限1000字符'},
  ];
}
export function checkXhsImage(note) {
  const images = note.images || [],bytes = images.reduce((sum,a)=>sum+(Number(a.size)||0),0);
  const checks = textChecks(note).concat([
    {key:'images',label:'图片',value:`${images.length} / 9 张`,ok:note.kind==='image' && images.length>=1 && images.length<=9 && images.every(a=>supported.has(a.type)),message:'图文须含1至9张PNG、JPEG或WebP图片'},
    {key:'size',label:'素材大小',value:`${(bytes/1024/1024).toFixed(1)} / 10 MB`,ok:bytes<=XHS_IMAGE_LIMITS.totalBytes && images.every(a=>a.size>0 && a.size<=XHS_IMAGE_LIMITS.imageBytes),message:'图片合计暂限10 MB，每张最多8 MB'},
  ]);
  return {checks,valid:checks.every(c=>c.ok),issues:checks.filter(c=>!c.ok).map(c=>c.message)};
}
export function checkXhsVideo(note) {
  const videos=(note.assets||[]).filter(a=>a.type==='video/mp4');
  const checks=textChecks(note).concat([
    {key:'video',label:'视频',value:`${videos.length} / 1 个 MP4`,ok:note.kind==='video'&&videos.length===1&&(note.assets||[]).length===1,message:'当前视频接入只接受1个MP4，封面使用平台默认帧'},
    {key:'size',label:'视频大小',value:`${((videos[0]?.size||0)/1024/1024).toFixed(1)} / 100 MB`,ok:!!videos[0]?.size&&videos[0].size<=VIDEO_MAX_BYTES,message:'当前视频接入暂限100 MB，与本地素材上限一致'},
  ]);
  return {checks,valid:checks.every(c=>c.ok),issues:checks.filter(c=>!c.ok).map(c=>c.message)};
}
export function moveAsset(assets,id,direction) {
  const index=assets.findIndex(a=>a.id===id),target=index+direction;
  if (![1,-1].includes(direction)||index<0||target<0||target>=assets.length) return assets.slice();
  const ordered=assets.slice(); [ordered[index],ordered[target]]=[ordered[target],ordered[index]]; return ordered;
}
