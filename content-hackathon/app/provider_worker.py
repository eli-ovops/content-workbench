"""Visible-browser login and inspection; Bili video preparation, never submission."""
import asyncio
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from douyin_note import UploadAgreementRequired

PROVIDERS={
 'douyin':{'name':'抖音','url':'https://creator.douyin.com/creator-micro/content/upload','hosts':{'creator.douyin.com','www.douyin.com'}},
 'bilibili':{'name':'B站','url':'https://member.bilibili.com/platform/upload/video/frame','hosts':{'member.bilibili.com','passport.bilibili.com','www.bilibili.com'}},
}
class Intervention(Exception):pass
class NewEditorFailure(Exception):pass

class Worker:
 def __init__(self,platform):
  if platform not in PROVIDERS:raise ValueError('invalid_platform')
  self.platform=platform;self.config=PROVIDERS[platform]
  self.context=None;self.page=None;self.playwright=None
  self.phase='not_connected'
  self.prepared_result=None
  self.prepared_pages=[]
  self.current_job=None
  self.cover_receipt=None
  self.login_network=[]
  self.prepare_lock=None
  self.upload_agreement_required=False
  self.editor_kind='video'
  self.expected_copy=None
 async def verify_current(self):
  """Read current controls on every status; cached receipts are never proof."""
  await self.check()
  if not self.current_job:raise RuntimeError('missing_preparation_job')
  job=self.current_job
  wanted=self.expected_copy or '\n\n'.join(v for v in (job['body'],job['tags']) if v.strip()).strip()
  if self.platform=='douyin':
   from douyin_settings import read_settings_text
   title=self.page.locator('input[placeholder*="作品标题"]').filter(visible=True)
   body=self.page.locator('div.zone-container[contenteditable="true"]').filter(visible=True)
   if await title.count()!=1 or await body.count()!=1:raise RuntimeError('editor_ambiguous')
   actual=(await read_settings_text(body)).strip().replace('\r\n','\n')
   if await title.input_value()!=job['title'] or actual not in (wanted,wanted+'\u200b'):raise RuntimeError('copy_changed')
   if self.editor_kind=='image':
    from douyin_image import image_receipt
    await image_receipt(self.page,len(job['image_paths']))
   else:
    complete=self.page.locator('[class^="long-card"]').get_by_text('重新上传',exact=True).filter(visible=True)
    if not await complete.count() or await self.page.get_by_text('上传失败',exact=True).filter(visible=True).count():raise RuntimeError('upload_unverified')
  else:
   frames=[f for f in self.page.frames if urlparse(f.url).hostname=='member.bilibili.com']
   matched=[]
   for f in frames:
    title=f.locator('input[placeholder*="标题"],textarea[placeholder*="标题"]').filter(visible=True)
    body=f.locator('[editor_id="desc_at_editor"] .ql-editor[contenteditable="true"]').filter(visible=True)
    if await title.count()==1 and await body.count()==1:matched.append((f,title,body))
   if len(matched)!=1:raise RuntimeError('editor_ambiguous')
   f,title,body=matched[0]
   import re
   if await title.input_value()!=job['title'] or (await body.inner_text()).strip().replace('\r\n','\n')!=wanted:raise RuntimeError('copy_changed')
   if not await f.get_by_text(re.compile('^(上传完成|上传成功)$')).filter(visible=True).count():raise RuntimeError('upload_unverified')
  return {**self.prepared_result,'preparationVerified':True,'titleVerified':True,'bodyVerified':True,'currentReadback':True}
 async def enter_upload(self,page,kind):
  if self.platform!='douyin':return
  import douyin_login
  from importlib import reload
  await reload(douyin_login).enter_upload(page,kind)
 def login_response(self,response):
  parsed=urlparse(response.url)
  if self.platform=='douyin' and response.status>=400 and parsed.hostname and (parsed.hostname.endswith('.douyin.com') or parsed.hostname.endswith('.snssdk.com')):
   # No query strings, body, headers, login token, cookie, or contact details.
   self.login_network.append({'host':parsed.hostname,'status':response.status,'resourceType':response.request.resource_type})
   self.login_network=self.login_network[-20:]
 async def check_page(self,page):
  if urlparse(page.url).hostname not in self.config['hosts']:raise Intervention('unexpected_origin')
  for frame in page.frames:
   if urlparse(frame.url).hostname not in self.config['hosts']:continue
   text=await frame.locator('body').inner_text(timeout=5000)
   if any(t in text for t in ('请完成安全验证','请拖动滑块','操作过于频繁','访问异常','请完成验证')):raise Intervention('verification_required')
 async def check(self):
  await self.check_page(self.page)
 async def retained_snapshot(self,page):
  from douyin_settings import read_settings_text,native_topics,cover_fingerprints
  title=page.locator('input[placeholder*="作品标题"]').filter(visible=True)
  body=page.locator('div.zone-container[contenteditable="true"]').filter(visible=True)
  if await title.count()!=1 or await body.count()!=1:raise NewEditorFailure('previous_editor_ambiguous')
  return {'page':page,'title':await title.input_value(),'body':(await read_settings_text(body)).strip(),'topics':await native_topics(body),'covers':await cover_fingerprints(page)}
 async def status(self):
  if not self.page or self.page.is_closed():self.phase='not_connected'
  elif self.phase=='prepared':
   try:return {**await self.verify_current(),'newEditorSupported':True}
   except Intervention:raise
   except Exception:return {**(self.prepared_result or {}),'phase':'prepared','preparationVerified':False,'titleVerified':False,'bodyVerified':False,'titlePreviewVerified':False,'bodyPreviewVerified':False,'currentReadback':False,'newEditorSupported':True,'message':'当前编辑页内容或上传状态无法核对；旧记录仅供参考，请检查，勿重传。'}
  elif self.platform=='douyin' and self.prepare_lock:
   await self.check()
   if self.editor_kind=='image' and self.current_job:
    # Recover only from complete native readback of this exact frozen job.
    # This path cannot upload, fill, publish, or click any control.
    try:
     import douyin_image
     from importlib import reload
     result=await reload(douyin_image).verify_prepared(self.page,self.current_job,self.check)
     result['draftId']=self.current_job.get('draft_id')
     self.phase='prepared';self.prepared_result=result
     self.prepared_pages.append({'page':self.page,'title':self.current_job['title'],'body':'\n\n'.join(v for v in (self.current_job['body'],self.current_job['tags']) if v.strip()).strip()})
     return {**result,'newEditorSupported':True}
    except Intervention:raise
    except Exception:pass
   return {'phase':'preparation_incomplete','message':'抖音上一项上传或填写未完成，请先核对当前编辑页；重复上传已锁定。','preparationVerified':False}
  elif self.phase not in ('error','verification_required','unexpected_origin'):
   await self.check();guest=False;upload=False
   if self.platform=='douyin':
    import douyin_login
    from importlib import reload
    report=await reload(douyin_login).read_login(self.page,kind=self.editor_kind)
    self.phase=report['phase']
    messages={'awaiting_login':'请在专用Chrome窗口本人扫码登录','login_failed':'抖音页面提示登录失败；请本人核对手机提示，尚未连接','qr_expired':'抖音登录二维码已过期，请本人刷新后再扫码','scan_confirm':'扫码已响应，请本人在手机上确认登录','network_error':'抖音登录页提示网络或服务异常，尚未连接','page_pending':'当前页尚未识别登录或视频投稿控件，请查看专用浏览器','login_observed':'已识别抖音'+('图文' if self.editor_kind=='image' else '视频')+'投稿控件，准备待验收','verification_required':'平台要求本人完成安全验证，自动操作已停止'}
    return {'phase':self.phase,'message':messages[self.phase],'preparationVerified':False,'loginDiagnostics':report,'agreementRequired':self.upload_agreement_required,'newEditorSupported':self.phase=='login_observed','kind':self.editor_kind}
   for frame in self.page.frames:
    if urlparse(frame.url).hostname not in self.config['hosts']:continue
    for marker in ('扫码登录','手机号登录','密码登录','验证码登录','登录'):
     loc=frame.get_by_text(marker,exact=True).filter(visible=True)
     if await loc.count():guest=True
    upload=upload or await frame.locator('input[type="file"][accept*="video"],input[type="file"][accept*=".mp4"]').count()>0
   self.phase='awaiting_login' if guest else 'login_observed' if upload else 'page_pending'
  messages={'not_connected':'尚未连接','awaiting_login':'请在专用Chrome窗口本人扫码登录','page_pending':'当前页尚未识别登录或视频投稿控件，请查看专用浏览器','login_observed':'已识别投稿控件，视频上传与文案准备待验收','verification_required':'平台要求本人完成安全验证，自动操作已停止','unexpected_origin':'页面离开预期平台，自动操作已停止','error':'连接器操作未完成，请检查专用浏览器窗口'}
  return {'phase':self.phase,'message':messages[self.phase],'preparationVerified':False}
 async def connect(self,fresh=False,kind="video"):
  if kind not in ("image","video") or (self.platform=="bilibili" and kind!="video"):raise ValueError("unsupported_editor_kind")
  if self.platform=="douyin" and self.page and not self.page.is_closed() and self.phase=="login_observed" and kind!=self.editor_kind:fresh=True
  if fresh:
   if not self.context or not self.page or self.page.is_closed() or self.phase not in ('prepared','login_observed'):raise NewEditorFailure('new_editor_requires_connection')
   if self.platform=='douyin' and self.prepare_lock and self.phase!='prepared':raise NewEditorFailure('previous_preparation_incomplete')
   await self.check()
   try:snapshot=await self.retained_snapshot(self.page) if self.platform=='douyin' and self.phase=='prepared' else None
   except Exception:raise NewEditorFailure('previous_editor_read_failed')
   old=(self.page,self.prepared_result,self.current_job,self.cover_receipt,self.phase,self.prepare_lock,self.upload_agreement_required,self.editor_kind)
   new=None
   try:
    new=await self.context.new_page()
    await new.goto(self.config['url'],wait_until='domcontentloaded',timeout=45000)
    await self.check_page(new)
    await self.enter_upload(new,kind)
    self.editor_kind=kind
    self.page=new;self.prepared_result=None;self.current_job=None;self.cover_receipt=None;self.phase='awaiting_login';self.prepare_lock=None;self.upload_agreement_required=False
    await new.bring_to_front()
    result=await self.status()
    if result['phase'] not in ('login_observed','awaiting_login','page_pending','scan_confirm','qr_expired'):raise NewEditorFailure('new_editor_not_ready')
   except Exception:
    self.page,self.prepared_result,self.current_job,self.cover_receipt,self.phase,self.prepare_lock,self.upload_agreement_required,self.editor_kind=old
    if new:
     try:await new.close()
     except Exception:pass
    raise NewEditorFailure('new_editor_navigation_failed')
   if snapshot:
    record=next((r for r in self.prepared_pages if r['page'] is old[0]),None)
    if record is not None:record.update(snapshot)
    else:self.prepared_pages.append(snapshot)
   return {**result,'previousPageRetained':True}
  if self.platform=='douyin' and self.prepare_lock:return await self.status()
  if self.page and not self.page.is_closed():
   if self.phase=='prepared':
    await self.page.bring_to_front();return await self.status()
   if self.platform=='bilibili' and urlparse(self.page.url).hostname=='member.bilibili.com' and urlparse(self.page.url).path=='/platform/home':
    await self.page.goto(self.config['url'],wait_until='domcontentloaded',timeout=45000)
   if self.platform=='douyin':
    import douyin_login
    from importlib import reload
    await self.enter_upload(self.page,kind)
    self.editor_kind=kind
   await self.page.bring_to_front();self.phase='awaiting_login';return await self.status()
  if self.context:
   self.page=await self.context.new_page();self.prepared_result=None;self.current_job=None;self.cover_receipt=None
   await self.page.goto(self.config['url'],wait_until='domcontentloaded',timeout=45000)
   await self.enter_upload(self.page,kind);self.editor_kind=kind
   await self.page.bring_to_front();self.phase='awaiting_login'
   return await self.status()
  runtime=Path(__file__).resolve().parent/'.runtime'/self.platform
  runtime.mkdir(parents=True,exist_ok=True,mode=0o700);runtime.chmod(0o700)
  profile=runtime/'chrome-profile';profile.mkdir(exist_ok=True,mode=0o700);profile.chmod(0o700)
  self.playwright=await async_playwright().start()
  self.context=await self.playwright.chromium.launch_persistent_context(str(profile),channel='chrome',headless=False,chromium_sandbox=True,permissions=[],accept_downloads=False,viewport={'width':1200,'height':850})
  self.page=self.context.pages[0] if self.context.pages else await self.context.new_page()
  if self.platform=='douyin':self.page.on('response',self.login_response)
  await self.page.goto(self.config['url'],wait_until='domcontentloaded',timeout=45000)
  if self.platform=='douyin':
   from douyin_login import select_scan_login
   await select_scan_login(self.page)
   await self.enter_upload(self.page,kind)
  self.editor_kind=kind
  await self.page.bring_to_front();self.phase='awaiting_login'
  return await self.status()
 async def inspect(self):
  if not self.page or self.page.is_closed():return {'pageOpen':False}
  await self.check();frames=[]
  for frame in self.page.frames:
   if urlparse(frame.url).hostname not in self.config['hosts']:continue
   frames.append({'host':urlparse(frame.url).hostname,'path':urlparse(frame.url).path,'inputs':await frame.locator('input,textarea').evaluate_all('els=>els.map(e=>({tag:e.tagName,type:e.type,placeholder:e.getAttribute("placeholder"),accept:e.getAttribute("accept"),className:e.className,visible:!!(e.offsetWidth||e.offsetHeight)}))'),'editors':await frame.locator('[contenteditable]').evaluate_all('els=>els.map(e=>({tag:e.tagName,role:e.getAttribute("role"),className:e.className,visible:!!(e.offsetWidth||e.offsetHeight)}))'),'buttons':await frame.locator('button,[role="button"]').evaluate_all('els=>els.filter(e=>e.offsetWidth||e.offsetHeight).map(e=>(e.innerText||e.getAttribute("aria-label")||"").trim()).filter(Boolean).slice(0,20)')})
  signals=[]
  for frame in self.page.frames:
   if urlparse(frame.url).hostname not in self.config['hosts']:continue
   text=await frame.locator('body').inner_text(timeout=5000)
   signals.extend(word for word in ('登录失败','二维码失效','二维码已过期','操作频繁','安全验证','网络异常','系统繁忙') if word in text)
  agreements=[]
  for frame in self.page.frames:
   if urlparse(frame.url).hostname not in self.config['hosts']:continue
   agreements.extend(await frame.locator('a[href]').evaluate_all('els=>els.filter(e=>/使用协议|社区公约/.test(e.innerText)).map(e=>({title:e.innerText.trim(),url:e.href}))'))
  retained=await self.inspect_retained()
  result={'pageOpen':True,'pageCount':sum(not p.is_closed() for p in self.context.pages),'retainedPreparedPages':retained,'frames':frames,'loginSignals':list(set(signals)),'agreements':agreements,'imageControls':await self.page.locator('[class*="image"], [class*="picture"], [class*="upload"]').evaluate_all('els=>els.filter(e=>e.getBoundingClientRect().width>40&&e.children.length<8).map(e=>({tag:e.tagName,className:e.className,parent:e.parentElement.className,background:!!e.style.backgroundImage,children:Array.from(e.children).map(n=>({tag:n.tagName,className:n.className,background:!!n.style.backgroundImage,text:n.childElementCount?null:n.innerText?.slice(0,70)}))})).slice(0,35)') if self.platform=='douyin' and self.editor_kind=='image' else []}
  if self.platform=='douyin':
   import douyin_login
   from importlib import reload
   result['loginDiagnostics']=await reload(douyin_login).read_login(self.page,kind=self.editor_kind)
   import uuid
   receipt=Path(__file__).resolve().parent.parent/'evidence'/('抖音登录诊断-'+str(uuid.uuid4())+'.png')
   # Mask QR/session imagery and all input values; retain only native UI labels.
   await self.page.screenshot(path=str(receipt),full_page=False,timeout=5000,animations='disabled',mask=[self.page.locator('#animate_qrcode_container, [class*="scan_qrcode"], img[aria-label="二维码"], input, textarea, [contenteditable]').filter(visible=True)])
   receipt.chmod(0o600)
   result['receiptFile']=receipt.name
   result['loginHttpErrors']=self.login_network
  return result
 async def inspect_retained(self):
  retained=[]
  for record in self.prepared_pages:
   if record['page'] is self.page:continue
   previous=record['page']
   entry={'pageOpen':not previous.is_closed(),'titleUnchanged':False,'bodyUnchanged':False}
   if entry['pageOpen']:
    if self.platform=='douyin':
     await self.check_page(previous)
     actual=await self.retained_snapshot(previous)
     entry.update({'titleUnchanged':actual['title']==record['title'],'bodyUnchanged':actual['body']==record['body'],'topicsUnchanged':actual['topics']==record.get('topics',[]),'coverUnchanged':actual['covers']==record.get('covers',[]),'coverCount':len(actual['covers'])})
    for frame in previous.frames:
     if urlparse(frame.url).hostname!='member.bilibili.com':continue
     title=frame.locator('input[placeholder*="标题"],textarea[placeholder*="标题"]').filter(visible=True)
     body=frame.locator('[editor_id="desc_at_editor"] .ql-editor[contenteditable="true"]').filter(visible=True)
     if await title.count()==1:entry['titleUnchanged']=await title.input_value()==record['title']
     if await body.count()==1:entry['bodyUnchanged']=(await body.inner_text()).strip().replace('\r\n','\n')==record['body']
   retained.append(entry)
  return retained
 async def settings_inspect(self):
  await self.check()
  if self.platform=='douyin':
   import douyin_settings
   from importlib import reload
   return await reload(douyin_settings).inspect_settings(self.page)
  import bilibili_settings
  from importlib import reload
  return await reload(bilibili_settings).inspect_settings(self.page)
 async def catalog(self):
  if self.platform!='bilibili' or self.phase!='prepared':raise ValueError('video_editor_required')
  await self.check()
  import bilibili_settings
  from importlib import reload
  result=await reload(bilibili_settings).read_categories(self.page,self.check)
  result['draftId']=self.current_job.get('draft_id') if self.current_job else None
  return result
 async def options(self,job_id):
  if self.phase!='prepared' or not self.current_job:raise ValueError('prepared_editor_required')
  import uuid
  uuid.UUID(job_id)
  base=(Path(__file__).resolve().parent/'.runtime'/self.platform/'jobs'/job_id).resolve()
  job=json.loads((base/'job.json').read_text())
  for key in ('cover_path','receipt_path'):
   if job.get(key) and not Path(job[key]).resolve().is_relative_to(base):raise ValueError('invalid_job_path')
  if self.platform=='douyin' and self.editor_kind=='image' and job.get('cover_mode')!='keep':raise ValueError('image_cover_unsupported')
  if job['draft_id']!=self.current_job['draft_id']:raise ValueError('draft_mismatch')
  job['expected_title']=self.current_job['title']
  job['expected_body']='\n\n'.join(v for v in (self.current_job['body'],self.current_job['tags']) if v.strip()).strip()
  await self.check()
  from importlib import reload
  if self.platform=='douyin':import douyin_settings as adapter
  else:import bilibili_settings as adapter
  try:
   result=await reload(adapter).apply_settings(self.page,job,self.check,previous_cover=self.cover_receipt)
  except Exception as error:
   if self.platform=='douyin' and (base/'partial-cover.json').exists():
    self.cover_receipt=json.loads((base/'partial-cover.json').read_text())
   (base/'error.json').write_text(json.dumps({'code':type(error).__name__}));(base/'error.json').chmod(0o600)
   try:
    await self.page.screenshot(path=str(base/'failed.png'),full_page=True,timeout=5000,animations='disabled');(base/'failed.png').chmod(0o600)
   except Exception:pass
   raise
  self.cover_receipt=result.pop('_coverReceipt',None)
  self.prepared_result.update(result)
  if self.platform=='douyin':
   from douyin_settings import read_settings_text
   self.expected_copy=(await read_settings_text(self.page.locator('div.zone-container[contenteditable="true"]').filter(visible=True))).strip().replace('\r\n','\n')
  return self.prepared_result
 async def prepare(self,job_id):
  import uuid
  uuid.UUID(job_id)
  if self.phase=='prepared':raise ValueError('already_prepared')
  if (await self.status())['phase']!='login_observed':raise ValueError('login_required')
  base=(Path(__file__).resolve().parent/'.runtime'/self.platform/'jobs'/job_id).resolve()
  job=json.loads((base/'job.json').read_text())
  for path in [job['receipt_path']]+([job['video_path']] if job.get('kind','video')=='video' else job.get('image_paths',[])):
   if not Path(path).resolve().is_relative_to(base):raise ValueError('invalid_job_path')
  if self.platform=='douyin':
   if self.prepare_lock:raise ValueError('previous_preparation_incomplete')
   if job.get('kind','video')!=self.editor_kind:raise ValueError('editor_kind_mismatch')
   if self.editor_kind=='image':
    import douyin_image
    from importlib import reload
    prepare_video=reload(douyin_image).prepare_images
    self.current_job=job
   else:from douyin_note import prepare_video
   self.prepare_lock=job_id
  else:
   from bilibili_note import prepare_video
  try:result=await prepare_video(self.page,job,self.check)
  except UploadAgreementRequired:
   self.prepare_lock=None;self.upload_agreement_required=True
   raise
  except Exception as error:
   if self.platform=='douyin':
    stage_path=base/'stage.json'
    if stage_path.exists() and json.loads(stage_path.read_text()).get('stage')=='upload_control_ambiguous':self.prepare_lock=None
   (base/'error.json').write_text(json.dumps({'code':type(error).__name__}));(base/'error.json').chmod(0o600)
   try:
    await self.page.screenshot(path=str(base/'failed.png'),full_page=True,timeout=5000,animations='disabled');(base/'failed.png').chmod(0o600)
   except Exception:pass
   raise
  self.current_job=job
  self.expected_copy=None
  self.upload_agreement_required=False
  result['draftId']=job.get('draft_id');result['kind']=job.get('kind','video')
  self.prepared_pages.append({'page':self.page,'title':job['title'],'body':'\n\n'.join(v for v in (job['body'],job['tags']) if v.strip()).strip()})
  self.phase='prepared';self.prepared_result=result;return result

