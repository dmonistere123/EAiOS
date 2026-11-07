import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TelegramHistory } from '../components/TelegramHistory';
import { hermes } from '../adapters';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('opens real-shaped saved history without a composer or session activation',async()=>{
 const history=vi.spyOn(hermes,'getSessionTranscript').mockResolvedValue([{id:'1',role:'you',text:'Telegram question',at:new Date().toISOString()},{id:'2',role:'ally',text:'Saved answer',at:new Date().toISOString()}]);
 const resume=vi.spyOn(hermes,'resumeAssistantSession');
 render(<TelegramHistory conversation={{id:'tg',title:'Saved Telegram chat',source:'telegram'}} onClose={()=>{}}/>);
 expect(await screen.findByText('Saved answer')).toBeInTheDocument();
 expect(history).toHaveBeenCalledWith(undefined,'tg');
 expect(resume).not.toHaveBeenCalled();
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
 expect(screen.getByText('Telegram · Read-only')).toBeInTheDocument();
});
it('shows an honest history error rather than mock messages',async()=>{
 vi.spyOn(hermes,'getSessionTranscript').mockRejectedValue(new Error('offline'));
 render(<TelegramHistory conversation={{id:'tg',title:'Saved chat'}} onClose={()=>{}}/>);
 expect(await screen.findByRole('status')).toHaveTextContent('could not refresh');
 expect(screen.queryByText('No saved messages.')).not.toBeInTheDocument();
});
