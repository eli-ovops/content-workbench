import unittest
import tempfile
import hashlib
from pathlib import Path
from unittest.mock import AsyncMock
from playwright.async_api import async_playwright
from bilibili_settings import read_categories, apply_settings

HTML='''<input placeholder="请输入稿件标题" value="验证稿件"><div editor_id="desc_at_editor"><div class="ql-editor" contenteditable="true">验证简介</div></div>
<div class="video-human-type"><div class="select-controller" onclick="document.querySelector('.human-type-list').hidden=false"><p class="select-item-cont">科技数码</p></div><div class="human-type-list" hidden><div class="drop-list-v2-item"><p class="item-cont-main" onclick="choose(this)">科技数码</p></div><div class="drop-list-v2-item"><p class="item-cont-main" onclick="choose(this)">人工智能</p></div></div></div>
<div class="tag-container"><div class="tag-input-wrp"><div class="tag-pre-wrp"></div><input placeholder="按回车键Enter创建标签" maxlength="20"></div></div>
<div class="cover"><div class="cover-main"><div class="cover-slot" style="width:200px;height:120px" onclick="document.querySelector('.cover-editor').hidden=false">添加封面</div></div><div class="cover-recommend-list"><div class="ai-generate-btn" onclick="ai++">AI生成</div><div class="img-item-cover" onclick="frameCover(0)">帧1</div><div class="img-item-cover" onclick="frameCover(1)">帧2</div><div class="img-item-cover" onclick="frameCover(2)">帧3</div></div></div>
<div class="cover-editor" hidden><div class="cover-upload"><div class="bcc-upload-wrapper" style="padding:30px" onclick="if(event.target.type!=='file')document.querySelector('#cover-file').click()">上传封面<input id="cover-file" type="file" accept="image/png,image/jpeg" hidden></div></div><div class="cover-phone-view-home-video-img" style="width:200px;height:120px"></div><div class="cover-editor-button"><div class="button" onclick="document.querySelector('.cover-editor').hidden=true">取消</div><div class="button submit" onclick="finish()">完成</div></div></div>
<div id="sync-warning" hidden><span>检测到16:9封面未修改</span><button onclick="coverSynced=true;document.querySelector('#sync-warning').hidden=true">确认同步</button></div><button onclick="posted++">立即投稿</button><button onclick="saved++">存草稿</button><script>
let posted=0,saved=0,ai=0,coverUploads=0,coverSynced=false;
function choose(e){document.querySelector('.select-item-cont').textContent=e.textContent;document.querySelector('.human-type-list').hidden=true}
document.querySelector('input[placeholder*="标题"]').addEventListener('click',()=>document.querySelector('.human-type-list').hidden=true);
function addTag(text){const div=document.createElement('div');div.className='label-item-v2-container';const p=document.createElement('p');p.className='label-item-v2-content';p.textContent=text;div.append(p);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.addEventListener('click',()=>div.remove());div.append(svg);document.querySelector('.tag-pre-wrp').append(div)}
addTag('平台默认标签');document.querySelector('input[placeholder*="标签"]').addEventListener('keydown',e=>{if(e.key==='Enter'){addTag(e.target.value);e.target.value=''}});
function finish(){if(document.querySelector('#cover-file').files.length&&!coverSynced)document.querySelector('#sync-warning').hidden=false;else finishFinal()}
function finishFinal(){document.querySelector('.cover-slot').style.backgroundImage=document.querySelector('.cover-phone-view-home-video-img').style.backgroundImage;document.querySelector('.cover-editor').hidden=true;document.querySelector('#sync-warning').hidden=true}
function frameCover(i){document.querySelector('.cover-phone-view-home-video-img').style.backgroundImage='url("https://example.invalid/frame'+i+'.png")';document.querySelector('.cover-editor').hidden=false}
document.querySelector('#cover-file').addEventListener('change',e=>{coverUploads++;const reader=new FileReader();reader.onload=()=>document.querySelector('.cover-phone-view-home-video-img').style.backgroundImage='url("'+reader.result+'")';reader.readAsDataURL(e.target.files[0])});
</script>'''

