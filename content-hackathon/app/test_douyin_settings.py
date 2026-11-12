import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
from playwright.async_api import async_playwright
from douyin_settings import apply_settings,read_editable_text,read_settings_text,native_topics
from provider_worker import Worker
from douyin_note import prepare_video

PNG=(Path(__file__).resolve().parent.parent/'assets'/'eli-social-publisher-icon-v5.png').read_bytes()

class DouyinSettingsRegression(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.pw=await async_playwright().start();self.browser=await self.pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True);self.context=await self.browser.new_context();self.page=await self.context.new_page()
  root=Path(self.temp.name);(root/'cover.png').write_bytes(PNG)
  self.job={'draft_id':'e4cc8edc-0660-4a3e-9eee-2b5950ef7afb','expected_title':'设置验证','expected_body':'本地文案','topics':['AI工具','效率工具'],'cover_mode':'upload','cover_path':str(root/'cover.png'),'cover_choice':'fixture-sha','receipt_path':str(root/'settings.png')}
  html='''<input placeholder="填写作品标题" value="设置验证"><div class="zone-container" contenteditable="true" style="white-space:pre-wrap">本地文案</div>
<div><div class="cover-card"><img id="portrait" style="width:100px;height:130px"><span>竖封面3:4</span><button onclick="document.querySelector('#modal').hidden=false">选择封面</button></div><div class="cover-card"><img id="landscape" style="width:130px;height:100px"><span>横封面4:3</span><button onclick="document.querySelector('#modal').hidden=false">选择封面</button></div></div>
<div id="modal" class="dy-creator-content-modal" hidden><div class="steps-fixture"><button onclick="window.ratio='portrait'">设置竖封面</button><button onclick="window.ratio='landscape'">设置横封面</button></div>
<div class="semi-upload"><span>AI参考图片</span><input type="file" accept="image/png" hidden onchange="window.ai++"></div>
<div class="semi-upload" style="padding:30px" onclick="if(event.target.tagName!=='INPUT')this.querySelector('input').click()"><span class="semi-upload-drag-area-main-text">点击上传文件或拖拽</span><input type="file" accept="image/png" hidden onchange="if(this.files.length){window.uploads++;const r=new FileReader();const ratio=window.ratio;r.onload=()=>document.querySelector('#'+ratio).src=r.result;r.readAsDataURL(this.files[0])}"></div>
<button onclick="document.querySelector('#modal').hidden=true">完成</button><button>设置竖封面</button><button onclick="document.querySelector('#modal').hidden=true">取消</button></div>
<div id="suggestions" role="listbox"></div><button onclick="window.posted++">发布</button><button onclick="window.saved++">暂存离开</button><script>window.ratio='portrait';window.uploads=0;window.ai=0;window.posted=0;window.saved=0;window.committed=[];
document.querySelector('.zone-container').addEventListener('input',e=>{const list=document.querySelector('#suggestions');list.replaceChildren();if(!e.target.innerText.trim())window.committed=[];const query=e.target.innerText.match(/#([^#\\s]+)$/);if(!query)return;const t=query[1];const button=document.createElement('button');button.textContent=t;button.onclick=()=>{window.committed.push(t);e.target.replaceChildren(document.createTextNode('本地文案\\n\\n'));window.committed.forEach(topic=>{const span=document.createElement('span');span.className='topic';span.contentEditable='false';span.textContent='#'+topic;e.target.append(span,document.createTextNode(' '))});list.replaceChildren();e.target.focus();const range=document.createRange();range.selectNodeContents(e.target);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range)};list.append(button)});</script>'''
  await self.page.route('**/*',lambda route:route.fulfill(body=html,content_type='text/html; charset=utf-8') if route.request.url.startswith('https://creator.douyin.com/') else route.abort())
  await self.page.goto('https://creator.douyin.com/creator-micro/content/post/video')
 async def asyncTearDown(self):
  await self.browser.close();await self.pw.stop()
 async def test_both_cover_ratios_and_native_topics_no_video_or_publish(self):
  result=await apply_settings(self.page,self.job,AsyncMock())
  self.assertTrue(result['horizontalCoverVerified']);self.assertTrue(result['verticalCoverVerified']);self.assertTrue(result['topicsVerified'])
  self.assertEqual(await native_topics(self.page.locator('.zone-container')),self.job['topics'])
  self.assertEqual((await read_editable_text(self.page.locator('.zone-container'))).strip(),'本地文案\n\n#AI工具 #效率工具')
  self.assertEqual(await self.page.evaluate('({uploads,ai,posted,saved})'),{'uploads':2,'ai':0,'posted':0,'saved':0})
 async def test_foreign_copy_is_not_overwritten(self):
  await self.page.locator('.zone-container').fill('本人已手动改稿')
  with self.assertRaisesRegex(RuntimeError,'body_changed'):await apply_settings(self.page,self.job,AsyncMock())
  self.assertEqual(await self.page.evaluate('uploads'),0)
 async def test_repeated_same_cover_skips_upload_when_only_topics_change(self):
  first=await apply_settings(self.page,self.job,AsyncMock())
  self.job['topics']=['AI工具']
  second=await apply_settings(self.page,self.job,AsyncMock(),previous_cover=first['_coverReceipt'])
  self.assertEqual(await self.page.evaluate('uploads'),2)
  self.assertFalse(second['coverUploadPerformed']);self.assertFalse(second['videoUploadPerformed'])
 async def test_native_decorations_removed_but_authored_zero_width_text_kept(self):
  await self.page.locator('.zone-container').evaluate('''e=>e.innerHTML='<div><span data-string>本地\\u200b文案</span></div><div><span data-enter>\\u200b</span></div><div><span data-zero-space>\\u200b</span><span data-fake-text=" " contenteditable="false">&nbsp;#AI工具&nbsp;</span></div>' ''')
  self.assertEqual(await read_settings_text(self.page.locator('.zone-container')),'本地\u200b文案\n\n#AI工具')
 async def test_utf16_copy_budget_rejects_before_cover_or_copy_mutation(self):
  self.job['expected_body']='😀'*499
  await self.page.locator('.zone-container').fill(self.job['expected_body'])
  with self.assertRaisesRegex(RuntimeError,'copy_limit'):await apply_settings(self.page,self.job,AsyncMock())
  self.assertEqual(await self.page.evaluate('uploads'),0)
 async def test_new_editor_second_copy_preserves_first_copy_covers_and_native_topics(self):
  first=await apply_settings(self.page,self.job,AsyncMock())
  worker=Worker('douyin');worker.context=self.page.context;worker.page=self.page
  worker.phase='prepared';worker.prepared_result={'phase':'prepared',**first}
  worker.current_job={'draft_id':self.job['draft_id']};worker.cover_receipt=first['_coverReceipt'];worker.prepare_lock='first-complete'
  worker.prepared_pages=[{'page':self.page,'title':'设置验证','body':'本地文案'}]
  html='''<input class="upload-btn-input" type="file" accept="video/mp4" hidden>
<div id="editor" hidden><input placeholder="填写作品标题"><div class="zone-container" contenteditable="true"></div><div class="long-card-fixture"><button>重新上传</button></div></div>
<button onclick="window.posted++">发布</button><button onclick="window.saved++">暂存离开</button><script>window.uploads=0;window.posted=0;window.saved=0;document.querySelector('input[type=file]').onchange=()=>{uploads++;document.querySelector('#editor').hidden=false}</script>'''
  await worker.context.route('https://creator.douyin.com/creator-micro/content/upload',lambda route:route.fulfill(body=html,content_type='text/html; charset=utf-8'))
  result=await worker.connect(fresh=True)
  self.assertEqual(result['phase'],'login_observed')
  self.assertIsNot(worker.page,self.page)
  self.assertIsNone(worker.prepare_lock)
  second={'title':'下一篇验证','body':'这是第二篇，上一稿保留。','tags':'','video_path':str(Path(__file__).resolve().parent.parent/'evidence'/'工作台视频验收素材-20261012.mp4'),'receipt_path':str(Path(self.temp.name)/'second.png')}
  prepared=await prepare_video(worker.page,second,worker.check)
  self.assertTrue(prepared['preparationVerified'])
  retained=await worker.inspect_retained()
  self.assertEqual(retained,[{'pageOpen':True,'titleUnchanged':True,'bodyUnchanged':True,'topicsUnchanged':True,'coverUnchanged':True,'coverCount':2}])
  self.assertEqual(await worker.page.locator('input[placeholder*="填写作品标题"]').input_value(),second['title'])
  self.assertEqual(await read_settings_text(worker.page.locator('.zone-container')),second['body'])
  self.assertEqual(await self.page.evaluate('({uploads,ai,posted,saved})'),{'uploads':2,'ai':0,'posted':0,'saved':0})
  self.assertEqual(await worker.page.evaluate('({uploads,posted,saved})'),{'uploads':1,'posted':0,'saved':0})
  with self.assertRaisesRegex(ValueError,'already_prepared'):
   worker.phase='prepared';await worker.prepare('4d65ee07-f41e-4f11-a1a3-e5638d63b929')

if __name__=='__main__':unittest.main()
