import {emptyWorkspace,id,hash} from './model.mjs';
export function demoWorkspace(){
const w=emptyWorkspace('虚构样例｜把三段周报汇成表');
w.topic='虚构选题卡：普通人如何把三段示例周报汇总成表；没有真实工具效果或客户数据。';
w.body='问题：三段虚构周报分散，想汇成一张表。\n材料：三段公开示例文字。\n操作：按事项、负责人、下一步列三列。\n交付：一张示例汇总表。\n检查：逐条对照原文，不把未知当完成。';
w.common={title:'用一张表整理三段示例周报',body:w.body,hashtags:'#AI工具 #工作方法',backendTags:'AI, 工作方法'};
const sid=id();w.sources=[{id:sid,title:'本人撰写的虚构样例',reference:'synthetic://weekly-example',date:'2026-10-12',scope:'全文',privacy:'PUBLIC',permission:'ALLOWED',version:1,expiresAt:'',text:'公开合成示例，无真实客户或媒体'}];
w.facts=[{id:id(),text:'工具效果尚未实测',status:'UNVERIFIED',sourceIds:[sid]}];
w.notes=[{id:id(),text:'录屏备注：显示三列汇总表；检查文字可读。只是计划，不是已录素材。',sourceIds:[sid],scriptVersion:null,mediaPath:''}];
return w;
}
