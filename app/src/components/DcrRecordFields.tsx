import type { DcrFields, DcrRecord } from '../domain/dcr';

export function DcrTypeFields({ value, onChange }: { value:DcrFields; onChange:(value:DcrFields)=>void }) {
  const set=(field:keyof DcrFields,text:string)=>onChange({...value,[field]:text});
  const field=(key:keyof DcrFields,label:string,multiline=false,required=false)=><label className={multiline?'dcr-wide':''}>{label}{multiline?<textarea rows={3} maxLength={6000} required={required} value={value[key]} onChange={e=>set(key,e.target.value)}/>:<input maxLength={500} required={required} value={value[key]} onChange={e=>set(key,e.target.value)}/>}</label>;
  return <>
    {value.kind==='decision'&&<>
      {field('decisionOptions','Options & trade-offs (one option per line)',true)}
      {field('recommendation','Working recommendation — not your decision',true)}
      {(value.status==='completed'||value.decisionOutcome||value.status==='archived')&&<fieldset className="dcr-wide dcr-outcome"><legend>Your recorded decision</legend><p className="dcr-muted">Save your actual choice and reasoning. This does not approve spending, messages or assignments.</p>
        {field('decisionOutcome','Your actual decision',true,value.status==='completed')}
        {field('decisionRationale','Your rationale',true,value.status==='completed')}
        <label>Decision date<input type="date" required={value.status==='completed'} value={value.decidedOn} onChange={e=>set('decidedOn',e.target.value)}/></label>
      </fieldset>}
    </>}
    {value.kind==='commitment'&&<>
      {field('promisor','Who made the promise?')}{field('promisee','To whom?')}
      <p className="dcr-muted dcr-wide">Record only the people you can confirm. Recording someone else’s promise does not assign them work or imply they accepted an invitation.</p>
      {field('blockers','Blockers / what is needed',true)}
    </>}
    {value.kind==='relationship'&&<>
      {field('recommendation','Suggested next interaction',true)}
      {field('personName','Person’s name')}{field('role','Role')}
      <label>Importance to you<select value={value.importance} onChange={e=>set('importance',e.target.value)}><option value="not_set">Not set</option><option value="standard">Standard</option><option value="important">Important</option><option value="key">Key relationship</option></select></label>
      {field('preferences','Confirmed preferences & business context',true)}
      <label>Last confirmed interaction<input type="date" value={value.lastInteractionDate} onChange={e=>set('lastInteractionDate',e.target.value)}/></label>
      {field('lastInteractionNote','Interaction evidence or your account',true,!!value.lastInteractionDate)}
      <p className="dcr-muted dcr-wide">Names are not identities: people with the same name remain separate records. Calendar invitations alone do not establish an interaction.</p>
    </>}
  </>;
}
export function DcrTypeDetails({record:r}:{record:DcrRecord}) {
  return <>
    {r.kind==='decision'&&<>
      <h3>Options & trade-offs</h3>{r.decisionOptions?<ul className="dcr-options">{r.decisionOptions.split('\n').filter(Boolean).map((option,i)=><li key={i}>{option}</li>)}</ul>:<p className="dcr-muted">Options have not been recorded yet.</p>}
      {r.recommendation&&<div className="dcr-recommendation"><div className="dcr-eyebrow">Working recommendation · not a decision</div><p className="dcr-prose">{r.recommendation}</p></div>}
      {r.decisionOutcome?<div className="dcr-outcome"><div className="dcr-eyebrow">Your recorded decision · {r.decidedOn}</div><p className="dcr-prose">{r.decisionOutcome}</p><h3>Your rationale</h3><p className="dcr-prose">{r.decisionRationale}</p><small>Business decision only. External execution requires separate approval.</small></div>:<p className="dcr-muted">Your actual decision has not been recorded.</p>}
    </>}
    {r.kind==='commitment'&&<><div className="dcr-promise"><div><small>Promised by</small><strong>{r.promisor||'Not confirmed'}</strong></div><span aria-hidden="true">→</span><div><small>Promised to</small><strong>{r.promisee||'Not confirmed'}</strong></div></div>{r.blockers&&<><h3>Blockers</h3><p className="dcr-warning dcr-prose">{r.blockers}</p></>}<small>The business promise stays open until you confirm its outcome with evidence.</small></>}
    {r.kind==='relationship'&&<>{r.recommendation&&<><h3>Suggested next interaction</h3><p className="dcr-prose">{r.recommendation}</p></>}<dl className="dcr-person"><dt>Person</dt><dd>{r.personName||'Not confirmed'}</dd><dt>Role</dt><dd>{r.role||'Not recorded'}</dd><dt>Importance to you</dt><dd>{r.importance==='not_set'?'Not set':r.importance}</dd></dl>{r.preferences&&<><h3>Confirmed preferences & context</h3><p className="dcr-prose">{r.preferences}</p></>}<h3>Last confirmed interaction</h3><p>{r.lastInteractionDate||'No confirmed date'}</p>{r.lastInteractionNote&&<p className="dcr-prose">{r.lastInteractionNote}</p>}</>}
  </>;
}
