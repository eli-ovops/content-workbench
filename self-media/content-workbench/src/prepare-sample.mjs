import {DEFAULT_ROOT} from './default-workspace.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {Store} from './store.mjs';import {demoWorkspace} from './fixture.mjs';
const BASE=path.dirname(path.dirname(fileURLToPath(import.meta.url))),root=DEFAULT_ROOT,store=await new Store(root).open();
try{const existing=store.state.workspaces.find(w=>w.title==='虚构样例｜已冻版双平台准备包');if(existing)throw new Error('样例已存在，不能重复创建');
let w=await store.create('虚构样例｜已冻版双平台准备包'),demo=demoWorkspace();
w=await store.update(w.id,w.revision,{body:demo.body,topic:demo.topic,common:demo.common,sources:demo.sources,facts:demo.facts,notes:demo.notes});
w=await store.freeze(w.id,w.revision);const notes=w.notes.map(n=>({...n,scriptVersion:w.selectedVersion,paragraphId:w.versions[0].paragraphs[0].id}));
const overrides={xiaohongshu:{title:'示例：三段周报整理成表',publicBasis:'OWN',sourceIds:[],languageConfirmed:true,scriptVersion:w.selectedVersion},
youtube:{title:'示例：三段週報整理成表',body:'這是虛構示例，沒有實際工具效果或客戶資料。\n問題：三段示例週報分散。\n材料：本人撰寫的合成文字。\n操作：按事項、負責人、下一步列三欄。\n交付：一張示例表格。\n檢查：逐項對照，不把未知當完成。',backendTags:'AI, 工作方法, 示例週報',publicBasis:'OWN',sourceIds:[],languageConfirmed:true,scriptVersion:w.selectedVersion}};
w=await store.update(w.id,w.revision,{notes,overrides});store.approve(w.id,'xiaohongshu');store.approve(w.id,'youtube');
const r=await store.export(w.id,w.revision,{mode:'FROZEN',platformIds:['xiaohongshu','youtube']});const publicPack=await store.getExport(r.exportId,true),internal=await store.getExport(r.exportId);
const out=path.join(BASE,'examples');await fs.mkdir(out,{mode:0o700});await fs.writeFile(path.join(out,'合成双平台-公开文字包.json'),JSON.stringify(publicPack,null,2),{mode:0o600});await fs.writeFile(path.join(out,'合成双平台-内部恢复包.json'),JSON.stringify(internal,null,2),{mode:0o600});
for(const [name,text] of Object.entries(publicPack.files))await fs.writeFile(path.join(out,path.basename(name)),text,{mode:0o600});
await fs.writeFile(path.join(out,'sample-receipt.json'),JSON.stringify({workspaceId:w.id,exportId:r.exportId,kind:'SYNTHETIC_ONLY',status:'COMPLETED',publicFiles:publicPack.manifest.files,deviations:[],note:'服务重启后需重新确认公开文字；这些文件是已取得的合成样例，不是视频或发布回执。'},null,2));
console.log(JSON.stringify({exampleWorkspace:w.id,exportId:r.exportId,examples:out,status:'COMPLETED'}));
}finally{await store.close();}
