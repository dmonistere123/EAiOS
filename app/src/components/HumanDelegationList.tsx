import { Link } from 'react-router-dom';
import type { HumanContact, HumanDelegation } from '../domain/humanDelegation';
import type { WorkItem } from '../domain/types';
import { HumanWorkStatus } from './HumanWorkStatus';
import { Card } from './ui';

/** The HI module keeps all open work visible, independently of Today's time window. */
export function HumanDelegationList({ jobs, contacts, work, onChange }: {
  jobs: HumanDelegation[];
  contacts: HumanContact[];
  work: WorkItem[];
  onChange: (job: HumanDelegation) => void;
}) {
  const open = jobs.filter(job => !['completed', 'cancelled', 'declined', 'rejected'].includes(job.status));
  return <section aria-labelledby="human-open-delegations">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id="human-open-delegations" className="text-sm font-semibold tracking-wide">Open delegations</h2>
      <span className="text-xs text-ink-dim">{open.length} open</span>
    </div>
    {open.length === 0 ? <Card className="p-5 text-sm text-ink-dim">No open delegations.</Card> :
      <ul className="space-y-3">{open.map(job => {
        const contact = contacts.find(c => c.id === job.contactId);
        const title = work.find(w => w.id === job.workItemId)?.title
          || job.package?.subject?.replace(/^Delegation:\s*/i, '') || job.workItemId;
        return <li key={job.id}><Card className="p-5">
          <h3 className="break-words text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-ink-dim">Assigned to {contact?.displayName || job.package?.recipient.displayName || 'Human assistant'}</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-faint">
            <span>{job.dueAt ? `Due ${new Date(job.dueAt).toLocaleString()}` : 'No due date set'}</span>
            <span>Updated {new Date(job.updatedAt).toLocaleString()}</span>
          </div>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-faint">Instructions</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-dim">{job.instructions || 'No additional instructions.'}</p>
          {job.package && <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-signal">Delegation message</summary>
            <p className="mt-2 break-words font-medium">{job.package.subject}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-ink-dim">{job.package.body}</p>
            {job.package.artifacts.length > 0 && <ul aria-label="Included files" className="mt-2 space-y-1 text-xs text-ink-dim">{job.package.artifacts.map(a => <li key={a.artifactId}>{a.filename}</li>)}</ul>}
          </details>}
          <div className="mt-4 border-t border-edge pt-2"><HumanWorkStatus delegation={job} onChange={onChange}/></div>
          {job.status === 'pending_approval' && <Link to="/approvals" className="mt-3 inline-block text-sm text-signal">Review in Approvals →</Link>}
        </Card></li>;
      })}</ul>}
  </section>;
}
