import unittest
from unittest.mock import patch
import web_research as research

class ResearchTests(unittest.TestCase):
    def test_reads_body_before_answer_and_preserves_history_image(self):
        payload={'model':'qwen3.8-27b','stream':True,'messages':[
            {'role':'system','content':'简洁中文'},
            {'role':'user','content':[{'type':'text','text':'Ubuntu版本'},{'type':'image_url','image_url':{'url':'data:image/png;base64,AAAA'}}]}]}
        brief={'sources':[{'title':'Ubuntu官方','url':'https://ubuntu.com/download'}],
               'documents':[{'title':'Ubuntu官方','url':'https://ubuntu.com/download','content':'网页正文。'*100,'published_date':'2026-10-01'}]}
        events=[]
        with patch.object(research,'mcp_call',return_value=brief) as call:
            result=research.research_messages(payload,events.append)
        self.assertEqual(call.call_args.args[0],'research')
        self.assertTrue(call.call_args.args[1]['fetch'])
        self.assertEqual(result['messages'][-1],payload['messages'][-1])
        self.assertIn(brief['documents'][0]['content'],result['messages'][1]['content'])
        self.assertEqual(events[-1]['sources'],[{'title':'Ubuntu官方','url':'https://ubuntu.com/download'}])
        self.assertEqual(len(payload['messages']),2)

    def test_search_snippets_and_failed_pages_are_not_read_sources(self):
        brief={'sources':[{'title':'摘要','url':'https://example.com','snippet':'搜索摘要。'*100}],
               'documents':[{'url':'https://example.com','error':'captcha'}]}
        with patch.object(research,'mcp_call',return_value=brief):
            with self.assertRaisesRegex(research.ResearchError,'无法读取'):
                research.research_messages({'messages':[{'role':'user','content':'问题'}]},lambda e:None)

    def test_mcp_failure_does_not_generate_answer(self):
        with patch.object(research,'mcp_call',side_effect=research.ResearchError('搜索失败')):
            with self.assertRaisesRegex(research.ResearchError,'搜索失败'):
                research.research_messages({'messages':[{'role':'user','content':'问题'}]},lambda e:None)

if __name__=='__main__': unittest.main()