class BiliSettingsRegression(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.pw=await async_playwright().start()
  self.browser=await self.pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
  self.page=await self.browser.new_page()
  await self.page.route('**/*',lambda route:route.fulfill(body=HTML,content_type='text/html; charset=utf-8'))
  await self.page.goto('https://member.bilibili.com/platform/upload/video/frame')
  self.directory=tempfile.TemporaryDirectory()
  print('QA-only settings paths:',self.directory.name)
  self.job={'expected_title':'验证稿件','expected_body':'验证简介','category_path':['人工智能'],'tags':['AI工具','效率工具'],'cover_mode':'upload','frame_index':0,'cover_choice':'test-cover','cover_path':str(Path(__file__).resolve().parent.parent/'assets/eli-social-publisher-icon-v5.png'),'receipt_path':str(Path(self.directory.name)/'settings.png')}
  self.job['cover_choice']=hashlib.sha256(Path(self.job['cover_path']).read_bytes()).hexdigest()
 async def asyncTearDown(self):
  await self.browser.close();await self.pw.stop();self.directory.cleanup()
 async def test_native_image_cover_category_and_tags_keep_copy_and_do_not_submit(self):
  catalog=await read_categories(self.page,AsyncMock())
  self.assertEqual(catalog['categories'][1]['path'],['人工智能'])
  self.assertEqual(await self.page.locator('.select-item-cont').inner_text(),'科技数码')
  result=await apply_settings(self.page,self.job,AsyncMock())
  self.assertTrue(result['optionsVerified'])
  self.assertTrue(result['titleBodyUnchanged'])
  self.assertEqual(await self.page.locator('.label-item-v2-content').all_text_contents(),self.job['tags'])
  self.assertEqual(await self.page.evaluate('()=>({posted,saved,ai})'),{'posted':0,'saved':0,'ai':0})
  self.assertEqual(await self.page.locator('#cover-file').evaluate('e=>e.files.length'),1)
 async def test_recommended_frame_never_clicks_ai_generation(self):
  self.job.update(cover_mode='frame',frame_index=1,cover_choice='frame:1',cover_path=None)
  result=await apply_settings(self.page,self.job,AsyncMock())
  self.assertTrue(result['coverVerified'])
  self.assertIn('frame1.png',result['_coverReceipt']['fingerprint'])
  self.assertEqual(await self.page.evaluate('()=>({posted,saved,ai})'),{'posted':0,'saved':0,'ai':0})
 async def test_screenshot_timeout_does_not_discard_verified_native_fields(self):
  self.job.update(cover_mode='frame',frame_index=1,cover_choice='frame:1',cover_path=None)
  self.page.screenshot=AsyncMock(side_effect=TimeoutError('offline screenshot timeout'))
  result=await apply_settings(self.page,self.job,AsyncMock())
  self.assertTrue(result['optionsVerified']);self.assertFalse(result['receiptCaptured'])
  self.assertEqual(await self.page.evaluate('()=>({posted,saved,ai})'),{'posted':0,'saved':0,'ai':0})
 async def test_unknown_category_stops_before_changes(self):
  self.job['category_path']=['旧版不存在的分区']
  with self.assertRaisesRegex(RuntimeError,'category_not_available'):
   await apply_settings(self.page,self.job,AsyncMock())
  self.assertEqual(await self.page.locator('.select-item-cont').inner_text(),'科技数码')
  self.assertEqual(await self.page.locator('.label-item-v2-content').all_text_contents(),['平台默认标签'])
  self.assertEqual(await self.page.evaluate('()=>({posted,saved,ai})'),{'posted':0,'saved':0,'ai':0})
 async def test_resume_matching_sync_warning_without_reuploading_cover(self):
  await self.page.locator('.cover-slot').click()
  async with self.page.expect_file_chooser() as chooser:
   await self.page.locator('.cover-upload .bcc-upload-wrapper').click()
  await (await chooser.value).set_files(self.job['cover_path'])
  await self.page.wait_for_function('()=>document.querySelector(".cover-phone-view-home-video-img").style.backgroundImage')
  await self.page.locator('.cover-editor-button').get_by_text('完成',exact=True).click()
  result=await apply_settings(self.page,self.job,AsyncMock())
  self.assertTrue(result['coverVerified'])
  self.assertEqual(await self.page.evaluate('()=>coverUploads'),1)
  self.assertEqual(await self.page.evaluate('()=>({posted,saved,ai})'),{'posted':0,'saved':0,'ai':0})

if __name__=='__main__':unittest.main()
