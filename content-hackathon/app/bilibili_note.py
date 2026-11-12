"""Bilibili creator-page preparation only. Never submits or picks declarations."""
from pathlib import Path
import json
import re
from playwright.async_api import expect

async def prepare_video(page,job,check):
    def stage(value):
        p=Path(job['receipt_path']).with_name('stage.json');p.write_text(json.dumps({'stage':value}));p.chmod(0o600)
    await check()
    frames=[f for f in page.frames if f.url.startswith('https://member.bilibili.com/')]
    candidates=[]
    for frame in frames:
        areas=frame.locator('.bcc-upload-wrapper .upload-area').filter(visible=True)
        if await areas.count()==1 and await areas.get_by_text('上传视频',exact=True).count()==1:
            candidates.append((frame,areas))
    if len(candidates)!=1:raise RuntimeError('upload_frame_ambiguous')
    frame,upload=candidates[0]
    stage('uploading_video')
    async with page.expect_file_chooser(timeout=10000) as chooser:
        await upload.click(timeout=10000)
    await (await chooser.value).set_files(job['video_path'],timeout=30000)
    title=frame.locator('input[placeholder*="标题"],textarea[placeholder*="标题"]').filter(visible=True)
    stage('waiting_title')
    await title.first.wait_for(state='visible',timeout=90000)
    if await title.count()!=1:raise RuntimeError('title_editor_ambiguous')
    await check()
    stage('filling_title')
    await title.fill(job['title'],timeout=10000)
    editor=frame.locator('[editor_id="desc_at_editor"] .ql-editor[contenteditable="true"]').filter(visible=True)
    if not await editor.count():editor=frame.locator('.ql-editor[contenteditable="true"]').filter(visible=True)
    if await editor.count()!=1:raise RuntimeError('body_editor_ambiguous')
    text='\n\n'.join(v for v in (job['body'],job['tags']) if v.strip())
    stage('filling_body')
    await editor.fill(text,timeout=10000)
    await title.press('Tab')
    await check()
    stage('waiting_upload_complete')
    await expect(frame.get_by_text(re.compile('^(上传完成|上传成功)$')).filter(visible=True).first).to_be_visible(timeout=90000)
    if await title.input_value()!=job['title']:raise RuntimeError('title_mismatch')
    if (await editor.inner_text()).strip().replace('\r\n','\n')!=text.strip():raise RuntimeError('body_mismatch')
    stage('capturing_receipt')
    captured=False
    try:
        await title.scroll_into_view_if_needed(timeout=5000)
        await page.screenshot(path=job['receipt_path'],full_page=True,timeout=5000,animations='disabled')
        Path(job['receipt_path']).chmod(0o600);captured=True
    except Exception:pass
    stage('prepared')
    return {'phase':'prepared','message':'B站视频、标题和简介已填入，上传完成已核对；分区、标签及声明请在编辑页核对，尚未投稿。','preparationVerified':True,'titleVerified':True,'bodyVerified':True,'videoUploadVerified':True,'receiptCaptured':captured}
