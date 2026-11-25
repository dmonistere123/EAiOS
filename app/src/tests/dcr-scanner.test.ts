// @vitest-environment node
import {it,expect,afterEach,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DcrStore} from '../../server/dcrStore.ts';
import {DcrScannerStore} from '../../server/dcrScannerStore.ts';
import {runScanner,scannerSlot,scannerConfig,confirmScannedFinding,scannerAnalyzer,pruneScannerQueue,queueRelationshipReview,scannerResponseFormat,reviewRelationshipFindings} from '../../server/dcrScanner.ts';
import {normalizeScanItem,type ScannerReader} from '../../server/dcrScannerSources.ts';
import type {ScannerConfig,ScanInput} from '../domain/dcrScanner.ts';
import {blankDcr} from '../domain/dcr.ts';
const cleanup:(()=>void)[]=[];afterEach(()=>{cleanup.splice(0).reverse().forEach(f=>f());vi.restoreAllMocks();});
const account={connectionId:'ca_exec',email:'executive@example.test',providerUserId:'executive-id'};
const config:ScannerConfig={enabled:true,timezone:'America/Chicago',hours:[6,10,12,15,17],accounts:[account],artifacts:false,lookbackDays:7};
const now=new Date('2026-11-14T16:00:00Z');
function setup(){const root=mkdtempSync(join(tmpdir(),'dcr-scanner-'));cleanup.push(()=>rmSync(root,{force:true,recursive:true}));const store=new DcrStore(root);cleanup.push(()=>store.db.close());const ctx={hermesHome:root,eaiosRoot:root,dataRoot:root};writeFileSync(join(root,'dcr.local.json'),JSON.stringify({enabled:true,principal:'executive',allowAi:true,scanner:config}));return {store,scanner:new DcrScannerStore(store),ctx};}
function item(id='m1',text='I will send the proposal by Monday.'):ScanInput{return normalizeScanItem(account,'mail',{id,subject:'Pilot scope',from:{emailAddress:{address:account.email}},toRecipients:[{emailAddress:{address:'customer@example.test'}}],body:{contentType:'text',content:text},sentDateTime:'2026-11-14T15:00:00Z'});}
function reader(items:ScanInput[]):ScannerReader{return {verify:vi.fn(async()=>{}),page:vi.fn(async(_account,channel)=>({items:channel==='mail'?items:[]})),current:vi.fn(async(input)=>input)};}
const suggestion=(id:string,quote='I will send the proposal by Monday.')=>({fields:{...blankDcr(),title:'Send the pilot proposal',what:'Send the promised proposal.',why:'Keep the customer promise.',owner:account.email},explanation:'The executive explicitly promised a proposal.',citations:[{sourceId:id,quote}]});
it('uses the five Chicago times through daylight saving changes and skips pre-6AM',()=>{
 expect(scannerSlot(config,new Date('2026-11-14T11:59:00Z'))).toBeNull();
 for(const hour of config.hours)expect(scannerSlot(config,new Date(`2026-11-14T${String(hour+6).padStart(2,'0')}:00:00Z`))).toBe(`2026-11-14T${String(hour).padStart(2,'0')}@America/Chicago`);
 expect(scannerSlot(config,new Date('2026-07-14T11:00:00Z'))).toBe('2026-07-14T06@America/Chicago');
 expect(scannerSlot(config,new Date('2026-11-14T20:59:00Z'))).toBe('2026-11-14T12@America/Chicago');
});
it('lists detected DCRs without creating confirmed records, sends or work tasks; repeated scans are idempotent',async()=>{
 const {store,scanner,ctx}=setup(),r=reader([item()]),analyze=vi.fn(async(batch)=>[suggestion(batch[0].sourceId)]);
 await runScanner(ctx,store,{config,now,reader:r,analyze});expect(scanner.findings()).toHaveLength(1);expect(store.records()).toEqual([]);expect(store.db.prepare('SELECT count(*) n FROM tasks').get()!.n).toBe(0);
 expect(await runScanner(ctx,store,{config,now,reader:r,analyze})).toBe(false);await runScanner(ctx,store,{config,now,force:true,reader:r,analyze});expect(analyze).toHaveBeenCalledTimes(1);
 expect(scanner.status(config).pending).toBe(0);expect(scanner.status(config).lastRun?.state).toBe('complete');
});
it('coordinates listeners with an expiring persisted lease and recovers after a crash',()=>{
 const {scanner,store}=setup();const second=new DcrScannerStore(store);const token=scanner.claim('slot',false,1000)!;expect(second.claim('slot',true,2000)).toBeNull();expect(second.claim('next',false,182000)).toBeTruthy();expect(scanner.owns(token)).toBe(false);
});
it('preserves failed pages and failed AI in the queue, then resumes without repeating completed evidence',async()=>{
 const {store,scanner,ctx}=setup();let fail=true;
 const r=reader([]);r.page=vi.fn(async(_a,ch,cursor)=>{if(ch==='calendar')return {items:[]};if(!cursor.next)return {items:[item()],next:'page-two'};if(fail)throw Error('Rate limited');return {items:[item('m2','A separate note.')]};});
 await runScanner(ctx,store,{config,now,reader:r,analyze:async()=>{throw Error('Provider timeout');}});expect(scanner.pending()).toHaveLength(1);expect(scanner.status(config).lastRun?.state).toBe('partial');
 fail=false;await runScanner(ctx,store,{config,now,force:true,reader:r,analyze:async()=>[]});expect(scanner.pending()).toHaveLength(0);expect(scanner.get<any>('cursor:ca_exec:executive-id:mail').complete).toBe(true);
 expect((r.page as any).mock.calls.filter((x:any)=>x[1]==='mail').at(-1)[2].next).toBe('page-two');
});
it('does not scan while paused and drops a model result if paused during the request',async()=>{
 const {store,scanner,ctx}=setup(),r=reader([item()]);scanner.set('paused',true);expect(await runScanner(ctx,store,{config,now,reader:r})).toBe(false);expect(r.verify).not.toHaveBeenCalled();scanner.set('paused',false);
 await runScanner(ctx,store,{config,now,reader:r,analyze:async batch=>{scanner.set('paused',true);return [suggestion(batch[0].sourceId)];}});expect(scanner.findings()).toEqual([]);expect(scanner.pending()).toHaveLength(1);
});
it('requires verbatim source evidence and never silently saves an unsupported completion',()=>{
 const {scanner}=setup();scanner.ingest(item());const id=scanner.pending()[0].sourceId;
 expect(()=>scanner.saveFindings([{...suggestion(id),citations:[{sourceId:id,quote:'invented quote'}]}],[id])).toThrow('verified');
 expect(()=>scanner.saveFindings([{...suggestion(id),fields:{...suggestion(id).fields,status:'completed',completionEvidence:'Done'}}],[id])).toThrow('fulfill');expect(scanner.findings()).toEqual([]);
});
it('revokes old evidence when sources change, and explicit removals are not reimported',()=>{
 const {scanner,store}=setup();const input=item();scanner.ingest(input);const id=scanner.pending()[0].sourceId;scanner.saveFindings([suggestion(id)],[id]);store.revokeSource(id);expect(scanner.ingest(input)).toBe(false);expect(scanner.status(config).findings).toEqual([]);
 scanner.ingest(item('m1','The proposal has changed.'));expect(scanner.pending()[0].sourceId).not.toBe(id);expect(()=>store.source(id)).toThrow();
});
it('revalidates remote evidence and record versions before confirmation, and keeps dismissed items suppressed',async()=>{
 const {scanner,store,ctx}=setup(),input=item(),r=reader([input]);scanner.ingest(input);const id=scanner.pending()[0].sourceId;scanner.saveFindings([suggestion(id)],[id]);let finding=scanner.findings()[0];
 r.current=async()=>item('m1','Changed source');await expect(confirmScannedFinding(ctx,scanner,{id:finding.id,revision:1,decision:'confirm'},r)).rejects.toThrow('changed');expect(store.records()).toEqual([]);
 r.current=async()=>input;await confirmScannedFinding(ctx,scanner,{id:finding.id,revision:1,decision:'confirm'},r);expect(store.records()).toHaveLength(1);
 await expect(confirmScannedFinding(ctx,scanner,{id:finding.id,revision:1,decision:'confirm'},r)).rejects.toThrow('changed');
 scanner.ingest(item('different','I will send the contract tomorrow.'));const otherId=scanner.pending().find(p=>p.input.origin.externalId==='different')!.sourceId;const other={...suggestion(otherId,'I will send the contract tomorrow.'),fields:{...suggestion(otherId).fields,title:'Send the contract',what:'Send the promised contract.'}};scanner.saveFindings([other],[otherId]);finding=scanner.findings().find(f=>f.state==='detected')!;scanner.decide(finding.id,finding.revision,'dismiss');scanner.saveFindings([other],[otherId]);expect(scanner.status(config).findings).toEqual([]);
});
it('handles sent versus received, cancelled calendars and untrusted HTML as source data',()=>{
 expect(item().origin.kind).toBe('sent');expect(normalizeScanItem(account,'mail',{id:'x',from:{emailAddress:{address:'other@example.test'}},body:{contentType:'html',content:'<script>steal()</script><p>Text</p>'}}).text).toContain('Text');
 const event=normalizeScanItem(account,'calendar',{id:'e',isCancelled:true,body:{content:'Meeting'}});expect(event.removed).toBe(true);expect(event.text).toContain('does not prove attendance');
});
it('configuration fails closed and source account access must still match at confirmation',async()=>{
 const {scanner,ctx}=setup();expect(scannerConfig(ctx)?.hours).toEqual(config.hours);writeFileSync(join(ctx.dataRoot,'dcr.local.json'),'{}');expect(scannerConfig(ctx)).toBeNull();
 scanner.ingest(item());const id=scanner.pending()[0].sourceId;scanner.saveFindings([suggestion(id)],[id]);await expect(confirmScannedFinding(ctx,scanner,{id:scanner.findings()[0].id,revision:1,decision:'confirm'},reader([]))).rejects.toThrow('enabled');
});

