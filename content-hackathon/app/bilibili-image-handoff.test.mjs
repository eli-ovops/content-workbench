import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {buildBiliImagePackage} from './bilibili-policy.mjs';
const png=readFileSync(new URL('../assets/eli-social-publisher-icon-v5.png',import.meta.url));
const note={kind:'image',draftId:'fixed-draft',title:'B站独立图文🙂',body:'第一行\n\n第三行',tags:'#效率'};
test('standard ZIP reader verifies UTF8 copy, original image bytes and safe ordered paths',async()=>{
 const result=await buildBiliImagePackage(note,[{name:'../../首图.png',blob:new Blob([png],{type:'image/png'})},{name:'首图.png',blob:new Blob([png],{type:'image/png'})}]);
 const text=execFileSync('python3',['-c',`import sys,io,zipfile,json,hashlib
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
names=z.namelist(); images=[n for n in names if n.startswith('图片/')]
assert len(images)==2 and images[0].startswith('图片/01-') and images[1].startswith('图片/02-')
assert not any('/../' in n or n.startswith('/') for n in names)
print(json.dumps({'title':z.read('标题.txt').decode(),'body':z.read('正文.txt').decode(),'tags':z.read('话题标签.txt').decode(),'manifest':json.loads(z.read('素材清单.json')),'hashes':[hashlib.sha256(z.read(n)).hexdigest() for n in images]},ensure_ascii=False))`],{input:Buffer.from(await result.blob.arrayBuffer()),encoding:'utf8'});
 const data=JSON.parse(text);assert.equal(data.title,note.title);assert.equal(data.body,note.body);assert.equal(data.tags,note.tags);assert.equal(data.manifest.appDraftPrepared,false);assert.equal(data.manifest.published,false);assert.equal(data.hashes[0],createHash('sha256').update(png).digest('hex'));assert.equal(data.hashes[0],data.hashes[1]);assert.equal(result.imageCount,2);
});
test('invalid type, disguised image and oversized copy fail before a package is created',async()=>{
 await assert.rejects(buildBiliImagePackage({...note,kind:'video'},[]));
 await assert.rejects(buildBiliImagePackage(note,[{blob:new Blob(['not-an-image'],{type:'image/png'})}]),/格式不一致/);
 await assert.rejects(buildBiliImagePackage({...note,body:'x'.repeat(1001)},[{blob:new Blob([png],{type:'image/png'})}]),/1000/);
});
