import type { MailboxIdentity, MailRoutingSettings } from '../domain/mailRouting';
async function request<T>(path:string,body?:unknown):Promise<T>{
  const r=await fetch('/api/mail-routing'+path,{cache:'no-store',...(body===undefined?{}:{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  const data=await r.json();if(!r.ok)throw new Error(data.error??'Mailbox settings unavailable.');return data;
}
export const mailRouting={
  history:(connectionId:string,messageId:string)=>request<{identity:MailboxIdentity;reference:{sourceMessageId:string;conversationId:string;internetMessageId:string};complete:true;messages:{id:string;subject:string;from?:{name?:string;address:string};to:{address:string}[];cc:{address:string}[];receivedAt:string;body:{contentType:string;content:string};webLink?:string;attachments:{id:string;name:string;size:number;isInline:boolean}[]}[]}>('/history?connectionId='+encodeURIComponent(connectionId)+'&messageId='+encodeURIComponent(messageId)),
  async associateSource(id:string,body:{connectionId:string;messageId:string;internetMessageId:string;conversationId:string;expectedBody:string}):Promise<{reviewVersion:string;mailReply:NonNullable<import('../domain/types').Approval['mailReply']>}>{const r=await fetch('/api/kanban/approvals/'+encodeURIComponent(id)+'/associate-outlook-source',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error??'Source association failed.');return data;},
  async saveOutlookDraft(id:string,body:{connectionId:string;body:string;bodyType:'Text'|'HTML';replyMode?:import('../domain/mailDraft').ReplyMode;expectedBody:string}):Promise<{draft:import('../domain/mailDraft').SavedMailDraft;reviewVersion:string}>{
    const r=await fetch('/api/kanban/approvals/'+encodeURIComponent(id)+'/save-outlook-draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error??'Draft save failed. Nothing was sent.');return data;
  },
  messages:(connectionId:string,subject:string)=>request<{id:string;subject:string;author:string;receivedAt?:string}[]>('/messages?connectionId='+encodeURIComponent(connectionId)+'&subject='+encodeURIComponent(subject)),
  async prepareReply(id:string,body:{connectionId:string;messageId:string;senderConnectionId?:string;replyMode?:import('../domain/mailDraft').ReplyMode;body:string;expectedBody:string}){
    const r=await fetch('/api/kanban/approvals/'+encodeURIComponent(id)+'/prepare-mail',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error??'Could not prepare reply.');return data;
  },
  settings:()=>request<MailRoutingSettings>(''),
  outlookChoices:()=>request<{connectionId:string;mailbox?:MailboxIdentity;error?:string}[]>('/choices?purpose=outlook-send'),
  choices:()=>request<{connectionId:string;mailbox?:MailboxIdentity;error?:string}[]>('/choices'),
  save:(connectionId:string,expectedEmail:string,revision:number,purpose:'default'|'delegation'='delegation')=>request<MailRoutingSettings>('',{connectionId,expectedEmail,revision,purpose}),
};