it('recovers an interrupted run in the same schedule slot and refuses stale record proposals',()=>{
 const {scanner,store}=setup();scanner.claim('same',false,1000);scanner.set('run',{state:'running'});expect(scanner.claim('same',false,182000)).toBeTruthy();
 scanner.ingest(item());const id=scanner.pending()[0].sourceId;const r=store.save(suggestion(id).fields);expect(()=>scanner.saveFindings([{...suggestion(id),targetRecordId:r.id,targetRevision:0}],[id])).toThrow('changed during scanning');
});

it('requests JSON explicitly as required by provider JSON mode',async()=>{
 const {scanner,ctx}=setup();writeFileSync(join(ctx.hermesHome,'.env'),'OPENROUTER_API_KEY=fixture-token\n');
 const fake=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{const payload=JSON.parse(String(init?.body));expect(payload.response_format.type).toBe('json_schema');expect(payload.response_format.json_schema.strict).toBe(true);expect(payload.response_format.json_schema.schema.properties.findings.items.properties.targetRecordId.enum).toEqual([null]);expect(payload.response_format.json_schema.schema.properties.findings.items.properties.fields.anyOf[1].properties.status.enum).toEqual(['open','blocked']);expect(payload.messages.some((m:{content:string})=>/\bjson\b/i.test(m.content))).toBe(true);return new Response(JSON.stringify({choices:[{message:{content:'{"findings":[]}'}}]}),{status:200});});
 expect(await scannerAnalyzer(ctx)([],scanner)).toEqual([]);expect(fake).toHaveBeenCalledOnce();
});
it('preserves executive-controlled preferences and unknown fields when proposing an existing record update',()=>{
 const {store,scanner}=setup();scanner.ingest(item());const id=scanner.pending()[0].sourceId;const record=store.save({...suggestion(id).fields,priority:'high',preferences:'Call before emailing',snoozedUntil:'2026-12-01',dueDate:'2026-12-05'});
 scanner.saveFindings([{...suggestion(id),targetRecordId:record.id,targetRevision:record.revision}],[id]);expect(scanner.findings()[0].fields).toMatchObject({priority:'high',preferences:'Call before emailing',snoozedUntil:'2026-12-01',dueDate:'2026-12-05'});expect(store.record(record.id).revision).toBe(1);
});

