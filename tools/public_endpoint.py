"""Manage the fixed ngrok HTTPS inference endpoint used by GitHub Pages."""
import argparse
import json
from pathlib import Path
import shlex
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def docker(*args):
    subprocess.run(['sg', 'docker', '-c', shlex.join(['docker', *args])], cwd=ROOT, check=True)

def compose(*args):
    docker('compose', '-f', str(ROOT / 'compose.public.yml'), *args)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'status', 'restart', 'stop'])
    parser.add_argument('--publish', action='store_true', help='publish config.json if the endpoint has changed')
    args = parser.parse_args()
    if args.action == 'stop':
        compose('stop')
        print('公网入口已停止；本机模型继续运行。'); return
    if args.action == 'status':
        compose('ps')
        print((ROOT / 'config.json').read_text()); return
    credential = ROOT / '.private/ngrok.env'
    if not credential.is_file():
        raise SystemExit('缺少本机 ngrok 认证文件 .private/ngrok.env；不要将凭据提交到 GitHub。')
    if credential.stat().st_mode & 0o077:
        raise SystemExit('请先将 .private/ngrok.env 权限设为 600。')
    docker('start', 'ninfer-4090')
    if args.action == 'restart': compose('restart')
    compose('up', '-d')
    expected = json.loads((ROOT / 'config.json').read_text())['apiBase']
    for _ in range(30):
        try:
            data = json.load(urllib.request.urlopen('http://127.0.0.1:4040/api/tunnels', timeout=2))
            urls = [t['public_url'] for t in data['tunnels'] if t['public_url'].startswith('https://')]
            if expected in urls:
                print('固定 HTTPS 推理接口：', expected)
                print('网页：https://shaotuoxiong.github.io/ninfer-chat-web/')
                break
        except (OSError, ValueError): pass
        time.sleep(1)
    else: raise SystemExit('代理尚未就绪，请检查容器状态或 ngrok 账户。')
    if args.publish:
        subprocess.run(['git', 'add', 'config.json'], cwd=ROOT, check=True)
        changed = subprocess.run(['git', 'diff', '--cached', '--quiet', '--', 'config.json'], cwd=ROOT)
        if changed.returncode:
            subprocess.run(['git', 'commit', '-m', 'fix: update fixed inference endpoint', '--', 'config.json'], cwd=ROOT, check=True)
            subprocess.run(['git', '-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', 'main'], cwd=ROOT, check=True)

if __name__ == '__main__':
    main()
