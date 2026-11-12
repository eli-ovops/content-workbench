"""Local review-only adaptation of social-auto-upload's XiaoHongShuNote.

Copyright (c) 2023 dreammis. MIT; see THIRD_PARTY_LICENSES/social-auto-upload.txt.
Source: commit 0012d2c355f88f683cc38dde2a2db209e14091bc,
uploader/xiaohongshu_uploader/main.py, XiaoHongShuNote.upload_note_content.
Uses the upstream image input/title/body workflow; removes stealth scripts,
cookie export, geolocation permission, automatic declarations and final publish.
"""
from urllib.parse import urlparse
from pathlib import Path
import json
import asyncio
import time
from playwright.async_api import expect

PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image'

class ManualIntervention(Exception):
    pass

def video_caption(page):
    return page.locator('.video-preview .user-desc-wrapper, .video-preview .user-desc-wrapper2').filter(visible=True)

async def wait_video_upload(page, timeout=90000):
    # The official component renders preview-new only in its Preview state,
    # after Uploading/Transcoding; quality advice varies for HD and lower sizes.
    await expect(page.locator('.preview-new')).to_be_visible(timeout=timeout)

async def fill_title(page, text, timeout=10000, video=False):
    title = page.locator('input[placeholder*="填写标题"]').filter(visible=True)
    if await title.count() != 1:
        raise RuntimeError('title_editor_ambiguous')
    await title.fill(text, timeout=timeout)
    # The official title component debounces its model update by 300 ms.
    # Observe the rendered preview rather than assuming input.value is committed.
    preview = video_caption(page) if video else page.locator('.image-preview .title')
    await expect(preview).to_be_visible(timeout=timeout)
    await expect(preview).to_have_text(text, use_inner_text=True, timeout=timeout)
    return title

def image_input(page):
    # Current live creator page uses extension lists rather than image/*.
    return page.locator('input[type="file"][accept*="image"], input[type="file"][accept*=".jpg"], div[class^="upload-content"] input.upload-input').first

def video_input(page):
    return page.locator('input[type="file"][accept*="video"], input[type="file"][accept*=".mp4"], div[class^="upload-content"] input.upload-input').first

async def body_editor(page):
    # Placeholder paragraphs disappear after typing. Bind the stable editor root.
    candidates = page.locator('.tiptap.ProseMirror[contenteditable="true"], .ql-editor[contenteditable="true"]').filter(visible=True)
    if not await candidates.count():
        candidates = page.locator('[contenteditable="true"]').filter(visible=True)
    if await candidates.count() != 1:
        raise RuntimeError('body_editor_ambiguous')
    return candidates.first

async def check_intervention(page):
    if urlparse(page.url).hostname != 'creator.xiaohongshu.com':
        raise ManualIntervention('unexpected_origin')
    text = await page.locator('body').inner_text(timeout=5000)
    if any(s in text for s in ('请完成安全验证', '请拖动滑块', '操作过于频繁', '访问异常', '验证码错误', '请完成验证')):
        raise ManualIntervention('verification_required')

async def ready(page):
    await check_intervention(page)
    if '/login' in page.url:
        return False
    for selector in ('div[class*="login-box"]', '.login-box-container'):
        box = page.locator(selector).first
        if await box.count() and await box.is_visible():
            return False
    # Positive publish control evidence; absence of a login dialog is not enough.
    return (await image_input(page).count() > 0
            or await page.locator('input[placeholder*="填写标题"]').first.is_visible())

async def logical_text(node):
    # Preserve authored paragraph/blank-line boundaries; Chromium innerText
    # inserts a second display newline between ProseMirror paragraphs.
    return await node.evaluate("""e=>{const read=node=>Array.from(node.childNodes).map((n,i)=>{
      if(n.nodeType===3)return n.textContent;if(n.nodeType!==1)return '';
      if(n.tagName==='BR')return '\\n';const block=['DIV','P'].includes(n.tagName);
      return (block&&i>0?'\\n':'')+(block&&n.childNodes.length===1&&n.firstChild.nodeName==='BR'?'':read(n));
    }).join('');return read(e);}""")

async def verify_body_preview(node,text,timeout=10000):
    deadline=time.monotonic()+timeout/1000
    while True:
        if (await logical_text(node)).strip().replace('\r\n','\n')==text.strip():return
        if time.monotonic()>=deadline:raise RuntimeError('body_preview_mismatch')
        await asyncio.sleep(.1)

