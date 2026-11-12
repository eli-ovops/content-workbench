"""Adapted native social-auto-upload video flow; preparation only, no publish.

MIT attribution: THIRD_PARTY_LICENSES/social-auto-upload.txt. Selectors derive
from the fixed 0012d2c reference. No stealth, cookie export, or declarations.
"""
import json
import re
import time
from pathlib import Path
from playwright.async_api import expect

class UploadAgreementRequired(Exception):pass

async def read_editable_text(editor):
    # innerText counts a blank <div><br></div> twice in Chromium. Read native
    # paragraph boundaries without collapsing intentionally repeated blank lines.
    return await editor.evaluate('''e=>{const read=node=>Array.from(node.childNodes).map((n,i)=>{
      if(n.nodeType===3)return n.textContent;
      if(n.nodeType!==1)return '';
      if(n.tagName==='BR')return '\\n';
      const block=['DIV','P'].includes(n.tagName);
      const emptyBreak=block&&n.childNodes.length===1&&n.firstChild.nodeName==='BR';
      return (block&&i>0?'\\n':'')+(emptyBreak?'':read(n));
    }).join('');return read(e);}''')

async def prepare_video(page, job, check):
    deadline=time.monotonic()+150
    def remaining():return max(1,int((deadline-time.monotonic())*1000))
    def stage(value):
        path=Path(job['receipt_path']).with_name('stage.json')
        path.write_text(json.dumps({'stage':value}));path.chmod(0o600)
    await check()
    notice=await page.locator('body').inner_text(timeout=5000)
    if re.search(r'上传[^\n]{0,24}(?:表示|代表|视为|即)[^\n]{0,24}(?:同意|接受)',notice) and '协议' in notice and not job.get('agreement_confirmed'):
        stage('agreement_required')
        raise UploadAgreementRequired()
    upload=page.locator('input.upload-btn-input[type="file"]')
    if await upload.count()!=1:
        upload=page.locator('input[type="file"][accept*="video"],input[type="file"][accept*=".mp4"]')
    if await upload.count()!=1:
        stage('upload_control_ambiguous')
        raise RuntimeError('upload_control_ambiguous')
    stage('uploading_video')
    await upload.set_input_files(job['video_path'],timeout=10000)
    stage('waiting_editor')
    title=page.locator('input[placeholder*="填写作品标题"]').filter(visible=True)
    await title.first.wait_for(state='visible',timeout=remaining())
    await check()
    if await title.count()!=1:raise RuntimeError('title_editor_ambiguous')
    editor=page.locator('div.zone-container[contenteditable="true"]').filter(visible=True)
    await editor.first.wait_for(state='visible',timeout=remaining())
    if await editor.count()!=1:raise RuntimeError('body_editor_ambiguous')
    text='\n\n'.join(v for v in (job['body'],job['tags']) if v.strip()).strip()
    stage('filling_copy')
    await title.fill(job['title'],timeout=10000)
    await editor.fill(text,timeout=10000)
    await editor.press('Tab',timeout=5000)
    await check()
    stage('waiting_upload_complete')
    failure=page.get_by_text('上传失败',exact=True).filter(visible=True)
    if await failure.count():raise RuntimeError('video_upload_failed')
    complete=page.locator('[class^="long-card"]').get_by_text('重新上传',exact=True).filter(visible=True)
    await expect(complete.first).to_be_visible(timeout=remaining())
    await check()
    if await failure.count():raise RuntimeError('video_upload_failed')
    await expect(title).to_have_value(job['title'],timeout=min(5000,remaining()))
    actual=(await editor.inner_text()).strip().replace('\r\n','\n')
    # EditorKit appends one invisible U+200B at the end; do not remove embedded
    # characters or otherwise relax the complete text comparison.
    accepted=(text,text+'\u200b')
    if actual not in accepted and (await read_editable_text(editor)).strip().replace('\r\n','\n') not in accepted:raise RuntimeError('body_mismatch')
    stage('capturing_receipt')
    captured=False
    try:
        await page.screenshot(path=job['receipt_path'],full_page=True,timeout=5000,animations='disabled',mask=[page.locator('input[type="tel"],input[type="password"]')])
        Path(job['receipt_path']).chmod(0o600);captured=True
    except Exception:pass
    stage('prepared')
    return {'phase':'prepared','message':'抖音视频、标题和正文已填入，上传完成已核对；封面与声明请本人核对，尚未发布。','preparationVerified':True,'titleVerified':True,'bodyVerified':True,'videoUploadVerified':True,'receiptCaptured':captured,'published':False}