it('quarantines invalid model findings for retry without blocking later source batches',async()=>{
 const {scanner,store,ctx}=setup();const inputs=Array.from({length:8},(_,i)=>item('m'+i));let calls=0;
 await runScanner(ctx,store,{config,now,reader:reader(inputs),analyze:async batch=>{calls++;return calls===1?[{...suggestion(batch[0].sourceId),citations:[]}]:[suggestion(batch[0].sourceId)];}});
 expect(calls).toBe(2);expect(scanner.findings()).toHaveLength(1);expect(scanner.pending()).toHaveLength(4);expect(scanner.pending(false)).toHaveLength(0);expect(scanner.status(config).lastRun?.state).toBe('partial');
 await runScanner(ctx,store,{config,now,force:true,reader:reader(inputs),analyze:async()=>[]});expect(scanner.pending()).toHaveLength(0);
});
it('rechecks unconfirmed early findings and excludes old mail without altering confirmed records',async()=>{
 const {scanner,store,ctx}=setup();const old=item('old');old.origin.sourceAt='2025-03-31T10:00:00Z';scanner.ingest(old);let id=scanner.pending()[0].sourceId;scanner.saveFindings([suggestion(id)],[id]);
 const current=item('current');scanner.ingest(current);const selected=scanner.pending().find(p=>p.input.origin.externalId==='current')!;const confirmed=store.save({...suggestion(selected.sourceId).fields,title:'My own entry'},undefined,undefined,[selected.sourceId]);
 await runScanner(ctx,store,{config,now,reader:reader([]),analyze:async()=>[]});expect(scanner.status(config).findings).toEqual([]);expect(scanner.pending()).toEqual([]);expect(()=>store.source(id)).toThrow();expect(store.record(confirmed.id).title).toBe('My own entry');expect(store.source(selected.sourceId)).toBeTruthy();
});


