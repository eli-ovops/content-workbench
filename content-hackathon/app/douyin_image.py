"""Visible native Douyin image preparation, adapted from fixed SAU MIT source.
Never clicks publish/cloud draft, selects declarations, or changes authentication.
"""
import asyncio
import json
import re
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import expect
from douyin_note import UploadAgreementRequired
from douyin_settings import read_settings_text

TITLE='input[placeholder*="作品标题"]'
EDITOR='div.zone-container[contenteditable="true"]'
def image_gallery(page):
    # Current native component: title row / section / editing-images gallery.
    # Scope excludes cover preview, account avatar, delete and drop icons.
    return page.get_by_text('编辑图片',exact=True).locator('xpath=../../..')

async def inspect_gallery(page):
    images=image_gallery(page).locator('div[class^="img-"] img').filter(visible=True)
    return {'count':await images.count(),'loaded':await images.evaluate_all('els=>els.map(e=>e.complete&&e.naturalWidth>0&&/^https?:/.test(e.currentSrc||e.src))')}

async def image_receipt(page,expected):
    scope=image_gallery(page)
    if await scope.count()!=1:raise RuntimeError('image_gallery_ambiguous')
    count=re.search(r'已添加\s*(\d+)\s*张图片',await scope.inner_text())
    if not count or int(count.group(1))!=expected:raise RuntimeError('image_count_unverified')
    images=scope.locator('div[class^="img-"] img').filter(visible=True)
    if await images.count()!=expected:raise RuntimeError('image_count_unverified')
    loaded=await images.evaluate_all('els=>els.every(e=>e.complete&&e.naturalWidth>0&&/^https?:/.test(e.currentSrc||e.src))')
    if not loaded or re.search(r'上传中|上传失败|\d+%',await scope.inner_text()):raise RuntimeError('image_upload_incomplete')
    return await images.evaluate_all('els=>els.map(e=>e.currentSrc||e.src)')

async def verify_prepared(page,job,check):
    await check()
    if urlparse(page.url).path!='/creator-micro/content/post/image':raise RuntimeError('image_editor_required')
    title=page.locator(TITLE).filter(visible=True)
    body=page.locator(EDITOR).filter(visible=True)
    if await title.count()!=1 or await body.count()!=1:raise RuntimeError('image_editor_ambiguous')
    if await title.input_value()!=job['title']:raise RuntimeError('title_mismatch')
    wanted='\n\n'.join(v for v in (job['body'],job['tags']) if v.strip()).strip()
    actual=(await read_settings_text(body)).strip().replace('\r\n','\n')
    if actual not in (wanted,wanted+'\u200b'):raise RuntimeError('body_mismatch')
    await image_receipt(page,len(job['image_paths']))
    return {'phase':'prepared','kind':'image','message':'抖音图文图片、标题和正文已核对，尚未发布。','preparationVerified':True,'titleVerified':True,'bodyVerified':True,'imageUploadVerified':True,'imageCount':len(job['image_paths']),'published':False}

async def prepare_images(page,job,check):
    root=Path(job['receipt_path']).parent
    def stage(value):
        p=root/'stage.json';p.write_text(json.dumps({'stage':value}));p.chmod(0o600)
    await check()
    notice=await page.locator('body').inner_text(timeout=5000)
    if re.search(r'上传[^\n]{0,24}(?:表示|代表|视为|即)[^\n]{0,24}(?:同意|接受)',notice) and '协议' in notice and not job.get('agreement_confirmed'):
        stage('agreement_required');raise UploadAgreementRequired()
    upload=page.locator('div[class^="container"] input[type="file"][accept*="image"]')
    if await upload.count()!=1:
        stage('upload_control_ambiguous');raise RuntimeError('image_upload_control_ambiguous')
    stage('uploading_images')
    await upload.set_input_files(job['image_paths'],timeout=10000)
    # No retry of set_input_files after any upload has started.
    stage('waiting_image_editor')
    await page.wait_for_url('**/creator-micro/content/post/image?**',timeout=90000)
    await check()
    title=page.locator(TITLE).filter(visible=True)
    editor=page.locator(EDITOR).filter(visible=True)
    await title.first.wait_for(state='visible',timeout=20000)
    if await title.count()!=1 or await editor.count()!=1:raise RuntimeError('image_editor_ambiguous')
    stage('filling_copy')
    await title.fill(job['title'],timeout=10000)
    await editor.fill('\n\n'.join(v for v in (job['body'],job['tags']) if v.strip()).strip(),timeout=10000)
    await editor.press('Tab',timeout=5000)
    await expect(title).to_have_value(job['title'],timeout=5000)
    stage('verifying_images')
    # Private structural evidence for bounded selector diagnosis, no URLs/values.
    shape=await inspect_gallery(page)
    p=root/'image-controls.json';p.write_text(json.dumps(shape));p.chmod(0o600)
    deadline=time.monotonic()+30
    while True:
        try:result=await verify_prepared(page,job,check);break
        except RuntimeError as error:
            if str(error) not in ('image_upload_incomplete',) or time.monotonic()>deadline:raise
            await asyncio.sleep(.25)
    await page.screenshot(path=job['receipt_path'],full_page=True,timeout=5000,animations='disabled')
    Path(job['receipt_path']).chmod(0o600)
    stage('prepared');result['receiptCaptured']=True
    return result
