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
        with patch.object(research,'decide_plan',return_value={'kind':'simple','limit':3,'fresh':False}), patch.object(research,'gather_documents',return_value=brief) as call:
            result=research.research_messages(payload,events.append)
        self.assertEqual(call.call_args.args[1]['limit'],3)
        self.assertEqual(result['messages'][-1],payload['messages'][-1])
        self.assertIn(brief['documents'][0]['content'],result['messages'][1]['content'])
        self.assertEqual(events[-1]['sources'],[{'title':'Ubuntu官方','url':'https://ubuntu.com/download'}])
        self.assertEqual(len(payload['messages']),2)

    def test_search_snippets_and_failed_pages_are_not_read_sources(self):
        brief={'sources':[{'title':'摘要','url':'https://example.com','snippet':'搜索摘要。'*100}],
               'documents':[{'url':'https://example.com','error':'captcha'}]}
        with patch.object(research,'decide_plan',return_value={'kind':'simple','limit':3,'fresh':False}), patch.object(research,'gather_documents',return_value=brief):
            with self.assertRaisesRegex(research.ResearchError,'无法读取'):
                research.research_messages({'messages':[{'role':'user','content':'问题'}]},lambda e:None)

    def test_mcp_failure_does_not_generate_answer(self):
        with patch.object(research,'decide_plan',return_value={'kind':'simple','limit':3,'fresh':False}), patch.object(research,'mcp_call',side_effect=research.ResearchError('搜索失败')):
            with self.assertRaisesRegex(research.ResearchError,'搜索失败'):
                research.research_messages({'messages':[{'role':'user','content':'问题'}]},lambda e:None)

    def test_identity_never_calls_network(self):
        with patch.object(research,'mcp_call') as call:
            events=[]
            result=research.research_messages({'messages':[{'role':'user','content':'你是什么模型？'}]},events.append)
        call.assert_not_called()
        self.assertEqual(events[-1]['stage'],'direct')
        self.assertIn('qwen3.8-27b',result['messages'][0]['content'])

    def test_local_model_routes_stable_knowledge_without_search(self):
        response=unittest.mock.MagicMock()
        # Build the wire response rather than relying on escaped fixture strings.
        import json
        response.__enter__.return_value.read.return_value=json.dumps({'choices':[{'message':{'content':json.dumps({'need_web':False,'kind':'simple'})}}]}).encode()
        with patch.object(research.urllib.request,'urlopen',return_value=response) as local, patch.object(research,'mcp_call') as external:
            self.assertEqual(research.decide_plan('什么是牛顿第一定律？')['limit'],0)
        self.assertEqual(local.call_args.args[0].full_url,'http://127.0.0.1:8080/v1/chat/completions')
        external.assert_not_called()

    def test_depth_and_explicit_search_override(self):
        for text, count in [('你是什么模型',0),('你好',0),('证明圆周率是无理数',0),
                            ('Ubuntu安装方法',3),('最新消息',6),('RTX 4090 与 A100 对比',6),
                            ('深入研究大模型部署并优先官方来源',16),('联网搜索你是什么模型',3)]:
            self.assertEqual(research.route_question(text)['limit'],count,text)

    def test_requesting_sources_alone_does_not_force_fresh_fetches(self):
        self.assertFalse(research.route_question('深入研究 Ubuntu 安装方法，优先官方来源')['fresh'])
        self.assertTrue(research.route_question('深入研究最新 Ubuntu 安装变化，优先官方来源')['fresh'])

    def test_sixteen_sources_are_unique_and_within_context_budget(self):
        docs=[{'url':f'https://example.com/{i}','content':'正文资料'*3000} for i in range(20)]
        result=research.read_documents({'documents':docs+[docs[0]]},16,24000)
        self.assertEqual(len(result),16)
        self.assertLessEqual(sum(len(s['text']) for s in result),24000)
        self.assertEqual(len({s['url'] for s in result}),16)

    def test_captcha_pages_never_count_as_read_sources(self):
        blocked=[{'title':'Client Challenge','url':'https://example.com/a','content':'challenge '*100},
                 {'title':'请进行安全验证(Security Verification)','url':'https://example.com/b','content':'页面资料 '*100}]
        self.assertEqual(research.read_documents({'documents':blocked},16),[])

    def test_search_prioritizes_official_and_replaces_failed_reads(self):
        candidates=[{'url':'https://example.com/blog'},{'url':'https://ubuntu.com/download'},
                    {'url':'https://example.com/failure'},{'url':'https://example.com/reserve'}]
        def fake(name,args,progress=None,**kwargs):
            if name=='search': return {'results':candidates}
            if args['url'].endswith('failure'): return {'error':'captcha'}
            return {'url':args['url'],'content':'有效正文资料'*100}
        with patch.object(research,'mcp_call',side_effect=fake):
            brief=research.gather_documents('Ubuntu',{'limit':3,'fresh':False},lambda e:None)
        self.assertEqual(brief['documents'][0]['url'],'https://ubuntu.com/download')
        self.assertEqual(len(brief['documents']),3)

    def test_two_searches_and_eight_reads_really_overlap(self):
        import threading
        import time
        searches=threading.Barrier(2)
        reads=threading.Barrier(8)
        active=0;maximum=0;guard=threading.Lock()
        results=[{'url':f'https://example.com/{i}'} for i in range(16)]
        def fake(name,args,progress=None,**kwargs):
            nonlocal active,maximum
            if name=='search': searches.wait(timeout=3); return {'results':results}
            with guard: active+=1;maximum=max(maximum,active)
            reads.wait(timeout=3)
            time.sleep(.01)
            with guard: active-=1
            return {'url':args['url'],'content':'真实正文资料'*100}
        with patch.object(research,'mcp_call',side_effect=fake):
            brief=research.gather_documents('深入研究',{'limit':16,'fresh':False},lambda e:None)
        self.assertEqual(len(brief['documents']),16)
        self.assertEqual(maximum,8)

if __name__=='__main__': unittest.main()