it('uses rolling seven-day email and calendar windows and excludes stale queues, other accounts and Artifacts',async()=>{
 const {scanner,store,ctx}=setup();scanner.set('analysisPolicyVersion',2);scanner.set('mailSince','2026-01-01T00:00:00Z');
 const calendar=(id:string,date:string)=>normalizeScanItem(account,'calendar',{id,subject:id,start:{dateTime:date,timeZone:'UTC'},body:{content:'Meeting plan'}});
 const old=item('old');old.origin.sourceAt='2026-11-06T16:00:00Z';
 const excluded=item('excluded');excluded.origin.accountId='ca_other';excluded.origin.email='don.monistere@example.test';
 const artifact:ScanInput={key:'artifact',version:'1',title:'Saved document',text:'A promise',origin:{kind:'artifact',externalId:'artifact',observedAt:now.toISOString()}};
 const inside=calendar('inside','2026-11-21T16:00:00'),outside=calendar('outside','2026-11-21T16:00:01Z');
 for(const input of [old,excluded,artifact,outside,item('aging')])scanner.ingest(input);
 scanner.set('cursor:ca_exec:executive-id:calendar',{from:'2026-11-07T16:00:00Z',to:'2026-11-28T16:00:00Z',next:'old-fourteen-day-page',complete:false});
 const r=reader([]);r.page=vi.fn(async(a,ch,cursor)=>{expect(a).toEqual(account);expect(cursor.from).toBe('2026-11-07T16:00:00.000Z');expect(cursor.next).toBeUndefined();expect(cursor.to).toBe(ch==='mail'?now.toISOString():'2026-11-21T16:00:00.000Z');return {items:ch==='mail'?[old,excluded,item('new')]:[inside,outside]};});
 const analyzed:string[]=[];await runScanner(ctx,store,{config,now,reader:r,analyze:async batch=>{analyzed.push(...batch.map(p=>p.input.origin.externalId));return [];}});
 expect(analyzed.sort()).toEqual(['aging','inside','new']);expect(scanner.pending()).toEqual([]);
 // Advance beyond a queued email's age limit even though its prior scan cutoff was older.
 scanner.ingest(item('queued'));const later=new Date('2026-11-22T16:00:00Z');expect(pruneScannerQueue(scanner,config,later)).toBe(1);expect(scanner.pending()).toEqual([]);
 const nextReader=reader([]);await runScanner(ctx,store,{config,now:later,force:true,reader:nextReader,analyze:async()=>[]});expect(scanner.get('mailSince')).toBe('2026-11-15T16:00:00.000Z');
 for(const call of vi.mocked(nextReader.page).mock.calls)expect(Date.parse(call[2].from)).toBeGreaterThanOrEqual(Date.parse('2026-11-15T16:00:00Z'));
});

it('does not resurface a prior finding after a source edit, paraphrased title, dismissal or store restart',()=>{
 const {scanner,store}=setup();scanner.ingest(item());const firstId=scanner.pending()[0].sourceId;scanner.saveFindings([suggestion(firstId)],[firstId]);const first=scanner.findings()[0];
 expect(scanner.saveFindings([suggestion(firstId)],[firstId])).toBe(0);expect(scanner.findings()[0].revision).toBe(first.revision);
 scanner.ingest(item('m1','I will send the proposal by Monday. Updated meeting room.'));const nextId=scanner.pending()[0].sourceId;
 const changed={...suggestion(nextId),fields:{...suggestion(nextId).fields,title:'Deliver proposal next week',what:'Provide the proposal on Monday.'}};
 expect(new DcrScannerStore(store).saveFindings([changed],[nextId])).toBe(0);
 scanner.decide(first.id,first.revision,'dismiss');expect(new DcrScannerStore(store).saveFindings([changed],[nextId])).toBe(0);expect(scanner.findings()).toHaveLength(1);
 // A separate, explicitly new promise from the edited source is still eligible.
 scanner.ingest(item('m1','I will send the contract tomorrow.'));const freshId=scanner.pending()[0].sourceId;
 expect(scanner.saveFindings([{...suggestion(freshId,'I will send the contract tomorrow.'),fields:{...suggestion(freshId).fields,title:'Send contract',what:'Send the contract tomorrow.'}}],[freshId])).toBe(1);
});
it('keeps distinct promises extracted together from one excerpt',()=>{
 const {scanner}=setup();const quote='I will send the proposal and I will arrange the demo.';scanner.ingest(item('two-promises',quote));const id=scanner.pending()[0].sourceId;
 const first=suggestion(id,quote),second={...suggestion(id,quote),fields:{...first.fields,title:'Arrange demo',what:'Arrange the customer demo.'}};
 expect(scanner.saveFindings([first,second],[id])).toBe(2);expect(scanner.findings()).toHaveLength(2);
});
it('continues a busy mailbox across scan dates while advancing the email-age filter',async()=>{
 const {scanner,store,ctx}=setup();scanner.set('analysisPolicyVersion',2);
 scanner.set('cursor:ca_exec:executive-id:mail',{from:'2026-11-06T16:00:00Z',to:'2026-11-13T16:00:00Z',mailSince:'2026-11-06T16:00:00Z',next:'remaining-mail',complete:false});
 const r=reader([]);r.page=vi.fn(async(_a,ch,cursor)=>{if(ch==='mail'){expect(cursor.next).toBe('remaining-mail');expect(cursor.mailSince).toBe('2026-11-07T16:00:00.000Z');}return {items:[]};});
 await runScanner(ctx,store,{config,now,reader:r,analyze:async()=>[]});expect(r.page).toHaveBeenCalledTimes(2);
});

