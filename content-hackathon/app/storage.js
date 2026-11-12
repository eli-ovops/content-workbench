let dbPromise;
// Only paired observations count as savings; zero is valid, missing is not.
export function timeComparison(records = []) {
  const pairs = records.filter(r => ['manualMinutes','workbenchMinutes','overheadMinutes'].every(k => Number.isFinite(r[k]) && r[k] >= 0));
  const baseline = pairs.reduce((s,r) => s+r.manualMinutes,0);
  const actual = pairs.reduce((s,r) => s+r.workbenchMinutes+r.overheadMinutes,0);
  return {count:pairs.length,baseline,actual,net:baseline-actual,percent:baseline>0?(baseline-actual)/baseline*100:null};
}
export function openDB() {
  return dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('eli-social-publisher', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts', { keyPath: 'id' });
      request.result.createObjectStore('assets', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他工作台标签页后重试'));
  });
}
export async function getDrafts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction('drafts').objectStore('drafts').getAll();
    r.onsuccess = () => resolve(r.result.sort((a, b) => b.updatedAt - a.updatedAt));
    r.onerror = () => reject(r.error);
  });
}
export async function saveDraft(draft, newAssets = []) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['drafts', 'assets'], 'readwrite');
    let failure;
    const store=tx.objectStore('drafts'),current=store.get(draft.id);
    current.onsuccess=()=>{
      const old=current.result;
      if(old && ((old.revision||0)!==(draft.revision||0) || (!old.revision && old.updatedAt!==draft.updatedAtBeforeSave))){
        failure=new Error('另一标签页已保存这份草稿；当前修改仍在，请另存副本再读取最新稿。');failure.code='DRAFT_CONFLICT';tx.abort();return;
      }
      draft.revision=(old?.revision||0)+1;delete draft.updatedAtBeforeSave;
      store.put(draft);newAssets.forEach(asset=>tx.objectStore('assets').put(asset));
    };
    tx.oncomplete = () => resolve(draft.revision);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('保存被中断'));
  });
}
export async function exportBackup(){
 const db=await openDB();
 const data=await new Promise((resolve,reject)=>{
  const tx=db.transaction(['drafts','assets']),d=tx.objectStore('drafts').getAll(),a=tx.objectStore('assets').getAll();
  tx.oncomplete=()=>resolve({drafts:d.result,assets:a.result});tx.onerror=()=>reject(tx.error);
 });
 if(data.assets.reduce((s,a)=>s+a.blob.size,0)>500*1024*1024)throw new Error('备份素材超过500 MB，本次未导出');
 const assets=[];
 for(const a of data.assets){
  const bytes=new Uint8Array(await a.blob.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  assets.push({id:a.id,name:a.name,type:a.type,size:bytes.length,hash,data:btoa(raw)});
 }
 return {schema:'eli-workbench-backup-v1',exportedAt:new Date().toISOString(),drafts:data.drafts,assets};
}
export async function importBackup(data){
 if(data?.schema!=='eli-workbench-backup-v1'||!Array.isArray(data.drafts)||!Array.isArray(data.assets)||data.drafts.length>10000||data.assets.length>50000)throw new Error('不是受支持的工作台备份');
 const ids=new Map(),assets=[],metadata=new Map();let total=0;
 for(const a of data.assets){
  if(typeof a.id!=='string'||ids.has(a.id)||typeof a.data!=='string'||typeof a.type!=='string'||!(/^(image|video)\//.test(a.type)))throw new Error('备份素材无效');
  const raw=atob(a.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));total+=bytes.length;
  if(total>500*1024*1024||bytes.length!==a.size)throw new Error('备份素材大小不符或超限');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==a.hash)throw new Error('备份素材校验失败，未导入');
  const id=crypto.randomUUID();ids.set(a.id,id);metadata.set(a.id,a);assets.push({id,name:String(a.name||'素材'),type:a.type,size:a.size,blob:new Blob([bytes],{type:a.type})});
 }
 const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const checkAssets=list=>{
  if(!Array.isArray(list)||list.some(a=>!plain(a)||typeof a.id!=='string'||!metadata.has(a.id)||a.type!==metadata.get(a.id).type||a.size!==metadata.get(a.id).size||typeof a.name!=='string'))throw new Error('备份中的素材引用缺失或不一致，未导入');
 };
 const checkVersions=versions=>{
  if(versions===undefined)return;
  if(!plain(versions)||Object.entries(versions).some(([platform,v])=>!['xhs','douyin','bilibili'].includes(platform)||!plain(v)||['title','body','tags'].some(k=>typeof v[k]!=='string')))throw new Error('备份中的平台版本无效，未导入');
 };
 const draftIds=new Set();
 const remap=v=>Array.isArray(v)?v.map(remap):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='id'&&ids.has(x)?ids.get(x):remap(x)])):v;
 const drafts=data.drafts.map(d=>{
  if(!d||typeof d.title!=='string'||typeof d.body!=='string'||typeof d.tags!=='string'||!['image','video','text'].includes(d.kind)||!Array.isArray(d.assets)||!Array.isArray(d.channels)||d.channels.some(c=>!['xhs','douyin','bilibili'].includes(c))||d.assets.some(a=>!ids.has(a.id)))throw new Error('备份草稿无效或素材缺失');
  if(typeof d.id!=='string'||!d.id||draftIds.has(d.id))throw new Error('备份中的草稿标识重复或缺失，未导入');draftIds.add(d.id);
  checkAssets(d.assets);checkVersions(d.versions);checkVersions(d.savedVersions);
  if(d.assetHistory!==undefined){
   if(!Array.isArray(d.assetHistory))throw new Error('备份素材历史无效，未导入');
   for(const item of d.assetHistory)checkAssets(item?.assets);
  }
  for(const options of [d.biliOptions,d.douyinOptions]){
   if(options!==undefined&&!plain(options))throw new Error('备份平台设置无效，未导入');
   if(options?.cover!==undefined)checkAssets([options.cover]);
  }
  if(d.preparationResults!==undefined&&(!plain(d.preparationResults)||Object.entries(d.preparationResults).some(([p,r])=>!['xhs','douyin','bilibili'].includes(p)||!plain(r))))throw new Error('备份准备记录无效，未导入');
  if(d.timeObservations!==undefined&&(!Array.isArray(d.timeObservations)||d.timeObservations.some(r=>!plain(r)||['manualMinutes','workbenchMinutes','overheadMinutes'].some(k=>!Number.isFinite(r[k])||r[k]<0))))throw new Error('备份使用记录无效，未导入');
  const copy=remap(d);copy.id=crypto.randomUUID();copy.revision=1;copy.updatedAt=Date.now();copy.restoredFrom=d.id;copy.versions=copy.versions||{};
  for(const r of Object.values(copy.preparationResults||{}))Object.assign(r,{state:'needs_review',draftId:copy.id,preparationVerified:false,packagePrepared:false,message:'恢复的历史记录；当前平台编辑页尚未核对。'});
  return copy;
 });
 const db=await openDB();await new Promise((resolve,reject)=>{
  const tx=db.transaction(['drafts','assets'],'readwrite');assets.forEach(a=>tx.objectStore('assets').add(a));drafts.forEach(d=>tx.objectStore('drafts').add(d));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('恢复中断'));
 });return drafts.length;
}
export async function getAsset(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction('assets').objectStore('assets').get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
