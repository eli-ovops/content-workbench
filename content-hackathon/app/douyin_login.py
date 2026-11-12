"""Native login UI diagnostics only; never extract QR contents or credentials."""
from urllib.parse import urlparse
import re

SIGNALS = {
    'login_failed': ('登录失败', '扫码登录失败'),
    'qr_expired': ('二维码失效', '二维码已过期', '二维码过期'),
    'scan_confirm': ('扫码成功', '请在手机上确认', '请在抖音App中确认', '请在抖音APP中确认'),
    'network_error': ('网络异常', '网络错误', '系统繁忙', '服务异常'),
    'verification_required': ('请完成安全验证', '请拖动滑块', '请完成验证', '操作过于频繁', '访问异常'),
}

def classify_login(signals, guest, upload):
    for kind in ('verification_required', 'login_failed', 'qr_expired', 'network_error', 'scan_confirm'):
        if kind in signals:return kind
    return 'awaiting_login' if guest else 'login_observed' if upload else 'page_pending'

async def read_login(page,kind="video"):
    signals = []
    guest = False
    upload = False
    qr_ready = False
    controls = []
    for frame in page.frames:
        if urlparse(frame.url).hostname != 'creator.douyin.com':continue
        text = await frame.locator('body').inner_text(timeout=5000)
        signals.extend(kind for kind, words in SIGNALS.items() if any(word in text for word in words))
        for word in ('扫码登录', '手机号登录', '验证码登录', '密码登录', '登录'):
            guest = guest or await frame.get_by_text(word, exact=True).filter(visible=True).count() > 0
        selector='div[class^="container"] input[type="file"][accept*="image"]' if kind=='image' else 'input[type="file"][accept*="video"], input[type="file"][accept*=".mp4"]'
        upload = upload or await frame.locator(selector).count() > 0
        qr_ready = qr_ready or await frame.locator('#animate_qrcode_container img, [class*="scan_qrcode"] img, img[aria-label="二维码"]').filter(visible=True).count() > 0
        for word in ('扫码登录', '点击刷新', '刷新二维码', '重新扫码', '登录失败，请重试', '网络异常，请刷新重试'):
            if await frame.get_by_text(word, exact=True).filter(visible=True).count():controls.append(word)
    signals = sorted(set(signals))
    return {'phase':classify_login(signals, guest, upload),'signals':signals,'qrVisible':qr_ready,'loginUiVisible':guest,'uploadInputPresent':upload,'controls':sorted(set(controls))}

async def select_scan_login(page):
    tab = page.get_by_text('扫码登录', exact=True).filter(visible=True)
    try:await tab.wait_for(state='visible',timeout=10000)
    except Exception:return
    if await tab.count() == 1:await tab.click(timeout=5000)

async def enter_video_upload(page):
    parsed=urlparse(page.url)
    if parsed.hostname!='creator.douyin.com' or parsed.path!='/creator-micro/home':return
    skip=page.get_by_text('跳过',exact=True).filter(visible=True)
    if await skip.count()==1:await skip.click(timeout=5000)
    button=page.get_by_role('button',name=re.compile('^发布高清视频')).filter(visible=True)
    if await button.count()!=1:raise RuntimeError('video_entry_ambiguous')
    await button.click(timeout=10000)


async def enter_upload(page,kind):
    await enter_video_upload(page)
    if kind!='image':return
    parsed=urlparse(page.url)
    if parsed.hostname!='creator.douyin.com' or parsed.path!='/creator-micro/content/upload':return
    tab=page.get_by_text('发布图文',exact=True).filter(visible=True)
    if await tab.count()!=1:raise RuntimeError('image_entry_ambiguous')
    await tab.click(timeout=10000)
    await page.locator('div[class^="container"] input[type="file"][accept*="image"]').first.wait_for(state='attached',timeout=10000)