it('classifies an unresolved attendance choice as a Decision, without inventing a promise',()=>{
 const {scanner}=setup();const quote='Should I send someone to attend?';scanner.ingest(item('attendance',quote));const id=scanner.pending()[0].sourceId;
 const choice={...suggestion(id,quote),fields:{...suggestion(id).fields,title:'Decide whether to send a representative',what:'Determine whether a representative should attend.',promisor:account.email,promisee:'Company',direction:'i_owe'}};
 expect(scanner.saveFindings([choice],[id])).toBe(1);const f=scanner.findings()[0];expect(f.fields).toMatchObject({kind:'decision',status:'open',direction:'none',promisor:'',promisee:'',decisionOutcome:''});expect(f.explanation).toContain('decision to make');
});
it('keeps an explicit promise to send a representative as a Commitment',()=>{
 const {scanner}=setup();const quote='I will send a representative to attend.';scanner.ingest(item('accepted-attendance',quote));const id=scanner.pending()[0].sourceId;
 scanner.saveFindings([{...suggestion(id,quote),fields:{...suggestion(id).fields,title:'Send a representative to attend',what:quote,promisor:account.email,promisee:'Company'}}],[id]);expect(scanner.findings()[0].fields.kind).toBe('commitment');
});
it('deduplicates the same choice across a forwarded email and original notice despite company suffix variation',()=>{
 const {scanner}=setup();const question='Should I send someone to attend?',notice='Notice of the public hearing.';scanner.ingest(item('forward',question));const id=scanner.pending()[0].sourceId;
 const choice={...suggestion(id,question),fields:{...suggestion(id).fields,title:'Decide whether to send a representative',what:'Determine whether to send someone.',email:account.email,organization:'Example, LLC',dueDate:'2026-11-18'}};
 scanner.saveFindings([choice],[id]);scanner.ingest(item('notice',notice));const next=scanner.pending()[0].sourceId;
 expect(scanner.saveFindings([{...suggestion(next,notice),fields:{...choice.fields,organization:'Example',what:'Choose whether someone will attend.'}}],[next])).toBe(0);expect(scanner.findings()).toHaveLength(1);
});
it('does not silently reclassify an already confirmed commitment through a scanner update',()=>{
 const {scanner,store}=setup();const quote='Should I send someone to attend?';scanner.ingest(item('target',quote));const id=scanner.pending()[0].sourceId;const record=store.save({...suggestion(id).fields,title:'Arrange representation'});
 expect(()=>scanner.saveFindings([{...suggestion(id,quote),fields:{...suggestion(id).fields,title:'Decide whether to send someone'},targetRecordId:record.id,targetRevision:record.revision}],[id])).toThrow('cannot change record type');expect(store.record(record.id).kind).toBe('commitment');
});

