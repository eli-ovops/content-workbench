"""Native Douyin cover/topic settings only; no publish, draft-save or AI action."""
import json
import re
import asyncio
import hashlib
from pathlib import Path
from playwright.async_api import expect
from douyin_note import read_editable_text

MODAL='div.dy-creator-content-modal'

async def read_settings_text(editor):
    return await editor.evaluate('''e=>{const read=node=>Array.from(node.childNodes).map((n,i)=>{
      if(n.nodeType===3)return n.textContent;if(n.nodeType!==1)return '';
      if(n.hasAttribute('data-zero-space')||(n.hasAttribute('data-enter')&&n.textContent==='\\u200b'))return '';
      if(n.hasAttribute('data-fake-text')&&n.getAttribute('contenteditable')==='false')return n.textContent.trim();
      if(n.tagName==='BR')return '\\n';const block=['DIV','P'].includes(n.tagName);
      return (block&&i>0?'\\n':'')+(block&&n.childNodes.length===1&&n.firstChild.nodeName==='BR'?'':read(n));
    }).join('');return read(e);}''')

async def dismiss_notice(page):
    notice=page.get_by_role('button',name='我知道了',exact=True).filter(visible=True)
    if await notice.count()==1:await notice.click(timeout=5000)

async def open_cover(page):
    modal=page.locator(MODAL).filter(visible=True)
    if await modal.count()==1:return modal
    await dismiss_notice(page)
    trigger=page.get_by_text('选择封面',exact=True).filter(visible=True)
    if await trigger.count()!=2:raise RuntimeError('cover_entry_ambiguous')
    await trigger.nth(0).click(timeout=10000)
    await modal.wait_for(state='visible',timeout=15000)
    return modal

async def inspect_settings(page):
    modal=page.locator(MODAL).filter(visible=True)
    editor=page.locator('div.zone-container').filter(visible=True)
    if not await modal.count():
        text=(await read_editable_text(editor)).strip()
        return {'imageGallery':await __import__('douyin_image').inspect_gallery(page) if '/content/post/image' in page.url else None, 'modalCount':0,'bodyHash':hashlib.sha256(text.encode()).hexdigest(),'nativeTopics':await native_topics(editor),'editorNodes':await editor.locator('span,a').evaluate_all('els=>els.map(e=>({tag:e.tagName,text:e.innerText,className:e.className,attrs:Array.from(e.attributes).map(a=>({name:a.name,value:a.name==="href"?"link-present":a.value}))}))'),'panels':await page.locator('[class*="mention" i],[class*="suggest" i],[role="listbox"]').evaluate_all('els=>els.filter(e=>e.offsetWidth||e.offsetHeight).map(e=>({tag:e.tagName,className:e.className,role:e.getAttribute("role"),text:e.innerText.slice(0,600)}))')}
    return {'modalCount':await modal.count(),'texts':(await modal.inner_text()).splitlines()[:65],'tabs':await modal.get_by_text(re.compile('^设置[横竖]封面$')).evaluate_all('els=>els.map(e=>({text:e.innerText,tag:e.tagName,role:e.getAttribute("role"),className:e.className,parent:e.parentElement.className,grandparent:e.parentElement.parentElement.className}))'),'inputs':await modal.locator('input').evaluate_all('els=>els.map(e=>({type:e.type,accept:e.accept,className:e.className,visible:!!(e.offsetWidth||e.offsetHeight),parent:e.parentElement.className}))'),'buttons':await modal.locator('button,[role="button"]').evaluate_all('els=>els.filter(e=>e.offsetWidth||e.offsetHeight).map(e=>({text:e.innerText,role:e.getAttribute("role"),className:e.className}))'),'editorNodeShapes':await page.locator('div.zone-container').evaluate_all('els=>els.flatMap(e=>Array.from(e.querySelectorAll("span,a")).map(n=>({tag:n.tagName,className:n.className,attrs:Array.from(n.attributes).map(a=>a.name)})))')}

async def cover_fingerprints(page):
    # URLs stay in worker-private memory/receipts, never public responses.
    return await page.locator('body').evaluate('''e=>['横封面','竖封面'].map((label,index)=>{
      const caption=Array.from(e.querySelectorAll('span,p,div')).find(n=>new RegExp('^'+label+'\\\\s*[（(]?\\\\s*'+(index?'3[:：]4':'4[:：]3')+'[）)]?$').test(n.textContent.trim()));
      if(!caption)return null;
      for(let parent=caption.parentElement,depth=0;parent&&depth<4;parent=parent.parentElement,depth++){
        const images=Array.from(parent.querySelectorAll('img')).filter(i=>i.naturalWidth>0&&i.getBoundingClientRect().width>=50);
        if(images.length===1)return images[0].currentSrc||images[0].src;
        if(images.length>1){const box=caption.getBoundingClientRect();const center=box.left+box.width/2;const nearest=images.map(i=>({image:i,delta:Math.abs(i.getBoundingClientRect().left+i.getBoundingClientRect().width/2-center)})).sort((a,b)=>a.delta-b.delta);if(nearest[0].delta<80&&(!nearest[1]||nearest[1].delta-nearest[0].delta>20))return nearest[0].image.currentSrc||nearest[0].image.src;return null;}
      }return null;
    }).filter(Boolean)''')

