/** Explicit account identities travel with a reviewed message. Never use a provider default. */
export interface MailboxIdentity {
  connectionId: string;
  provider: 'outlook' | 'gmail';
  email: string;
  providerUserId: string;
  verifiedAt: string;
}
export interface MailRoutingSettings { delegationSender?: MailboxIdentity; defaultSender?: MailboxIdentity; revision: number; }
export type MailPurpose = {kind:'reply'; sourceMailbox:MailboxIdentity; sourceMessageId:string} | {kind:'human_delegation'} | {kind:'new_message'};
export function sameMailbox(a:MailboxIdentity,b:MailboxIdentity):boolean {
  return a.connectionId===b.connectionId && a.provider===b.provider && a.providerUserId===b.providerUserId && a.email.toLowerCase()===b.email.toLowerCase();
}
/** Available identities must be obtained by the server, not trusted from an approval payload. */
export function selectMailSender(purpose:MailPurpose,settings:MailRoutingSettings,available:MailboxIdentity[]):MailboxIdentity {
  if(purpose.kind==='reply'&&!purpose.sourceMessageId.trim())throw new Error('The original message is required.');
  const expected=purpose.kind==='reply'?purpose.sourceMailbox:purpose.kind==='new_message'?settings.defaultSender:settings.delegationSender;
  if(!expected)throw new Error('Choose a verified sender for this purpose in Settings.');
  const found=available.find(a=>sameMailbox(a,expected));
  if(!found)throw new Error('The required mailbox is unavailable or its identity changed. Sending remains blocked.');
  return found;
}
export function requireReviewedSender(reviewed:MailboxIdentity,current:MailboxIdentity):void {
  if(!sameMailbox(reviewed,current))throw new Error('The sending mailbox changed. Review a new approval before sending.');
}
