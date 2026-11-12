import unittest
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock
from playwright.async_api import async_playwright
from bilibili_note import prepare_video

class BiliEditorRegression(unittest.IsolatedAsyncioTestCase):
 async def test_upload_readback_and_no_submission(self):
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
   try:
    page=await browser.new_page()
    html='''<div class="bcc-upload-wrapper"><div class="upload-area" style="padding:40px" onclick="document.querySelector('#actual').click()"><div class="upload-btn no-events" style="pointer-events:none">上传视频</div></div><input id="actual" type="file" accept=".mp4" style="display:none"></div><input id="unrelated" type="file" accept=".mp4"><input placeholder="请输入稿件标题"><div editor_id="desc_at_editor"><div class="ql-editor" contenteditable="true" style="min-height:100px"></div></div><span id="uploaded" hidden>上传完成</span><button onclick="document.querySelector('#posted').textContent='1'">投稿</button><span id="posted">0</span><script>document.querySelector('#actual').addEventListener('change',()=>setTimeout(()=>document.querySelector('#uploaded').hidden=false,100))</script>'''
    await page.route('https://member.bilibili.com/**',lambda route:route.fulfill(body=html,content_type='text/html; charset=utf-8'))
    await page.goto('https://member.bilibili.com/platform/upload/video/frame')
    with tempfile.TemporaryDirectory() as directory:
     job={'title':'验证稿件','body':'验证简介','tags':'','video_path':str(Path(__file__).resolve().parent.parent/'evidence/工作台视频验收素材-20261012.mp4'),'receipt_path':str(Path(directory)/'prepared.png')}
     result=await prepare_video(page,job,AsyncMock())
     self.assertTrue(result['preparationVerified'])
     self.assertEqual(await page.locator('input[placeholder]').input_value(),job['title'])
     self.assertEqual(await page.locator('.ql-editor').inner_text(),job['body'])
     self.assertEqual(await page.locator('#posted').inner_text(),'0')
     self.assertEqual(await page.locator('#actual').evaluate('e=>e.files.length'),1)
     self.assertEqual(await page.locator('#unrelated').evaluate('e=>e.files.length'),0)
     from provider_worker import Worker
     worker=Worker('bilibili');worker.page=page;worker.current_job=job;worker.phase='prepared';worker.prepared_result=result
     self.assertTrue((await worker.status())['currentReadback'])
     await page.locator('.ql-editor').fill('手动修改后简介')
     self.assertFalse((await worker.status())['preparationVerified'])
     self.assertEqual(await page.locator('#posted').inner_text(),'0')
   finally:await browser.close()

if __name__=='__main__':unittest.main()
