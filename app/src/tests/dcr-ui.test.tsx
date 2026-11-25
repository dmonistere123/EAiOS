import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import Dcr from '../pages/Dcr';
import {dcr} from '../adapters';
import {blankDcr} from '../domain/dcr';
import type {DcrSnapshot,DcrRecord} from '../domain/dcr';
afterEach(()=>vi.restoreAllMocks());
function fixture():DcrSnapshot{
 const records:DcrRecord[]=[{...blankDcr('decision'),id:'one',title:'Pilot scope decision',what:'Choose the scope.',why:'Get the pilot moving.',owner:'Executive',revision:1,createdAt:'2026-11-12T00:00:00Z',updatedAt:'2026-11-12T00:00:00Z',linkedIds:['two'],sourceIds:[]},{...blankDcr('relationship'),id:'two',title:'Maya Chen',what:'Pilot stakeholder.',why:'Coordinates the team.',revision:1,createdAt:'2026-11-12T00:00:00Z',updatedAt:'2026-11-12T00:00:00Z',linkedIds:[],sourceIds:[]}];
 return {records,sources:[],requests:[],history:[],assistantName:'Casey',aiAvailable:true};
}
function show(snapshot:DcrSnapshot,path='/dcr'){vi.spyOn(dcr,'snapshot').mockImplementation(async()=>structuredClone(snapshot));render(<MemoryRouter initialEntries={[path]}><Dcr/></MemoryRouter>);}
it('uses the configured assistant name and isolates drafts when switching connected records',async()=>{
 const s=fixture();show(s,'/dcr?item=one');const user=userEvent.setup();expect(await screen.findByRole('heading',{name:'Talk it through with Casey'})).toBeInTheDocument();await user.type(screen.getByLabelText('Talk to your assistant'),'Private question about item one');await user.click(screen.getByRole('button',{name:'Open saved relationship: Maya Chen'}));expect(screen.getByLabelText('Talk to your assistant')).toHaveValue('');expect(screen.getByRole('heading',{name:'Maya Chen'})).toBeInTheDocument();
});
it('does not save a speculative conversation and keeps the question scoped to its record',async()=>{
 const s=fixture();show(s,'/dcr?item=one');const ask=vi.spyOn(dcr,'ask').mockResolvedValue({id:'request',recordId:'one',revision:1,prompt:'What if Monday?',sourceIds:[],state:'running',createdAt:'2026-11-12T00:00:00Z',accepted:false});const save=vi.spyOn(dcr,'save');await screen.findByLabelText('Talk to your assistant');const user=userEvent.setup();await user.type(screen.getByLabelText('Talk to your assistant'),'What if Monday?');await user.click(screen.getByRole('button',{name:'Ask Casey'}));expect(ask).toHaveBeenCalledWith('What if Monday?','one',[],false);expect(save).not.toHaveBeenCalled();
});
it('shows proposed changes separately and saves only after explicit review',async()=>{
 const s=fixture(),fields={...blankDcr('commitment'),title:'Send the roster',what:'Send Maya the roster.',why:'Support the pilot.'};
 s.requests=[{id:'proposal',recordId:null,revision:null,prompt:'Review evidence',sourceIds:[],state:'complete',createdAt:'2026-11-12T00:00:00Z',accepted:false,answer:{reply:'The owner and date still need confirmation.',citations:[],suggestions:[{fields,basis:'inference',citations:[]}]}}];
 const accept=vi.spyOn(dcr,'accept').mockImplementation(async()=>{s.requests[0].accepted=true;return [];});show(s);const user=userEvent.setup();await screen.findByRole('heading',{name:/Suggestions to Review/});expect(accept).not.toHaveBeenCalled();await user.click(screen.getByRole('button',{name:'Review suggestions'}));expect(screen.getByLabelText('Due date')).toHaveValue('');await user.click(screen.getByRole('button',{name:'Confirm & save records'}));expect(accept).toHaveBeenCalledWith('proposal',[fields],true);
});
it('persists edits with the reviewed revision and shows server conflicts without claiming success',async()=>{
 const s=fixture();show(s,'/dcr?item=one');vi.spyOn(dcr,'save').mockRejectedValue(Error('This record changed. Reload and review the current version.'));const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Edit record'}));await user.clear(screen.getByLabelText('Title'));await user.type(screen.getByLabelText('Title'),'Changed title');await user.click(screen.getByRole('button',{name:'Confirm & save record'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('This record changed'));expect(screen.getByLabelText('Title')).toHaveValue('Changed title');expect(dcr.save).toHaveBeenCalledWith(expect.objectContaining({title:'Changed title'}),[],['two'],expect.objectContaining({id:'one',revision:1}));
});
it('records an actual decision only after the executive supplies and saves an outcome',async()=>{
 const s=fixture();s.records[0].recommendation='Consider a narrower pilot';show(s,'/dcr?item=one');const save=vi.spyOn(dcr,'save').mockResolvedValue(s.records[0]);const user=userEvent.setup();
 await screen.findByText('Consider a narrower pilot');expect(screen.getByText('Your actual decision has not been recorded.')).toBeInTheDocument();expect(save).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'Record my decision'}));expect(screen.getByLabelText('Your actual decision')).toHaveValue('');
 await user.type(screen.getByLabelText('Your actual decision'),'Approve one location');await user.type(screen.getByLabelText('Your rationale'),'Learn before expanding');
 await user.click(screen.getByRole('button',{name:'Confirm & save record'}));expect(save).toHaveBeenCalledWith(expect.objectContaining({status:'completed',decisionOutcome:'Approve one location',decisionRationale:'Learn before expanding'}),[],['two'],expect.objectContaining({id:'one',revision:1}));
});
it('creates a linked commitment without silently assigning an owner or promising on behalf of someone',async()=>{
 const s=fixture();Object.assign(s.records[0],{status:'completed',decisionOutcome:'Proceed with one location',decisionRationale:'Limit risk',decidedOn:'2026-11-14'});show(s,'/dcr?item=one');const create=vi.spyOn(dcr,'fromDecision').mockResolvedValue(s.records[0]);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Create linked commitment'}));expect(screen.getByLabelText('Promise direction')).toHaveValue('none');expect(screen.getByLabelText('Who made the promise?')).toHaveValue('');expect(create).not.toHaveBeenCalled();
 await user.type(screen.getByLabelText('Title'),'Send the confirmed scope');await user.type(screen.getByLabelText('What',{exact:true}),'Send the scope to Maya');await user.click(screen.getByRole('button',{name:'Confirm & save record'}));
 expect(create).toHaveBeenCalledWith(expect.objectContaining({id:'one',revision:1}),expect.objectContaining({kind:'commitment',direction:'none',owner:''}));
});
it('restores an unsent question only when returning to its own record',async()=>{
 const s=fixture();show(s,'/dcr?item=one');const user=userEvent.setup();await user.type(await screen.findByLabelText('Talk to your assistant'),'Question for the pilot');await user.click(screen.getByRole('button',{name:'Open saved relationship: Maya Chen'}));expect(screen.getByLabelText('Talk to your assistant')).toHaveValue('');await user.click(screen.getByRole('button',{name:'Open saved decision: Pilot scope decision'}));expect(screen.getByLabelText('Talk to your assistant')).toHaveValue('Question for the pilot');
});
it('keeps saved items in the notebook, searchable by organization and status',async()=>{
 const s=fixture();Object.assign(s.records[1],{organization:'Northstar',priority:'high'});show(s);const user=userEvent.setup();
 const notebook=await screen.findByRole('complementary',{name:'Saved DCR items'});
 expect(within(notebook).getByRole('button',{name:'Open saved decision: Pilot scope decision'})).toBeInTheDocument();
 expect(within(screen.getByRole('region',{name:'New items to review'})).queryByText('Pilot scope decision')).not.toBeInTheDocument();
 await user.type(screen.getByLabelText('Find a saved item'),'Northstar');
 expect(within(notebook).queryByRole('button',{name:'Open saved decision: Pilot scope decision'})).not.toBeInTheDocument();expect(within(notebook).getByRole('button',{name:'Open saved relationship: Maya Chen'})).toBeInTheDocument();
});
it('requires an Artifact preview and explicit selection before saving evidence, without contacting AI',async()=>{
 const s=fixture(),preview={id:'att-1',title:'Saved pilot brief',taskTitle:'Prepare scope',text:'A source passage for review.',version:'v1'};
 vi.spyOn(dcr,'connections').mockResolvedValue({label:'Isolated examples',artifacts:[preview],work:[],errors:[]});vi.spyOn(dcr,'previewArtifact').mockResolvedValue(preview);
 const select=vi.spyOn(dcr,'selectArtifact').mockImplementation(async()=>{const source={id:'source',title:preview.title,text:preview.text,hash:'hash',active:true,fixture:true,createdAt:'2026-11-14',artifact:{id:preview.id,version:preview.version}};s.sources.push(source);return source;});const ask=vi.spyOn(dcr,'ask');show(s);
 const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Evidence & suggestions'}));await user.click(screen.getByRole('button',{name:'Browse Artifacts'}));await user.click(await screen.findByRole('button',{name:/Saved pilot brief/}));
 expect(await screen.findByText(preview.text)).toBeInTheDocument();expect(select).not.toHaveBeenCalled();await user.click(screen.getByRole('button',{name:'Add this Artifact as evidence'}));await waitFor(()=>expect(select).toHaveBeenCalledWith(preview));expect(await screen.findByRole('checkbox',{name:'Saved pilot brief'})).toBeChecked();expect(ask).not.toHaveBeenCalled();
});
it('shows completed work as progress needing business review and links only on an explicit click',async()=>{
 const s=fixture();s.records[0]={...s.records[0],...blankDcr(),title:'Confirm measures',what:'Agree the measures',why:'Establish success'};
 const work={kind:'task' as const,id:'task-1',title:'Draft measures',status:'done',owner:'Research',summary:'Draft ready',version:'v1'};
 vi.spyOn(dcr,'connections').mockResolvedValue({label:'Isolated examples',artifacts:[],work:[work],errors:[]});const link=vi.spyOn(dcr,'linkWork').mockImplementation(async()=>{s.workLinks=[{recordId:'one',kind:work.kind,id:work.id,work}];return s.records[0];});const save=vi.spyOn(dcr,'save');show(s,'/dcr?item=one');const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Link existing work'}));expect(link).not.toHaveBeenCalled();await user.click(await screen.findByRole('button',{name:'Link to this promise'}));expect(link).toHaveBeenCalledWith(s.records[0],'task','task-1','v1');
 expect(await screen.findByText('Work reported ready. Review the outcome before marking this promise fulfilled.')).toBeInTheDocument();expect(s.records[0].status).toBe('open');expect(save).not.toHaveBeenCalled();
});
it('shows missing work honestly and lets the executive unlink it',async()=>{
 const s=fixture();Object.assign(s.records[0],{kind:'commitment'});s.workLinks=[{recordId:'one',kind:'human',id:'missing',work:null}];const link=vi.spyOn(dcr,'linkWork').mockResolvedValue(s.records[0]);show(s,'/dcr?item=one');const user=userEvent.setup();
 expect(await screen.findByText('Linked work unavailable')).toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Unlink'}));expect(link).toHaveBeenCalledWith(s.records[0],'human','missing',undefined,true);
});
it('shows scheduled findings in their DCR category while preserving manual creation and on-demand scanning',async()=>{
 const s=fixture();s.scanner={configured:true,paused:false,timezone:'America/Chicago',hours:[6,10,12,15,17],accounts:['executive@example.test'],artifacts:true,lookbackDays:7,pending:0,findings:[{id:'f1',revision:1,fields:{...blankDcr(),title:'Send the promised proposal',what:'The executive promised a proposal.',why:'Keep the promise.'},citations:[],explanation:'Detected in a sent email.',state:'detected',sourceIds:[],createdAt:'2026-11-14T14:00:00Z',updatedAt:'2026-11-14T14:00:00Z'}]};
 const scan=vi.spyOn(dcr,'scan').mockResolvedValue({ok:true});show(s);const user=userEvent.setup();expect(await screen.findByText('Send the promised proposal')).toBeInTheDocument();expect(screen.getByText('6 AM · 10 AM · 12 PM · 3 PM · 5 PM · America/Chicago')).toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'Scan now'}));expect(scan).toHaveBeenCalledOnce();
 await user.selectOptions(screen.getByLabelText('Filter by type'),'relationship');expect(screen.queryByText('Send the promised proposal')).not.toBeInTheDocument();await user.selectOptions(screen.getByLabelText('Filter by type'),'commitment');expect(screen.getByText('Send the promised proposal')).toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'+ New record'}));expect(screen.getByLabelText('Title')).toBeInTheDocument();
});
it('reviews and edits a detected item before confirmation and does not silently create a record',async()=>{
 const s=fixture();s.scanner={configured:true,paused:false,timezone:'America/Chicago',hours:[6,10,12,15,17],accounts:[],artifacts:true,lookbackDays:7,pending:0,findings:[{id:'f1',revision:2,fields:{...blankDcr(),title:'Send draft',what:'Send a draft.',why:'Keep promise.'},citations:[],explanation:'Source reports a promise.',state:'detected',sourceIds:[],createdAt:'2026-11-14T14:00:00Z',updatedAt:'2026-11-14T14:00:00Z'}]};const decide=vi.spyOn(dcr,'decideFinding').mockResolvedValue({ok:true});show(s);const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Review detected item'}));expect(decide).not.toHaveBeenCalled();await user.clear(screen.getByLabelText('Title'));await user.type(screen.getByLabelText('Title'),'Send final draft');await user.click(screen.getByRole('button',{name:'Confirm & save'}));await waitFor(()=>expect(decide).toHaveBeenCalledWith('f1',2,'confirm',expect.objectContaining({title:'Send final draft'})));
});
it('shows why a person needs attention and lets the executive edit the suggested interaction',async()=>{
 const s=fixture();s.scanner={configured:true,paused:false,timezone:'America/Chicago',hours:[6,10,12,15,17],accounts:[],artifacts:false,lookbackDays:7,pending:0,findings:[{id:'relationship-finding',revision:1,fields:{...blankDcr('relationship'),title:'Maya — reconnect about the pilot',personName:'Maya Chen',what:'Maya asked to reconnect.',why:'Maintain alignment on the customer pilot.',recommendation:'Suggest a short pilot check-in.'},citations:[],explanation:'A substantive follow-up was requested.',state:'detected',sourceIds:[],createdAt:'2026-11-14T14:00:00Z',updatedAt:'2026-11-14T14:00:00Z'}]};show(s);const user=userEvent.setup();
 expect(await screen.findByText('Why your attention matters:')).toBeInTheDocument();expect(screen.getByText(/Suggest a short pilot check-in/)).toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Edit record'}));expect(screen.getByLabelText('Suggested next interaction')).toHaveValue('Suggest a short pilot check-in.');
});

