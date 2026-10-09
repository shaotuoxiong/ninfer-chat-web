"""Measure four overlapping public SSE responses against the deployed model."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default=json.loads((ROOT / 'config.json').read_text())['apiBase'])
base = parser.parse_args().base_url
headers = {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1'}
with urllib.request.urlopen(urllib.request.Request(base + '/v1/models', headers=headers), timeout=30) as r:
    model = json.load(r)['data'][0]['id']
barrier = threading.Barrier(4)
start = time.monotonic()
stop = threading.Event()
memories = []
def sample():
    while not stop.is_set():
        raw = subprocess.check_output(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], text=True)
        memories.append(int(raw.strip().splitlines()[0]))
        stop.wait(.2)

def request(index):
    label = f'CONCURRENT-{index}'
    body = {'model': model, 'stream': True, 'stream_options': {'include_usage': True},
            'enable_thinking': False, 'max_tokens': 512, 'temperature': 0,
            'messages': [{'role': 'user', 'content': f'先原样写出会话标识 {label}，然后逐行列出从1到150的整数，每行一个数字。'}]}
    barrier.wait()
    first = None; last = None; answer = ''; timing = {}; usage = {}
    req = urllib.request.Request(base + '/v1/chat/completions', headers=headers, data=json.dumps(body).encode())
    with urllib.request.urlopen(req, timeout=120) as response:
        for line in response:
            if not line.startswith(b'data:'): continue
            raw = line[5:].strip()
            if raw == b'[DONE]': break
            data = json.loads(raw)
            if 'error' in data: raise RuntimeError(data['error'])
            text = (data.get('choices') or [{}])[0].get('delta', {}).get('content', '')
            if text:
                last = time.monotonic() - start
                if first is None: first = last
                answer += text
            if data.get('timings'): timing = data['timings']
            if data.get('usage'): usage = data['usage']
    assert label in answer, f'Unexpected output for {label}'
    return {'request': index, 'first_content_s': first, 'last_content_s': last, 'timings': timing, 'usage': usage}

sampler = threading.Thread(target=sample); sampler.start()
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(request, range(1, 5)))
finally:
    stop.set(); sampler.join()
overlap = min(r['last_content_s'] for r in results) - max(r['first_content_s'] for r in results)
report = {'base_url': base, 'model': model, 'concurrency': 4, 'overlap_seconds': overlap,
          'gpu_peak_mib': max(memories), 'results': results}
(ROOT / 'concurrency-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
assert overlap > 0, 'All four responses did not overlap'
