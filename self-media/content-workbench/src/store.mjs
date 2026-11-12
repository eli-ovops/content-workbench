import fs from 'node:fs/promises';
import path from 'node:path';
import {APP,SCHEMA,APP_VERSION,CONFIG_VERSION,LIMIT,PLATFORMS,PUBLIC_FIELDS} from './config.mjs';
import {AppError,fail,id,hash,clone,emptyWorkspace,validateWorkspace,effective,dependency,privacyIssues,bundleFor,restoreWorkspace} from './model.mjs';
import {readAuthority} from './authority.mjs';
const protectedJSON=async(p,o)=>{const h=await fs.open(p,'wx',0o600);try{await h.writeFile(JSON.stringify(o,null,2));await h.sync();}finally{await h.close();}};
const exists=async p=>fs.access(p).then(()=>true,()=>false);
export class Store{
constructor(root,{limits={},hook=async()=>{},now=()=>Date.now(),authorityPaths}={}){
this.root=path.resolve(root);this.limits={...LIMIT,...limits};this.hook=hook;this.now=now;this.authorityPaths=authorityPaths;this.tail=Promise.resolve();this.approvals=new Map();this.denied=new Set();this.exports=new Map();this.lockOwned=false;
}
async init(workspaces=[]){
fail(!await exists(this.root),'ROOT_EXISTS','初始化仅允许新根',409);
await fs.mkdir(this.root,{recursive:true,mode:0o700});await fs.chmod(this.root,0o700);
const rootId=id();await protectedJSON(path.join(this.root,'root.json'),{producerApp:APP,rootId,schemaName:SCHEMA,schemaVersion:1});
for(const w of workspaces){validateWorkspace(w);w.revision=1;}
await protectedJSON(path.join(this.root,'current.json'),{rootId,schemaName:SCHEMA,schemaVersion:1,revision:1,workspaces});
await protectedJSON(path.join(this.root,'previous.json'),{rootId,schemaName:SCHEMA,schemaVersion:1,revision:1,workspaces});
}
async open(){
const st=await fs.lstat(this.root);fail(st.isDirectory()&&!st.isSymbolicLink(),'ROOT','数据根不能是链接');
for(const file of ['root.json','current.json','previous.json'])fail(!(await fs.lstat(path.join(this.root,file))).isSymbolicLink(),'PATH','拒绝数据文件链接');
this.marker=JSON.parse(await fs.readFile(path.join(this.root,'root.json'),'utf8'));fail(this.marker.producerApp===APP&&this.marker.schemaVersion===1,'SCHEMA','根身份/schema不符');
this.lock=path.join(this.root,'instance.lock');try{await protectedJSON(this.lock,{app:APP,rootId:this.marker.rootId,pid:process.pid,instanceId:id(),createdAt:new Date().toISOString()});this.lockOwned=true;}catch(e){if(e.code==='EEXIST')throw new AppError('LOCKED','同一数据根已有实例或残留锁；请核对运行状态',409);throw e;}
try{await this.load();await fs.mkdir(path.join(this.root,'exports'),{mode:0o700});}catch(e){if(e.code!=='EEXIST'){await this.close();throw e;}}
try{await this.totalBytes();for(const entry of await fs.readdir(path.join(this.root,'exports'))){if(!/^[a-f0-9-]{36}$/.test(entry))continue;try{const r=JSON.parse(await fs.readFile(path.join(this.root,'exports',entry,'operation.json'),'utf8'));this.exports.set(entry,r);}catch{}}}catch(e){await this.close();throw e;}
return this;
}
async load(){
try{const s=JSON.parse(await fs.readFile(path.join(this.root,'current.json'),'utf8'));fail(s.rootId===this.marker.rootId&&s.schemaName===SCHEMA&&s.schemaVersion===1,'SCHEMA','库身份/schema错误');for(const w of s.workspaces)validateWorkspace(w);this.state=s;}
catch(e){throw new AppError('DAMAGED','数据损坏或缺失：停止写入；可恢复上一副本到新根',503);}
}
async close(){if(this.lockOwned){await fs.unlink(this.lock);this.lockOwned=false;}}
async totalBytes(){
let bytes=0;const walk=async p=>{for(const n of await fs.readdir(p,{withFileTypes:true})){const q=path.join(p,n.name),s=await fs.lstat(q);fail(!s.isSymbolicLink(),'PATH','拒绝根内符号链接');if(s.isDirectory())await walk(q);else bytes+=s.size;}};await walk(this.root);return bytes;
}
queue(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}
workspace(wid){const w=this.state.workspaces.find(w=>w.id===wid&&!w.trashedAt);fail(w,'NOT_FOUND','稿件不存在或已移到回收站',404);return w;}
async trash(wid,base){
return this.queue(async()=>{await this.load();const w=this.workspace(wid);fail(w.revision===base,'CONFLICT','稿件已有更新，请刷新后再删除',409);
const next=clone(this.state),n=next.workspaces.find(w=>w.id===wid);n.trashedAt=new Date(this.now()).toISOString();n.revision++;next.revision++;await this.persist(next);
for(const key of this.approvals.keys())if(key.startsWith(wid+':'))this.approvals.delete(key);
return clone(n);});
}
async untrash(wid,base){
return this.queue(async()=>{await this.load();const w=this.state.workspaces.find(w=>w.id===wid&&w.trashedAt);fail(w,'NOT_FOUND','回收站中没有这篇稿件',404);fail(w.revision===base,'CONFLICT','稿件状态已有更新，请刷新后再恢复',409);
const next=clone(this.state),n=next.workspaces.find(w=>w.id===wid);delete n.trashedAt;n.revision++;next.revision++;await this.persist(next);return clone(n);});
}
async persist(next,{growth=false}={}){
const data=JSON.stringify(next,null,2),old=JSON.stringify(this.state,null,2);
fail(Buffer.byteLength(data)<=this.limits.payload*50,'CAPACITY','状态块超限',413);
const size=await this.totalBytes(),reserve=Buffer.byteLength(data)+Buffer.byteLength(old);
fail(size+reserve<=this.limits.hard&&( !growth||size+reserve<=this.limits.soft),'CAPACITY','容量不足（含历史、备份和在途预留）',413);
await this.hook('beforePersist');
const previous=path.join(this.root,'previous.json'),current=path.join(this.root,'current.json');
const backupTmp=previous+'.'+id()+'.tmp';await protectedJSON(backupTmp,this.state);
await this.hook('beforeBackupCommit');await fs.rename(backupTmp,previous);
const currentTmp=current+'.'+id()+'.tmp';await protectedJSON(currentTmp,next);await this.hook('beforeCurrentCommit');await fs.rename(currentTmp,current);
this.state=next;return next;
}
async create(title){
return this.queue(async()=>{fail(this.state.workspaces.length<this.limits.workspaces,'CAPACITY','档案数量上限',413);const w=emptyWorkspace(title);w.revision=1;const next=clone(this.state);next.revision++;next.workspaces.push(w);await this.persist(next,{growth:true});return clone(w);});
}
async copyWorkspaces(incoming,{sourceRootId=null}={}){
return this.queue(async()=>{await this.load();fail(Array.isArray(incoming),'SCHEMA','复制档案列表格式错误');fail(new Set(incoming.map(w=>w?.id)).size===incoming.length,'COPY_CONFLICT','输入中含重复档案ID',409);
const additions=[],skipped=[];for(const input of incoming){validateWorkspace(input);const old=this.state.workspaces.find(w=>w.id===input.id);if(old){fail(hash(old)===hash(input),'COPY_CONFLICT','同ID档案内容不同，拒绝覆盖：'+input.id,409);skipped.push(input.id);}else additions.push(clone(input));}
fail(this.state.workspaces.length+additions.length<=this.limits.workspaces,'CAPACITY','复制后超过档案数量上限',413);
if(additions.length){const next=clone(this.state);next.revision++;next.workspaces.push(...additions);await this.persist(next,{growth:true});}
return {copied:additions.length,skipped:skipped.length,sourceRootId,targetRootId:this.marker.rootId,ids:additions.map(w=>w.id),publicApprovals:'NOT_IMPORTED'};
});
}
async update(wid,base,changes){
fail(Buffer.byteLength(JSON.stringify(changes))<=this.limits.block,'BLOCK_TOO_LARGE','单次文字块超过40KiB，编辑保留；请分段保存',413);
return this.queue(async()=>{await this.load();const w=this.workspace(wid);fail(w.revision===base,'CONFLICT','内容已有更新，你的编辑仍保留',409);
const allowed=['title','topic','body','common','sources','facts','notes','checks','overrides','linkedContentId','selectedVersion'];
for(const k of Object.keys(changes))fail(allowed.includes(k),'FIELD','不允许写入字段');
const next=clone(this.state),n=next.workspaces.find(w=>w.id===wid);Object.assign(n,clone(changes));n.revision++;n.updatedAt=new Date(this.now()).toISOString();
validateWorkspace(n);next.revision++;await this.persist(next);return clone(n);});
}
async freeze(wid,base){
return this.queue(async()=>{await this.load();const w=this.workspace(wid);fail(w.revision===base,'CONFLICT','请先保存最新稿',409);fail(w.body.trim(),'EMPTY','空稿不能冻结');
const next=clone(this.state),n=next.workspaces.find(w=>w.id===wid),prior=n.versions.at(-1)?.paragraphs||[],used=new Set();
const paragraphs=n.body.split('\n').map(text=>{const old=prior.find(p=>p.text===text&&!used.has(p.id));const pid=old?.id||id();used.add(pid);return {id:pid,text};});
const v={id:id(),label:'v'+(n.versions.length+1),body:n.body,hash:hash(n.body),paragraphs,createdAt:new Date(this.now()).toISOString()};
n.versions.push(v);n.selectedVersion=v.id;n.revision++;next.revision++;await this.persist(next,{growth:true});return clone(n);});
}
async refresh(wid){return this.queue(async()=>{const w=this.workspace(wid);const snapshot=await readAuthority(w.authority.length?w.authority:this.authorityCache||[],this.authorityPaths,()=>new Date(this.now()).toISOString());const next=clone(this.state),n=next.workspaces.find(w=>w.id===wid);n.authority=snapshot;n.revision++;next.revision++;await this.persist(next);this.authorityCache=snapshot;return clone(n);});}
approve(wid,pid){const w=this.workspace(wid);fail(PLATFORMS.some(p=>p.id===pid),'PLATFORM','未知平台');const issues=privacyIssues(w,pid,this.now());fail(!issues.length,'PUBLIC_BLOCKED',issues.join('；'),409);this.denied.delete(wid);this.approvals.set(wid+':'+pid,dependency(w,pid));return {pid,dependency:dependency(w,pid),sessionOnly:true};}
valid(wid,pid,dep){const w=this.state.workspaces.find(w=>w.id===wid&&!w.trashedAt);return !!w&&!this.denied.has(wid)&&this.approvals.get(wid+':'+pid)===dep&&dependency(w,pid)===dep&&!privacyIssues(w,pid,this.now()).length;}
async revoke(wid,sid){
this.denied.add(wid);for(const key of this.approvals.keys())if(key.startsWith(wid+':'))this.approvals.delete(key);
const w=this.workspace(wid),sources=clone(w.sources),s=sources.find(s=>s.id===sid);fail(s,'NOT_FOUND','来源不存在');s.permission='REVOKED';s.version=(s.version||1)+1;return this.update(wid,w.revision,{sources});
}
async export(wid,base,{mode='DRAFT',platformIds=[]}={}){
fail(['DRAFT','FROZEN'].includes(mode),'MODE','导出类型错误');fail(platformIds.every(p=>PLATFORMS.some(x=>x.id===p)),'PLATFORM','未知平台');
return this.queue(async()=>{await this.load();const w=this.workspace(wid);fail(w.revision===base,'CONFLICT','请先保存最新编辑',409);
if(mode==='FROZEN'){fail(w.selectedVersion&&platformIds.length,'FREEZE_REQUIRED','冻结准备包须脚本冻版和选择平台');fail(w.versions.find(v=>v.id===w.selectedVersion)?.body===w.body,'STALE_SCRIPT','正文已变，请冻结新脚本',409);}
const snapshot=clone(w);snapshot.authority=await readAuthority(w.authority,this.authorityPaths,()=>new Date(this.now()).toISOString());
const exportId=id(),dir=path.join(this.root,'exports',exportId),deps={},publicFiles={},limitations=[];
for(const pid of platformIds){
const issues=privacyIssues(snapshot,pid,this.now()),dep=dependency(snapshot,pid);
if(issues.length||!this.valid(wid,pid,dep)){limitations.push({platform:pid,reasons:issues.length?issues:['本次启动尚未确认公开文字']});continue;}
deps[pid]=dep;const t=effective(snapshot,pid);
publicFiles['platforms/'+pid+'.md']='# '+t.title+'\n\n'+t.body+'\n\n'+t.hashtags+(pid==='youtube'?'\n\n后台标签计划：'+t.backendTags:'')+'\n';
}
const bundle=bundleFor(snapshot);const internalFiles={'工作档案.json':JSON.stringify(bundle,null,2),'准备包.md':'# '+snapshot.title+'\n\n类型：'+mode+'；离线准备，非发布回执。\n\n'+snapshot.body+'\n\n来源与备注见内部JSON。\n\n缺口：'+JSON.stringify(limitations)};
const bytes=Object.values({...publicFiles,...internalFiles}).reduce((a,s)=>a+Buffer.byteLength(s),0)*5+65536;
fail(await this.totalBytes()+bytes<=this.limits.soft,'CAPACITY','导出余量不足（含inflight）',413);
await fs.mkdir(dir,{mode:0o700});const record={exportId,workspaceId:wid,workspaceRevision:base,mode,status:'IN_PROGRESS',publicStatus:'IN_PROGRESS',deps,dir,createdAt:new Date(this.now()).toISOString(),limitations};
this.exports.set(exportId,record);await protectedJSON(path.join(dir,'operation.json'),record);
try{
const all={...internalFiles,...publicFiles};let i=0;for(const [name,text] of Object.entries(all)){await this.hook('exportFile',{index:++i,name,exportId});await fs.mkdir(path.dirname(path.join(dir,name)),{recursive:true,mode:0o700});const h=await fs.open(path.join(dir,name),'wx',0o600);try{await h.writeFile(text);await h.sync();}finally{await h.close();}}
for(const [name,text] of Object.entries(all))fail(hash(await fs.readFile(path.join(dir,name),'utf8'))===hash(text),'HASH','导出写入摘要错误');
await this.hook('beforePublicComplete',{exportId});
const publicValid=Object.entries(deps).every(([pid,dep])=>this.valid(wid,pid,dep));
record.publicStatus=Object.keys(publicFiles).length&&publicValid?'COMPLETED':Object.keys(publicFiles).length?'REVOKED':'INTERNAL_ONLY';
record.status='COMPLETED';
const fields=files=>Object.entries(files).map(([relativePath,text])=>({relativePath,sha256:hash(text),bytes:Buffer.byteLength(text)}));
const manifest={producerApp:APP,appVersion:APP_VERSION,schemaName:SCHEMA,schemaVersion:1,exportId,createdAt:record.createdAt,sourceRevisionRefs:{workspaceId:wid,workspaceRevision:base,scriptRevision:snapshot.selectedVersion,configVersion:CONFIG_VERSION,authority:snapshot.authority},files:fields(all),verificationCoverage:['text-snapshot','byte-hashes'],limitations,privacyMode:'INTERNAL',status:'COMPLETED'};
await protectedJSON(path.join(dir,'manifest.json'),manifest);
const pubManifest={...manifest,sourceRevisionRefs:{workspaceRevision:base,scriptRevision:snapshot.selectedVersion,configVersion:CONFIG_VERSION},files:fields(publicFiles),limitations:limitations.map(x=>({platform:x.platform,reasons:['未进入公开包']})),privacyMode:'PUBLIC',status:record.publicStatus};
await protectedJSON(path.join(dir,'public-manifest.json'),pubManifest);
record.manifest=manifest;record.publicManifest=pubManifest;await fs.writeFile(path.join(dir,'operation.json'),JSON.stringify(record,null,2),{mode:0o600});return this.exportSummary(record);
}catch(e){record.status='FAILED';record.publicStatus='FAILED';record.error=e.code||'WRITE_FAILED';await fs.writeFile(path.join(dir,'operation.json'),JSON.stringify(record,null,2),{mode:0o600}).catch(()=>{});throw new AppError('EXPORT_FAILED','导出未完整，现场保留：'+exportId,503);}
});
}
exportSummary(r){const status=r.publicStatus==='COMPLETED'&&!Object.entries(r.deps||{}).every(([pid,dep])=>this.valid(r.workspaceId,pid,dep))?'RECONFIRM_REQUIRED':r.publicStatus;return {exportId:r.exportId,workspaceId:r.workspaceId,workspaceRevision:r.workspaceRevision,mode:r.mode,status:r.status,publicStatus:status,limitations:r.limitations};}
listExports(){return [...this.exports.values()].map(r=>this.exportSummary(r));}
async getExport(eid,publicOnly=false){
let r=this.exports.get(eid);
fail(/^[a-f0-9-]{36}$/.test(eid),'PATH','导出ID不合法');
const dir=path.join(this.root,'exports',eid);let dirReal;try{dirReal=await fs.realpath(dir);}catch{throw new AppError('NOT_FOUND','导出不存在',404);}const rootReal=await fs.realpath(this.root);fail(dirReal.startsWith(rootReal+path.sep),'PATH','导出目录越界');
const safeRead=async name=>{fail(!path.isAbsolute(name)&&!name.split('/').includes('..'),'PATH','包内路径越界');const fp=path.join(dir,name);fail(!(await fs.lstat(fp)).isSymbolicLink(),'PATH','包文件链接拒绝');const real=await fs.realpath(fp);fail(real.startsWith(dirReal+path.sep),'PATH','包文件路径越界');return fs.readFile(fp,'utf8');};
if(!r){try{r=JSON.parse(await safeRead('operation.json'));}catch(e){if(e instanceof AppError)throw e;throw new AppError('NOT_FOUND','导出不存在',404);}}
fail(r.status==='COMPLETED','INCOMPLETE','半包不能下载或恢复',409);
if(publicOnly)fail(r.publicStatus==='COMPLETED'&&Object.entries(r.deps).every(([pid,dep])=>this.valid(r.workspaceId,pid,dep)),'PUBLIC_REVOKED','公开许可/核准已失效；内部现场保留',403);
const manifest=JSON.parse(await safeRead(publicOnly?'public-manifest.json':'manifest.json')),files={};
for(const f of manifest.files){fail(!path.isAbsolute(f.relativePath)&&!f.relativePath.split('/').includes('..'),'PATH','包内路径越界');
const text=await safeRead(f.relativePath);fail(hash(text)===f.sha256&&Buffer.byteLength(text)===f.bytes,'HASH','包文件摘要不符');files[f.relativePath]=text;}
return {manifest,files};
}
async restorePackage(pkg,newRoot){
fail(pkg.manifest?.producerApp===APP&&pkg.manifest.schemaName===SCHEMA&&pkg.manifest.schemaVersion===1&&pkg.manifest.status==='COMPLETED'&&pkg.manifest.privacyMode==='INTERNAL','SCHEMA','仅内部完整包可恢复');
for(const f of pkg.manifest.files){fail(pkg.files?.[f.relativePath]!=null&&hash(pkg.files[f.relativePath])===f.sha256&&Buffer.byteLength(pkg.files[f.relativePath])===f.bytes,'HASH','恢复包摘要不符');}
const w=restoreWorkspace(JSON.parse(pkg.files['工作档案.json']));const target=path.resolve(newRoot);
fail(path.dirname(target)===path.join(path.dirname(this.root),'restored')&&!await exists(target),'PATH','恢复只允许工具隔离新根，不合并当前根');
fail(!(await fs.lstat(path.dirname(target))).isSymbolicLink(),'PATH','恢复父目录链接拒绝');
const s=new Store(target);await s.init([w]);
const launcher=path.join(target,'启动隔离副本.command'),base=path.dirname(path.dirname(new URL(import.meta.url).pathname));
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const command='#!/bin/zsh\nset -e\ncd '+quote(decodeURIComponent(base))+'\nexec '+quote(process.execPath)+' '+quote('src/launch.mjs')+' '+quote(target)+'\n';await fs.writeFile(launcher,command,{mode:0o700});
return {root:target,launcher,workspaceId:w.id,originalId:pkg.manifest.sourceRevisionRefs.workspaceId,publicApprovals:'HISTORICAL_ONLY'};
}
}