async def prepare_note(page, job):
    def stage(value):
        if job.get('receipt_path'):
            path = Path(job['receipt_path']).with_name('stage.json')
            path.write_text(json.dumps({'stage':value}))
            path.chmod(0o600)
    # connect() already brought the authenticated session to this empty editor.
    # Do not reload it: SPA controls may not exist immediately after DOMContentLoaded.
    if urlparse(page.url).path != '/publish/publish':
        await page.goto(PUBLISH_URL.replace('target=image','target=video') if job.get('kind')=='video' else PUBLISH_URL, wait_until='domcontentloaded', timeout=45000)
    video = job.get('kind') == 'video'
    upload_input = video_input(page) if video else image_input(page)
    stage('waiting_image_input')
    await upload_input.wait_for(state='attached', timeout=30000)
    if not await ready(page):
        raise ManualIntervention('login_required')
    stage('uploading_images')
    await upload_input.set_input_files(job['video_path'] if video else job['image_paths'], timeout=30000)
    if video:
        stage('waiting_video_upload')
        upload_preview=page.locator('.preview-new')
        await wait_video_upload(page)
        if job.get('receipt_path'):
            diagnostic=Path(job['receipt_path']).with_name('video-upload-state.json')
            diagnostic.write_text(json.dumps({'stages':await upload_preview.locator('.stage').all_text_contents()},ensure_ascii=False));diagnostic.chmod(0o600)
            try:
                await page.screenshot(path=str(Path(job['receipt_path']).with_name('video-upload.png')),full_page=True,timeout=5000,animations='disabled')
                Path(job['receipt_path']).with_name('video-upload.png').chmod(0o600)
            except Exception:
                pass
    title = page.locator('input[placeholder*="填写标题"]').first
    stage('waiting_title')
    await title.wait_for(state='visible', timeout=60000)
    await check_intervention(page)
    guide_close = page.get_by_role('button', name='关闭新功能引导', exact=True)
    if await guide_close.count() and await guide_close.is_visible():
        await guide_close.click(timeout=5000)
    stage('filling_title')
    title = await fill_title(page, job['title'], video=video)
    editor = await body_editor(page)
    stage('waiting_body')
    await editor.wait_for(state='visible', timeout=15000)
    text = '\n\n'.join(v for v in (job['body'], job['tags']) if v.strip())
    stage('filling_body')
    await editor.fill(text, timeout=10000)
    await check_intervention(page)
    stage('verifying_fields')
    if await title.input_value() != job['title']:
        raise RuntimeError('title_mismatch')
    if not video:
        await expect(page.locator('.image-preview .title')).to_have_text(job['title'], use_inner_text=True, timeout=10000)
    stage('verifying_body')
    if (await logical_text(editor)).strip().replace('\r\n', '\n') != text.strip():
        raise RuntimeError('body_mismatch')
    if video:
        await expect(video_caption(page)).to_have_text(' '.join(v for v in (job['title'],text) if v.strip()), use_inner_text=True, timeout=10000)
    else:
        await verify_body_preview(page.locator('.image-preview .info'),text)
        await expect(page.locator('.img-preview-area img.preview')).to_have_count(len(job['image_paths']), timeout=30000)
    receipt_captured = False
    if job.get('receipt_path'):
        stage('capturing_receipt')
        try:
            await title.scroll_into_view_if_needed(timeout=5000)
            await page.screenshot(path=job['receipt_path'], full_page=True,timeout=5000,animations='disabled')
            receipt_captured = True
        except Exception:
            pass  # Screenshot failure does not invalidate successful field readback.
    stage('prepared')
    # Deliberately no click on publish/save-draft/declaration controls.
    return {'phase': 'prepared','kind':'video' if video else 'image', 'message': ('视频' if video else '图片')+'、标题和正文已传入小红书编辑页，预览核对通过。尚未发布。','titleVerified':True,'titlePreviewVerified':True,'bodyVerified':True,'bodyPreviewVerified':True,'imageCountVerified':not video,'videoUploadVerified':video,'receiptCaptured':receipt_captured}

async def verify_current(page,job):
    await check_intervention(page)
    if not job:raise RuntimeError('missing_preparation_job')
    title=page.locator('input[placeholder*="填写标题"]').filter(visible=True)
    if await title.count()!=1 or await title.input_value()!=job['title']:raise RuntimeError('title_mismatch')
    text='\n\n'.join(v for v in (job['body'],job['tags']) if v.strip()).strip()
    if (await logical_text(await body_editor(page))).strip().replace('\r\n','\n')!=text:raise RuntimeError('body_mismatch')
    if job.get('kind')=='video':
        preview=video_caption(page)
        if await preview.count()!=1 or (await preview.inner_text()).strip()!=' '.join(v for v in (job['title'],text) if v.strip()):raise RuntimeError('preview_mismatch')
        if not await page.locator('.preview-new').is_visible():raise RuntimeError('upload_unverified')
    else:
        if (await page.locator('.image-preview .title').inner_text()).strip()!=job['title']:raise RuntimeError('title_preview_mismatch')
        if (await logical_text(page.locator('.image-preview .info'))).strip().replace('\r\n','\n')!=text:raise RuntimeError('body_preview_mismatch')
        if await page.locator('.img-preview-area img.preview').count()!=len(job['image_paths']):raise RuntimeError('image_count_mismatch')
