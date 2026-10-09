"""Automatic research gateway using the loopback-only free-search MCP server."""
import http.client
import json
from http.server import ThreadingHTTPServer
from local_gateway import Gateway as BaseGateway, ORIGINS
from web_research import research_messages, ResearchError

ORIGINS.update({'http://127.0.0.1:8080','http://localhost:8080'})

class Gateway(BaseGateway):
    def do_POST(self):
        if self.path == '/v1/research/chat/completions': self.research()
        else: self.forward()

    def research(self):
        connection = None
        started = False
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > 20 * 1024 * 1024:
                self.send_error(413); return
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict) or payload.get('stream') is not True:
                self.send_error(400, 'Research endpoint requires stream=true'); return
            self.send_response(200); self.cors()
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('X-Accel-Buffering', 'no')
            self.send_header('Connection', 'close'); self.end_headers()
            self.close_connection = True; started = True
            def event(value):
                self.wfile.write(('data: ' + json.dumps(value, ensure_ascii=False) + '\n\n').encode())
                self.wfile.flush()
            augmented = research_messages(payload, lambda progress: event({'research':progress}))
            connection = http.client.HTTPConnection('127.0.0.1', 8080, timeout=300)
            connection.request('POST', '/v1/chat/completions', body=json.dumps(augmented).encode(),
                               headers={'Content-Type':'application/json'})
            upstream = connection.getresponse()
            if upstream.status != 200:
                raise ResearchError('资料已读取，但模型请求失败（HTTP %s）。' % upstream.status)
            while data := upstream.read1(65536):
                self.wfile.write(data); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (ResearchError, OSError, http.client.HTTPException, ValueError) as error:
            if started:
                message = str(error) if isinstance(error, ResearchError) else '联网读取或模型连接失败，请稍后重试。'
                try:
                    self.wfile.write(('data: ' + json.dumps({'error':{'message':message}}, ensure_ascii=False) + '\n\ndata: [DONE]\n\n').encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError): pass
            else: self.send_error(400, 'Invalid research request')
        finally:
            if connection: connection.close()

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1',8081),Gateway).serve_forever()