const relationship=(id:string,quote='Maya asked to reconnect about the pilot and align on the rollout concerns raised by her team.')=>({fields:{...blankDcr('relationship'),title:'Maya Chen — align on the pilot',what:'Maya asked to reconnect about the pilot and align on the rollout concerns raised by her team.',why:'An active customer conversation needs continuity.',personName:'Maya Chen',email:'maya@example.test',recommendation:'Suggest a brief check-in on the pilot.'},explanation:'The source requests a substantive next conversation.',citations:[{sourceId:id,quote}]});
it('requires a named person and next interaction for automatically detected Relationships',()=>{
 const {scanner}=setup();const quote='Maya asked to reconnect about the pilot and align on the rollout concerns raised by her team.';scanner.ingest(item('rel',quote));const id=scanner.pending()[0].sourceId;
 expect(()=>scanner.saveFindings([{...relationship(id),fields:{...relationship(id).fields,personName:''}}],[id])).toThrow('named person');
 expect(()=>scanner.saveFindings([{...relationship(id),fields:{...relationship(id).fields,recommendation:''}}],[id])).toThrow('next interaction');
 scanner.saveFindings([relationship(id)],[id]);expect(scanner.findings()[0].fields).toMatchObject({kind:'relationship',importance:'not_set',lastInteractionDate:'',dueDate:''});
});
it('rechecks previously analyzed recent sources for Relationships once without resurfacing Decisions or Commitments',async()=>{
 const {scanner,store,ctx}=setup();scanner.set('analysisPolicyVersion',2);const quote='Maya asked to reconnect about the pilot and align on the rollout concerns raised by her team.';scanner.ingest(item('reviewed',quote));const row=scanner.pending()[0];scanner.saveFindings([suggestion(row.sourceId,quote)],[row.sourceId]);const original=scanner.findings()[0];
 store.db.prepare("UPDATE dcr_scan_items SET status='analyzed'").run();
 const expired=item('expired');expired.origin.sourceAt='2026-10-01T00:00:00Z';scanner.ingest(expired);store.db.prepare("UPDATE dcr_scan_items SET status='analyzed' WHERE key=?").run(expired.key);
 expect(queueRelationshipReview(scanner,config,now)).toBe(1);expect(queueRelationshipReview(scanner,config,now)).toBe(0);
 const analyze=vi.fn(async(batch,_scanner,only)=>{expect(only).toBe(true);return [relationship(batch[0].sourceId),{...suggestion(batch[0].sourceId,quote),fields:{...suggestion(batch[0].sourceId).fields,title:'Do not resurface this commitment'}}];});
 await runScanner(ctx,store,{config,now,reader:reader([]),analyze});expect(analyze).toHaveBeenCalledOnce();expect(scanner.findings()).toHaveLength(2);expect(scanner.findings().find(f=>f.id===original.id)).toEqual(original);expect(scanner.findings().filter(f=>f.fields.kind==='relationship')).toHaveLength(1);
 await runScanner(ctx,store,{config,now,force:true,reader:reader([]),analyze});expect(analyze).toHaveBeenCalledOnce();
});
it('keeps Relationship-only mode through invalid-result retries',async()=>{
 const {scanner,store,ctx}=setup();scanner.set('analysisPolicyVersion',2);scanner.ingest(item('retry-rel','Maya asked to reconnect about the pilot and align on the rollout concerns raised by her team.'));store.db.prepare("UPDATE dcr_scan_items SET status='analyzed'").run();
 await runScanner(ctx,store,{config,now,reader:reader([]),analyze:async batch=>[{...relationship(batch[0].sourceId),citations:[]}]});expect(scanner.pending()[0].relationshipsOnly).toBe(true);expect(scanner.pending(false)).toEqual([]);
 await runScanner(ctx,store,{config,now,force:true,reader:reader([]),analyze:async(batch,_s,only)=>{expect(only).toBe(true);return [relationship(batch[0].sourceId)];}});expect(scanner.pending()).toEqual([]);expect(scanner.findings()[0].fields.kind).toBe('relationship');
});
it('restricts the provider schema during a Relationship review',()=>{
 const variants=scannerResponseFormat([],true).json_schema.schema.properties.findings.items.properties.fields.anyOf;
 expect(variants).toHaveLength(1);expect(variants[0].properties.kind).toEqual({type:'string',enum:['relationship']});expect(variants[0].properties.personName).toEqual({type:'string',minLength:1});
});

it('omits thin Relationship signals without discarding supported findings in the same batch',()=>{
 const {scanner}=setup();const text='Subject: Accepted: Maya and Executive Catch Up\nhttps://example.test/meeting\nSending you a new link.\nMaya is concerned about the rollout delays and asks to reconnect with the executive to agree on next steps.';scanner.ingest(item('evidence-quality',text));const id=scanner.pending()[0].sourceId;
 const findings=['Subject: Accepted: Maya and Executive Catch Up','https://example.test/meeting','Sending you a new link.','Maya is concerned about the rollout delays and asks to reconnect with the executive to agree on next steps.'].map((quote,i)=>({...relationship(id,quote),fields:{...relationship(id).fields,title:'Attention signal '+i}}));
 expect(scanner.saveFindings(findings,[id])).toBe(1);expect(scanner.findings()[0].fields.title).toBe('Attention signal 3');
});

