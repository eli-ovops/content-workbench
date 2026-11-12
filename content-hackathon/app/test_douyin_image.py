import unittest
from playwright.async_api import async_playwright
from douyin_image import image_receipt

class ImageGalleryRegression(unittest.IsolatedAsyncioTestCase):
 async def test_count_and_loaded_thumbnails_exclude_avatar_delete_and_drop_icons(self):
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
   try:
    page=await browser.new_page()
    await page.route('https://fixture.example/**',lambda route:route.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>'))
    await page.set_content('<img src="https://fixture.example/avatar"><div class="content-native"><div><div><span>编辑图片</span></div></div><div><div class="img-native"><img src="https://fixture.example/first" width="79"></div><img class="del-native" src="https://fixture.example/delete"><div class="drop-native"><img src="https://fixture.example/drop"></div><div class="img-native"><img src="https://fixture.example/second" width="79"></div><div>已添加2张图片<button>继续添加</button></div></div></div>')
    await page.wait_for_load_state('networkidle')
    self.assertEqual(await image_receipt(page,2),['https://fixture.example/first','https://fixture.example/second'])
    with self.assertRaisesRegex(RuntimeError,'image_count_unverified'):await image_receipt(page,1)
    await page.locator('.content-native').get_by_text('已添加2张图片').evaluate("e=>e.prepend(document.createTextNode('上传失败 '))")
    with self.assertRaisesRegex(RuntimeError,'image_upload_incomplete'):await image_receipt(page,2)
   finally:await browser.close()

if __name__=='__main__':unittest.main()
