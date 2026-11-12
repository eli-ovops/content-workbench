"""Isolated Chrome context only. No personal IndexedDB or platform mutations."""
import unittest
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright, expect

class WorkbenchSafety(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.pw=await async_playwright().start()
  self.browser=await self.pw.chromium.launch(channel='chrome',headless=True,chromium_sandbox=True)
  self.context=await self.browser.new_context(accept_downloads=True)
  self.remote_mutations=[]
  async def api(route):
   if route.request.method!='GET':self.remote_mutations.append(route.request.url)
   await route.fulfill(json={'phase':'not_connected','message':'隔离测试：未连接'})
  await self.context.route('**/api/**',api)
  self.page=await self.context.new_page();await self.page.goto('http://127.0.0.1:4197/');await self.page.wait_for_load_state('networkidle')
 async def asyncTearDown(self):
  self.assertEqual(self.remote_mutations,[])
  await self.browser.close();await self.pw.stop()
 async def save(self,page=None):
  page=page or self.page;await page.locator('#save-draft').click();await expect(page.locator('#save-state')).to_have_text('已保存在此浏览器')
 async def test_asset_correction_and_independent_copy_are_recoverable(self):
  p=self.page;await p.locator('[data-kind="image"]').click();await p.locator('#master-title').fill('纠错测试')
  source=Path(__file__).resolve().parent.parent/'assets/eli-social-publisher-icon-v5.png'
  await p.locator('#asset-input').set_input_files(str(source));await expect(p.locator('#asset-list .asset')).to_have_count(1)
  await p.get_by_role('button',name='移除素材 '+source.name,exact=True).click();await expect(p.locator('#asset-list .asset')).to_have_count(0)
  await p.locator('#undo-assets').click();await expect(p.locator('#asset-list .asset')).to_have_count(1)
  async with p.expect_file_chooser() as chooser:await p.get_by_role('button',name='替换素材 '+source.name,exact=True).click()
  replacement=source.with_name('eli-social-publisher-icon-v4.png');await (await chooser.value).set_files(str(replacement))
  await expect(p.locator('#asset-list')).to_contain_text(replacement.name)
  await p.locator('#undo-assets').click();await expect(p.locator('#asset-list')).to_contain_text(source.name)
  await p.locator('#channels input[value="xhs"]').check();await p.locator('#use-master').uncheck();await p.locator('#version-title').fill('保留独立标题')
  await p.locator('#use-master').check();await expect(p.locator('#version-title')).to_have_value('纠错测试')
  await p.locator('#use-master').uncheck();await expect(p.locator('#version-title')).to_have_value('保留独立标题');await self.save()
  await p.reload();await expect(p.locator('#version-title')).to_have_value('保留独立标题')
 async def test_stale_tab_cannot_overwrite_and_can_save_its_copy(self):
  p=self.page;await p.locator('#master-title').fill('原稿');await self.save()
  second=await self.context.new_page();await second.goto('http://127.0.0.1:4197/');await second.wait_for_load_state('networkidle')
  await p.locator('#master-title').fill('第一个标签已保存');await second.locator('#master-title').fill('第二个标签未保存');await self.save(p)
  await second.locator('#save-draft').click();await expect(second.locator('#save-state')).to_contain_text('保存冲突')
  await expect(second.locator('#master-title')).to_have_value('第二个标签未保存')
  await second.locator('#save-conflict-copy').click();await expect(second.locator('#draft-count')).to_have_text('2')
  await p.reload();await expect(p.locator('#draft-list')).to_contain_text('第一个标签已保存');await expect(p.locator('#draft-list')).to_contain_text('第二个标签未保存（冲突副本）')
 async def test_complete_backup_restores_raw_assets_and_preserves_existing_drafts(self):
  p=self.page;await p.locator('#master-title').fill('备份验收');await p.locator('#master-body').fill('母稿\n第二行')
  source=Path(__file__).resolve().parent.parent/'assets/eli-social-publisher-icon-v5.png';await p.locator('#asset-input').set_input_files(str(source));await self.save()
  result=await p.evaluate('''async()=>{
   const s=await import('/storage.js'),current=(await s.getDrafts())[0];
   current.biliOptions={coverMode:'upload',cover:structuredClone(current.assets[0])};
   current.assetHistory=[{assets:structuredClone(current.assets),at:Date.now()}];
   current.savedVersions={xhs:{title:'已保留的平台标题',body:'独立正文',tags:'#工具'}};
   await s.saveDraft(current);const data=await s.exportBackup();
   const before=await s.getDrafts(),count=await s.importBackup(data),after=await s.getDrafts();
   const restored=after.find(d=>!before.some(b=>b.id===d.id));
   const a=await s.getAsset(before[0].assets[0].id),b=await s.getAsset(restored.assets[0].id);
   const same=JSON.stringify(Array.from(new Uint8Array(await a.blob.arrayBuffer())))===JSON.stringify(Array.from(new Uint8Array(await b.blob.arrayBuffer())));
   data.assets[0].hash='bad';let rejected=false;try{await s.importBackup(data)}catch{rejected=true}
   return {count,total:after.length,same,rejected,afterRejected:(await s.getDrafts()).length,title:restored.title,body:restored.body,originalPresent:after.some(d=>d.id===before[0].id),nestedRemapped:restored.biliOptions.cover.id===restored.assets[0].id&&restored.assetHistory[0].assets[0].id===restored.assets[0].id,versionPreserved:restored.savedVersions.xhs.title==='已保留的平台标题'};
  }''')
  self.assertEqual(result,{'count':1,'total':2,'same':True,'rejected':True,'afterRejected':2,'title':'备份验收','body':'母稿\n第二行','originalPresent':True,'nestedRemapped':True,'versionPreserved':True})
 async def test_time_comparison_reports_negative_net_and_missing_evidence(self):
  p=self.page;await expect(p.locator('#time-summary')).to_have_text('尚无真实对照，省时效果待验证。')
  await p.get_by_text('实际使用 · 省时对照',exact=True).click()
  for k,v in [('manual','10'),('workbench','4'),('overhead','8')]:await p.locator('#time-'+k).fill(v)
  await p.locator('#record-time').click();await expect(p.locator('#time-summary')).to_contain_text('净省时 -2.0 分钟')
  await p.reload();await expect(p.locator('#time-summary')).to_contain_text('净省时 -2.0 分钟')
 async def test_damaged_nested_backup_is_rejected_before_any_write(self):
  p=self.page;await p.locator('#master-title').fill('完整性验收');await self.save()
  result=await p.evaluate('''async()=>{
   const s=await import('/storage.js'),original=await s.exportBackup();
   const changes=[
    d=>d.drafts[0].biliOptions={coverMode:'upload',cover:{id:'missing-cover'}},
    d=>d.drafts[0].assetHistory=[{assets:[{id:'missing-old-image'}]}],
    d=>d.drafts[0].versions={xhs:{title:42,body:'正文',tags:''}},
    d=>d.drafts[0].savedVersions={douyin:{title:'标题',body:null,tags:''}},
   ];
   const rejected=[];
   for(const change of changes){const data=structuredClone(original);change(data);try{await s.importBackup(data);rejected.push(false)}catch{rejected.push(true)}}
   return {rejected,total:(await s.getDrafts()).length};
  }''')
  self.assertEqual(result,{'rejected':[True,True,True,True],'total':1})
 async def ai_fixture(self,delayed=False):
  p=self.page;requested=asyncio.Event();release=asyncio.Event();calls=[]
  await p.route('**/api/tokenpay/status',lambda r:r.fulfill(json={'keyCreationAllowed':False,'modelCallsAllowed':True,'connected':True}))
  async def suggest(route):
   calls.append(route.request.post_data_json);requested.set()
   if delayed:await release.wait()
   await route.fulfill(json={'candidate':{'platform':'xhs','title':'离线候选标题','body':'离线候选正文','tags':'#工具'},'model':'offline-fixture','appUrl':'app://eli-social-publisher','reviewRequired':True,'revenueVerified':False})
  await p.route('**/api/tokenpay/suggest',suggest)
  await p.reload();await p.wait_for_load_state('networkidle')
  await p.locator('#master-title').fill('原标题');await p.locator('#master-body').fill('原正文');await p.locator('#channels input[value="xhs"]').check()
  return requested,release,calls
 async def test_ai_candidate_requires_review_and_can_restore_previous_copy(self):
  _,_,calls=await self.ai_fixture();p=self.page
  await p.locator('#ai-generate').click();await expect(p.locator('#ai-candidate')).to_contain_text('离线候选正文')
  await expect(p.locator('#version-title')).to_have_value('原标题');await expect(p.locator('#ai-adopt')).to_be_disabled()
  await p.locator('#ai-facts-confirmed').check();await p.locator('#ai-adopt').click();await expect(p.locator('#version-title')).to_have_value('离线候选标题')
  await expect(p.locator('#master-title')).to_have_value('原标题');await p.locator('#ai-undo').click();await expect(p.locator('#version-title')).to_have_value('原标题')
  self.assertEqual(len(calls),1);self.assertEqual(calls[0],{'platform':'xhs','title':'原标题','body':'原正文','tags':''})
 async def test_ai_result_after_copy_changed_cannot_overwrite_latest_text(self):
  requested,release,calls=await self.ai_fixture(delayed=True);p=self.page
  await p.locator('#ai-generate').click();await asyncio.wait_for(requested.wait(),5)
  await p.locator('#master-body').fill('等待期间我修改了原文');release.set()
  await expect(p.locator('#ai-candidate')).to_contain_text('离线候选正文');await p.locator('#ai-facts-confirmed').check()
  await expect(p.locator('#ai-adopt')).to_be_disabled();await expect(p.locator('#ai-status')).to_contain_text('旧候选不能覆盖当前稿')
  await expect(p.locator('#version-body')).to_have_value('等待期间我修改了原文');self.assertEqual(len(calls),1)

 async def test_consumed_single_call_budget_disables_generation_without_a_second_request(self):
  p=self.page
  await p.route('**/api/tokenpay/status',lambda r:r.fulfill(json={'connected':True,'modelCallsAllowed':True,'keyCreationAllowed':False,'maxCalls':1,'callsAttempted':1}))
  await p.reload();await p.locator('#channels input[value="xhs"]').check()
  await expect(p.locator('#ai-generate')).to_be_disabled();await expect(p.locator('#ai-status')).to_contain_text('调用次数已用完')

 async def test_recharge_requires_amount_confirmation_and_paid_before_original_retry(self):
  p=self.page;calls=[];state={'pendingRetry':False,'payment':{'phase':'not_started','rechargeAllowed':True,'maxRechargeYuan':1,'sessionCreated':False,'paid':False}}
  async def status(r):await r.fulfill(json={'connected':True,'modelCallsAllowed':True,'keyCreationAllowed':False,**state})
  async def suggest(r):calls.append('suggest');state['pendingRetry']=True;await r.fulfill(json={'balanceRequired':True})
  async def payment(r):
   calls.append('payment');self.assertEqual(r.request.post_data_json,{'amount':1,'confirmed':True})
   state['payment'].update(phase='pending',sessionCreated=True,amount=1);await r.fulfill(json={'phase':'pending','amount':1})
  async def check(r):calls.append('check');state['payment'].update(phase='paid',paid=True);await r.fulfill(json={'phase':'paid','paid':True})
  async def resume(r):
   calls.append('resume');self.assertEqual(r.request.post_data_json,{'confirmed':True});state['pendingRetry']=False
   await r.fulfill(json={'candidate':{'platform':'xhs','title':'离线恢复候选','body':'原事实','tags':''},'model':'offline-fixture','reviewRequired':True})
  for path,handler in [('status',status),('suggest',suggest),('payment',payment),('payment-check',check),('resume',resume)]:await p.route('**/api/tokenpay/'+path,handler)
  await p.reload();await p.locator('#master-title').fill('原题');await p.locator('#master-body').fill('原事实');await p.locator('#channels input[value="xhs"]').check();await self.save()
  await p.locator('#ai-generate').click();await expect(p.locator('#wallet-view')).to_be_visible();self.assertEqual(calls,['suggest'])
  await expect(p.locator('#tokenpay-create-payment')).to_be_disabled();await p.locator('#tokenpay-payment-confirm').check();await p.locator('#tokenpay-create-payment').click()
  await expect(p.locator('#tokenpay-payment-status')).to_contain_text('pending');await expect(p.locator('#tokenpay-resume')).to_be_disabled()
  await p.locator('#tokenpay-check-payment').click();await expect(p.locator('#tokenpay-payment-status')).to_contain_text('已确认到账');await expect(p.locator('#tokenpay-resume')).to_be_disabled();self.assertEqual(calls,['suggest','payment','check'])
  await p.reload();await p.get_by_role('button',name='Token 钱包',exact=True).click();await expect(p.locator('#tokenpay-resume')).to_be_disabled();self.assertEqual(calls,['suggest','payment','check'])
  await p.locator('#tokenpay-retry-confirm').check();await p.locator('#tokenpay-resume').click();await expect(p.locator('#ai-candidate')).to_contain_text('离线恢复候选')
  await p.get_by_role('button',name='内容工作台',exact=True).click();await expect(p.locator('#master-body')).to_have_value('原事实');await expect(p.locator('#ai-adopt')).to_be_disabled();await expect(p.locator('#publish')).to_be_disabled();self.assertEqual(calls,['suggest','payment','check','resume'])

if __name__=='__main__':unittest.main()
