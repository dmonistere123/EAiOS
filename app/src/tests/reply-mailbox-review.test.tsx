import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {ReplyMailboxReview} from '../components/ReplyMailboxReview';
import {mailRouting} from '../adapters';
import type {Approval} from '../domain/types';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const approval={id:'test',payload:'Reply body',mailReply:{recipientEmail:'recipient@example.com',senderEmail:'work@example.com',sourceConnectionId:'work',sourceMessageId:'original',senderConnectionId:'work',body:'Reply body'}} as Approval;
function accounts(){return vi.spyOn(mailRouting,'choices').mockResolvedValue([{connectionId:'work',mailbox:{connectionId:'work',provider:'outlook',email:'work@example.com',providerUserId:'user',verifiedAt:'now'}}]);}
it('loads senders automatically and hides original source selectors for verified replies',async()=>{
 const choices=accounts();const prepare=vi.spyOn(mailRouting,'prepareReply');
 render(<ReplyMailboxReview approval={approval} onPrepared={()=>{}}/>);
 expect(await screen.findByRole('option',{name:'work@example.com'})).toBeInTheDocument();
 expect(choices).toHaveBeenCalled();expect(screen.getByLabelText('Send To')).toHaveValue('recipient@example.com');
 expect(screen.getByLabelText('Send To')).toHaveAttribute('readonly');
 expect(screen.getByLabelText('Send From')).toHaveValue('work');
 expect(screen.queryByLabelText('Original inbox')).not.toBeInTheDocument();
 expect(screen.queryByLabelText('Original message')).not.toBeInTheDocument();expect(prepare).not.toHaveBeenCalled();
});
it('keeps source verification separate and prevents saving an unidentified recipient',async()=>{
 accounts();render(<ReplyMailboxReview approval={{...approval,mailReply:undefined}} onPrepared={()=>{}}/>);
 await screen.findByRole('option',{name:'work@example.com'});
 expect(screen.getByText('Verify source email — required for this approval')).toBeInTheDocument();
 expect(screen.getByLabelText('Send To')).toHaveValue('');
 expect(screen.getByRole('button',{name:'Save verified reply for review'})).toBeDisabled();
});