it('qualifies Relationship proposals separately and preserves other categories',async()=>{
 const {ctx}=setup();writeFileSync(join(ctx.hermesHome,'.env'),'OPENROUTER_API_KEY=fixture-token\n');
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reviews:[{index:0,reason:'active_engagement'},{index:1,reason:'routine_or_bulk'}]})}}]})));
 const good=relationship('s'),bulk={...relationship('s'),fields:{...relationship('s').fields,title:'Product newsletter'}};const commitment=suggestion('s');
 expect(await reviewRelationshipFindings(ctx,[good,bulk,commitment],[])).toEqual([good,commitment]);
});
it('leaves source work retryable when the independent Relationship review fails',async()=>{
 const {ctx}=setup();writeFileSync(join(ctx.hermesHome,'.env'),'OPENROUTER_API_KEY=fixture-token\n');vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('Unavailable',{status:503}));
 await expect(reviewRelationshipFindings(ctx,[relationship('s')],[])).rejects.toThrow('remains queued');
});
it('does not substitute a company or multiple people for a single Relationship contact',()=>{
 const {scanner}=setup();const quote='Maya asked to reconnect about the pilot and align on the rollout concerns raised by her team.';scanner.ingest(item('people',quote));const id=scanner.pending()[0].sourceId;
 for(const identity of [{personName:'Maya, Alex',organization:''},{personName:'Northstar',organization:'Northstar'}])expect(scanner.saveFindings([{...relationship(id),fields:{...relationship(id).fields,...identity}}],[id])).toBe(0);
});

