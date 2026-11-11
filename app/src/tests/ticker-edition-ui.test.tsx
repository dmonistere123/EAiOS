import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import AppShell from '../app/AppShell';
import Settings from '../pages/Settings';
vi.mock('../adapters',async original=>({...await original<typeof import('../adapters')>(),adapterMode:'live'}));
vi.mock('../components/BottomTicker',()=>({BottomTicker:()=> <div data-testid="ticker-footer">Ticker footer</div>}));
vi.mock('../components/TickerSettings',()=>({TickerSettings:()=> <div data-testid="ticker-settings">Ticker settings</div>}));
afterEach(()=>vi.unstubAllGlobals());
it.each(['core','full'])('%s renders only the intended ticker surfaces',async edition=>{
 const enabled=['today','settings','approvals',...(edition==='full'?['ticker']:[])];
 vi.stubGlobal('fetch',vi.fn(async (url:string)=>{
  if(url==='/api/modules')return new Response(JSON.stringify({edition,enabled}));
  return new Response('{}',{status:503});
 }));
 const page=render(<MemoryRouter initialEntries={['/settings']}><Routes><Route element={<AppShell/>}><Route path="settings" element={<Settings/>}/></Route></Routes></MemoryRouter>);
 await screen.findByRole('heading',{name:'Settings'});
 await waitFor(()=>expect(screen.queryByText('Loading your modules…')).not.toBeInTheDocument());
 expect(screen.queryByRole('link',{name:'Ticker'})!==null).toBe(edition==='full');
 expect(screen.queryByTestId('ticker-footer')!==null).toBe(edition==='full');
 expect(screen.queryByTestId('ticker-settings')!==null).toBe(edition==='full');
 page.unmount();
 render(<MemoryRouter initialEntries={['/ticker']}><Routes><Route element={<AppShell/>}><Route path="ticker" element={<h1>Ticker dashboard</h1>}/></Route></Routes></MemoryRouter>);
 await waitFor(()=>expect(screen.queryByText('Loading your modules…')).not.toBeInTheDocument());
 expect(screen.queryByRole('heading',{name:'Ticker dashboard'})!==null).toBe(edition==='full');
 if(edition==='core')expect(screen.getByText('This optional module is not enabled on this box.')).toBeInTheDocument();
});
