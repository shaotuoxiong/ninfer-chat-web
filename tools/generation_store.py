"""Private resumable generation jobs; only unguessable IDs expose a single job."""
import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path

DB_PATH = os.environ.get('NINFER_JOB_DB', '/data/generations.sqlite3')
TTL = 24 * 3600
CAPACITY = 4
slots = threading.BoundedSemaphore(CAPACITY)
lock = threading.RLock()
running = set()


def connect():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=NORMAL')
    db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, fingerprint TEXT, created REAL, state TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS events (job TEXT, seq INTEGER, value TEXT, PRIMARY KEY(job,seq))')
    return db


def emit(job, value):
    with lock, connect() as db:
        seq = db.execute('SELECT COALESCE(MAX(seq),0)+1 FROM events WHERE job=?',(job,)).fetchone()[0]
        db.execute('INSERT INTO events VALUES (?,?,?)',(job,seq,json.dumps(value,ensure_ascii=False)))
    return seq


def state(job):
    with connect() as db:
        row = db.execute('SELECT state FROM jobs WHERE id=?',(job,)).fetchone()
    return row[0] if row else None


def finish(job, status):
    with lock, connect() as db:
        db.execute('UPDATE jobs SET state=? WHERE id=?',(status,job))


def replay(job, after):
    with connect() as db:
        return [(seq,json.loads(value)) for seq,value in db.execute(
            'SELECT seq,value FROM events WHERE job=? AND seq>? ORDER BY seq LIMIT 256',(job,after))]


def create(job, payload, worker):
    uuid.UUID(job)
    fingerprint = hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
    with lock, connect() as db:
        old = db.execute('SELECT fingerprint FROM jobs WHERE id=?',(job,)).fetchone()
        if old:
            if old[0] != fingerprint: raise ValueError('request ID reused with different messages')
            return False
        if not slots.acquire(blocking=False): raise OverflowError('任务较多，请稍后重试')
        db.execute('DELETE FROM events WHERE job IN (SELECT id FROM jobs WHERE created<? AND state!=?)',(time.time()-TTL,'running'))
        db.execute('DELETE FROM jobs WHERE created<? AND state!=?',(time.time()-TTL,'running'))
        db.execute('INSERT INTO jobs VALUES (?,?,?,?)',(job,fingerprint,time.time(),'running'))
        running.add(job)
    def run():
        try: worker(job,payload)
        except Exception:
            emit(job,{'error':{'message':'后台生成异常，已保存部分回答。'}})
            finish(job,'failed')
        finally:
            with lock: running.discard(job)
            slots.release()
    threading.Thread(target=run,daemon=True).start()
    return True


def recover_interrupted():
    with connect() as db:
        interrupted = [row[0] for row in db.execute("SELECT id FROM jobs WHERE state='running'")]
    for job in interrupted:
        emit(job,{'error':{'message':'网关重启中断了生成；此前输出已保留，请继续追问。'}})
        finish(job,'failed')
