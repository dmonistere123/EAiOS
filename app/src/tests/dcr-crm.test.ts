// @vitest-environment node
import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DcrStore} from '../../server/dcrStore';
import {DcrScannerStore} from '../../server/dcrScannerStore';
import {saveRelationshipContact} from '../../server/dcrCrm';
import {ErmStore} from '../../server/ermStore';
import {blankDcr} from '../domain/dcr';
import {emptyErmContact} from '../domain/erm';
import type {DcrFinding} from '../domain/dcrScanner';
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
function setup(){
 const root=mkdtempSync(join(tmpdir(),'dcr-crm-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=new DcrStore(root);cleanup.push(()=>store.db.close());const scanner=new DcrScannerStore(store);
 const finding:DcrFinding={id:'relationship-one',revision:1,state:'detected',fields:{...blankDcr('relationship'),title:'Maya Chen',personName:'Maya Chen',organization:'Example',email:'maya@example.test',what:'Discuss the planning engagement.',why:'Active customer opportunity.'},citations:[],sourceIds:[],explanation:'Planning counterpart',createdAt:'2026-11-21T00:00:00Z',updatedAt:'2026-11-21T00:00:00Z'};
 store.db.prepare('INSERT INTO dcr_findings VALUES(?,?,?)').run(finding.id,'unique',JSON.stringify(finding));
 return {root,store,scanner,finding,ctx:{hermesHome:root,dataRoot:root,eaiosRoot:root}};
}
it('persists edits without confirming a DCR record and rejects stale or category-changing edits',()=>{
 const {scanner,finding,store}=setup();const next=scanner.editRelationship(finding.id,1,{...finding.fields,organization:'Corrected company'});
 expect(next.revision).toBe(2);expect(next.fields.organization).toBe('Corrected company');expect(store.records()).toEqual([]);
 expect(()=>scanner.editRelationship(finding.id,1,finding.fields)).toThrow(/changed/);
 expect(()=>scanner.editRelationship(finding.id,2,{...finding.fields,kind:'decision'})).toThrow();
});
it('removes a deleted suggestion from the review queue while retaining suppression history',()=>{
 const {scanner,finding}=setup();scanner.decide(finding.id,1,'dismiss');expect(scanner.findings()[0].state).toBe('dismissed');expect(scanner.findings()[0].fields.personName).toBe('Maya Chen');
});
it('creates one full CRM contact, retires the suggestion and safely handles a repeated save',()=>{
 const {ctx,root,scanner,finding}=setup();const contact={...emptyErmContact(),name:'Maya Chen',company:'Example',emails:['maya@example.test'],phones:[{label:'Mobile',value:'555-0100'}]};
 const input={id:finding.id,revision:1,contact};const saved=saveRelationshipContact(ctx,scanner,input);
 expect(saved.phones).toEqual(contact.phones);expect(scanner.findings()[0].crmContactId).toBe(saved.id);expect(scanner.findings()[0].state).toBe('dismissed');
 expect(saveRelationshipContact(ctx,scanner,input).id).toBe(saved.id);expect(new ErmStore(root).listContacts('',null).total).toBe(1);
});
it('does not create contacts for stale, deleted, invalid or disabled-module requests',()=>{
 const {ctx,root,scanner,finding}=setup();const contact={...emptyErmContact(),name:'Maya Chen'};
 expect(()=>saveRelationshipContact(ctx,scanner,{id:finding.id,revision:99,contact})).toThrow(/changed/);
 expect(()=>saveRelationshipContact(ctx,scanner,{id:finding.id,revision:1,contact:{...contact,name:''}})).toThrow();
 writeFileSync(join(root,'modules.local.json'),JSON.stringify({edition:'core',addons:[]}));
 expect(()=>saveRelationshipContact(ctx,scanner,{id:finding.id,revision:1,contact})).toThrow(/not enabled/);
 expect(new ErmStore(root).listContacts('',null).total).toBe(0);
});
