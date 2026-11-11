import {describe,it,expect} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {MarketMovers} from '../components/MarketMovers';
import {MarketQuote} from '../components/MarketQuote';
describe('ticker default visibility',()=>{
 it('shows movers and Bitcoin on every mount and retains hide, show and retry',()=>{
  const widgets=<><MarketMovers/><MarketQuote symbol="BITSTAMP:BTCUSD"/></>;
  const first=render(widgets);
  for(const [name,hostName] of [['movers','TradingView Active, Gainers and Losers'],['BITSTAMP:BTCUSD','TradingView quote for BITSTAMP:BTCUSD']]){
   const host=screen.getByLabelText(hostName);
   expect(screen.getByRole('button',{name:`Hide ${name} widget`})).toHaveAttribute('aria-expanded','true');
   expect(host).not.toHaveClass('hidden');
   fireEvent.click(screen.getByRole('button',{name:`Hide ${name} widget`}));
   expect(host).toHaveClass('hidden');
   fireEvent.click(screen.getByRole('button',{name:`Show ${name} widget`}));
   expect(host).not.toHaveClass('hidden');
   const oldScript=host.querySelector('script')!;
   fireEvent.error(oldScript);expect(host).toHaveClass('hidden');
   fireEvent.click(screen.getByRole('button',{name:`Retry ${name}`}));
   expect(host).not.toHaveClass('hidden');expect(host.querySelector('script')).not.toBe(oldScript);
   fireEvent.click(screen.getByRole('button',{name:`Hide ${name} widget`}));
  }
  first.unmount();render(widgets);
  expect(screen.getByRole('button',{name:'Hide movers widget'})).toHaveAttribute('aria-expanded','true');
  expect(screen.getByRole('button',{name:'Hide BITSTAMP:BTCUSD widget'})).toHaveAttribute('aria-expanded','true');
 });
 it('preserves the existing initial state of individual stock quotes',()=>{
  render(<MarketQuote symbol="NASDAQ:AAPL"/>);
  expect(screen.getByRole('button',{name:'Show NASDAQ:AAPL widget'})).toHaveAttribute('aria-expanded','false');
 });
});
