import {createHash,randomUUID} from 'node:crypto';
import {APP,SCHEMA,PLATFORMS,PUBLIC_FIELDS} from './config.mjs';
export const clone=o=>structuredClone(o);
export const hash=o=>createHash('sha256').update(typeof o==='string'?o:JSON.stringify(o)).digest('hex');
export const id=()=>randomUUID();
export class AppError extends Error {constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
export const fail=(condition,code,message,status=400)=>{if(!condition)throw new AppError(code,message,status);};
export function emptyWorkspace(title='未命名草稿'){
return {id:id(),revision:0,title,topic:'',body:'',common:{title:'',body:'',hashtags:'',backendTags:''},sources:[],facts:[],notes:[],checks:[],versions:[],selectedVersion:null,overrides:{},linkedContentId:'',authority:[],createdAt:new Date().toISOString()};
}
export function validateWorkspace(w){
fail(w&&typeof w==='object'&&!Array.isArray(w),'SCHEMA','档案格式错误');
if(w.trashedAt!==undefined)fail(typeof w.trashedAt==='string'&&Number.isFinite(Date.parse(w.trashedAt)),'SCHEMA','回收站时间格式错误');
for(const k of ['id','title','topic','body','linkedContentId'])fail(typeof w[k]==='string','SCHEMA','缺少文字字段：'+k);
for(const k of ['sources','facts','notes','checks','versions','authority'])fail(Array.isArray(w[k]),'SCHEMA','缺少列表：'+k);
fail(w.common&&w.overrides&&typeof w.common==='object','SCHEMA','缺少公共文案');
for(const k of PUBLIC_FIELDS)fail(typeof w.common[k]==='string','SCHEMA','公共文案字段错误');
const sources=new Set(w.sources.map(x=>x.id));fail(sources.size===w.sources.length,'RELATION','来源ID重复');
for(const s of w.sources){fail(typeof s.id==='string'&&typeof s.title==='string','SCHEMA','来源格式错误');fail(['PUBLIC','PRIVATE','UNKNOWN'].includes(s.privacy),'SCHEMA','隐私状态错误');fail(['ALLOWED','UNKNOWN','REVOKED'].includes(s.permission),'SCHEMA','许可状态错误');if(s.expiresAt)fail(/(Z|[+-]\d\d:\d\d)$/.test(s.expiresAt)&&Number.isFinite(Date.parse(s.expiresAt)),'SCHEMA','到期时间须为含时区ISO时间，例如2026-10-13T09:00:00+08:00');}
for(const obj of [...w.facts,...w.notes,...w.checks]){fail(typeof obj.id==='string','RELATION','记录ID缺失');for(const sid of obj.sourceIds||[])fail(sources.has(sid),'RELATION','来源关系悬空');}
const versions=new Set(w.versions.map(v=>v.id));fail(versions.size===w.versions.length,'RELATION','脚本ID重复');
for(const v of w.versions)fail(v.hash===hash(v.body),'HASH','冻结脚本摘要不符');
if(w.selectedVersion)fail(versions.has(w.selectedVersion),'RELATION','脚本版本不存在');
for(const n of w.notes)if(n.paragraphId){const v=w.versions.find(v=>v.id===n.scriptVersion);fail(v&&v.paragraphs?.some(p=>p.id===n.paragraphId),'RELATION','镜头备注的段落关联悬空');}
for(const [pid,o] of Object.entries(w.overrides)){fail(PLATFORMS.some(p=>p.id===pid),'PLATFORM','未知平台');for(const k of PUBLIC_FIELDS)if(o[k]!=null)fail(typeof o[k]==='string','SCHEMA','平台覆盖格式错误');for(const sid of o.sourceIds||[])fail(sources.has(sid),'RELATION','平台来源悬空');if(o.scriptVersion)fail(versions.has(o.scriptVersion),'RELATION','平台脚本关系悬空');}
return w;
}
export function effective(w,pid){const o=w.overrides[pid]||{};return Object.fromEntries(PUBLIC_FIELDS.map(k=>[k,o[k]===undefined?w.common[k]:o[k]]));}
export function dependency(w,pid){
const v=w.versions.find(v=>v.id===w.selectedVersion);
return hash({workspace:w.id,script:v?.hash||null,liveBody:hash(w.body),public:effective(w,pid),language:w.overrides[pid]?.languageConfirmed||false,sources:w.sources.map(({id,privacy,permission,expiresAt,version})=>({id,privacy,permission,expiresAt,version}))});
}
export function privacyIssues(w,pid,now=Date.now()){
const o=w.overrides[pid]||{},p=PLATFORMS.find(p=>p.id===pid),t=effective(w,pid),issues=[];
if(!o.languageConfirmed)issues.push('待语言确认：'+p.language);
if(!o.publicBasis||!['OWN','SOURCES'].includes(o.publicBasis))issues.push('公共文字需声明自有或来源依据');
if(o.publicBasis==='SOURCES'&&!(o.sourceIds||[]).length)issues.push('公共文字未关联来源');
const linked=o.sourceIds||[];
for(const sid of linked){const s=w.sources.find(s=>s.id===sid);if(!s||s.privacy!=='PUBLIC'||s.permission!=='ALLOWED')issues.push('来源隐私/许可未核或已撤销');if(s?.expiresAt&&new Date(s.expiresAt).getTime()<=now)issues.push('来源许可已到期');}
const text=Object.values(t).join('\n');
if(/(?:\/Users\/|\/Volumes\/|PRIVATE_FIXTURE|CLIENT_FIXTURE|SECRET_FIXTURE|\bsk-[A-Za-z0-9]+)/.test(text))issues.push('公开文字含内部路径或敏感标记');
if(o.scriptVersion&&o.scriptVersion!==w.selectedVersion)issues.push('平台稿适用旧脚本版本');
if(w.selectedVersion&&w.versions.find(v=>v.id===w.selectedVersion)?.body!==w.body)issues.push('当前正文与冻结脚本不同');
return [...new Set(issues)];
}
export function bundleFor(w){validateWorkspace(w);return {producerApp:APP,schemaName:SCHEMA,schemaVersion:1,workspace:clone(w)};}
export function restoreWorkspace(bundle){
fail(bundle.producerApp===APP&&bundle.schemaName===SCHEMA&&bundle.schemaVersion===1,'SCHEMA','不支持此工具/未来schema');
const w=clone(bundle.workspace);validateWorkspace(w);const old=w.id;w.id=id();w.namespace=w.id;w.originalRef={workspaceId:old};w.revision=0;
w.authority=w.authority.map(s=>({...s,status:'IMPORTED_HISTORICAL',readAt:null}));
for(const s of w.sources){s.originalPermission=s.permission;s.permission='UNKNOWN';s.privacy='UNKNOWN';}
for(const o of Object.values(w.overrides)){delete o.approved; o.languageConfirmed=false;}
w.checks=w.checks.map(c=>({...c,result:'HISTORICAL',current:false}));
w.restoredAt=new Date().toISOString();return validateWorkspace(w);
}
