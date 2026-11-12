import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
from playwright.async_api import async_playwright
from douyin_note import prepare_video,UploadAgreementRequired,read_editable_text

class DouyinEditorRegression(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.pw=await async_playwright().start()
        self.browser=await self.pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
        self.page=await self.browser.new_page()
        root=Path(self.temp.name)
        video=root/'sample.mp4';video.write_bytes(b'fixture only')
        self.job={'title':'验证视频','body':'正文第一行\n正文第二行','tags':'#AI工具 #工作台','video_path':str(video),'receipt_path':str(root/'prepared.png')}
    async def asyncTearDown(self):
        await self.browser.close();await self.pw.stop()
    async def load(self,notice='',extra='',alter=''):
        html='''<p>NOTICE</p><input class="upload-btn-input" type="file" accept="video/mp4" hidden>EXTRA
<div id="editor" hidden><input placeholder="填写作品标题，为作品获得更多流量"><div class="zone-container" contenteditable="true"></div><div class="long-card-abc"><button>重新上传</button></div></div>
<button onclick="window.posted++">发布</button><button onclick="window.saved++">存草稿</button><button onclick="window.declared++">内容由AI生成</button>
<script>window.posted=0;window.saved=0;window.declared=0;window.uploads=0;
document.querySelector('.upload-btn-input').onchange=()=>{window.uploads++;setTimeout(()=>document.querySelector('#editor').hidden=false,150)};ALTER</script>'''.replace('NOTICE',notice).replace('EXTRA',extra).replace('ALTER',alter)
        await self.page.route('**/*',lambda route:route.fulfill(body=html,content_type='text/html; charset=utf-8') if route.request.url.startswith('https://creator.douyin.com/') else route.abort())
        await self.page.goto('https://creator.douyin.com/creator-micro/content/upload')
    async def test_delayed_native_upload_copy_readback_without_submission(self):
        await self.load(extra='<input type="file" accept="image/png">')
        result=await prepare_video(self.page,self.job,AsyncMock())
        self.assertTrue(result['videoUploadVerified']);self.assertTrue(result['bodyVerified'])
        self.assertEqual(await read_editable_text(self.page.locator('.zone-container')),self.job['body']+'\n\n'+self.job['tags'])
        self.assertEqual(await self.page.evaluate('({uploaded:uploads,posted,saved,declared})'),{'uploaded':1,'posted':0,'saved':0,'declared':0})
        self.assertEqual(json.loads(Path(self.job['receipt_path']).with_name('stage.json').read_text())['stage'],'prepared')
    async def test_native_legal_notice_blocks_before_upload(self):
        await self.load(notice='上传即表示您同意用户协议')
        with self.assertRaises(UploadAgreementRequired):await prepare_video(self.page,self.job,AsyncMock())
        self.assertEqual(await self.page.evaluate('uploads'),0)
    async def test_worker_status_rereads_manual_changes_and_never_reuploads(self):
        from provider_worker import Worker
        await self.load()
        prepared=await prepare_video(self.page,self.job,AsyncMock())
        worker=Worker('douyin');worker.page=self.page;worker.current_job=self.job
        worker.phase='prepared';worker.prepared_result=prepared
        self.assertTrue((await worker.status())['currentReadback'])
        await self.page.locator('input[placeholder*="作品标题"]').fill('本人在平台页修改标题')
        result=await worker.status()
        self.assertFalse(result['preparationVerified']);self.assertFalse(result['currentReadback'])
        self.assertEqual(await self.page.evaluate('({uploaded:uploads,posted,saved,declared})'),{'uploaded':1,'posted':0,'saved':0,'declared':0})
    async def test_ambiguous_video_controls_do_not_upload(self):
        await self.load(extra='<input class="upload-btn-input" type="file" accept="video/mp4">')
        with self.assertRaisesRegex(RuntimeError,'ambiguous'):await prepare_video(self.page,self.job,AsyncMock())
        self.assertEqual(await self.page.evaluate('uploads'),0)
    async def test_editor_copy_mismatch_is_not_reported_prepared(self):
        await self.load(alter="document.addEventListener('input',e=>{if(e.target.className==='zone-container')e.target.textContent='platform changed copy'})")
        with self.assertRaisesRegex(RuntimeError,'body_mismatch'):await prepare_video(self.page,self.job,AsyncMock())
        self.assertEqual(await self.page.evaluate('({uploaded:uploads,posted,saved,declared})'),{'uploaded':1,'posted':0,'saved':0,'declared':0})
    async def test_native_trailing_zero_width_marker_preserves_copy_and_does_not_publish(self):
        await self.load(alter="document.addEventListener('input',e=>{if(e.target.className==='zone-container'&&!e.target.textContent.endsWith('\\u200b'))(e.target.lastElementChild||e.target).append(document.createTextNode('\\u200b'))})")
        result=await prepare_video(self.page,self.job,AsyncMock())
        self.assertTrue(result['bodyVerified'])
        self.assertEqual(await read_editable_text(self.page.locator('.zone-container')),self.job['body']+'\n\n'+self.job['tags']+'\u200b')
        self.assertEqual(await self.page.evaluate('({uploaded:uploads,posted,saved,declared})'),{'uploaded':1,'posted':0,'saved':0,'declared':0})

if __name__=='__main__':unittest.main()
