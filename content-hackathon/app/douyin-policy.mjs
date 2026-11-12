export const DOUYIN_COVER_LIMIT=2*1024*1024;
export function normalizeDouyinTopics(value){
  const values=Array.isArray(value)?value:String(value||'').split(/[,，\n]+/);
  return [...new Set(values.map(v=>String(v).trim().replace(/^#+/,'')).filter(Boolean))];
}
export function checkDouyinOptions(options){
  const topics=normalizeDouyinTopics(options?.topics),issues=[];
  if(topics.length>5||topics.some(t=>[...t].length>20||/[\s#\u0000-\u001f]/.test(t)))issues.push('话题暂限5个，每个1至20字，不含空格或井号');
  if(!['keep','upload'].includes(options?.coverMode))issues.push('请选择封面来源');
  if(options?.coverMode==='upload'&&(!options.cover||!['image/png','image/jpeg'].includes(options.cover.type)||options.cover.size<=0||options.cover.size>DOUYIN_COVER_LIMIT))issues.push('封面须为2 MB以内的PNG或JPEG');
  return {valid:!issues.length,issues,topics};
}
export function validateDouyinOptions(payload){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload?.draftId||''))throw new Error('当前稿件标识无效');
  let cover,coverType;
  if(payload.coverMode==='upload'){
    const data=payload.cover?.data;
    if(typeof data!=='string'||data.length>Math.ceil(DOUYIN_COVER_LIMIT/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw new Error('封面编码或大小无效');
    cover=Buffer.from(data,'base64');
    if(cover.toString('base64')!==data||!cover.length||cover.length>DOUYIN_COVER_LIMIT)throw new Error('封面编码或大小无效');
    if(cover.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))coverType='image/png';
    else if(cover[0]===255&&cover[1]===216&&cover[2]===255)coverType='image/jpeg';
    else throw new Error('仅支持PNG或JPEG封面');
    if(payload.cover.type!==coverType)throw new Error('封面内容与类型不一致');
  }
  const result=checkDouyinOptions({...payload,cover:cover?{type:coverType,size:cover.length}:undefined});
  if(!result.valid)throw new Error(result.issues[0]);
  return {draftId:payload.draftId,topics:result.topics,coverMode:payload.coverMode,cover,coverType};
}
