import { spawn } from 'node:child_process';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createBroker } from './rpc_broker.mjs';
import { checkXhsImage,checkXhsVideo,VIDEO_MAX_BYTES } from './xhs-policy.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const runtime = root + '.runtime/xhs/';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let child, busy = false;
const broker = createBroker(request => {startWorker();child.stdin.write(JSON.stringify(request)+'\n');});
export function validateNote(payload) {
  if (!payload || typeof payload !== 'object' || payload.kind !== 'image') throw new Error('只接受图文内容');
  if (typeof payload.title !== 'string' || !payload.title.trim() || [...payload.title].length > 20) throw new Error('当前连接器标题须为1至20字，请修改后重试');
  if (typeof payload.body !== 'string' || typeof payload.tags !== 'string') throw new Error('正文与标签须为文字');
  if (!Array.isArray(payload.images) || !payload.images.length || payload.images.length > 9) throw new Error('当前连接器只接受1至9张图片');
  const images = payload.images.map(image => {
    if (typeof image?.data !== 'string' || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error('图片编码或大小不符合要求');
    const b = Buffer.from(image.data, 'base64');
    if (!b.length || b.length > MAX_IMAGE_BYTES) throw new Error('图片超过8 MB');
    let ext;
    if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext = 'png';
    else if (b[0] === 255 && b[1] === 216 && b[2] === 255) ext = 'jpg';
    else if (b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP') ext = 'webp';
    else throw new Error('仅接收有效PNG、JPEG或WebP图片');
    return { buffer: b, ext };
  });
  const check=checkXhsImage({...payload,images:images.map(i=>({type:{png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[i.ext],size:i.buffer.length}))});
  if (!check.valid) throw new Error(check.issues[0]);
  return { title: payload.title, body: payload.body, tags: payload.tags, images };
}
export function validateVideo(payload) {
  if(payload?.kind!=='video'||typeof payload.title!=='string'||typeof payload.body!=='string'||typeof payload.tags!=='string')throw new Error('视频文案格式错误');
  const data=payload.video?.data;
  if(typeof data!=='string'||data.length>Math.ceil(VIDEO_MAX_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw new Error('视频编码或大小不符合要求');
  const buffer=Buffer.from(data,'base64');
  if(buffer.length<16||buffer.length>VIDEO_MAX_BYTES||buffer.subarray(4,8).toString()!=='ftyp')throw new Error('当前连接器只接收100 MB以内的MP4视频');
  const check=checkXhsVideo({...payload,assets:[{type:'video/mp4',size:buffer.length}]});
  if(!check.valid)throw new Error(check.issues[0]);
  return {title:payload.title,body:payload.body,tags:payload.tags,video:buffer};
}
function startWorker() {
  if (child) return;
  child = spawn(root + '.venv/bin/python', ['-u', root + 'xhs_worker.py'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  // Do not echo upstream error text or browser profile contents into HTTP/logs.
  child.stderr.on('data', () => {});
  createInterface({ input: child.stdout }).on('line', line => {
    let response; try { response = JSON.parse(line); } catch { return; }
    broker.receive(response);
  });
  const failed = () => {
    child = undefined;
    broker.abort();
  };
  child.on('error', failed); child.on('exit', failed);
  child.stdin.on('error', failed);
}
export function rpc(action, extra = {}) {
  return broker.request(action,extra);
}
export async function connectXhs({fresh=false,kind='image'}={}) {
  if (busy) throw new Error('已有连接器任务进行中');
  if(!['image','video'].includes(kind))throw new Error('只支持图文或视频编辑页');
  busy = true; try { return await rpc('connect',{fresh,kind}); } finally { busy = false; }
}
export async function statusXhs() {
  if (busy) return { phase: 'preparing', message: '正在操作专用浏览器，请勿重复提交' };
  if (!child) return { phase: 'not_connected', message: '小红书尚未连接' };
  return rpc('status');
}
export async function prepareXhs(payload) {
  if (busy) throw new Error('已有连接器任务进行中');
  const kind=payload?.kind==='video'?'video':'image';
  const note = kind==='video'?validateVideo(payload):validateNote(payload);
  busy = true;
  try {
    if (!child) throw new Error('请先扫码登录并刷新连接状态');
    const status = await rpc('status');
    if (status.phase === 'prepared') throw new Error('本次图文已传入编辑页，请先在小红书核对，不能重复上传');
    if (status.phase !== 'connected') throw new Error('请先扫码登录并刷新连接状态');
    if((status.kind||'image')!==kind)throw new Error('请先打开对应内容类型的小红书编辑页');
    const id = randomUUID(); const dir = runtime + 'jobs/' + id;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(runtime, 0o700); await chmod(dir, 0o700);
    const paths = [];
    for (const [index, image] of (note.images||[]).entries()) {
      const path = dir + '/' + index + '.' + image.ext;
      await writeFile(path, image.buffer, { mode: 0o600, flag: 'wx' }); paths.push(path);
    }
    if(note.video)await writeFile(dir+'/0.mp4',note.video,{mode:0o600,flag:'wx'});
    await writeFile(dir + '/job.json', JSON.stringify({kind,title: note.title, body: note.body, tags: note.tags, image_paths: paths,video_path:note.video?dir+'/0.mp4':undefined, receipt_path:dir+'/prepared.png' }), { mode: 0o600, flag: 'wx' });
    return await rpc('prepare', { job_id: id });
  } finally { busy = false; }
}
export function closeWorker() { child?.stdin.end(); }
