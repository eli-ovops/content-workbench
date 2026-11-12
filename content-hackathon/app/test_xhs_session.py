import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from xhs_worker import Worker
from xhs_note import PUBLISH_URL

class SessionRegression(unittest.IsolatedAsyncioTestCase):
    async def test_switching_content_type_opens_a_separate_page(self):
        worker=Worker()
        old=SimpleNamespace(is_closed=lambda:False,goto=AsyncMock(),close=AsyncMock())
        new=SimpleNamespace(goto=AsyncMock(),bring_to_front=AsyncMock())
        worker.page=old;worker.phase='prepared'
        worker.context=SimpleNamespace(new_page=AsyncMock(return_value=new))
        worker.status=AsyncMock(return_value={'phase':'connected'})
        await worker.connect(kind='video')
        old.goto.assert_not_awaited();old.close.assert_not_awaited()
        self.assertIn('target=video',new.goto.await_args.args[0])
        self.assertEqual(worker.editor_kind,'video')

    async def test_new_editor_preserves_the_prepared_page(self):
        worker=Worker()
        old=SimpleNamespace(is_closed=lambda:False,goto=AsyncMock(),close=AsyncMock())
        new=SimpleNamespace(goto=AsyncMock(),bring_to_front=AsyncMock())
        worker.page=old;worker.phase='prepared'
        worker.context=SimpleNamespace(new_page=AsyncMock(return_value=new))
        worker.status=AsyncMock(return_value={'phase':'connected'})
        await worker.connect(fresh=True)
        worker.context.new_page.assert_awaited_once()
        old.goto.assert_not_awaited();old.close.assert_not_awaited()
        self.assertEqual(new.goto.await_args.args[0],PUBLISH_URL)
        self.assertIs(worker.page,new)

if __name__=='__main__':unittest.main()
