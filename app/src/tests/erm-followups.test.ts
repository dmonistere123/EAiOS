// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ErmStore } from '../../server/ermStore';

const roots:string[]=[];
const setup=()=>{const root=mkdtempSync(join(tmpdir(),'erm-followups-test-'));roots.push(root);return new ErmStore(root);};
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const note={title:'Planning follow-up',body:'A fictional note that must not leak into Today.',includeInAI:false};

describe('E-CRM note follow-ups',()=>{
  it('returns due and overdue notes with exact contact and note identifiers, not their bodies',()=>{
    const store=setup();
    const a=store.createContact({name:'Alice Example'},'alice');
    const b=store.createContact({name:'Bob Example'},'bob');
    const due=store.saveNote(a.id,{...note,followUpOn:'2026-11-21'},'due');
    const late=store.saveNote(b.id,{...note,followUpOn:'2026-11-20'},'late');
    store.saveNote(a.id,{...note,followUpOn:'2026-11-22'},'future');
    store.saveNote(b.id,note,'no-date');
    const reloaded=new ErmStore(store.root);
    expect(reloaded.note(a.id,due.id).followUpOn).toBe('2026-11-21');
    expect(reloaded.followUps('2026-11-21')).toEqual({total:2,hasMore:false,items:[
      {contactId:b.id,contactName:'Bob Example',noteId:late.id,noteTitle:note.title,followUpOn:'2026-11-20'},
      {contactId:a.id,contactName:'Alice Example',noteId:due.id,noteTitle:note.title,followUpOn:'2026-11-21'},
    ]});
    expect(reloaded.followUps('2026-11-22').total).toBe(3);
  });

  it('preserves the date during unrelated edits, permits explicit clearing, and excludes archived contacts',()=>{
    const store=setup();
    const a=store.createContact({name:'Alice Example'},'alice');
    const due=store.saveNote(a.id,{...note,followUpOn:'2026-11-21'},'due');
    const edit=store.updateNote(a.id,due.id,{...note,title:'Updated title'},due.version);
    expect(edit.followUpOn).toBe('2026-11-21');
    expect(store.followUps('2026-11-21').items[0]?.noteTitle).toBe('Updated title');
    const archived=store.archiveContact(a.id,a.version,true);
    expect(store.followUps('2026-11-21').total).toBe(0);
    store.archiveContact(a.id,archived.version,false);
    expect(store.followUps('2026-11-21').total).toBe(1);
    store.updateNote(a.id,due.id,{...note,followUpOn:null},edit.version);
    expect(store.followUps('2026-11-21').total).toBe(0);
    expect(store.note(a.id,due.id).followUpOn).toBeNull();
  });

  it.each(['2026-02-29','2026-11-31','2026-11-01T14:00:00.000Z','2026-1-1'])('rejects invalid date %s',day=>{
    const store=setup();
    const a=store.createContact({name:'Alice Example'},'alice');
    expect(()=>store.saveNote(a.id,{...note,followUpOn:day},'invalid')).toThrow('Choose a valid follow-up date.');
    expect(()=>store.followUps(day)).toThrow('Choose a valid follow-up date.');
  });
});
