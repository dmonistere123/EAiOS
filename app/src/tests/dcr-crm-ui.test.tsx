import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {DcrDetectedList} from '../components/DcrScanner';
import {dcr} from '../adapters';
import {blankDcr} from '../domain/dcr';
import {emptyErmContact} from '../domain/erm';
import type {DcrSnapshot} from '../domain/dcr';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function show(){
 const snapshot={assistantName:'Ally',records:[],sources:[],scanner:{configured:true,findings:[{id:'person',revision:2,fields:{...blankDcr('relationship'),personName:'Maya Chen',title:'Maya Chen',organization:'Example',email:'maya@example.test',what:'Planning engagement',why:'Customer opportunity'},sourceIds:[],citations:[],explanation:'Follow up'}]}} as unknown as DcrSnapshot;
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 render(<MemoryRouter><DcrDetectedList snapshot={snapshot} kind="all" search="" busy={false} run={async fn=>{await fn();}} Fields={({value,onChange})=><label>Organization<input value={value.organization} onChange={e=>onChange({...value,organization:e.target.value})}/></label>}/></MemoryRouter>);
}
it('offers three relationship actions and persists edits without confirming the suggestion',async()=>{
 const edit=vi.spyOn(dcr,'editFinding').mockResolvedValue({ok:true});const confirm=vi.spyOn(dcr,'decideFinding');show();
 expect(screen.getByRole('button',{name:'Delete record'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Save as contact in E-CRM'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Edit record'}));fireEvent.change(screen.getByLabelText('Organization'),{target:{value:'Corrected'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 await waitFor(()=>expect(edit).toHaveBeenCalledWith('person',2,expect.objectContaining({organization:'Corrected'})));expect(confirm).not.toHaveBeenCalled();
});
it('deletes the detected relationship through the durable dismissal action',async()=>{
 const decide=vi.spyOn(dcr,'decideFinding').mockResolvedValue({ok:true});show();fireEvent.click(screen.getByRole('button',{name:'Delete record'}));await waitFor(()=>expect(decide).toHaveBeenCalledWith('person',2,'dismiss'));
});
it('prefills a full contact editor and saves additional details into E-CRM',async()=>{
 const save=vi.spyOn(dcr,'saveFindingContact').mockResolvedValue({...emptyErmContact(),name:'Maya Chen',id:'crm-person',version:1,source:'manual',archived:false,createdAt:'now',updatedAt:'now'});show();
 fireEvent.click(screen.getByRole('button',{name:'Save as contact in E-CRM'}));expect(screen.getByLabelText('Full name')).toHaveValue('Maya Chen');expect(screen.getByLabelText('Email 1')).toHaveValue('maya@example.test');
 fireEvent.change(screen.getByLabelText('Job title'),{target:{value:'President'}});fireEvent.click(screen.getByRole('button',{name:'Save contact'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith('person',2,expect.objectContaining({title:'President',name:'Maya Chen'})));expect(await screen.findByRole('link',{name:/Open contact in E-CRM/})).toHaveAttribute('href','/erm?contact=crm-person');
});
