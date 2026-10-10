import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiKeysPanel } from '../components/ApiKeysPanel';
import { apiKeys } from '../adapters';
vi.mock('../adapters',()=>({adapterMode:'live',apiKeys:{list:vi.fn(),save:vi.fn()}}));
const keys=[{key:'OPENROUTER_API_KEY',name:'OpenRouter',description:'Writing',configured:true,source:'saved' as const},{key:'OPENAI_API_KEY',name:'OpenAI',description:'Images',configured:false,source:'missing' as const},{key:'TAVILY_API_KEY',name:'Tavily',description:'Search',configured:false,source:'missing' as const}];
afterEach(()=>{cleanup();vi.resetAllMocks();window.history.replaceState({},'','/');});
it('opens Social Media from its Settings link and reuses existing keys without exposing values',async()=>{
 window.history.replaceState({},'','/settings#social-media');vi.mocked(apiKeys.list).mockResolvedValue({scope:'hermes',version:'v1',keys});render(<ApiKeysPanel/>);
 expect(await screen.findByLabelText('OpenRouter')).toHaveValue('');expect(screen.getByLabelText('Used by')).toHaveValue('social');expect(screen.queryByLabelText('Tavily')).not.toBeInTheDocument();expect(screen.getByText('Saved')).toBeInTheDocument();expect(apiKeys.list).toHaveBeenCalledWith('hermes');
});
it('saves Social Media credentials to the existing shared store and clears the entry',async()=>{
 window.history.replaceState({},'','/settings#social-media');vi.mocked(apiKeys.list).mockResolvedValue({scope:'hermes',version:'v1',keys});vi.mocked(apiKeys.save).mockResolvedValue();render(<ApiKeysPanel/>);
 fireEvent.change(await screen.findByLabelText('OpenRouter'),{target:{value:'test-only-token'}});fireEvent.click(screen.getAllByRole('button',{name:'Save key'})[0]);await waitFor(()=>expect(apiKeys.save).toHaveBeenCalledWith('hermes','OPENROUTER_API_KEY','test-only-token','v1'));expect(await screen.findByRole('status')).toHaveTextContent('No restart is needed');expect(screen.getByLabelText('OpenRouter')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('Used by'),{target:{value:'hermes'}});expect(await screen.findByLabelText('Tavily')).toBeInTheDocument();
});
