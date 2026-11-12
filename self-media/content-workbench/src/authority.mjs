import fs from 'node:fs/promises';
import {AUTHORITY_PATHS} from './config.mjs';
import {hash} from './model.mjs';
export async function readAuthority(previous=[],paths=AUTHORITY_PATHS,now=()=>new Date().toISOString()){
return Promise.all(paths.map(async (path,i)=>{try{
const raw=await fs.readFile(path,'utf8'),obj=JSON.parse(raw);
const value=i===0?{version:obj.version,stages:(obj.stages||[]).map(s=>({id:s.id,label:s.label,thread_id:s.thread_id})),pmo_thread_id:obj.pmo?.thread_id}:{
version:obj.version,active_content_id:obj.active_content_id,runs:Object.fromEntries(Object.entries(obj.runs||{}).map(([id,r])=>[id,{current_stage:r.current_stage,status:r.status??'UNKNOWN',stages:Object.fromEntries(Object.entries(r.stages||{}).map(([k,v])=>[k,v.status??'UNKNOWN']))}]))};
const last=previous.find(x=>x.path===path);return {path,sha256:hash(raw),readAt:now(),status:'CURRENT_RAW',value,changed:!!last&&last.sha256!==hash(raw)};
}catch(e){const last=previous.find(x=>x.path===path);return {path,status:last?'HISTORICAL_EXPIRED':'UNKNOWN',readAt:last?.readAt||null,sha256:last?.sha256||null,value:last?.value||null,error:'来源缺失或JSON损坏'};}}));
}
