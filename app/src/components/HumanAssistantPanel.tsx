import { useEffect, useState } from 'react';
import { humanDirectory, mailRouting } from '../adapters';
import type { HumanContact } from '../domain/humanDelegation';
import type { MailboxIdentity, MailRoutingSettings } from '../domain/mailRouting';
import { Card, SectionTitle } from './ui';

/** Private server storage only. Account identity is verified by the server on save. */
export function HumanAssistantPanel() {
  const [contacts,setContacts]=useState<HumanContact[]>([]);
  const [settings,setSettings]=useState<MailRoutingSettings>({revision:0});
  const [choices,setChoices]=useState<MailboxIdentity[]>([]);
  const [connection,setConnection]=useState('');
  const [name,setName]=useState(''),[email,setEmail]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{Promise.all([humanDirectory.listContacts(),mailRouting.settings()]).then(([c,s])=>{setContacts(c);setSettings(s);setConnection(s.delegationSender?.connectionId??'');}).catch(e=>setError(e.message));},[]);
  async function run(action:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Unable to save.');}finally{setBusy(false);}}
  const field='mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink';
  return <Card className="space-y-4 p-5">
    <SectionTitle>Human assistants &amp; email accounts</SectionTitle>
    <p className="text-sm text-ink-dim">Replies start with the original inbox; you can explicitly change the sender in Approvals. Human assistant delegations use the sender selected here. A missing account must block delivery.</p>
    <p className="text-xs text-warn">Human delegation emails require review and approval before sending.</p>
    <div className="rounded-lg border border-edge p-3">
      <p className="text-sm">Default sender: <strong>{settings.defaultSender?.email??'Not configured'}</strong></p><p className="text-sm">Human EA sender: <strong>{settings.delegationSender?.email??'Not configured'}</strong></p>
      <button disabled={busy} onClick={()=>void run(async()=>{const rows=await mailRouting.choices();setChoices(rows.flatMap(r=>r.mailbox?[r.mailbox]:[]));setNotice(rows.some(r=>r.error)?'Some accounts could not be verified. Check Connections.':'Mailbox identities loaded. This does not verify permission to send.');})} className="mt-2 text-sm text-signal">Find connected mailboxes</button>
      {choices.length>0 && <><label className="mt-3 block text-sm" htmlFor="hea-sender">Default delegation sender</label><select id="hea-sender" className={field} value={connection} onChange={e=>setConnection(e.target.value)}><option value="">Choose a mailbox</option>{choices.map(c=><option key={c.connectionId} value={c.connectionId}>{c.email} — {c.provider} ({c.connectionId})</option>)}</select><button className="mt-2 text-sm text-signal" disabled={busy||!choices.some(c=>c.connectionId===connection)} onClick={()=>void run(async()=>{const choice=choices.find(c=>c.connectionId===connection)!;setSettings(await mailRouting.save(connection,choice.email,settings.revision));setNotice('Delegation sender saved. Existing drafts keep their reviewed sender.');})}>Save delegation sender</button><button className="ml-4 mt-2 text-sm text-signal" disabled={busy||!choices.some(c=>c.connectionId===connection)} onClick={()=>void run(async()=>{const choice=choices.find(c=>c.connectionId===connection)!;setSettings(await mailRouting.save(connection,choice.email,settings.revision,'default'));setNotice('Default sender saved. Replies still start with their original inbox.');})}>Save as default sender</button></>}
    </div>
    <ul className="space-y-2">{contacts.filter(c=>c.active).map(c=><li key={c.id} className="rounded-lg border border-edge p-3 text-sm"><strong>{c.displayName}</strong><div className="text-ink-dim">{c.email}</div></li>)}</ul>
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{const c=await humanDirectory.createContact({displayName:name,email});setContacts([...contacts,c]);setName('');setEmail('');setNotice('Human assistant saved. No email sent.');});}}>
      <label htmlFor="hea-name" className="text-sm">Assistant name</label><input id="hea-name" required maxLength={160} value={name} onChange={e=>setName(e.target.value)} className={field}/>
      <label htmlFor="hea-email" className="mt-3 block text-sm">Assistant email</label><input id="hea-email" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} className={field}/>
      <button disabled={busy||!name.trim()||!email.trim()} className="mt-3 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas disabled:opacity-50">Add human assistant</button>
    </form>
    {error&&<p role="alert" className="text-sm text-risk">{error}</p>}{notice&&<p role="status" className="text-sm text-ink-dim">{notice}</p>}
  </Card>;
}
