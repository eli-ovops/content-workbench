export async function continueAfterSave({isDirty,confirmSave,save,proceed}){
if(isDirty()){if(!await confirmSave())return false;await save();if(isDirty())throw new Error('保存期间有新输入，编辑仍保留，请再保存后继续。');}
await proceed();return true;
}
export function nextDraftTitle(workspaces){const used=new Set(workspaces.map(w=>w.title));let title='未命名稿件',i=2;while(used.has(title))title='未命名稿件 '+i++;return title;}
function lastActivity(w){return Math.max(0,...[w.updatedAt,w.createdAt,w.versions?.at(-1)?.createdAt].map(s=>Number.isFinite(Date.parse(s))?Date.parse(s):0));}
export const sortWorkspaces=workspaces=>[...workspaces].sort((a,b)=>lastActivity(b)-lastActivity(a));
export function draftMeta(w,now=Date.now()){
const version=w.versions?.find(v=>v.id===w.selectedVersion)?.label||'草稿',when=lastActivity(w);if(!when)return version;
const day=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}),clock=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
const date=day.format(when),label=date===day.format(now)?'今天':date===day.format(now-86400000)?'昨天':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',...(new Date(when).getUTCFullYear()!==new Date(now).getUTCFullYear()?{year:'numeric'}:{})}).format(when);
return version+' · '+label+' '+clock.format(when);
}
// Exported view rules are also exercised in Node without creating a browser.
if(typeof document!=='undefined'){
const $=id=>document.getElementById(id);
const isPreview=new URLSearchParams(location.search).get('preview')==='1';
let previewData=null;
if(isPreview){previewData=(await import('/preview-data.js')).previewState();document.body.classList.add('is-preview');$('preview-banner').hidden=false;document.querySelector('.brand').href='/?preview=1';document.querySelector('.sheet-bottom>span').textContent='预览输入仅在此页面';document.querySelector('.document-meta span:last-child').textContent='虚构示例';document.querySelector('.local-indicator').textContent='界面预览';}
const localTime=s=>s?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s)):'';
function updateWritingMeta(){text($('word-count'),Array.from($('body').value).filter(x=>!/\s/.test(x)).length+' 字');text($('document-name'),$('title').value||'未命名稿件');}
function updateIndicator(){const b=document.querySelector('[data-tab][aria-selected=true]');if(!b)return;const line=$('tab-indicator');line.style.width=b.offsetWidth+'px';line.style.transform='translateX('+b.offsetLeft+'px)';}
function setSaved(w){const e=$('save-state');e.className='is-saved';e.textContent=isPreview?'界面预览':'已保存'+(localTime(w.updatedAt||w.createdAt)?' · '+localTime(w.updatedAt||w.createdAt):'');e.title=isPreview?'预览不读取或保存实际数据':'本地 revision '+w.revision;}
let serverState,current,draft,activePid='xiaohongshu',dirty=false,epoch=0,busy=false,sessionReady=false,restoredPackage,lastTrashed;
const fields=['title','body','hashtags','backendTags'];
function initializePlatforms(state){if($('platform').options.length)return;for(const p of state.platforms){$('platform').append(el('option',{value:p.id},p.name));const o=el('option',{value:p.id},p.name);o.selected=['xiaohongshu','youtube'].includes(p.id);$('export-platforms').append(o);const check=el('input',{type:'checkbox',value:p.id});check.checked=o.selected;check.addEventListener('change',()=>{o.selected=check.checked;});const label=el('label',{},'');label.append(check,document.createTextNode(p.name));$('platform-choices').append(label);}}