async def main(platform):
 worker=Worker(platform)
 try:
  while True:
   line=await asyncio.to_thread(sys.stdin.readline)
   if not line:break
   request=json.loads(line)
   try:
    action=request['action']
    if action not in ('connect','status','inspect','prepare','catalog','options','settings_inspect'):raise ValueError('unsupported_action')
    operation=getattr(worker,action)(request['job_id']) if action in ('prepare','options') else worker.connect(fresh=request.get('fresh') is True,kind=request.get('kind','video')) if action=='connect' else getattr(worker,action)()
    result=await asyncio.wait_for(operation,timeout=180 if action in ('prepare','options') else 90 if action in ('connect','catalog') else 20)
    reply={'id':request['id'],'ok':True,'result':result}
   except Intervention as e:
    worker.phase=str(e);reply={'id':request['id'],'ok':False,'error':str(e)}
   except NewEditorFailure:
    reply={'id':request['id'],'ok':False,'error':'新编辑页未打开，原编辑页已保留，请先检查浏览器'}
   except UploadAgreementRequired:
    worker.phase='login_observed';reply={'id':request['id'],'ok':False,'error':'抖音上传页注明上传代表同意协议，请本人阅读该页提示后确认，再准备视频；尚未上传。'}
   except Exception:
    if action=='options' and worker.prepared_result:
     worker.prepared_result.update({'optionsVerified':False,'message':'视频已准备；'+('封面和话题' if worker.platform=='douyin' else '封面、分区和标签')+'更新未完成，请检查编辑页。'})
    elif action not in ('catalog','settings_inspect'):worker.phase='error'
    reply={'id':request['id'],'ok':False,'error':'connector_error'}
   print(json.dumps(reply,ensure_ascii=False),flush=True)
 finally:
  if worker.context:await worker.context.close()
  if worker.playwright:await worker.playwright.stop()

if __name__=='__main__':asyncio.run(main(sys.argv[1]))
