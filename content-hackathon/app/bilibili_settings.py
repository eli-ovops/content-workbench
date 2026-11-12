"""Native Bili creator controls; no submission or model-generation actions."""
from urllib.parse import urlparse
from pathlib import Path
import json
import re
import base64
import uuid
import traceback
from playwright.async_api import expect


async def editor_frame(page):
    matches=[]
    for frame in page.frames:
        if urlparse(frame.url).hostname=='member.bilibili.com' and await frame.locator('.video-human-type').filter(visible=True).count()==1:
            matches.append(frame)
    if len(matches)!=1:raise RuntimeError('settings_editor_ambiguous')
    return matches[0]


FINGERPRINT_JS='''e=>[e,...e.querySelectorAll('*')].flatMap(n=>[
  n.style?.backgroundImage && n.style.backgroundImage!=='none' ? n.style.backgroundImage : '',
  n.tagName==='IMG' && n.naturalWidth>100 ? n.src : ''
]).filter(Boolean).join('|')'''


async def cover_fingerprint(frame):
    return await frame.locator('.cover .cover-main .cover-slot').evaluate(FINGERPRINT_JS)


async def confirm_cover(frame, dialog, click_complete=True):
    if click_complete:await dialog.locator('.cover-editor-button').get_by_text('完成',exact=True).click(timeout=10000)
    await frame.wait_for_function('''()=>{
      const dialog=document.querySelector('.cover-editor');
      return !(dialog && dialog.getClientRects().length) || [...document.querySelectorAll('*')].some(e=>e.children.length===0 && e.innerText?.trim()==='确认同步' && e.getClientRects().length);
    }''',timeout=15000)
    sync=frame.get_by_text('确认同步',exact=True).filter(visible=True)
    if await sync.count()==1:
        await sync.click(timeout=10000)
        await expect(sync).to_have_count(0,timeout=10000)
        if await dialog.count():await dialog.locator('.cover-editor-button').get_by_text('完成',exact=True).click(timeout=10000)
    await expect(dialog).to_have_count(0,timeout=30000)