it('moves a confirmed finding into the notebook and reopens it for updates',async()=>{
 const s=fixture();s.records=[];const fields={...blankDcr('decision'),title:'Choose the pilot scope',what:'Choose one or two sites.',why:'Agree scope.'};
 s.scanner={configured:true,paused:false,timezone:'America/Chicago',hours:[6],accounts:[],artifacts:false,lookbackDays:7,pending:0,findings:[{id:'f',revision:1,fields,citations:[],explanation:'A choice remains open.',state:'detected',sourceIds:[],createdAt:'2026-11-14',updatedAt:'2026-11-14'}]};
 vi.spyOn(dcr,'decideFinding').mockImplementation(async(_id,_revision,_decision,input)=>{const record={...fields,...input,id:'saved',revision:1,createdAt:'2026-11-14',updatedAt:'2026-11-14',linkedIds:[],sourceIds:[]};s.records.push(record);s.scanner!.findings=[];return record;});
 show(s);const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Review detected item'}));await user.click(screen.getByRole('button',{name:'Confirm & save'}));
 const notebook=screen.getByRole('complementary',{name:'Saved DCR items'});
 const saved=await within(notebook).findByRole('button',{name:'Open saved decision: Choose the pilot scope'});
 expect(screen.queryByRole('button',{name:'Confirm & save'})).not.toBeInTheDocument();expect(within(screen.getByRole('region',{name:'New items to review'})).queryByText(fields.title)).not.toBeInTheDocument();expect(saved).toHaveTextContent('Decision needed');
 await user.click(saved);expect(await screen.findByRole('heading',{name:fields.title})).toBeInTheDocument();expect(saved).toHaveAttribute('aria-current','true');await user.click(screen.getByRole('button',{name:'Edit record'}));expect(screen.getByLabelText('Title')).toHaveValue(fields.title);
});
it('closes a saved edit, retains completed decisions in the notebook, and opens the persisted outcome',async()=>{
 const s=fixture();show(s,'/dcr?item=one');vi.spyOn(dcr,'save').mockImplementation(async(fields)=>{s.records[0]={...s.records[0],...fields,revision:2};return s.records[0];});const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Record my decision'}));await user.type(screen.getByLabelText('Your actual decision'),'Proceed with one site');await user.type(screen.getByLabelText('Your rationale'),'Keep the pilot focused');await user.click(screen.getByRole('button',{name:'Confirm & save record'}));
 await screen.findByRole('heading',{name:'New items to review'});expect(screen.queryByLabelText('Your actual decision')).not.toBeInTheDocument();
 await user.selectOptions(screen.getByLabelText('Saved item status'),'completed');await user.click(screen.getByRole('button',{name:'Open saved decision: Pilot scope decision'}));expect(await screen.findByText('Proceed with one site')).toBeInTheDocument();expect(screen.getByRole('complementary',{name:'Saved DCR items'})).toBeInTheDocument();
});
it('shows additional relationship sources under the saved person without another alert',async()=>{
 const s=fixture();s.scanner={configured:true,paused:false,timezone:'America/Chicago',hours:[6],accounts:[],artifacts:false,lookbackDays:7,pending:0,findings:[],relationshipEvidence:[{recordId:'two',sourceIds:['email-one','meeting-two'],citations:[]}]};
 s.sources=['email-one','meeting-two'].map((id,i)=>({id,title:i?'Pilot planning meeting':'Pilot follow-up email',text:'Supporting source '+i,hash:id,active:true,fixture:true,createdAt:'2026-11-14'}));show(s,'/dcr?item=two');
 expect(await screen.findByRole('heading',{name:'Supporting conversations 2'})).toBeInTheDocument();expect(screen.getByText('Pilot follow-up email',{selector:'summary'})).toBeInTheDocument();expect(screen.getByText('Pilot planning meeting',{selector:'summary'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Review detected item'})).not.toBeInTheDocument();
});
it('does not count archived relationships in normal DCR and retains explicit archive access',async()=>{
 const s=fixture();s.records[1].status='archived';show(s);
 const user=userEvent.setup(),tile=await screen.findByRole('button',{name:/Relationship.*saved/i});
 expect(tile).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Open saved relationship: Maya Chen'})).not.toBeInTheDocument();
 await user.selectOptions(screen.getByRole('combobox',{name:'Saved item status'}),'archived');
 expect(screen.getByRole('button',{name:'Open saved relationship: Maya Chen'})).toBeInTheDocument();
 expect(tile.querySelector('strong')).toHaveTextContent(/^0$/);
});
