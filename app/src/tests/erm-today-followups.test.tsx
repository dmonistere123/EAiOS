import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Today from '../pages/Today';

vi.mock('../adapters',async get=>{
  const original=await get<typeof import('../adapters')>();
  return {...original,adapterMode:'live',humanDelegation:{...original.humanDelegation,list:async()=>[]},today:{
    activity:async()=>({runs:[],links:{},reviewed:[],report:null,warnings:[]}),
    meetings:async()=>({calendars:[],fetchedAt:new Date().toISOString()}),
  }};
});
vi.mock('../state/runtime',async get=>{
  const original=await get<typeof import('../state/runtime')>();
  return {...original,useRuntime:()=>({work:[],approvals:[],degraded:[],artifacts:[],ready:true})};
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('shows due and overdue contact follow-ups with the exact note link',async()=>{
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
    const url=new URL(String(input),'http://localhost');
    expect(url.pathname).toBe('/api/erm/follow-ups');
    const through=url.searchParams.get('through');
    expect(through).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    return Response.json({items:[
      {contactId:'contact-a',contactName:'Alice Example',noteId:'note-a',noteTitle:'Scope check-in',followUpOn:through},
      {contactId:'contact-b',contactName:'Bob Example',noteId:'note-b',noteTitle:'Budget check-in',followUpOn:'2025-01-01'},
    ],total:2,hasMore:false});
  });
  vi.stubGlobal('fetch',fetcher);
  render(<MemoryRouter><Today/></MemoryRouter>);
  const section=within(await screen.findByRole('region',{name:'E-CRM follow-ups'}));
  expect(section.getByText('2 due')).toBeInTheDocument();
  expect(section.getByRole('link',{name:/Alice Example.*Scope check-in.*Due today/})).toHaveAttribute('href','/erm?contact=contact-a&note=note-a');
  expect(section.getByRole('link',{name:/Bob Example.*Budget check-in.*Overdue/})).toHaveAttribute('href','/erm?contact=contact-b&note=note-b');
});

it('does not show an E-CRM error when the module is unavailable on a deployment',async()=>{
  const fetcher=vi.fn(async()=>new Response(null,{status:404}));
  vi.stubGlobal('fetch',fetcher);
  render(<MemoryRouter><Today/></MemoryRouter>);
  await screen.findByText('You’re caught up');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(screen.queryByRole('region',{name:'E-CRM follow-ups'})).not.toBeInTheDocument();
});
