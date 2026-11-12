export const APP='eli-content-workbench';
export const APP_VERSION='0.1.3';
export const SCHEMA='content-workbench.workspace';
export const CONFIG_VERSION='platforms-20261009-v1';
export const PLATFORM_SOURCE={path:'/Volumes/EXTERNAL/自媒体/账号资料统一/README.md',date:'2026-10-09',capturedAt:'2026-10-12',note:'dated offline template; current account/API status UNKNOWN'};
export const PLATFORMS=[
['xiaohongshu','小红书','zh-Hans'],['bilibili','B站','zh-Hans'],['douyin_cn','国内抖音','zh-Hans'],['wechat_channels','微信视频号','zh-Hans'],
['youtube','YouTube','zh-Hant'],['linkedin','LinkedIn','zh-Hant'],['x','X','zh-Hant'],['weibo','微博','zh-Hans'],['tiktok','TikTok','zh-Hant']
].map(([id,name,language])=>({id,name,language,enabled:true}));
export const PUBLIC_FIELDS=['title','body','hashtags','backendTags'];
export const AUTHORITY_PATHS=['/Volumes/EXTERNAL/自媒体/流程协作/会话登记.json','/Volumes/EXTERNAL/自媒体/流程协作/流程状态.json'];
export const LIMIT={payload:1024*1024,block:40*1024,soft:45*1024*1024,hard:50*1024*1024,workspaces:50};
