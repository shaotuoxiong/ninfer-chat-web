"""Resumable background research and model generation, independent of visitors."""
import http.client
import json
import time
import uuid
from http.server import ThreadingHTTPServer
from local_gateway import Gateway as BaseGateway, ORIGINS
from web_research import research_messages, ResearchError
import generation_store as store

ORIGINS.update({'http://127.0.0.1:8080','http://localhost:8080'})


def generate(job, payload):
    connection = None
    ended = False
    try:
        def progress(value):
            if store.state(job) == 'cancelled': raise ResearchError('已停止生成')
            store.emit(job,{'research':value})
        augmented = research_messages(payload, progress)
        if store.state(job) == 'cancelled': return
        connection = http.client.HTTPConnection('127.0.0.1',8080,timeout=300)
        connection.request('POST','/v1/chat/completions',body=json.dumps(augmented).encode(),headers={'Content-Type':'application/json'})
        upstream = connection.getresponse()
        if upstream.status != 200: raise ResearchError('模型请求失败（HTTP %s）'%upstream.status)
        lines=[]
        for raw in upstream:
            if store.state(job) == 'cancelled': return
            line=raw.decode().strip()
            if line.startswith('data:'): lines.append(line[5:].lstrip())
            elif not line and lines:
                text='\n'.join(lines);lines=[]
                if text=='[DONE]': break
                value=json.loads(text)
                store.emit(job,value)
                if any(c.get('finish_reason') for c in value.get('choices',[])): ended=True
        if not ended: raise ResearchError('模型连接提前结束；已保存部分回答，请继续追问。')
        store.finish(job,'completed')
    except (ResearchError,OSError,http.client.HTTPException,ValueError) as error:
        if store.state(job) != 'cancelled':
            store.emit(job,{'error':{'message':str(error) if isinstance(error,ResearchError) else '模型或检索连接失败，已保存部分回答。'}})
            store.finish(job,'failed')
    finally:
        if connection: connection.close()


class Gateway(BaseGateway):
    def do_POST(self):
        if self.path == '/v1/research/chat/completions': self.research()
        elif self.path == '/v1/research/cancel': self.cancel()
        else: self.forward()

    def body(self):
        size=int(self.headers.get('Content-Length','0'))
        if size<=0 or size>20*1024*1024: raise ValueError('invalid payload size')
        return json.loads(self.rfile.read(size))

    def cancel(self):
        try:
            job=self.body()['request_id']; uuid.UUID(job)
            if store.state(job)=='running': store.finish(job,'cancelled')
            self.send_response(204);self.cors();self.send_header('Content-Length','0');self.end_headers()
        except (ValueError,KeyError): self.send_error(400)

    def research(self):
        try:
            payload=self.body()
            job=payload.pop('request_id',None) or str(uuid.uuid4())
            after=int(payload.pop('after',0))
            if payload.get('stream') is not True or after<0: raise ValueError('invalid stream request')
            store.create(job,payload,generate)
        except OverflowError:
            self.send_response(429);self.cors();self.send_header('Content-Length','0');self.end_headers();return
        except (ValueError,KeyError,TypeError): self.send_error(400);return
        self.send_response(200);self.cors()
        for key,value in [('Content-Type','text/event-stream; charset=utf-8'),('Cache-Control','no-cache'),
                          ('X-Accel-Buffering','no'),('Connection','close')]: self.send_header(key,value)
        self.end_headers();self.close_connection=True
        heartbeat=time.monotonic()
        try:
            while True:
                events=store.replay(job,after)
                for seq,value in events:
                    value['resume']={'request_id':job,'seq':seq}
                    self.wfile.write(('data: '+json.dumps(value,ensure_ascii=False)+'\n\n').encode())
                    after=seq
                if events: self.wfile.flush();heartbeat=time.monotonic()
                if not events and store.state(job)!='running':
                    self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush();break
                if time.monotonic()-heartbeat>=5:
                    self.wfile.write(b': heartbeat\n\n');self.wfile.flush();heartbeat=time.monotonic()
                time.sleep(0.1)
        except (BrokenPipeError,ConnectionResetError,OSError):
            # Detach this visitor; the generation worker continues and saves events.
            pass


if __name__=='__main__':
    store.recover_interrupted()
    ThreadingHTTPServer(('127.0.0.1',8081),Gateway).serve_forever()
