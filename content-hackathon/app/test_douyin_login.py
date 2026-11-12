import unittest
from douyin_login import classify_login,read_login,select_scan_login,enter_video_upload
from playwright.async_api import async_playwright

class DouyinLoginRegression(unittest.TestCase):
    def test_failure_and_expiry_are_not_generic_waiting(self):
        self.assertEqual(classify_login(['login_failed'], True, False), 'login_failed')
        self.assertEqual(classify_login(['qr_expired'], True, False), 'qr_expired')
    def test_challenge_stops_even_with_upload_control(self):
        self.assertEqual(classify_login(['verification_required'], False, True), 'verification_required')
    def test_url_or_missing_login_ui_does_not_prove_login(self):
        self.assertEqual(classify_login([], False, False), 'page_pending')
        self.assertEqual(classify_login([], False, True), 'login_observed')
        self.assertEqual(classify_login([], True, True), 'awaiting_login')

class DouyinNativeLoginRegression(unittest.IsolatedAsyncioTestCase):
    async def test_logged_in_home_uses_native_video_entry_without_uploading(self):
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
            try:
                page=await browser.new_page()
                html='''<div id="guide"><button onclick="document.querySelector('#guide').hidden=true">跳过</button></div><button onclick="window.entries++;document.querySelector('#upload').hidden=false">发布高清视频 支持常用格式</button><input id="upload" type="file" accept="video/mp4" hidden><script>window.entries=0</script>'''
                await page.route('https://creator.douyin.com/**',lambda route:route.fulfill(body=html,content_type='text/html; charset=utf-8'))
                await page.goto('https://creator.douyin.com/creator-micro/home')
                await enter_video_upload(page)
                self.assertEqual(await page.evaluate('entries'),1)
                self.assertEqual(await page.locator('#upload').evaluate('e=>e.files.length'),0)
                self.assertFalse(await page.locator('#guide').is_visible())
            finally:await browser.close()
    async def test_native_scan_tab_and_error_readback_without_private_values(self):
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
            try:
                page=await browser.new_page()
                html='''<button onclick="document.querySelector('#scan').hidden=false">扫码登录</button><div id="scan" hidden><span>二维码失效</span><span>网络异常</span><button>点击刷新</button></div><input type="tel" value="PRIVATE_SENTINEL"><button>发布</button>'''
                await page.route('https://creator.douyin.com/**',lambda route:route.fulfill(body=html,content_type='text/html; charset=utf-8'))
                await page.goto('https://creator.douyin.com/creator-micro/content/upload')
                initial=await read_login(page)
                self.assertEqual(initial['phase'],'awaiting_login')
                await select_scan_login(page)
                result=await read_login(page)
                self.assertEqual(result['phase'],'qr_expired')
                self.assertIn('点击刷新',result['controls'])
                self.assertNotIn('PRIVATE_SENTINEL',str(result))
                self.assertFalse(result['uploadInputPresent'])
            finally:await browser.close()

if __name__ == '__main__':unittest.main()
