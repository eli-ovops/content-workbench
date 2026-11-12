import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from provider_worker import Worker, PROVIDERS


class ProviderSessionRegression(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        launcher = patch('provider_worker.async_playwright', side_effect=AssertionError('session reuse must not launch another browser'))
        launcher.start()
        self.addCleanup(launcher.stop)

    def session(self,platform="bilibili"):
        worker = Worker(platform)
        old = SimpleNamespace(is_closed=lambda: False, goto=AsyncMock(), close=AsyncMock(), bring_to_front=AsyncMock())
        new = SimpleNamespace(goto=AsyncMock(), close=AsyncMock(), bring_to_front=AsyncMock())
        worker.page = old
        worker.phase = 'prepared'
        worker.prepared_result = {'phase': 'prepared', 'preparationVerified': True}
        worker.context = SimpleNamespace(new_page=AsyncMock(return_value=new))
        worker.enter_upload = AsyncMock()
        worker.check = AsyncMock()
        worker.check_page = AsyncMock()
        worker.retained_snapshot = AsyncMock(return_value={"page":old,"title":"上一稿","body":"上一稿正文 #AI工具","topics":["AI工具"],"covers":["private-horizontal","private-vertical"]})
        worker.status = AsyncMock(return_value={'phase': 'login_observed'})
        return worker, old, new

    async def test_new_editor_keeps_previous_page_and_resets_current_receipt(self):
        worker, old, new = self.session()
        result = await worker.connect(fresh=True)
        old.goto.assert_not_awaited()
        old.close.assert_not_awaited()
        worker.context.new_page.assert_awaited_once()
        new.goto.assert_awaited_once_with(PROVIDERS['bilibili']['url'], wait_until='domcontentloaded', timeout=45000)
        self.assertIs(worker.page, new)
        self.assertIsNone(worker.prepared_result)
        self.assertEqual(result['phase'], 'login_observed')

    async def test_regular_connect_keeps_prepared_editor(self):
        worker, old, new = self.session()
        worker.status.return_value = worker.prepared_result
        await worker.connect()
        self.assertIs(worker.page, old)
        worker.context.new_page.assert_not_awaited()
        old.goto.assert_not_awaited()

    async def test_navigation_failure_preserves_previous_editor_and_receipt(self):
        worker, old, new = self.session()
        result = worker.prepared_result
        new.goto.side_effect = TimeoutError('navigation failed')
        with self.assertRaises(Exception):
            await worker.connect(fresh=True)
        self.assertIs(worker.page, old)
        self.assertIs(worker.prepared_result, result)
        self.assertEqual(worker.phase, 'prepared')
        old.goto.assert_not_awaited()
        old.close.assert_not_awaited()

    async def test_closed_current_page_reuses_existing_context(self):
        worker, old, new = self.session()
        old.is_closed = lambda: True
        await worker.connect()
        self.assertIs(worker.page, new)
        worker.context.new_page.assert_awaited_once()

    async def test_douyin_incomplete_upload_connect_does_not_clear_lock_or_navigate(self):
        worker=Worker('douyin')
        worker.prepare_lock='pending-job'
        worker.status=AsyncMock(return_value={'phase':'preparation_incomplete'})
        worker.context=SimpleNamespace(new_page=AsyncMock())
        result=await worker.connect()
        self.assertEqual(result['phase'],'preparation_incomplete')
        self.assertEqual(worker.prepare_lock,'pending-job')
        worker.context.new_page.assert_not_awaited()

    async def test_douyin_prepared_video_cannot_be_uploaded_again(self):
        worker=Worker('douyin');worker.phase='prepared'
        with self.assertRaisesRegex(ValueError,'already_prepared'):
            await worker.prepare('4d65ee07-f41e-4f11-a1a3-e5638d63b929')

    async def test_douyin_fresh_page_preserves_previous_copy_covers_topics_and_clears_only_current_lock(self):
        worker, old, new = self.session('douyin')
        worker.prepare_lock='completed-job'
        worker.current_job={'draft_id':'first'}
        worker.cover_receipt={'body':'上一稿正文 #AI工具'}
        worker.upload_agreement_required=True
        worker.prepared_pages=[{'page':old,'title':'上一稿','body':'上一稿正文'}]
        result=await worker.connect(fresh=True)
        self.assertTrue(result['previousPageRetained'])
        self.assertIs(worker.page,new)
        self.assertIsNone(worker.prepare_lock)
        self.assertIsNone(worker.current_job)
        self.assertIsNone(worker.cover_receipt)
        self.assertFalse(worker.upload_agreement_required)
        self.assertEqual(worker.prepared_pages[0]['body'],'上一稿正文 #AI工具')
        self.assertEqual(worker.prepared_pages[0]['topics'],['AI工具'])
        self.assertEqual(len(worker.prepared_pages[0]['covers']),2)
        old.goto.assert_not_awaited();old.close.assert_not_awaited()

    async def test_douyin_failed_new_page_restores_all_previous_state(self):
        for failure in ('creation','navigation','origin','status'):
            with self.subTest(failure=failure):
                worker,old,new=self.session('douyin')
                worker.prepare_lock='completed-job';worker.current_job={'draft_id':'first'}
                worker.cover_receipt={'body':'原文 #话题'}
                before=(worker.prepared_result,worker.current_job,worker.cover_receipt,worker.prepare_lock)
                if failure=='creation':worker.context.new_page.side_effect=RuntimeError()
                elif failure=='navigation':new.goto.side_effect=TimeoutError()
                elif failure=='origin':worker.check_page.side_effect=RuntimeError('unexpected_origin')
                else:worker.status.side_effect=TimeoutError()
                with self.assertRaises(Exception):await worker.connect(fresh=True)
                self.assertIs(worker.page,old)
                self.assertEqual(worker.phase,'prepared')
                self.assertEqual((worker.prepared_result,worker.current_job,worker.cover_receipt,worker.prepare_lock),before)
                self.assertEqual(worker.prepared_pages,[])
                if failure!='creation':new.close.assert_awaited_once()
                old.close.assert_not_awaited();old.goto.assert_not_awaited()

    async def test_douyin_incomplete_upload_refuses_fresh_page(self):
        worker,old,new=self.session('douyin')
        worker.phase='login_observed';worker.prepare_lock='pending-job'
        with self.assertRaises(Exception):await worker.connect(fresh=True)
        self.assertEqual(worker.prepare_lock,'pending-job')
        worker.context.new_page.assert_not_awaited()



    async def test_douyin_image_page_uses_native_entry_and_retains_video(self):
        worker,old,new=self.session('douyin')
        result=await worker.connect(fresh=True,kind='image')
        self.assertTrue(result['previousPageRetained'])
        worker.enter_upload.assert_awaited_once_with(new,'image')
        self.assertEqual(worker.editor_kind,'image')
        old.close.assert_not_awaited();old.goto.assert_not_awaited()

    async def test_image_entry_failure_restores_previous_kind_and_page(self):
        worker,old,new=self.session('douyin')
        worker.enter_upload.side_effect=RuntimeError('image_entry_ambiguous')
        with self.assertRaises(Exception):await worker.connect(fresh=True,kind='image')
        self.assertIs(worker.page,old);self.assertEqual(worker.editor_kind,'video')
        new.close.assert_awaited_once();old.close.assert_not_awaited()

if __name__ == '__main__':
    unittest.main()
