import unittest
from playwright.async_api import async_playwright
from xhs_note import body_editor, fill_title,wait_video_upload,logical_text,verify_body_preview

class EditorRegression(unittest.IsolatedAsyncioTestCase):
    async def test_current_status_rejects_changed_preview_without_mutation(self):
        from xhs_worker import Worker
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
            try:
                page=await browser.new_page()
                html='<input placeholder="填写标题" value="标题"><div class="tiptap ProseMirror" contenteditable="true">正文</div><div class="image-preview"><div class="title">标题</div><div class="info">正文</div></div><div class="img-preview-area"><img class="preview"></div>'
                await page.route('https://creator.xiaohongshu.com/**',lambda r:r.fulfill(body=html,content_type='text/html; charset=utf-8'))
                await page.goto('https://creator.xiaohongshu.com/publish/publish')
                worker=Worker();worker.page=page;worker.phase='prepared';worker.current_job={'title':'标题','body':'正文','tags':'','image_paths':['one']};worker.prepared_result={'titlePreviewVerified':True,'bodyPreviewVerified':True,'preparationFingerprint':'old'}
                self.assertTrue((await worker.status())['currentReadback'])
                await page.locator('.image-preview .title').evaluate("e=>e.textContent='不同标题'")
                self.assertFalse((await worker.status())['titlePreviewVerified'])
            finally:await browser.close()
    async def test_completed_video_accepts_hd_quality_advice_and_rejects_transcoding(self):
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
            try:
                page=await browser.new_page()
                await page.set_content('<div class="transcoding">转码中</div><input placeholder="填写标题">')
                with self.assertRaises(AssertionError):await wait_video_upload(page,timeout=400)
                for text in ('检测为高清视频。','视频分辨率较低，建议上传1080P'):
                    await page.set_content('<div class="preview-new">'+text+'</div>')
                    await wait_video_upload(page,timeout=400)
            finally:
                await browser.close()

    async def test_video_preview_uses_visible_caption_instead_of_hidden_measurement(self):
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
            try:
                page=await browser.new_page()
                await page.set_content('''<input placeholder="填写标题"><div class="video-preview"><span class="user-desc-hide" style="display:none">错误值</span><span class="user-desc-wrapper2">旧标题</span></div><script>document.querySelector('input').addEventListener('input',e=>{const value=e.target.value;setTimeout(()=>document.querySelector('.user-desc-wrapper2').textContent=value,300)})</script>''')
                await fill_title(page,'视频标题',video=True)
                self.assertEqual(await page.locator('.user-desc-wrapper2').inner_text(),'视频标题')
            finally:
                await browser.close()

    async def test_title_waits_for_delayed_preview_commit(self):
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
            try:
                page=await browser.new_page()
                await page.set_content('''<input placeholder="填写标题"><div class="image-preview"><div class="title"></div></div><script>let timer;document.querySelector('input').addEventListener('input',e=>{clearTimeout(timer);const text=e.target.value;timer=setTimeout(()=>document.querySelector('.image-preview .title').textContent=text,300)})</script>''')
                title=await fill_title(page,'验证图文：发布工作台')
                self.assertEqual(await title.input_value(),'验证图文：发布工作台')
                self.assertEqual(await page.locator('.image-preview .title').inner_text(),'验证图文：发布工作台')
            finally:
                await browser.close()

    async def test_uncommitted_title_cannot_pass_on_input_value_alone(self):
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
            try:
                page=await browser.new_page()
                await page.set_content('<input placeholder="填写标题"><div class="image-preview"><div class="title">旧标题</div></div>')
                with self.assertRaises(AssertionError):
                    await fill_title(page,'未同步标题',timeout=400)
                self.assertEqual(await page.locator('input').input_value(),'未同步标题')
            finally:
                await browser.close()

    async def test_hidden_matching_preview_cannot_pass(self):
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
            try:
                page=await browser.new_page()
                await page.set_content('<input placeholder="填写标题"><div class="image-preview" style="display:none"><div class="title">隐藏标题</div></div>')
                with self.assertRaises(AssertionError):
                    await fill_title(page,'隐藏标题',timeout=400)
            finally:
                await browser.close()

    async def test_editor_remains_bound_when_empty_placeholder_disappears(self):
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
            try:
                page=await browser.new_page()
                await page.set_content('''<div class="tiptap ProseMirror" style="min-height:100px" contenteditable="true" role="textbox"><p data-placeholder="输入正文描述"></p></div><script>document.querySelector('[contenteditable]').addEventListener('input',()=>document.querySelectorAll('[data-placeholder]').forEach(e=>e.removeAttribute('data-placeholder')))</script>''')
                editor=await body_editor(page)
                await editor.fill('验证正文')
                self.assertEqual(await page.locator('[data-placeholder]').count(),0)
                self.assertEqual(await editor.inner_text(),'验证正文')
            finally:
                await browser.close()

    async def test_paragraph_readback_preserves_single_and_repeated_newlines(self):
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
            try:
                page=await browser.new_page()
                await page.set_content('<div class="tiptap"><p>第一行</p><p><br></p><p>第三行</p><p>第四行\u200b</p></div>')
                node=page.locator('.tiptap')
                text='第一行\n\n第三行\n第四行\u200b'
                self.assertEqual(await logical_text(node),text)
                await verify_body_preview(node,text,timeout=100)
                with self.assertRaisesRegex(RuntimeError,'body_preview_mismatch'):
                    await verify_body_preview(node,'第一行\n第三行\n第四行',timeout=100)
            finally:await browser.close()

if __name__=='__main__':
    unittest.main()
