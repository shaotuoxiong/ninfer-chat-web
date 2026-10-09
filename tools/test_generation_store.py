import tempfile
import threading
import time
import unittest
import uuid
from unittest.mock import patch
import generation_store as store

class StoreTests(unittest.TestCase):
    def test_idempotent_job_survives_detached_reader_and_replays_exact_suffix(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(store,'DB_PATH',directory+'/jobs.db'):
            job=str(uuid.uuid4()); done=threading.Event()
            def worker(job,payload):
                store.emit(job,{'choices':[{'delta':{'content':'第一段'}}]})
                time.sleep(0.1)
                store.emit(job,{'choices':[{'delta':{'content':'第二段'},'finish_reason':'stop'}]})
                store.finish(job,'completed');done.set()
            payload={'stream':True,'messages':[]}
            self.assertTrue(store.create(job,payload,worker))
            self.assertFalse(store.create(job,payload,worker))
            self.assertTrue(done.wait(3))
            self.assertEqual(store.state(job),'completed')
            self.assertEqual([seq for seq,_ in store.replay(job,1)],[2])
            with self.assertRaises(ValueError):store.create(job,{'messages':['different']},worker)
            store.recover_interrupted()
            self.assertEqual(len(store.replay(job,0)),2)

    def test_restart_reports_interrupted_generation_and_retains_partial_output(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(store,'DB_PATH',directory+'/jobs.db'):
            job=str(uuid.uuid4())
            with store.connect() as db:
                db.execute('INSERT INTO jobs VALUES (?,?,?,?)',(job,'fingerprint',time.time(),'running'))
            store.emit(job,{'choices':[{'delta':{'content':'已生成内容'}}]})
            store.recover_interrupted()
            events=store.replay(job,0)
            self.assertEqual(store.state(job),'failed')
            self.assertEqual(events[0][1]['choices'][0]['delta']['content'],'已生成内容')
            self.assertIn('网关重启',events[1][1]['error']['message'])

if __name__=='__main__':unittest.main()
