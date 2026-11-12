import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateNote,validateVideo, prepareXhs, statusXhs } from './xhs_bridge.mjs';
const picture = (await readFile(new URL('../assets/eli-social-publisher-icon-v5.png', import.meta.url))).toString('base64');
const note = { kind:'image',title:'验证图文',body:'正文',tags:'#验证',images:[{data:picture}] };
const video = (await readFile(new URL('../evidence/工作台视频验收素材-20261012.mp4',import.meta.url))).toString('base64');
test('video preparation keeps literal text and rejects image bytes or oversized copy',()=>{
  const payload={kind:'video',title:'视频验证',body:'正文',tags:'',video:{data:video,name:'../../private'}};
  const result=validateVideo(payload);assert.equal(result.title,payload.title);assert.equal(result.video.subarray(4,8).toString(),'ftyp');
  assert.throws(()=>validateVideo({...payload,video:{data:picture}}));
  assert.throws(()=>validateVideo({...payload,body:'字'.repeat(1001)}));
});
test('accepted user content is preserved; file paths/names cannot select runtime destinations', () => {
  const result = validateNote({...note,images:[{data:picture,name:'../../secrets.env'}]});
  assert.equal(result.title,note.title); assert.equal(result.body,note.body);
  assert.equal(result.images[0].ext,'png'); assert.equal('name' in result.images[0],false);
});
test('reject unsupported media and oversized title rather than silent truncation', () => {
  assert.throws(()=>validateNote({...note,title:'x'.repeat(21)}));
  assert.throws(()=>validateNote({...note,kind:'video'}));
  assert.throws(()=>validateNote({...note,images:[{data:Buffer.from('not an image').toString('base64')}]}));
  assert.throws(()=>validateNote({...note,images:[]}));
  assert.throws(()=>validateNote({...note,body:'字'.repeat(1000)}),/1000/);
});
test('preparing without a connected account is refused; no worker or browser starts', async () => {
  assert.equal((await statusXhs()).phase,'not_connected');
  await assert.rejects(prepareXhs(note),/先扫码/);
  assert.equal((await statusXhs()).phase,'not_connected');
});
