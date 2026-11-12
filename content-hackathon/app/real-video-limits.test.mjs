import test from 'node:test';
import assert from 'node:assert/strict';
import {checkXhsVideo,VIDEO_MAX_BYTES} from './xhs-policy.mjs';
import {validateVideo} from './xhs_bridge.mjs';
import {readFileSync} from 'node:fs';
test('real video sizes above old 8MB pass consistently; 100MB ceiling is retained',()=>{
 const base={kind:'video',title:'真实视频准备验证',body:'只准备，不发布',tags:''};
 for(const size of [13386003,61802739,12617771,VIDEO_MAX_BYTES])assert.equal(checkXhsVideo({...base,assets:[{type:'video/mp4',size}]}).valid,true);
 assert.equal(checkXhsVideo({...base,assets:[{type:'video/mp4',size:VIDEO_MAX_BYTES+1}]}).valid,false);
 const original=readFileSync(new URL('../evidence/工作台视频验收素材-20261012.mp4',import.meta.url));
 const media=Buffer.alloc(9*1024*1024);original.copy(media);
 assert.equal(validateVideo({...base,video:{data:media.toString('base64')}}).video.length,media.length);
 assert.throws(()=>validateVideo({...base,video:{data:Buffer.alloc(16).toString('base64')}}),/MP4/);
});
