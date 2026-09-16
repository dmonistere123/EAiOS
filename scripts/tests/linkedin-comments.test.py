import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('comments', Path(__file__).parents[1] / 'linkedin-comments.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
POST = 'urn:li:share:123456789'; ACTOR = 'urn:li:person:example'

class Comments(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.home = Path(self.temp.name)
        self.c = sqlite3.connect(self.home / 'kanban.db')
        self.c.execute('CREATE TABLE tasks(id TEXT,body TEXT,status TEXT)')
        self.env = {'eaios': 'approval', 'actionType': 'publish', 'targetSystem': 'linkedin', 'decision': 'approved', 'payload': 'The executive edited this exact text.', 'linkedinComment': {'postUrn': POST, 'actorUrn': ACTOR}}
        self.put()
    def tearDown(self): self.c.close(); self.temp.cleanup()
    def put(self, status='running'):
        self.c.execute('DELETE FROM tasks'); self.c.execute('INSERT INTO tasks VALUES (?,?,?)', ('task1', json.dumps(self.env), status)); self.c.commit()
    def response(self, home, name, args):
        if args['tools'][0]['tool_slug']=='LINKEDIN_GET_MY_INFO':return {'data':{'results':[{'response':{'successful':True,'data':{'id':'example'}}}]}}
        self.calls.append(args)
        a = args['tools'][0]['arguments']
        self.assertEqual(a['message']['text'], self.env['payload'])
        self.assertEqual(a['target_urn'], POST)
        return {'data': {'results': [{'response': {'successful': True, 'data': {'id': 'receipt123', 'actor': ACTOR, 'object': POST, 'message': {'text': self.env['payload']}}}}]}}
    def test_fresh_box_can_check_before_first_kanban_task(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertFalse(m.seen(Path(temp),POST)['skip'])
    def test_exact_approved_text_and_receipt_prevent_reposting(self):
        self.calls=[]
        r=m.publish(self.home,'task1',self.response);self.assertEqual(r['commentId'],'receipt123')
        self.assertEqual(m.seen(self.home,POST)['status'],'posted')
        with self.assertRaises(ValueError):m.publish(self.home,'task1',self.response)
        self.assertEqual(len(self.calls),1)
    def test_rejected_pending_review_and_done_never_publish(self):
        for decision,typ,status in [('rejected','publish','blocked'),('pending','publish','ready'),('approved','review','running'),('approved','publish','done')]:
            self.env.update(decision=decision,actionType=typ);self.put(status)
            with self.assertRaises(ValueError):m.publish(self.home,'task1',lambda *a:self.fail('Must not call LinkedIn'))
    def test_unconfirmed_write_is_not_retried(self):
        def fail(home,name,args):
            if args['tools'][0]['tool_slug']=='LINKEDIN_GET_MY_INFO':return {'data':{'results':[{'response':{'successful':True,'data':{'id':'example'}}}]}}
            raise TimeoutError()
        with self.assertRaises(ValueError):m.publish(self.home,'task1',fail)
        self.assertEqual(m.seen(self.home,POST)['status'],'unconfirmed')
        with self.assertRaises(ValueError):m.publish(self.home,'task1',fail)
    def test_mismatched_text_target_and_failed_receipts_are_not_success(self):
        for change in ['text','target','failure','missing']:
            with m.connection(self.home) as c:c.execute('DELETE FROM comments')
            def transport(home,name,arguments):
                if arguments['tools'][0]['tool_slug']=='LINKEDIN_GET_MY_INFO':return {'data':{'results':[{'response':{'successful':True,'data':{'id':'example'}}}]}}
                data={'id':'123','actor':ACTOR,'object':POST,'message':{'text':self.env['payload']}}
                if change=='text':data['message']['text']='Wrong draft'
                if change=='target':data['object']='urn:li:share:987'
                if change=='missing':data.pop('id')
                return {'data':{'results':[{'response':{'successful':change!='failure','data':data}}]}}
            with self.assertRaises(ValueError):m.publish(self.home,'task1',transport)
            self.assertEqual(m.seen(self.home,POST)['status'],'unconfirmed')
    def test_rejection_during_preparation_stops_write(self):
        def transport(home,name,args):
            self.env['decision']='rejected';self.put('blocked')
            return {'data':{'results':[{'response':{'successful':True,'data':{'id':'example'}}}]}}
        with self.assertRaises(ValueError):m.publish(self.home,'task1',transport)
        with m.connection(self.home) as c:self.assertEqual(c.execute('SELECT count(*) FROM comments').fetchone()[0],0)
    def test_wrong_connected_identity_never_publishes(self):
        calls=[]
        def transport(home,name,args):
            calls.append(args);return {'data':{'results':[{'response':{'successful':True,'data':{'id':'other'}}}]}}
        with self.assertRaises(ValueError):m.publish(self.home,'task1',transport)
        self.assertEqual(len(calls),1);self.assertFalse(m.seen(self.home,POST,excluding='task1')['skip'])
    def test_activity_url_cannot_be_guessed_into_post_urn(self):
        self.env['linkedinComment']['postUrn']='urn:li:activity:123';self.put()
        with self.assertRaises(ValueError):m.publish(self.home,'task1',lambda *a:self.fail('Must not guess'))
    def test_scans_skip_existing_pending_rejected_and_approved_targets(self):
        for decision in ['pending','rejected','approved']:
            self.env['decision']=decision;self.put()
            self.assertTrue(m.seen(self.home,POST)['skip'])
            result=m.suggest(self.home,POST,'https://www.linkedin.com/posts/example','Example','New text',ACTOR,lambda *a,**k:self.fail('Must not duplicate'))
            self.assertTrue(result['skip'])
    def test_new_suggestions_are_unassigned_publish_envelopes(self):
        self.c.execute('DELETE FROM tasks');self.c.commit();calls=[]
        def run(args,**kwargs):calls.append(args)
        m.suggest(self.home,POST,'https://www.linkedin.com/posts/example','Article','Draft',ACTOR,run)
        self.assertNotIn('--assignee',calls[0]);e=json.loads(calls[0][calls[0].index('--body')+1])
        self.assertEqual(e['actionType'],'publish');self.assertEqual(e['payload'],'Draft');self.assertEqual(e['linkedinComment']['postUrn'],POST)

if __name__=='__main__':unittest.main()
