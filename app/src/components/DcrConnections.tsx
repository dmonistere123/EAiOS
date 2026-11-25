import {useState} from 'react';
import {dcr} from '../adapters';
import type {DcrArtifactPreview,DcrConnections,DcrRecord,DcrSnapshot} from '../domain/dcr';
type Run=(fn:()=>Promise<unknown>)=>Promise<void>;

export function DcrArtifactPicker({run,busy,onSelected}:{run:Run;busy:boolean;onSelected:(id:string)=>void}){
  const [catalog,setCatalog]=useState<DcrConnections|null>(null);
  const [preview,setPreview]=useState<DcrArtifactPreview|null>(null);
  return <section className="dcr-connection-box">
    <div className="dcr-row"><div><div className="dcr-eyebrow">Saved work, ready for context</div><h3>Choose from Artifacts</h3></div>
      <button disabled={busy} onClick={()=>void run(async()=>{setPreview(null);setCatalog(await dcr.connections());})}>{catalog?'Refresh Artifacts':'Browse Artifacts'}</button></div>
    <p className="dcr-muted">Preview a saved text file, then add it to your evidence. Your assistant only reviews it when you ask.</p>
    {catalog&&<><small>{catalog.label} · latest 100 entries · supported text files</small>{catalog.errors.map(error=><p role="alert" className="dcr-warning" key={error}>{error}</p>)}
      <div className="dcr-artifact-list">{catalog.artifacts.map(artifact=><button className="dcr-linked" disabled={busy} key={artifact.id} onClick={()=>void run(async()=>{setPreview(null);setPreview(await dcr.previewArtifact(artifact.id));})}><span>{artifact.title}<small>{artifact.taskTitle}</small></span><span>Preview →</span></button>)}</div>
      {!catalog.artifacts.length&&<p className="dcr-muted">No supported text Artifacts are available.</p>}</>}
    {preview&&<div className="dcr-artifact-preview"><h3>{preview.title}</h3><p className="dcr-prose">{preview.text}</p><div className="dcr-actions">
      <button className="dcr-primary" disabled={busy} onClick={()=>void run(async()=>{const source=await dcr.selectArtifact(preview);onSelected(source.id);setPreview(null);})}>Add this Artifact as evidence</button>
      <button disabled={busy} onClick={()=>setPreview(null)}>Cancel preview</button></div><small>Only this version is selected. A changed or removed file requires a fresh review.</small></div>}
  </section>;
}

export function DcrWorkConnections({record,snapshot,run,busy}:{record:DcrRecord;snapshot:DcrSnapshot;run:Run;busy:boolean}){
  const [catalog,setCatalog]=useState<DcrConnections|null>(null);
  const [show,setShow]=useState(false);
  const links=(snapshot.workLinks??[]).filter(link=>link.recordId===record.id);
  if(record.kind!=='commitment')return null;
  return <section className="dcr-work-section" aria-label="Linked execution work">
    <div className="dcr-row"><h3>Work behind this promise <span className="dcr-muted">{links.length}</span></h3><button disabled={busy} onClick={()=>void run(async()=>{setCatalog(await dcr.connections());setShow(true);})}>Link existing work</button></div>
    <p className="dcr-muted">Keep an eye on agent and HI progress here. You confirm the business outcome separately.</p>
    {links.map(link=><article className="dcr-work-card" key={link.kind+link.id}>
      <div className="dcr-eyebrow">{link.kind==='human'?'HI Assistant':'Agent task'}</div>
      <strong>{link.work?.title??'Linked work unavailable'}</strong>
      {link.work?<><div className="dcr-meta"><span>{link.work.status.replaceAll('_',' ')}</span><span>{link.work.owner||'Unassigned'}</span></div>
        {link.work.summary&&<p className="dcr-prose">{link.work.summary}</p>}
        {['done','completed','awaiting_completion'].includes(link.work.status)&&<p className="dcr-warning">Work reported ready. Review the outcome before marking this promise fulfilled.</p>}</>:<p className="dcr-muted">The source is missing or unavailable. The promise remains unchanged.</p>}
      <small>Reference: {link.id}</small><button disabled={busy} onClick={()=>void run(()=>dcr.linkWork(record,link.kind,link.id,undefined,true))}>Unlink</button>
    </article>)}
    {!links.length&&<p className="dcr-muted">No execution work linked yet.</p>}
    {links.length>0&&<button disabled={busy} onClick={()=>void run(async()=>{})}>Refresh progress</button>}
    {show&&catalog&&<div className="dcr-connection-box"><div className="dcr-row"><h3>Select existing work</h3><button onClick={()=>setShow(false)}>Close work picker</button></div>
      <small>{catalog.label} · latest 100 entries per module</small>{catalog.errors.map(error=><p role="alert" className="dcr-warning" key={error}>{error}</p>)}
      {catalog.work.map(work=>{const linked=links.some(link=>link.kind===work.kind&&link.id===work.id);return <div className="dcr-work-option" key={work.kind+work.id}>
        <div><strong>{work.title}</strong><small>{work.kind==='human'?'HI Assistant':'Agent task'} · {work.status.replaceAll('_',' ')} · {work.owner||'Unassigned'}</small>{work.summary&&<p>{work.summary}</p>}</div>
        <button disabled={busy||linked} onClick={()=>void run(()=>dcr.linkWork(record,work.kind,work.id,work.version))}>{linked?'Linked':'Link to this promise'}</button></div>;})}
      {!catalog.work.length&&<p>No work items are available.</p>}
      <p className="dcr-muted">Linking does not create, assign, send, or complete work.</p>
    </div>}
  </section>;
}