async def inspect_settings(page):
    result = []
    for frame in page.frames:
        if urlparse(frame.url).hostname != 'member.bilibili.com':
            continue
        result.append(await frame.locator('body').evaluate('''body => {
          const shape = (e, depth) => ({tag:e.tagName, cls:e.className,
            text:e.children.length ? undefined : e.innerText?.trim().slice(0,160),
            children:depth ? [...e.children].slice(0,24).map(c=>shape(c,depth-1)) : undefined});
          const labels=[...body.querySelectorAll('*')].filter(e=>e.children.length===0 &&
            /^(封面|分区|标签|更换封面|添加封面)$/.test(e.innerText?.trim()) && e.getClientRects().length);
          return {uploadNavigation:[...body.querySelectorAll('.upload-nav-item')].map(e=>e.innerText?.trim()),navigation:[...body.querySelectorAll('a[href]')].filter(e=>e.getClientRects().length).map(e=>({text:e.innerText.trim().slice(0,60),href:e.href})).filter(e=>e.text),entries:[...body.querySelectorAll('*')].filter(e=>e.children.length===0&&/^(图文|图文投稿|专栏投稿|投稿|文章|专栏|动态|视频投稿|立即创作)$/.test(e.innerText?.trim())&&e.getClientRects().length).map(e=>({text:e.innerText,tag:e.tagName,cls:e.className,href:e.getAttribute('href'),target:e.getAttribute('target')})),sections:labels.map(e=>shape(e.parentElement.parentElement,7)),
            dialogs:[...body.querySelectorAll('[role="dialog"], .bcc-dialog, [class*="cover-cut"], [class*="cover"][class*="dialog"], [class*="select-dropdown"]')]
              .filter(e=>e.getClientRects().length).map(e=>shape(e,6)),
            coverCards:[...body.querySelectorAll('.cover .group-cards .card')].map(e=>shape(e,5)),
            coverTools:[...body.querySelectorAll('.cover-editor-sidebar-item,.cover-editor-panel-tool,.cover-editor-panel-select,.cover-editor-button')].map(e=>({cls:e.className,text:e.innerText?.trim(),children:[...e.children].map(c=>({tag:c.tagName,cls:c.className,text:c.innerText?.trim()}))})),
            coverPreview:[...body.querySelectorAll('.cover-editor-panel-canvas,.cover-editor-preview')].map(e=>shape(e,6)),
            files:[...body.querySelectorAll('input[type="file"]')].map(e=>({accept:e.accept,cls:e.className,parentClass:e.parentElement.className,visible:!!e.getClientRects().length,selectedCount:e.files.length})),
            tagInputs:[...body.querySelectorAll('input[placeholder*="标签"]')].map(e=>({placeholder:e.placeholder,maxLength:e.maxLength,cls:e.className}))};
        }'''))
    frame=await editor_frame(page)
    title=frame.locator('input[placeholder*="标题"]').filter(visible=True)
    body=frame.locator('[editor_id="desc_at_editor"] .ql-editor[contenteditable="true"]').filter(visible=True)
    thumbs=frame.locator('.cover .cover-recommend-list .img-item-cover')
    result.append({'nativeReadback':{'title':await title.input_value(),'body':(await body.inner_text()).strip().replace('\r\n','\n'),'category':(await frame.locator('.video-human-type .select-controller .select-item-cont').inner_text()).strip(),'tags':await frame.locator('.tag-container .label-item-v2-content').all_text_contents(),'coverPresent':bool(await cover_fingerprint(frame)),'thumbnails':await thumbs.evaluate_all('els=>els.map(e=>{const r=e.getBoundingClientRect(),p=getComputedStyle(e),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {visible:!!e.getClientRects().length,cls:e.className,parentCls:e.parentElement.className,width:r.width,height:r.height,y:r.y,pointerEvents:p.pointerEvents,hit:hit?.className,background:!!e.style.backgroundImage,images:[...e.querySelectorAll("img")].map(n=>({loaded:n.complete,width:n.naturalWidth}))}})')}})
    receipt=Path(__file__).resolve().parent.parent/'evidence'/('B站编辑设置核对-'+str(uuid.uuid4())+'.png')
    try:
        await page.screenshot(path=str(receipt),full_page=False,timeout=5000,animations='disabled',mask=[page.locator('input,textarea,[contenteditable]').filter(visible=True)])
        receipt.chmod(0o600)
    except Exception:pass
    result.append({'openPages':[{'host':urlparse(p.url).hostname,'path':urlparse(p.url).path} for p in page.context.pages if not p.is_closed()]})
    return result


async def read_categories(page, check, include_previews=True):
    await check()
    frame=await editor_frame(page)
    if await frame.locator('.cover-editor').filter(visible=True).count():raise RuntimeError('cover_dialog_open')
    control=frame.locator('.video-human-type .select-controller').filter(visible=True)
    selected=(await control.locator('.select-item-cont').inner_text()).strip()
    await control.click(timeout=10000)
    try:
        choices=frame.locator('.video-human-type .drop-list-v2-item .item-cont-main').filter(visible=True)
        await expect(choices.first).to_be_visible(timeout=10000)
        categories=[v.strip() for v in await choices.all_text_contents()]
        if not categories or len(set(categories))!=len(categories):raise RuntimeError('category_list_ambiguous')
    finally:
        await frame.locator('input[placeholder*="标题"]').filter(visible=True).click(timeout=5000)
    frames=[]
    thumbnails=frame.locator('.cover .cover-recommend-list .img-item-cover').filter(visible=True)
    for index in range(min(3,await thumbnails.count()) if include_previews else 0):
        try:frames.append({'index':index,'preview':base64.b64encode(await thumbnails.nth(index).screenshot(timeout=5000)).decode()})
        except Exception:pass
    return {'categories':[{'path':[v],'label':v} for v in categories], 'selectedPath':[selected], 'frames':frames, 'tagMaxLength':20,'tagLimit':10}


