// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyErmContact } from '../domain/erm';
import { ErmStore } from '../../server/ermStore.ts';
const roots: string[] = [];
const setup = () => { const root=mkdtempSync(join(tmpdir(),'erm-test-')); roots.push(root); return {root,store:new ErmStore(root)}; };
afterEach(()=>roots.splice(0).forEach(r=>rmSync(r,{recursive:true,force:true})));
const contact = (name='Alex Example') => ({...emptyErmContact(),name,emails:['alex@example.com'],phones:[{label:'Mobile',value:'+1 225 555 0123'}]});
it('persists full contacts and lengthy notes independently of providers with private permissions',()=>{
 const {root,store}=setup(),p=store.createContact(contact(),'request-1');
 const note=store.saveNote(p.id,{title:'Meeting',body:'Paragraph one.\n\n'+'Long discussion. '.repeat(1000),includeInAI:true},'note-request-1');
 const reopened=new ErmStore(root);expect(reopened.contact(p.id).phones[0].value).toBe('+1 225 555 0123');expect(reopened.note(p.id,note.id).body).toBe(note.body);
 expect(statSync(join(root,'erm-data','erm.db')).mode&0o777).toBe(0o600);
 expect(store.createContact(contact(),'request-1').id).toBe(p.id);
 expect(()=>store.createContact(contact('Changed'),'request-1')).toThrow('different');
 expect(store.saveNote(p.id,{title:'Meeting',body:note.body,includeInAI:true},'note-request-1').id).toBe(note.id);
});
it('keeps namesakes separate, uses optimistic versions, and invalidates evidence on note exclusion',()=>{
 const {store}=setup(),a=store.createContact(contact(),'a'),b=store.createContact({...contact(),emails:['another@example.com']},'b');
 expect(a.id).not.toBe(b.id);expect(store.listContacts('',null).total).toBe(2);
 store.updateContact(a.id,{...contact(),company:'Updated'},a.version);
 expect(()=>store.updateContact(a.id,contact(),a.version)).toThrow('changed');
 const n=store.saveNote(a.id,{title:'Private',body:'Do not include after correction.',includeInAI:true},'n');
 const before=store.snapshot(a.id);
 store.updateNote(a.id,n.id,{...n,includeInAI:false},n.version);
 expect(store.snapshot(a.id).fingerprint).not.toBe(before.fingerprint);expect(store.snapshot(a.id).notes).toEqual([]);
 expect(()=>store.note(b.id,n.id)).toThrow('not found');
 expect(()=>store.updateNote(a.id,n.id,n,n.version)).toThrow('changed');
});
it('paginates one filtered directory without mixing archived contacts',()=>{
 const {store}=setup();for(let i=0;i<55;i++)store.createContact(contact('Person '+i),'p'+i);
 const first=store.listContacts('Person',null),next=store.listContacts('Person',first.nextCursor);
 expect(first.items).toHaveLength(50);expect(next.items).toHaveLength(5);expect(new Set([...first.items,...next.items].map(x=>x.id)).size).toBe(55);
 store.archiveContact(first.items[0].id,first.items[0].version,true);expect(store.listContacts('Person',null).total).toBe(54);
});
