import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SocialMedia from '../pages/SocialMedia';
import { social } from '../adapters';
import { resetRailForTests } from '../state/rail';
vi.mock('../adapters',()=>({social:{board:vi.fn(),capabilities:vi.fn(),manual:vi.fn(),generate:vi.fn(),edit:vi.fn(),image:vi.fn(),imageUrl:()=>''}}));
afterEach(()=>{cleanup();resetRailForTests();vi.resetAllMocks();});
it('offers Instagram and manual authoring without pretending a missing model key works',async()=>{
  vi.mocked(social.board).mockResolvedValue({posts:[],brief:{subject:'',voice:'Practical',identity:'Executive',networks:['linkedin'],days:[1,3,5],startDate:'2026-10-12',time:'12:00',timeZone:'America/Chicago',count:1,imageStyle:'photo',kind:'post'}});
  vi.mocked(social.capabilities).mockResolvedValue({text:false,images:false,composio:false,publishing:false});
  vi.mocked(social.manual).mockResolvedValue([]);
  render(<MemoryRouter><SocialMedia/></MemoryRouter>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Generate drafts'})).toBeDisabled());
  fireEvent.change(screen.getByLabelText('What should we talk about?'),{target:{value:'Ownership'}});
  fireEvent.click(screen.getByRole('checkbox',{name:/Instagram/}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Write my own'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Write my own'}));
  await waitFor(()=>expect(social.manual).toHaveBeenCalledWith(expect.objectContaining({subject:'Ownership',networks:['linkedin','instagram'],days:[1,3,5]}),expect.any(String)));
  expect(social.generate).not.toHaveBeenCalled();
  expect(screen.getByRole('link',{name:/Open Vista Social/})).toHaveAttribute('rel','noopener noreferrer');
  expect(screen.queryByRole('button',{name:/Publish now|Approve & schedule/})).not.toBeInTheDocument();
});
it('displays backend failure instead of a successful empty queue response',async()=>{
  vi.mocked(social.board).mockRejectedValue(new Error('Storage unavailable'));
  vi.mocked(social.capabilities).mockResolvedValue({text:false,images:false,composio:false,publishing:false});
  render(<MemoryRouter><SocialMedia/></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
  expect(screen.getByRole('button',{name:'Generate drafts'})).toBeDisabled();
});
it('creates images after saving text and displays newest-created drafts first',async()=>{
 const base={revision:1,title:'Older draft',copy:'Copy',network:'linkedin' as const,identity:'Executive',plannedDate:'2026-10-12',time:'12:00',timeZone:'America/Chicago',imagePrompt:'A photo of a leadership workshop',status:'draft' as const};
 const old={...base,id:'old',createdAt:'2026-10-01T00:00:00Z'}, fresh={...base,id:'new',title:'New draft',plannedDate:'2026-12-01',createdAt:'2026-10-10T00:00:00Z'};
 vi.mocked(social.board).mockResolvedValueOnce({posts:[old],brief:{subject:'',voice:'Practical',identity:'Executive',networks:['linkedin'],days:[1,3,5],startDate:'2026-10-12',time:'12:00',timeZone:'America/Chicago',count:1,imageStyle:'photo',kind:'post'}}).mockResolvedValue({posts:[old,fresh],brief:{subject:'',voice:'Practical',identity:'Executive',networks:['linkedin'],days:[1,3,5],startDate:'2026-10-12',time:'12:00',timeZone:'America/Chicago',count:1,imageStyle:'photo',kind:'post'}});vi.mocked(social.capabilities).mockResolvedValue({text:true,images:true,composio:false,publishing:false});vi.mocked(social.generate).mockResolvedValue([fresh]);vi.mocked(social.image).mockResolvedValue({...fresh,imageVersion:'png'});
 render(<MemoryRouter><SocialMedia/></MemoryRouter>);await waitFor(()=>expect(screen.getByRole('button',{name:'Generate drafts'})).toBeEnabled());fireEvent.change(screen.getByLabelText('What should we talk about?'),{target:{value:'Leadership'}});await waitFor(()=>expect(screen.getByRole('button',{name:'Generate drafts'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Generate drafts'}));
 await waitFor(()=>expect(social.image).toHaveBeenCalledWith(fresh,expect.any(String)));expect((await screen.findAllByRole('heading',{level:3})).map(e=>e.textContent)).toEqual(['New draft','Older draft']);
});
it('preserves text drafts and reports image failures without generating copy again',async()=>{
 const p={id:'new',revision:1,title:'Saved draft',copy:'Copy',network:'x' as const,identity:'Executive',plannedDate:'2026-10-12',time:'12:00',timeZone:'America/Chicago',imagePrompt:'A photograph',status:'draft' as const,createdAt:'2026-10-10T00:00:00Z'};
 vi.mocked(social.board).mockResolvedValue({posts:[p],brief:{subject:'',voice:'Practical',identity:'Executive',networks:['linkedin'],days:[1,3,5],startDate:'2026-10-12',time:'12:00',timeZone:'America/Chicago',count:1,imageStyle:'photo',kind:'post'}});vi.mocked(social.capabilities).mockResolvedValue({text:true,images:true,composio:false,publishing:false});vi.mocked(social.generate).mockResolvedValue([p]);vi.mocked(social.image).mockRejectedValue(new Error('Provider unavailable'));
 render(<MemoryRouter><SocialMedia/></MemoryRouter>);await waitFor(()=>expect(screen.getByRole('button',{name:'Generate drafts'})).toBeEnabled());fireEvent.change(screen.getByLabelText('What should we talk about?'),{target:{value:'Leadership'}});await waitFor(()=>expect(screen.getByRole('button',{name:'Generate drafts'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Generate drafts'}));expect(await screen.findByRole('alert')).toHaveTextContent('Your drafts are saved');expect(social.generate).toHaveBeenCalledTimes(1);expect(screen.getByRole('heading',{name:'Saved draft'})).toBeInTheDocument();
});
it('generates each monthly platform slot separately with stable distinct request IDs',async()=>{
 vi.mocked(social.board).mockResolvedValue({posts:[],brief:{subject:'Ownership',voice:'Practical',identity:'Executive',networks:['linkedin','x'],days:[1,3,5],startDate:'2026-11-01',endDate:'2026-11-30',time:'12:00',timeZone:'America/Chicago',count:1,imageStyle:'none',kind:'post'}});
 vi.mocked(social.capabilities).mockResolvedValue({text:true,images:false,composio:false,publishing:false});vi.mocked(social.generate).mockResolvedValue([]);
 render(<MemoryRouter><SocialMedia/></MemoryRouter>);await waitFor(()=>expect(screen.getByRole('button',{name:'Generate drafts'})).toBeEnabled());expect(screen.getByText(/26 individual drafts/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Generate drafts'}));
 await waitFor(()=>expect(social.generate).toHaveBeenCalledTimes(26));expect(vi.mocked(social.generate).mock.calls.map(c=>c[2])).toEqual(Array.from({length:26},(_,i)=>i));expect(new Set(vi.mocked(social.generate).mock.calls.map(c=>c[1])).size).toBe(26);expect(social.image).not.toHaveBeenCalled();
});
it('selects personal and company accounts independently and saves only checked destinations',async()=>{
 const accounts=[{id:'personal',network:'linkedin' as const,label:'Personal',url:'https://www.linkedin.com/in/example/'},{id:'company',network:'linkedin' as const,label:'Company',url:'https://www.linkedin.com/company/123/'},{id:'instagram',network:'instagram' as const,label:'Instagram profile',url:'https://www.instagram.com/example/'}];
 vi.mocked(social.board).mockResolvedValue({posts:[],brief:null,accounts});vi.mocked(social.capabilities).mockResolvedValue({text:false,images:false,composio:false,publishing:false});vi.mocked(social.manual).mockResolvedValue([]);
 render(<MemoryRouter><SocialMedia/></MemoryRouter>);expect(await screen.findByRole('checkbox',{name:'LinkedIn · Personal'})).toBeChecked();fireEvent.change(screen.getByLabelText('What should we talk about?'),{target:{value:'Ownership'}});fireEvent.click(screen.getByRole('checkbox',{name:'LinkedIn · Personal'}));fireEvent.click(screen.getByRole('checkbox',{name:'Instagram · Instagram profile'}));fireEvent.click(screen.getByRole('button',{name:'Write my own'}));
 await waitFor(()=>expect(social.manual).toHaveBeenCalledWith(expect.objectContaining({accountIds:['company'],networks:['linkedin']}),expect.any(String)));expect(screen.getByRole('link',{name:accounts[1].url})).toHaveAttribute('href',accounts[1].url);expect(screen.queryByRole('checkbox',{name:/Snapchat/})).not.toBeInTheDocument();
});