function relationshipFinding(sourceId:string,quote:string,email='jeff@example.test',title='Jeff — planning review'){
 return {fields:{...blankDcr('relationship'),title,personName:'Jeff Mitchell',email,organization:'Example',what:'Coordinate substantive planning work.',why:'Align the ongoing project.',recommendation:'Review the open planning questions.'},explanation:'A substantive planning exchange.',citations:[{sourceId,quote}]};
}
it('collects different topics and batches into one person with every supporting source',()=>{
 const {store,scanner}=setup();const quote='We should review the customer planning and budget constraints together before agreeing the next steps.';
 const sources=Array.from({length:12},(_,i)=>store.addSource('Conversation '+i,quote+' '+i));
 expect(scanner.saveFindings(sources.slice(0,2).map((s,i)=>relationshipFinding(s.id,quote,i?'JEFF@EXAMPLE.TEST':'jeff@example.test','Different topic '+i)),sources.slice(0,2).map(s=>s.id))).toBe(1);
 for(const source of sources.slice(2))expect(scanner.saveFindings([relationshipFinding(source.id,quote)], [source.id])).toBe(0);
 expect(scanner.status(config).findings).toHaveLength(1);const f=scanner.status(config).findings[0];expect(f.sourceIds).toHaveLength(12);expect(f.citations).toHaveLength(12);
 scanner.saveFindings([relationshipFinding(sources[0].id,quote)],[sources[0].id]);expect(scanner.status(config).findings[0].revision).toBe(f.revision);
 const record=scanner.decide(f.id,f.revision,'confirm') as any;expect(store.records()).toHaveLength(1);expect(record.sourceIds).toHaveLength(8);expect(scanner.status(config).relationshipEvidence?.[0].sourceIds).toHaveLength(12);
 const extra=store.addSource('Another conversation',quote+' new');const before=store.records();scanner.saveFindings([relationshipFinding(extra.id,quote)],[extra.id]);expect(scanner.status(config).findings).toHaveLength(0);expect(scanner.status(config).relationshipEvidence?.[0].sourceIds).toHaveLength(13);expect(store.records()).toEqual(before);
});
it('preserves dismissal while collecting further sources and keeps different people and decisions separate',()=>{
 const {store,scanner}=setup();const quote='We should review the customer planning and budget constraints together before agreeing the next steps.';
 const a=store.addSource('First',quote),b=store.addSource('Second',quote+' again');scanner.saveFindings([relationshipFinding(a.id,quote)],[a.id]);const first=scanner.findings()[0];scanner.decide(first.id,first.revision,'dismiss');
 scanner.saveFindings([relationshipFinding(b.id,quote)],[b.id]);expect(scanner.status(config).findings).toHaveLength(0);expect(scanner.findings()[0].sourceIds).toHaveLength(2);
 scanner.saveFindings([relationshipFinding(b.id,quote,'different@example.test')],[b.id]);expect(scanner.status(config).findings).toHaveLength(1);
 const choice={...relationshipFinding(a.id,quote),fields:{...blankDcr('decision'),title:'Choose a scope',what:'Select a scope',why:'Scope needs approval'}};scanner.saveFindings([choice],[a.id]);expect(scanner.status(config).findings.some(f=>f.fields.kind==='decision')).toBe(true);
});
it('attaches sources to an existing manual relationship without overwriting saved notes or reopening it',()=>{
 const {store,scanner}=setup();const quote='We should review the customer planning and budget constraints together before agreeing the next steps.';const s=store.addSource('Evidence',quote);
 const record=store.save({...relationshipFinding(s.id,quote).fields,status:'archived',preferences:'Executive-entered preferences'});const before=store.records();scanner.saveFindings([relationshipFinding(s.id,quote)],[s.id]);expect(scanner.status(config).findings).toHaveLength(0);expect(scanner.status(config).relationshipEvidence?.[0].recordId).toBe(record.id);expect(store.records()).toEqual(before);
});
it('consolidates historical duplicates without losing evidence or resurrecting dismissed people',()=>{
 const {store,scanner}=setup();const quote='We should review the customer planning and budget constraints together before agreeing the next steps.';
 const a=store.addSource('A',quote),b=store.addSource('B',quote+' again');scanner.saveFindings([relationshipFinding(a.id,quote)],[a.id]);const f=scanner.findings()[0];
 const duplicate={...f,id:'duplicate',fields:{...f.fields,title:'Another topic'},sourceIds:[b.id],citations:[{sourceId:b.id,quote}]};store.db.prepare('INSERT INTO dcr_findings VALUES(?,?,?)').run(duplicate.id,'legacy-fingerprint',JSON.stringify(duplicate));
 expect(scanner.consolidateRelationships()).toBe(1);expect(scanner.status(config).findings).toHaveLength(1);expect(scanner.status(config).findings[0].sourceIds).toHaveLength(2);expect(scanner.consolidateRelationships()).toBe(0);
 const current=scanner.status(config).findings[0];scanner.decide(current.id,current.revision,'dismiss');expect(scanner.consolidateRelationships()).toBe(0);expect(scanner.status(config).findings).toHaveLength(0);
});
it('keeps a person visible when an older source expires and protects confirmation against concurrent evidence changes',()=>{
 const {store,scanner}=setup();const quote='We should review the customer planning and budget constraints together before agreeing the next steps.';const a=store.addSource('A',quote),b=store.addSource('B',quote+' again');scanner.saveFindings([relationshipFinding(a.id,quote)],[a.id]);const old=scanner.findings()[0];scanner.saveFindings([relationshipFinding(b.id,quote)],[b.id]);expect(()=>scanner.decide(old.id,old.revision,'confirm')).toThrow(/changed/);store.revokeSource(a.id);const current=scanner.status(config).findings[0];expect(current.sourceIds).toEqual([b.id]);expect(()=>scanner.decide(current.id,current.revision,'confirm')).not.toThrow();
});
it('learns a missing email once and never merges another address into that contact',()=>{
 const {store,scanner}=setup();const quote='We should review the customer planning and budget constraints together before agreeing the next steps.';const source=store.addSource('Evidence',quote);
 scanner.saveFindings([relationshipFinding(source.id,quote,'')],[source.id]);scanner.saveFindings([relationshipFinding(source.id,quote,'first@example.test')],[source.id]);scanner.saveFindings([relationshipFinding(source.id,quote,'second@example.test')],[source.id]);expect(scanner.status(config).findings).toHaveLength(2);
});
it('does not attach two different addresses to an email-less saved contact',()=>{
 const {store,scanner}=setup();const quote='We should review the customer planning and budget constraints together before agreeing the next steps.';const source=store.addSource('Evidence',quote);store.save(relationshipFinding(source.id,quote,'').fields);
 scanner.saveFindings([relationshipFinding(source.id,quote,'first@example.test')],[source.id]);scanner.saveFindings([relationshipFinding(source.id,quote,'second@example.test')],[source.id]);expect(scanner.status(config).relationshipEvidence).toHaveLength(1);expect(scanner.status(config).findings).toHaveLength(1);
});
it('uses the executive-reviewed contact identity for later evidence collection',()=>{
 const {store,scanner}=setup();const quote='We should review the customer planning and budget constraints together before agreeing the next steps.';const source=store.addSource('Evidence',quote);scanner.saveFindings([relationshipFinding(source.id,quote)],[source.id]);const f=scanner.findings()[0];const record=scanner.decide(f.id,f.revision,'confirm',{...f.fields,email:'corrected@example.test'}) as any;
 scanner.saveFindings([relationshipFinding(source.id,quote,'corrected@example.test')],[source.id]);expect(scanner.status(config).findings).toHaveLength(0);
 store.save({...f.fields,email:'updated@example.test'},record.id,record.revision,record.sourceIds,record.linkedIds);
 scanner.saveFindings([relationshipFinding(source.id,quote,'updated@example.test')],[source.id]);expect(scanner.status(config).findings).toHaveLength(0);expect(scanner.status(config).relationshipEvidence).toHaveLength(1);
});
