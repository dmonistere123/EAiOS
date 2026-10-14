import type { MailboxIdentity, MailRoutingSettings } from '../domain/mailRouting';
async function request<T>(path:string,body?:unknown):Promise<T>{
  const r=await fetch('/api/mail-routing'+path,{cache:'no-store',...(body===undefined?{}:{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  const data=await r.json();if(!r.ok)throw new Error(data.error??'Mailbox settings unavailable.');return data;
}
export const mailRouting={
  messages:(connectionId:string,subject:string)=>request<{id:string;subject:string;author:string;receivedAt?:string}[]>('/messages?connectionId='+encodeURIComponent(connectionId)+'&subject='+encodeURIComponent(subject)),
  async prepareReply(id:string,body:{connectionId:string;messageId:string;senderConnectionId?:string;body:string;expectedBody:string}){
    const r=await fetch('/api/kanban/approvals/'+encodeURIComponent(id)+'/prepare-mail',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error??'Could not prepare reply.');return data;
  },
  settings:()=>request<MailRoutingSettings>(''),
  choices:()=>request<{connectionId:string;mailbox?:MailboxIdentity;error?:string}[]>('/choices'),
  save:(connectionId:string,expectedEmail:string,revision:number,purpose:'default'|'delegation'='delegation')=>request<MailRoutingSettings>('',{connectionId,expectedEmail,revision,purpose}),
};