const text=(el,value)=>{el.textContent=value;};
const copy=o=>structuredClone(o);
function updateSessionControls(){for(const id of ['new','empty-new','open-trash','trash-current','undo-trash','save','freeze','approve','export-draft','export-frozen','refresh','restore-button','logout'])$(id).disabled=isPreview||!sessionReady||busy||(['save','trash-current'].includes(id)&&!current);for(const b of $('trash-list').querySelectorAll('button'))b.disabled=isPreview||!sessionReady||busy;$('rescue').disabled=!current;}
updateSessionControls();
function message(s,error=false){$('message').hidden=false;$('undo-trash').hidden=true;text($('message-text'),s);$('message').className=error?'error':'';}
async function api(url,data){if(isPreview){if(url==='state'&&!data)return copy(previewData);throw new Error('这是界面预览，不读取或写入已保存数据。');}const r=await fetch('/api/'+url,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const o=await r.json();if(!r.ok){if(r.status===401){sessionReady=false;updateSessionControls();$('login').hidden=false;text($('save-state'),'需建立会话');if(!current)text($('document-name'),'工作空间未连接');throw new Error(o.message);}throw new Error(o.message+' ['+r.status+'/'+o.error+']');}if(url==='state'){sessionReady=true;initializePlatforms(o);updateSessionControls();}return o;}
async function checkSession(){
 serverState=await api('state');$('login').hidden=true;
 if(current&&dirty){text($('save-state'),'已连接 · 编辑未保存');message('已连接。页面编辑保留，可继续保存。');}
 else{await reload(current?.id);message('已连接，稿件可以保存。');}
}
$('request-pair').addEventListener('click',()=>run(checkSession));
window.addEventListener('focus',async()=>{if(!sessionReady&&!isPreview){try{await checkSession();}catch{}}});
function dirtyMark(){dirty=true;epoch++;text($('save-state'),isPreview?'仅在此预览页':'未保存');$('save-state').className='is-dirty';updateWritingMeta();}
function askToSave(action){const dialog=$('save-before-action');text($('pending-action'),'保存当前修改后，再'+action+'。');dialog.returnValue='cancel';return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='save'),{once:true});dialog.showModal();});}
const withSavedEditor=(action,proceed)=>continueAfterSave({isDirty:()=>dirty,confirmSave:()=>askToSave(action),save,proceed});
function el(tag,attributes={},value){const e=document.createElement(tag);for(const [k,v] of Object.entries(attributes)){if(k==='class')e.className=v;else e.setAttribute(k,v);}if(value!==undefined)e.textContent=value;return e;}
function labelled(label,node){const l=el('label',{},label);l.append(node);return l;}
function input(value,attrs={}){const e=el('input',attrs);e.value=value||'';return e;}
function select(values,value,attrs={}){const e=el('select',attrs);for(const [v,t] of values){const o=el('option',{value:v},t);e.append(o);}e.value=value;return e;}
function getSources(){return [...$('sources').querySelectorAll('.source-row')].map(row=>{const old=draft.sources.find(s=>s.id===row.dataset.id)||{};const s={...old,id:row.dataset.id};for(const k of ['title','reference','date','scope','text','privacy','permission','expiresAt'])s[k]=row.querySelector('[data-key="'+k+'"]').value;if(JSON.stringify({...old,version:undefined})!==JSON.stringify({...s,version:undefined}))s.version=(old.version||0)+1;return s;});}
function renderSources(){
$('sources').replaceChildren();
for(const s of draft.sources){
const row=el('details',{class:'source-row'});row.dataset.id=s.id;const summary=el('summary',{},s.title||'未命名来源');summary.append(el('small',{},s.permission==='ALLOWED'?'有许可':s.permission==='REVOKED'?'已撤销':'待核'));row.append(summary);
for(const [key,label] of [['title','资料名称'],['reference','链接或路径（只作记录）'],['date','资料日期'],['scope','已读取范围'],['text','说明与待核条件'],['expiresAt','许可到期时间']])row.append(labelled(label,input(s[key],{'data-key':key})));
const g=el('div',{class:'field-grid'});g.append(labelled('隐私属性',select([['UNKNOWN','待核'],['PUBLIC','公开'],['PRIVATE','私密']],s.privacy,{'data-key':'privacy'})),labelled('使用许可',select([['UNKNOWN','待核'],['ALLOWED','允许此用途'],['REVOKED','已撤销']],s.permission,{'data-key':'permission'})));
const b=el('button',{type:'button',class:'secondary'},'撤销公开许可');b.addEventListener('click',()=>run(async()=>{if(dirty)throw new Error('先保存当前编辑，再撤销；页面文字可下载');current=await api('revoke',{id:current.id,sourceId:s.id});await reload(current.id);message('许可已撤销，旧公开包不再提供新下载。');}));g.append(b);row.append(g);$('sources').append(row);
}
}
function collectPlatform(){
if(!draft)return;const old=draft.overrides[activePid]||{},o={...old};
for(const k of fields){const v=$('override-'+k)?.value;if(v===undefined)continue;if(v==='')delete o[k];else o[k]=v;}
o.publicBasis=$('public-basis').value;o.sourceIds=$('public-source').value?[$('public-source').value]:[];o.languageConfirmed=$('language-confirmed').checked;o.scriptVersion=draft.selectedVersion;
draft.overrides[activePid]=o;
}
function renderPlatform(){
const p=serverState.platforms.find(p=>p.id===activePid),o=draft.overrides[activePid]||{};
text($('platform-language'),(p.language==='zh-Hant'?'繁体中文，需人工核对。':'简体中文。')+'未填写的差异沿用通用文案。');text($('preview-platform'),p.name);$('copy-backendTags').hidden=activePid!=='youtube';
$('overrides').replaceChildren();for(const [k,label] of [['title','标题差异'],['body','正文差异'],['hashtags','话题差异'],['backendTags','后台标签差异']]){
const e=k==='body'?el('textarea',{id:'override-'+k,rows:'4'}):input('',{id:'override-'+k});e.value=o[k]||'';e.placeholder='与通用文案相同时留空';$('overrides').append(labelled(label,e));
}
$('public-basis').value=o.publicBasis||'UNKNOWN';$('language-confirmed').checked=!!o.languageConfirmed;
$('public-source').replaceChildren(el('option',{value:''},'无关联'));for(const s of draft.sources)$('public-source').append(el('option',{value:s.id},s.title));$('public-source').value=o.sourceIds?.[0]||'';
renderPreview();text($('approval-state'),serverState.publicConfirmations.includes(current.id+':'+activePid)?'已确认。稿件或依据变动后需重新核对。':'保存并核对预览后，再确认本站文字。');
}
function platformText(){collectPlatform();const o=draft.overrides[activePid]||{};return Object.fromEntries(fields.map(k=>[k,o[k]===undefined?$('common-'+k).value:o[k]]));}
function renderPreview(){const t=platformText();text($('public-preview'),t.title+'\n\n'+t.body+'\n\n'+t.hashtags+(activePid==='youtube'?'\n\n后台标签计划：'+t.backendTags:''));}
function gather(){
collectPlatform();draft.title=$('title').value;draft.topic=$('topic').value;draft.body=$('body').value;draft.linkedContentId=$('content-id').value;
for(const k of fields)draft.common[k]=$('common-'+k).value;
draft.sources=getSources();
for(const [key,element] of [['facts','facts'],['notes','notes'],['checks','checks']])draft[key]=$(element).value.split('\n').filter(s=>s.trim()).map((value,i)=>{const old=draft[key][i],version=old?.text===value?old.scriptVersion||draft.selectedVersion:draft.selectedVersion;const v=draft.versions.find(v=>v.id===version),index=Number(value.match(/^\[段落(\d+)\]/)?.[1]||1)-1;return {...old,id:old?.id||crypto.randomUUID(),text:value,sourceIds:old?.sourceIds||[],scriptVersion:version,paragraphId:key==='notes'?(old?.text===value&&old.paragraphId?old.paragraphId:v?.paragraphs[index]?.id||null):undefined,status:key==='facts'?'UNVERIFIED':undefined};});
return copy(draft);
}
function renderVersions(){
$('version-select').replaceChildren(el('option',{value:''},draft.versions.length?'未选择版本':'还没有留存版本'));for(const v of draft.versions)$('version-select').append(el('option',{value:v.id},v.label+' · '+localTime(v.createdAt)));
$('version-select').value=draft.selectedVersion||'';
$('version-preview').replaceChildren();const index=draft.versions.findIndex(v=>v.id===draft.selectedVersion);const selected=draft.versions[index];
for(const [v,label] of [[selected,'所选版本'],[draft.versions[index-1],'上一版']]){if(!v)continue;const box=el('div');box.append(el('h3',{},label+' · '+v.label),el('pre',{},v.body));$('version-preview').append(box);}
$('copy-version').disabled=!selected;text($('version-status'),selected?.label||'草稿');
if(draft.versions.length&&!selected)$('version-preview').append(el('p',{class:'version-empty'},'选择一个留存版本，再查看或以它继续修改。'));
if(selected&&index===0)$('version-preview').append(el('p',{class:'version-empty'},'这是首个留存版本，没有更早的稿件可供对照。'));
if(!draft.versions.length)$('version-preview').append(el('p',{class:'muted'},'先保存稿件，再留存一个版本。每次修改都有可回看的原稿。'));
const stale=[...draft.notes,...draft.checks].filter(x=>!x.scriptVersion||x.scriptVersion!==draft.selectedVersion).length;
text($('dependency-note'),stale?'有 '+stale+' 项备注尚未关联当前版本，使用前请重新核对。':'参考记录不代替实际全片审看。');
}
function rememberWorkspace(w){try{localStorage.setItem('cw-draft:'+serverState.rootId,w.id);}catch{}const url=new URL(location.href);url.searchParams.set('draft',w.id);history.replaceState(null,'',url.pathname+url.search);}
function preferredWorkspace(){const fromUrl=new URLSearchParams(location.search).get('draft');if(fromUrl)return fromUrl;try{return localStorage.getItem('cw-draft:'+serverState.rootId);}catch{return null;}}
function revealActiveDraft(){const nav=$('workspaces'),active=nav.querySelector('button.active');if(!active||active.hidden)return;const box=active.getBoundingClientRect(),view=nav.getBoundingClientRect();if(nav.scrollWidth>nav.clientWidth){if(box.left<view.left)nav.scrollLeft+=box.left-view.left;else if(box.right>view.right)nav.scrollLeft+=box.right-view.right;}if(nav.scrollHeight>nav.clientHeight){if(box.top<view.top)nav.scrollTop+=box.top-view.top;else if(box.bottom>view.bottom)nav.scrollTop+=box.bottom-view.bottom;}}
function showWorkspace(w){
rememberWorkspace(w);
$('trash-panel').hidden=true;$('workspace-welcome').hidden=true;$('open-trash').setAttribute('aria-expanded','false');$('save').hidden=false;$('rescue').hidden=false;
$('message').hidden=true;
current=copy(w);draft=copy(w);dirty=false;epoch=0;updateSessionControls();
$('editor').hidden=false;$('login').hidden=true;
for(const [k,key] of [['title','title'],['topic','topic'],['body','body'],['content-id','linkedContentId']])$(k).value=w[key]||'';
for(const k of fields)$('common-'+k).value=w.common[k];
$('inherit-script').checked=w.common.body===w.body;$('common-body').readOnly=$('inherit-script').checked;
$('facts').value=w.facts.map(x=>x.text).join('\n');$('notes').value=w.notes.map(x=>x.text).join('\n');$('checks').value=w.checks.map(x=>x.text).join('\n');
renderSources();renderVersions();renderPlatform();renderExports();setSaved(w);updateWritingMeta();text($('version-status'),w.versions.find(v=>v.id===w.selectedVersion)?.label||'草稿');for(const b of $('workspaces').children){b.classList.toggle('active',b.dataset.id===w.id);b.setAttribute('aria-current',b.dataset.id===w.id?'page':'false');}updateIndicator();
revealActiveDraft();text($('authority'),JSON.stringify(w.authority.length?w.authority:serverState.startupAuthority,null,2));
}
function renderExports(){
$('exports').replaceChildren();for(const r of serverState.exports.filter(r=>r.workspaceId===current.id).reverse()){
const row=el('div',{class:'export-row'});const publicState={COMPLETED:'公开文字可下载',RECONFIRM_REQUIRED:'公开文字需重新确认',INTERNAL_ONLY:'仅内部资料',REVOKED:'公开许可已撤销',FAILED:'未完整生成'};row.append(el('p',{},(r.mode==='FROZEN'?'冻结准备包':'内部草稿包')+' · '+(r.status==='COMPLETED'?'已生成':'未完整生成')+' · '+(publicState[r.publicStatus]||'公开状态待核')));row.title=r.exportId;
for(const [label,mode] of [['下载内部恢复包','internal'],['下载公开文字包','public']]){const b=el('button',{class:'secondary'},label);b.addEventListener('click',()=>run(async()=>{const pkg=await api('export/'+r.exportId+'/'+mode);download(JSON.stringify(pkg,null,2),'内容准备包-'+mode+'-'+r.exportId+'.json');message('已在浏览器生成下载；'+mode+' 包需另核收到文件。');}));row.append(b);}
$('exports').append(row);
}
}
function filterWorkspaces(){const q=$('workspace-search').value.trim().toLocaleLowerCase();let visible=0;for(const b of $('workspaces').children){b.hidden=!b.textContent.toLocaleLowerCase().includes(q);if(!b.hidden)visible++;}text($('workspace-count'),q?visible+' / '+serverState.state.workspaces.length:String(serverState.state.workspaces.length));$('workspace-empty').hidden=visible>0;$('clear-search').hidden=!(q&&visible===0);text($('workspace-empty'),q?'没有找到这篇稿件，换个词试试。':'还没有稿件，点击“新建稿件”开始写。');}
$('workspace-search').addEventListener('input',filterWorkspaces);
$('clear-search').addEventListener('click',()=>{$('workspace-search').value='';filterWorkspaces();$('workspace-search').focus();});
$('dismiss-message').addEventListener('click',()=>{$('message').hidden=true;});
function setFocusWriting(on){document.body.classList.toggle('writing-focus',on);$('focus-writing').setAttribute('aria-pressed',String(on));text($('focus-writing').querySelector('span'),on?'退出专注':'专注写稿');updateIndicator();if(on)$('body').focus();}
$('focus-writing').addEventListener('click',()=>setFocusWriting(!document.body.classList.contains('writing-focus')));
for(const key of fields)$('copy-'+key).addEventListener('click',()=>run(async()=>{const value=platformText()[key];if(!value.trim())throw new Error('这一栏还没有文字，填写后再复制。');try{await navigator.clipboard.writeText(value);}catch{throw new Error('浏览器未允许复制。请在文字预览中选中并复制所需内容。');}message(({title:'标题',body:'正文',hashtags:'话题',backendTags:'后台标签'})[key]+'已复制。');}));
async function reload(id,{keepEditing=false}={}){
const readEpoch=epoch;
serverState=await api('state');$('workspaces').replaceChildren();for(const w of sortWorkspaces(serverState.state.workspaces)){const b=el('button',{class:w.id===id?'active':''},w.title.trim()||'未命名稿件');b.dataset.id=w.id;b.append(el('small',{},draftMeta(w)));b.addEventListener('click',()=>{if(current?.id===w.id&&!$('editor').hidden)return;run(()=>withSavedEditor('打开这篇稿件',()=>reload(w.id,{keepEditing:true})));});$('workspaces').append(b);}
filterWorkspaces();
renderTrash();
if(current&&dirty&&(keepEditing||epoch!==readEpoch)){for(const b of $('workspaces').children){b.classList.toggle('active',b.dataset.id===current.id);b.setAttribute('aria-current',b.dataset.id===current.id?'page':'false');}text($('save-state'),'新输入未保存');message('当前编辑仍保留，请保存后再继续。');return false;}
const selected=serverState.state.workspaces.find(w=>w.id===(id||preferredWorkspace()));if(selected)showWorkspace(selected);else if(serverState.state.workspaces.length)showWorkspace(sortWorkspaces(serverState.state.workspaces)[0]);else{current=null;draft=null;dirty=false;epoch=0;$('editor').hidden=true;$('login').hidden=true;$('trash-panel').hidden=true;$('workspace-welcome').hidden=false;$('open-trash').setAttribute('aria-expanded','false');$('save').hidden=true;$('rescue').hidden=true;text($('document-name'),'创建第一篇稿件');text($('save-state'),'已连接');try{localStorage.removeItem('cw-draft:'+serverState.rootId);}catch{}const url=new URL(location.href);url.searchParams.delete('draft');history.replaceState(null,'',url.pathname+url.search);updateSessionControls();}
text($('runtime'),JSON.stringify({app:serverState.app,root:serverState.root,rootId:serverState.rootId,configVersion:serverState.configVersion,platformSource:serverState.platformSource,publicConfirmation:serverState.bootNote},null,2));
return true;
}
function renderTrash(){
const items=serverState.trashedWorkspaces||[];text($('trash-count'),String(items.length));$('trash-list').replaceChildren();$('trash-empty').hidden=items.length>0;
for(const w of [...items].sort((a,b)=>b.trashedAt.localeCompare(a.trashedAt))){const row=el('div',{class:'trash-row'}),info=el('div');info.append(el('h2',{},w.title||'未命名稿件'),el('p',{},w.versions.length+' 个留存版本 · '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(w.trashedAt))+' 移入'));const restore=el('button',{class:'secondary','aria-label':'恢复稿件：'+(w.title||'未命名稿件')},'恢复稿件');restore.addEventListener('click',()=>run(async()=>{const restored=await api('untrash',{id:w.id,base:w.revision});await reload(restored.id);message('稿件已恢复，历史版本保留。');}));row.append(info,restore);$('trash-list').append(row);}
}
async function save(){
if(!current)return;const data=gather(),startEpoch=epoch;let w=current;
for(const k of ['title','topic','body','common','sources','facts','notes','checks','overrides','linkedContentId','selectedVersion']){
if(JSON.stringify(data[k])===JSON.stringify(w[k]))continue;
w=await api('save',{id:w.id,base:w.revision,changes:{[k]:data[k]}});current=copy(w);
}
if(epoch===startEpoch){if(await reload(w.id))message('稿件已保存。');}else{dirty=true;text($('save-state'),'新编辑未保存');}
}
function download(s,name){const url=URL.createObjectURL(new Blob([s],{type:'application/json;charset=utf-8'}));const a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
async function run(fn){if(busy)return;busy=true;updateSessionControls();if(fn===save)$('save').textContent='保存中…';try{await fn();}catch(e){message(e.message,true);if(current)text($('save-state'),dirty?'未保存 · 编辑保留':'操作未完成 · 原稿保留');}finally{busy=false;updateSessionControls();$('save').textContent='保存';}}
$('editor').addEventListener('input',e=>{if(e.target.id==='platform'||e.target.id==='export-platforms'||e.target.id==='workspace-search'||e.target.closest('#platform-choices'))return;dirtyMark();if(e.target.id==='body'&&$('inherit-script').checked)$('common-body').value=e.target.value;if(e.target.closest('#platforms'))renderPreview();});
$('editor').addEventListener('change',e=>{if(e.target.id!=='platform'&&e.target.id!=='export-platforms'&&!e.target.closest('#platform-choices'))dirtyMark();});
$('inherit-script').addEventListener('change',()=>{$('common-body').readOnly=$('inherit-script').checked;if($('inherit-script').checked)$('common-body').value=$('body').value;renderPreview();});
$('platform').addEventListener('change',e=>{collectPlatform();activePid=e.target.value;renderPlatform();});
$('version-select').addEventListener('change',e=>{draft.selectedVersion=e.target.value||null;renderVersions();dirtyMark();});
$('copy-version').addEventListener('click',()=>{const v=draft.versions.find(v=>v.id===draft.selectedVersion);if(v){$('body').value=v.body;if($('inherit-script').checked)$('common-body').value=v.body;dirtyMark();}});
$('save').addEventListener('click',()=>run(save));
$('new').addEventListener('click',()=>run(()=>withSavedEditor('新建稿件',async()=>{const title=nextDraftTitle([...serverState.state.workspaces,...(serverState.trashedWorkspaces||[])]),w=await api('create',{title});$('workspace-search').value='';if(await reload(w.id,{keepEditing:true})){activateTab($('tab-writing'));$('title').focus();$('title').select();}})));
$('empty-new').addEventListener('click',()=>$('new').click());
$('trash-current').addEventListener('click',()=>run(async()=>{if(dirty)throw new Error('请先保存当前编辑，再移到回收站。');lastTrashed=await api('trash',{id:current.id,base:current.revision});await reload();message('稿件已移到回收站，正文和历史版本保留。');$('undo-trash').hidden=false;(current?$('title'):$('empty-new')).focus();}));
$('undo-trash').addEventListener('click',()=>run(async()=>{if(dirty)throw new Error('先保存当前编辑，再恢复稿件。');if(!lastTrashed)return;const w=await api('untrash',{id:lastTrashed.id,base:lastTrashed.revision});await reload(w.id);lastTrashed=null;message('稿件已恢复，历史版本保留。');}));
$('open-trash').addEventListener('click',()=>run(()=>withSavedEditor('打开回收站',async()=>{if(!await reload(current?.id,{keepEditing:true}))return;$('editor').hidden=true;$('workspace-welcome').hidden=true;$('trash-panel').hidden=false;$('open-trash').setAttribute('aria-expanded','true');$('save').hidden=true;$('rescue').hidden=true;text($('document-name'),'回收站');text($('save-state'),'已连接');$('message').hidden=true;})));
$('back-to-writing').addEventListener('click',()=>run(()=>reload(current?.id)));
$('freeze').addEventListener('click',()=>run(async()=>{if(dirty)throw new Error('请先保存当前编辑，再冻结');const w=await api('freeze',{id:current.id,base:current.revision});await reload(w.id);message('新版本已留存，旧稿仍可查看。');}));
$('add-source').addEventListener('click',()=>{draft.sources=getSources();draft.sources.push({id:crypto.randomUUID(),title:'新来源',reference:'',date:'',scope:'',text:'',privacy:'UNKNOWN',permission:'UNKNOWN',expiresAt:'',version:1});renderSources();$('sources').lastElementChild.open=true;dirtyMark();});
$('approve').addEventListener('click',()=>run(async()=>{if(dirty)throw new Error('先保存当前文字与语言/许可选择，再确认公开');await api('approve',{id:current.id,platformId:activePid});serverState=await api('state');renderPlatform();message('本站公开文字已确认，仅本次启动与此版本有效；仍由本人决定发布。');}));
for(const [element,mode] of [['export-draft','DRAFT'],['export-frozen','FROZEN']])$(element).addEventListener('click',()=>run(async()=>{if(dirty)throw new Error('先保存当前编辑；草稿包也不能跳过保存');const selected=[...$('export-platforms').selectedOptions].map(x=>x.value);await api('export',{id:current.id,base:current.revision,mode,platformIds:selected});serverState=await api('state');renderExports();message('包已完整生成。未确认语言或公开许可的站点只保留内部文字。');}));
$('refresh').addEventListener('click',()=>run(async()=>{if(dirty)throw new Error('先保存再刷新来源');const w=await api('refresh',{id:current.id});await reload(w.id);message('已更新只读来源；原关联未改变。');}));
$('rescue').addEventListener('click',()=>{const w=current?gather():{};download(JSON.stringify({kind:'UNSAVED_EDITOR_RECOVERY',workspace:w},null,2),'当前编辑-仅内部.json');message('已从页面缓冲区下载当前编辑，无需服务器读取。');});
$('restore-button').addEventListener('click',()=>run(async()=>{const file=$('restore-file').files[0];if(!file)throw new Error('选择本工具完整内部包');if(file.size>1024*1024)throw new Error('恢复载荷超过1MiB');const pkg=JSON.parse(await file.text()),r=await api('restore',{package:pkg});$('restore-result').hidden=false;text($('restore-result'),JSON.stringify(r,null,2)+'\n副本已创建。双击副本目录里的“启动隔离副本.command”打开；旧许可不自动生效。');}));
$('logout').addEventListener('click',()=>run(async()=>{await api('logout',{});sessionReady=false;updateSessionControls();$('login').hidden=false;text($('save-state'),'已退出会话');message('已退出。当前编辑仍可下载；使用启动入口重新打开。');}));
const tabs=[...document.querySelectorAll('[data-tab]')];
function activateTab(b){if(!$('message').classList.contains('error'))$('message').hidden=true;if(b.dataset.tab!=='writing'&&document.body.classList.contains('writing-focus'))setFocusWriting(false);for(const t of document.querySelectorAll('.tab')){t.hidden=t.id!==b.dataset.tab;t.classList.remove('is-entering');}for(const k of tabs){k.setAttribute('aria-selected',String(k===b));k.tabIndex=k===b?0:-1;}$(b.dataset.tab).classList.add('is-entering');updateIndicator();}
for(const b of tabs){b.addEventListener('click',()=>activateTab(b));b.addEventListener('keydown',e=>{const i=tabs.indexOf(b);const next={ArrowRight:(i+1)%tabs.length,ArrowLeft:(i+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[e.key];if(next===undefined)return;e.preventDefault();tabs[next].focus();activateTab(tabs[next]);});}
window.addEventListener('resize',()=>{updateIndicator();revealActiveDraft();});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('writing-focus')){setFocusWriting(false);$('focus-writing').focus();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(!isPreview)run(save);}});
document.querySelector('[data-tab=writing]').setAttribute('aria-selected','true');
window.addEventListener('beforeunload',e=>{if(dirty&&!isPreview){e.preventDefault();e.returnValue='';}});
(async()=>{try{serverState=await api('state');initializePlatforms(serverState);await reload();if(isPreview){$('request-pair').disabled=true;for(const id of ['new','save','freeze','approve','export-draft','export-frozen','refresh','restore-button','logout'])$(id).disabled=true;}requestAnimationFrame(updateIndicator);}catch(e){$('login').hidden=false;message(e.message,true);}})();
}
