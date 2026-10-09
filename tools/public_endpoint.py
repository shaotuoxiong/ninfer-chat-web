"""Manage a temporary HTTPS inference endpoint and optionally update GitHub Pages."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def pid_for(name, marker):
    try:
        pid = int((ROOT / name).read_text())
        if marker.encode() in Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0'):
            return pid
    except (ValueError, OSError):
        pass
    return None

def spawn(command, pidfile, logfile):
    with (ROOT / logfile).open('wb') as output:
        p = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=output,
                             stderr=subprocess.STDOUT, start_new_session=True, cwd=ROOT)
    (ROOT / pidfile).write_text(str(p.pid) + '\n')
    return p

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'status', 'stop'])
    parser.add_argument('--publish', action='store_true', help='commit and push the new config.json endpoint')
    args = parser.parse_args()
    marker = f'UserKnownHostsFile={ROOT / "public-tunnel-known-hosts"}'
    tunnel = pid_for('.public-tunnel.pid', marker)
    gateway = pid_for('.gateway.pid', str(ROOT / 'tools/local_gateway.py'))
    if args.action == 'stop':
        for pid, file in [(tunnel, '.public-tunnel.pid'), (gateway, '.gateway.pid')]:
            if pid: os.kill(pid, signal.SIGTERM)
            (ROOT / file).unlink(missing_ok=True)
        print('公网 API 入口已停止；模型容器继续运行。'); return
    if args.action == 'status':
        print('隧道运行中' if tunnel else '隧道未运行')
        print((ROOT / 'config.json').read_text() if (ROOT / 'config.json').exists() else '尚无服务地址')
        return
    with urllib.request.urlopen('http://127.0.0.1:8080/v1/models', timeout=5) as response:
        response.read()
    if not gateway:
        spawn([sys.executable, str(ROOT / 'tools/local_gateway.py')], '.gateway.pid', 'gateway.log')
        for _ in range(30):
            try:
                urllib.request.urlopen('http://127.0.0.1:8081/v1/models', timeout=1).close(); break
            except OSError: time.sleep(.1)
        else: raise SystemExit('网关未启动，请查看 gateway.log')
    if not tunnel:
        p = spawn(['ssh', '-T', '-p', '443', '-o', 'BatchMode=yes', '-o', 'IdentityFile=none',
                   '-o', 'IdentityAgent=none', '-o', 'StrictHostKeyChecking=accept-new', '-o', marker,
                   '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
                   '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=15',
                   '-R', '0:127.0.0.1:8081', 'free.pinggy.io', 'x:passpreflight'], '.public-tunnel.pid', 'public-tunnel.log')
        for _ in range(150):
            if p.poll() is not None: raise SystemExit((ROOT / 'public-tunnel.log').read_text(errors='replace'))
            if re.search(r'https://[a-z0-9-]+\.free\.pinggy\.net', (ROOT / 'public-tunnel.log').read_text(errors='replace')): break
            time.sleep(.2)
        else: raise SystemExit('连接尚未完成，请查看 public-tunnel.log')
    url = re.search(r'https://[a-z0-9-]+\.free\.pinggy\.net', (ROOT / 'public-tunnel.log').read_text(errors='replace')).group()
    (ROOT / 'config.json').write_text(json.dumps({'apiBase': url}, indent=2) + '\n')
    print('HTTPS 推理接口：', url)
    print('免费入口约 60 分钟后到期；网页仍存在，但需更新接口。')
    if args.publish:
        subprocess.run(['git', 'add', 'config.json'], cwd=ROOT, check=True)
        changed = subprocess.run(['git', 'diff', '--cached', '--quiet', '--', 'config.json'], cwd=ROOT)
        if changed.returncode:
            subprocess.run(['git', 'commit', '-m', 'fix: refresh temporary inference endpoint', '--', 'config.json'], cwd=ROOT, check=True)
            subprocess.run(['git', '-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', 'main'], cwd=ROOT, check=True)

if __name__ == '__main__':
    main()
