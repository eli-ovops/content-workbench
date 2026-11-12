"""JSON-lines local worker. Never returns cookies, tokens or profile contents."""
import asyncio
import json
import os
import sys
from pathlib import Path
import hashlib
from playwright.async_api import async_playwright
from xhs_note import PUBLISH_URL, ready, prepare_note, check_intervention, ManualIntervention

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime' / 'xhs'

def preparation_fingerprint(job):
    paths=[job['video_path']] if job.get('kind')=='video' else job['image_paths']
    data={'kind':job.get('kind','image'),'title':job['title'],'body':job['body'],'tags':job['tags'],'media':[hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in paths]}
    return hashlib.sha256(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

class Worker:
    def __init__(self):
        self.playwright = None
        self.context = None
        self.page = None
        self.phase = 'not_connected'
        self.prepared_result = None
        self.editor_kind = 'image'
        self.current_job = None

    async def connect(self, fresh=False, kind='image'):
        if kind not in ('image','video'):
            raise ValueError('invalid_kind')
        if not fresh and kind == self.editor_kind and self.page and not self.page.is_closed() and self.phase in ('connected','prepared'):
            await self.page.bring_to_front()
            return await self.status()
        RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(RUNTIME, 0o700)
        profile = RUNTIME / 'chrome-profile'
        profile.mkdir(exist_ok=True, mode=0o700)
        os.chmod(profile, 0o700)
        if not self.context or not self.page or self.page.is_closed():
            if self.context:
                await self.context.close()
            if not self.playwright:
                self.playwright = await async_playwright().start()
            self.context = await self.playwright.chromium.launch_persistent_context(
                str(profile), channel='chrome', headless=False,
                chromium_sandbox=True, permissions=[], accept_downloads=False,
                viewport={'width': 1200, 'height': 850},
            )
            self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()
        elif fresh or kind != self.editor_kind:
            self.page = await self.context.new_page()
        self.prepared_result = None
        self.editor_kind = kind
        await self.page.goto(PUBLISH_URL.replace('target=image','target='+kind), wait_until='domcontentloaded', timeout=45000)
        await self.page.bring_to_front()
        self.phase = 'awaiting_login'
        return await self.status()

    async def status(self):
        if not self.page or self.page.is_closed():
            self.phase = 'not_connected'
        elif self.phase not in ('error', 'verification_required'):
            try:
                is_ready = await ready(self.page)
                if is_ready:
                    if self.phase != 'prepared':
                        self.phase = 'connected'
                else:
                    self.phase = 'awaiting_login'
            except ManualIntervention as e:
                self.phase = str(e)
        messages = {
            'not_connected': '小红书尚未连接',
            'awaiting_login': '请在专用 Chrome 窗口使用本人小红书 App 扫码登录',
            'connected': '本人登录已识别，可以准备稿件',
            'prepared': '稿件已传入编辑页，预览核对通过。尚未发布',
            'verification_required': '平台要求本人完成安全验证，自动操作已停止',
            'unexpected_origin': '页面离开预期创作者域名，自动操作已停止',
            'error': '连接器停止，请检查专用浏览器窗口',
        }
        result = {'phase': self.phase, 'kind':self.editor_kind, 'message': messages.get(self.phase, '请检查专用浏览器窗口')}
        if self.phase == 'prepared' and self.prepared_result:
            try:
                from xhs_note import verify_current
                await verify_current(self.page,self.current_job)
                result.update({key:self.prepared_result[key] for key in ('titlePreviewVerified','bodyPreviewVerified','imageCountVerified','videoUploadVerified','preparationFingerprint') if key in self.prepared_result})
                result['currentReadback']=True
            except ManualIntervention:raise
            except Exception:
                result.update({'titlePreviewVerified':False,'bodyPreviewVerified':False,'currentReadback':False,'message':'当前小红书编辑页回读未通过，旧记录仅供参考；请核对，勿重传。'})
        return result

    async def prepare(self, job_id):
        # ID is a server-generated UUID, not an arbitrary caller path.
        import uuid
        uuid.UUID(job_id)
        path = RUNTIME / 'jobs' / job_id / 'job.json'
        job = json.loads(path.read_text())
        if job.get('kind','image') != self.editor_kind:
            raise ValueError('editor_kind_mismatch')
        base = path.parent.resolve()
        for image in job['image_paths']:
            if not Path(image).resolve().is_relative_to(base):
                raise ValueError('invalid_image_path')
        if job.get('video_path') and not Path(job['video_path']).resolve().is_relative_to(base):
            raise ValueError('invalid_video_path')
        if job.get('receipt_path') and not Path(job['receipt_path']).resolve().is_relative_to(base):
            raise ValueError('invalid_receipt_path')
        if self.phase == 'prepared':
            raise ValueError('already_prepared')
        if self.phase != 'connected' or not self.page or self.page.is_closed():
            raise ManualIntervention('login_required')
        try:
            result = await prepare_note(self.page, job)
        except Exception as error:
            code = str(error) if str(error) in ('body_editor_ambiguous','body_mismatch','title_mismatch') else type(error).__name__
            (base/'error.json').write_text(json.dumps({'code':code}))
            os.chmod(base/'error.json',0o600)
            raise
        if job.get('receipt_path') and Path(job['receipt_path']).is_file():
            os.chmod(job['receipt_path'],0o600)
        self.phase = result['phase']
        result['preparationFingerprint']=preparation_fingerprint(job)
        self.prepared_result = result
        self.current_job = job
        return result

    async def login_preview(self):
        if self.phase != 'awaiting_login' or not self.page or self.page.is_closed():
            return {'available':False}
        await check_intervention(self.page)
        if await ready(self.page):
            return {'available':False}
        box = self.page.locator('div[class*="login-box"]').first
        if not await box.count():
            box = self.page.locator('.login-box-container').first
        if not await box.count() or not await box.is_visible():
            return {'available':False}
        label = box.get_by_text('APP扫一扫登录', exact=False).first
        if not await label.count() or not await label.is_visible():
            switch = box.locator('img.css-wemwzq').first
            if await switch.count() and await switch.is_visible():
                await switch.click()
                try: await label.wait_for(state='visible',timeout=5000)
                except Exception: return {'available':False}
        if not await label.count() or not await label.is_visible():
            return {'available':False}
        qr = label.locator('xpath=..//following-sibling::div//img').first
        if not await qr.count() or not await qr.is_visible():
            return {'available':False}
        rectangle = await qr.bounding_box()
        if not rectangle or rectangle['width'] < 100 or rectangle['height'] < 100:
            return {'available':False}
        import base64
        image = await qr.screenshot(timeout=10000)
        await check_intervention(self.page)
        if await ready(self.page) or not await box.is_visible() or not await label.is_visible():
            return {'available':False}
        return {'available':True,'qrVisible':True,'image':base64.b64encode(image).decode()}

    async def inspect_page(self):
        if not self.page or self.page.is_closed():
            return {'pageOpen':False}
        await check_intervention(self.page)
        from urllib.parse import urlparse
        inputs = await self.page.locator('input').evaluate_all('els=>els.map(e=>({type:e.type,accept:e.getAttribute("accept"),placeholder:e.getAttribute("placeholder"),visible:!!(e.offsetWidth||e.offsetHeight)}))')
        buttons = await self.page.locator('button,[role="button"]').evaluate_all('els=>els.filter(e=>e.offsetWidth||e.offsetHeight).map(e=>(e.innerText||e.getAttribute("aria-label")||"").trim()).filter(Boolean).slice(0,25)')
        boxes = []
        for selector in ('div[class*="login-box"]','.login-box-container'):
            loc=self.page.locator(selector).first
            boxes.append({'selector':selector,'count':await loc.count(),'visible':await loc.is_visible() if await loc.count() else False})
        editors = await self.page.locator('[contenteditable]').evaluate_all('els=>els.map(e=>({tag:e.tagName,role:e.getAttribute("role"),className:e.className,visible:!!(e.offsetWidth||e.offsetHeight)}))')
        title_structure = await self.page.locator('input[placeholder*="填写标题"]').evaluate_all('''els => els.map(e => {
            const shape = (node,depth) => ({tag:node.tagName,cls:node.className,
                text:/^\\d+\\s*\\/\\s*\\d+$/.test(node.textContent.trim())?node.textContent.trim():undefined,
                hidden:!node.getClientRects().length,
                children:depth>0?Array.from(node.children).slice(0,20).map(c=>shape(c,depth-1)):undefined});
            let parent=e; const ancestors=[];
            for(let i=0;i<4 && parent;i++,parent=parent.parentElement) ancestors.push(shape(parent,2));
            return {length:e.value.length,readOnly:e.readOnly,disabled:e.disabled,ancestors};
        })''')
        preview_structure = await self.page.locator('[class*="preview"]').evaluate_all('''els=>els.filter(e=>e.getClientRects().length).slice(0,30).map(e=>({tag:e.tagName,cls:e.className,children:Array.from(e.children).slice(0,15).map(c=>({tag:c.tagName,cls:c.className,textLength:c.innerText?.length}))}))''')
        return {'pageOpen':True,'pageCount':sum(not p.is_closed() for p in self.context.pages),'path':urlparse(self.page.url).path,'title':await self.page.title(),'inputs':inputs,'buttons':buttons,'loginBoxes':boxes,'editors':editors,'titleStructure':title_structure,'previewStructure':preview_structure}

async def main():
    worker = Worker()
    try:
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            request = json.loads(line)
            try:
                if request['action'] == 'connect':
                    result = await asyncio.wait_for(worker.connect(fresh=request.get('fresh') is True,kind=request.get('kind','image')), timeout=90)
                elif request['action'] == 'status':
                    result = await asyncio.wait_for(worker.status(), timeout=15)
                elif request['action'] == 'prepare':
                    result = await asyncio.wait_for(worker.prepare(request['job_id']), timeout=120)
                elif request['action'] == 'login_preview':
                    result = await asyncio.wait_for(worker.login_preview(), timeout=15)
                elif request['action'] == 'inspect':
                    result = await asyncio.wait_for(worker.inspect_page(), timeout=15)
                else:
                    raise ValueError('unknown_action')
                reply = {'id': request['id'], 'ok': True, 'result': result}
            except ManualIntervention as e:
                phase = 'awaiting_login' if str(e) == 'login_required' else str(e)
                worker.phase = phase
                reply = {'id': request['id'], 'ok': False, 'error': phase}
            except Exception:
                worker.phase = 'error'
                reply = {'id': request['id'], 'ok': False, 'error': 'connector_error'}
            print(json.dumps(reply, ensure_ascii=False), flush=True)
    finally:
        if worker.context:
            await worker.context.close()
        if worker.playwright:
            await worker.playwright.stop()

if __name__ == '__main__':
    asyncio.run(main())