async def native_topics(editor):
    return await editor.evaluate('''e=>{const nodes=Array.from(e.querySelectorAll('span,a'));return [...new Set(nodes.filter(n=>{
      const t=(n.innerText||n.textContent||'').trim();return t.startsWith('#')&&(n.getAttribute('contenteditable')==='false'||n.hasAttribute('data-topic-id')||n.hasAttribute('data-topic')||n.getAttribute('data-type')==='topic'||/topic|mention|hashtag/.test(n.className));
    }).map(n=>(n.innerText||n.textContent||'').trim().replace(/^#/,'').trim()))];}''')

async def apply_settings(page,job,check,previous_cover=None):
    root=Path(job['receipt_path']).parent
    def stage(value):
        path=root/'stage.json';path.write_text(json.dumps({'stage':value}));path.chmod(0o600)
    await check()
    title=page.locator('input[placeholder*="作品标题"]').filter(visible=True)
    editor=page.locator('div.zone-container[contenteditable="true"]').filter(visible=True)
    if await title.count()!=1 or await editor.count()!=1:raise RuntimeError('editor_ambiguous')
    if await title.input_value()!=job['expected_title']:raise RuntimeError('title_changed')
    base=job['expected_body'].strip()
    topics=job.get('topics') or []
    wanted=base+('\n\n'+' '.join('#'+t for t in topics) if topics else '')
    if len(wanted.encode('utf-16-le'))//2>1000:raise RuntimeError('copy_limit')
    current_raw=(await read_editable_text(editor)).strip()
    current=(await read_settings_text(editor)).strip()
    previous_cover=dict(previous_cover or {})
    # Recovery is restricted to a recorded failed settings job for this draft,
    # the same verified cover choice, and unchanged editor content.
    if previous_cover and not previous_cover.get('body') and not previous_cover.get('failedBodyHash') and root.parent.resolve()==(Path(__file__).resolve().parent/'.runtime/douyin/jobs').resolve():
        for directory in sorted(root.parent.iterdir(),key=lambda p:p.stat().st_mtime,reverse=True)[:10]:
            record_path=directory/'partial-cover.json'
            if not record_path.is_file():continue
            record=json.loads(record_path.read_text())
            if record.get('draft_id')==job['draft_id'] and record.get('choice')==previous_cover.get('choice') and record.get('fingerprints')==previous_cover.get('fingerprints') and record.get('failedBodyHash'):
                previous_cover.update(record);break
    known=[base,wanted]+([previous_cover['body']] if previous_cover and previous_cover.get('body') else [])
    recovery=previous_cover.get('failedBodyHash')==hashlib.sha256(current_raw.encode()).hexdigest()
    if not recovery and not any(current in (v,v+'\u200b') for v in known):raise RuntimeError('body_changed')
    cover_verified=False;cover_uploaded=False
    fingerprints=await cover_fingerprints(page)
    receipt=dict(previous_cover or {});receipt['draft_id']=job['draft_id']
    if job['cover_mode']=='upload':
        if previous_cover and previous_cover.get('choice')==job['cover_choice'] and previous_cover.get('fingerprints')==fingerprints and len(fingerprints)==2:
            cover_verified=True
        else:
            previous_fingerprints=list(fingerprints)
            modal=await open_cover(page)
            cover_uploaded=True
            for label in ('设置横封面','设置竖封面'):
                stage('uploading_'+label)
                tab=modal.locator('[class^="steps-"]').get_by_text(label,exact=True).filter(visible=True)
                if await tab.count()!=1:raise RuntimeError('cover_tab_ambiguous')
                await tab.click(timeout=5000)
                wrapper=modal.locator('.semi-upload:has(.semi-upload-drag-area-main-text)').filter(visible=True)
                if await wrapper.count()!=1:raise RuntimeError('cover_upload_ambiguous')
                for file_input in await wrapper.locator('input[type="file"]').all():
                    if await file_input.evaluate('e=>e.files.length'):
                        await file_input.set_input_files([])
                async with page.expect_file_chooser(timeout=10000) as chooser:
                    await wrapper.click(timeout=10000)
                await(await chooser.value).set_files(job['cover_path'],timeout=10000)
                finish=modal.get_by_role('button',name='完成',exact=True)
                if await finish.count()>1:finish=modal.locator('button[class*=" primary-"]').filter(has_text=re.compile('^完成$'))
                await expect(finish).to_be_enabled(timeout=45000)
                await expect(finish).not_to_have_class(re.compile('.*disabled.*'),timeout=45000)
            stage('finishing_cover')
            await finish.click(timeout=10000)
            await expect(modal).to_have_count(0,timeout=20000)
            for _ in range(50):
                fingerprints=await cover_fingerprints(page)
                if len(fingerprints)==2 and fingerprints!=previous_fingerprints:break
                await asyncio.sleep(0.1)
            if len(fingerprints)!=2:raise RuntimeError('two_cover_previews_required')
            if fingerprints==previous_fingerprints:raise RuntimeError('cover_preview_unchanged')
            cover_verified=True
            receipt.update({'choice':job['cover_choice'],'fingerprints':fingerprints})
            path=root/'partial-cover.json';path.write_text(json.dumps(receipt));path.chmod(0o600)
    elif await page.locator(MODAL).filter(visible=True).count():
        cancel=page.locator(MODAL).get_by_role('button',name='取消',exact=True)
        if await cancel.count()!=1:raise RuntimeError('cover_editor_open')
        await cancel.click(timeout=5000)
    stage('filling_native_topics')
    await dismiss_notice(page)
    await editor.click(timeout=5000)
    await editor.press('ControlOrMeta+A')
    await editor.press('Backspace')
    cleared=False
    for _ in range(20):
        if (await read_settings_text(editor)).strip() in ('','\u200b'):cleared=True;break
        await asyncio.sleep(0.1)
    if not cleared:raise RuntimeError('editor_clear_failed')
    await page.keyboard.insert_text(base)
    if topics:
        await editor.press('Enter');await editor.press('Enter')
    for topic in topics:
        await editor.press_sequentially('#')
        await page.keyboard.insert_text(topic)
        await editor.press('ArrowRight')
        outside=page.locator('body :not(.zone-container):not(.zone-container *)')
        for _ in range(20):
            candidate=page.get_by_text(topic,exact=True).and_(outside).filter(visible=True)
            if await candidate.count()!=1:candidate=page.get_by_text('#'+topic,exact=True).and_(outside).filter(visible=True)
            if await candidate.count()==1:break
            await asyncio.sleep(0.1)
        if await candidate.count()!=1:
            receipt['failedBodyHash']=hashlib.sha256((await read_editable_text(editor)).strip().encode()).hexdigest()
            path=root/'partial-cover.json';path.write_text(json.dumps(receipt));path.chmod(0o600)
            raise RuntimeError('exact_topic_candidate_missing')
        await candidate.click(timeout=5000)
        await editor.press('Escape')
        if not (await read_settings_text(editor)).endswith((' ','\u00a0')):
            await page.keyboard.insert_text(' ')
    await editor.press('Tab')
    await check()
    stage('verifying_settings')
    actual=(await read_settings_text(editor)).strip()
    if actual not in (wanted,wanted+'\u200b'):
        receipt['failedBodyHash']=hashlib.sha256((await read_editable_text(editor)).strip().encode()).hexdigest();path=root/'partial-cover.json';path.write_text(json.dumps(receipt));path.chmod(0o600)
        raise RuntimeError('topic_body_mismatch')
    marked=await native_topics(editor)
    if any(t not in marked for t in topics):raise RuntimeError('native_topic_nodes_missing')
    if await title.input_value()!=job['expected_title']:raise RuntimeError('title_changed')
    receipt['body']=wanted
    receipt.pop('failedBodyHash',None)
    await page.screenshot(path=job['receipt_path'],full_page=True,timeout=5000,animations='disabled')
    Path(job['receipt_path']).chmod(0o600)
    stage('settings_verified')
    return {'optionsVerified':True,'topicsVerified':True,'appliedTopics':topics,'coverVerified':cover_verified if job['cover_mode']=='upload' else None,'horizontalCoverVerified':cover_verified if job['cover_mode']=='upload' else None,'verticalCoverVerified':cover_verified if job['cover_mode']=='upload' else None,'coverUploadPerformed':cover_uploaded,'videoUploadPerformed':False,'titleVerified':True,'bodyVerified':True,'bodyBaseUnchanged':True,'receiptCaptured':True,'message':('抖音封面和话题已核对，视频及原文保留' if job['cover_mode']=='upload' else '抖音话题已核对，当前封面及原文保留')+'；自主声明请本人核对，尚未发布。','_coverReceipt':receipt}
