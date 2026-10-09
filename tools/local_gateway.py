"""Streaming gateway for the GitHub Pages chat; forwards to existing nInfer."""
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORIGINS = {'https://shaotuoxiong.github.io', 'http://127.0.0.1:8088'}

class Gateway(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def cors(self):
        origin = self.headers.get('Origin')
        if origin in ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Pinggy-No-Screen')
            self.send_header('Access-Control-Max-Age', '600')

    def do_OPTIONS(self):
        self.send_response(204); self.cors()
        self.send_header('Content-Length', '0'); self.end_headers()

    def do_GET(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def forward(self):
        if (self.command, self.path) not in {('GET', '/v1/models'), ('POST', '/v1/chat/completions')}:
            self.send_error(404); return
        connection = http.client.HTTPConnection('127.0.0.1', 8080, timeout=300)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 0 or size > 20 * 1024 * 1024:
                self.send_error(413); return
            body = self.rfile.read(size) if size else None
            connection.request(self.command, self.path, body=body,
                               headers={'Content-Type': 'application/json'})
            upstream = connection.getresponse()
            self.send_response(upstream.status); self.cors()
            self.send_header('Content-Type', upstream.getheader('Content-Type', 'application/json'))
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('X-Accel-Buffering', 'no')
            self.send_header('Connection', 'close'); self.end_headers()
            self.close_connection = True
            while data := upstream.read1(65536):
                self.wfile.write(data); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (OSError, http.client.HTTPException) as error:
            self.log_error('upstream error: %s', error)
            self.close_connection = True
        finally:
            connection.close()

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8081), Gateway).serve_forever()