async def apply_settings(page, job, check, previous_cover=None):
    try:return await _apply_settings(page,job,check,previous_cover)
    except Exception as error:
        p=Path(job['receipt_path']).with_name('settings-failure-points.json')
        p.write_text(json.dumps({'code':type(error).__name__,'frames':[{'module':Path(f.filename).name,'line':f.lineno,'function':f.name} for f in traceback.extract_tb(error.__traceback__) if Path(f.filename).parent==Path(__file__).parent]}));p.chmod(0o600)
        raise

async def _apply_settings(page,job,check,previous_cover=None):
    def stage(value):
        p=Path(job['receipt_path']).with_name('stage.json');p.write_text(json.dumps({'stage':value}));p.chmod(0o600)
    await check()
    frame=await editor_frame(page)
    title=frame.locator('input[placeholder*="标题"],textarea[placeholder*="标题"]').filter(visible=True)
    body=frame.locator('[editor_id="desc_at_editor"] .ql-editor[contenteditable="true"]').filter(visible=True)
    if await title.count()!=1 or await body.count()!=1:raise RuntimeError('copy_editor_ambiguous')
    if await title.input_value()!=job['expected_title'] or (await body.inner_text()).strip().replace('\r\n','\n')!=job['expected_body']:raise RuntimeError('prepared_content_changed')

    # Resume only the same image already selected through the native input.
    # Read its DOM File and compare a digest; never repeat the upload on recovery.
    recovered_cover=False
    pending=frame.locator('.cover-editor').filter(visible=True)
    if await pending.count():
        sync=frame.get_by_text('确认同步',exact=True).filter(visible=True)
        if job['cover_mode']!='upload':raise RuntimeError('cover_dialog_open')
        fileinput=pending.locator('input[type="file"][accept*="image/png"]')
        if await fileinput.count()!=1:raise RuntimeError('pending_cover_input_ambiguous')
        digest=await fileinput.evaluate('''async e=>{
          if(e.files.length!==1)return null;
          const digest=await crypto.subtle.digest('SHA-256',await e.files[0].arrayBuffer());
          return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
        }''')
        if digest!=job['cover_choice']:raise RuntimeError('pending_cover_is_different')
        stage('confirming_existing_cover_sync')
        await confirm_cover(frame,pending,click_complete=await sync.count()!=1)
        recovered_cover=True

    stage('checking_category')
    catalog=await read_categories(page,check,include_previews=False)
    if job['category_path'] not in [entry['path'] for entry in catalog['categories']]:raise RuntimeError('category_not_available')
    name=job['category_path'][0]
    await frame.locator('.video-human-type .select-controller').click(timeout=10000)
    choice=frame.locator('.video-human-type .human-type-list .item-cont-main').filter(has_text=re.compile('^'+re.escape(name)+'$')).filter(visible=True)
    if await choice.count()!=1:raise RuntimeError('category_choice_ambiguous')
    await choice.click(timeout=10000)
    await expect(frame.locator('.video-human-type .select-controller .select-item-cont')).to_have_text(name,timeout=10000)

    stage('setting_tags')
    tagroot=frame.locator('.tag-container').filter(visible=True)
    if await tagroot.count()!=1:raise RuntimeError('tag_editor_ambiguous')
    items=tagroot.locator('.tag-input-wrp .label-item-v2-container').filter(visible=True)
    for _ in range(10):
        count=await items.count()
        if not count:break
        remove=items.first.locator('svg')
        if await remove.count()!=1:raise RuntimeError('tag_remove_ambiguous')
        await remove.click(timeout=5000)
        await expect(items).to_have_count(count-1,timeout=5000)
    if await items.count():raise RuntimeError('tag_clear_incomplete')
    taginput=tagroot.locator('input[placeholder*="标签"]').filter(visible=True)
    for tag in job['tags']:
        await taginput.fill(tag,timeout=5000);await taginput.press('Enter')
        await expect(items.locator('.label-item-v2-content').filter(has_text=re.compile('^'+re.escape(tag)+'$'))).to_have_count(1,timeout=10000)
    actual_tags=[v.strip() for v in await items.locator('.label-item-v2-content').all_text_contents()]
    if actual_tags!=job['tags']:raise RuntimeError('tags_mismatch')
    await check()

    stage('setting_cover')
    existing=await cover_fingerprint(frame)
    unchanged=recovered_cover or previous_cover and previous_cover['choice']==job['cover_choice'] and previous_cover['fingerprint']==existing
    if not unchanged:
        dialog=frame.locator('.cover-editor').filter(visible=True)
        if job['cover_mode']=='frame':
            if await dialog.count():await dialog.locator('.cover-editor-button').get_by_text('取消',exact=True).click(timeout=5000)
            thumbs=frame.locator('.cover .cover-recommend-list .img-item-cover').filter(visible=True)
            await expect(thumbs.nth(job['frame_index'])).to_be_visible(timeout=30000)
            await thumbs.nth(job['frame_index']).click(timeout=10000)
            await frame.wait_for_function('''()=>{
              const dialog=document.querySelector('.cover-editor');
              const slot=document.querySelector('.cover .cover-main .cover-slot');
              return (dialog && dialog.getClientRects().length) || (slot && [...slot.querySelectorAll('*')].some(n=>n.style?.backgroundImage || (n.tagName==='IMG' && n.naturalWidth>100)));
            }''',timeout=30000)
        else:
            stage('opening_cover_editor')
            if not await dialog.count():await frame.locator('.cover .cover-main .cover-slot').click(timeout=10000)
            await expect(dialog).to_be_visible(timeout=10000)
            preview=dialog.locator('.cover-phone-view-home-video-img').first
            before=await preview.evaluate(FINGERPRINT_JS)
            async with page.expect_file_chooser(timeout=10000) as chooser:
                await dialog.locator('.cover-upload .bcc-upload-wrapper').click(timeout=10000)
            stage('uploading_cover')
            await (await chooser.value).set_files(job['cover_path'],timeout=30000)
            stage('waiting_cover_preview')
            await frame.wait_for_function('''before=>{
              const e=document.querySelector('.cover-editor .cover-phone-view-home-video-img');
              if(!e)return false;
              const current=[e,...e.querySelectorAll('*')].flatMap(n=>[n.style?.backgroundImage && n.style.backgroundImage!=='none'?n.style.backgroundImage:'', n.tagName==='IMG'&&n.naturalWidth>100?n.src:'']).filter(Boolean).join('|');
              return !!current && current!==before;
            }''',arg=before,timeout=30000)
        if await dialog.count():
            stage('confirming_cover')
            await confirm_cover(frame,dialog)
    fingerprint=await cover_fingerprint(frame)
    if not fingerprint:raise RuntimeError('cover_preview_missing')
    if (await frame.locator('.video-human-type .select-controller .select-item-cont').inner_text()).strip()!=name:raise RuntimeError('category_mismatch')
    if [v.strip() for v in await items.locator('.label-item-v2-content').all_text_contents()]!=job['tags']:raise RuntimeError('tags_mismatch')
    if await title.input_value()!=job['expected_title'] or (await body.inner_text()).strip().replace('\r\n','\n')!=job['expected_body']:raise RuntimeError('copy_changed')
    await check()
    stage('capturing_settings_receipt')
    captured=False
    try:
        await frame.locator('.cover .cover-main').scroll_into_view_if_needed(timeout=5000)
        await page.screenshot(path=job['receipt_path'],full_page=True,timeout=10000,animations='disabled')
        Path(job['receipt_path']).chmod(0o600);captured=True
    except Exception:pass
    stage('settings_verified')
    return {'optionsVerified':True,'coverVerified':True,'categoryVerified':True,'tagsVerified':True,'titleBodyUnchanged':True,'receiptCaptured':captured,'appliedCategory':job['category_path'],'appliedTags':actual_tags,'coverMode':job['cover_mode'],'message':'B站视频、文案、封面、分区和标签已核对；创作声明请本人核对，尚未投稿。'+('' if captured else '截图未取得；以当前页面回读为准。'),'_coverReceipt':{'choice':job['cover_choice'],'fingerprint':fingerprint}}
