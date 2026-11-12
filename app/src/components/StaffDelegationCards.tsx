import { Link } from 'react-router-dom';
import type { Agent } from '../domain/types';
import type { HumanContact, HumanDelegation } from '../domain/humanDelegation';
import { HumanAvatar } from './HumanStaffForm';
import { StaffAvatar } from './StaffAvatar';
import { AgentStatusBadge } from './ui';

/** AI delegation first, human support second. No implied human online presence. */
export function StaffDelegationCards({ hub, humans, jobs, humanOnly, loading, error, onSelectAgent, onSelectHuman, onAddHuman }: {
  hub?: Agent; humans: HumanContact[]; jobs: HumanDelegation[]; humanOnly: boolean; loading: boolean; error: string;
  onSelectAgent: (agent: Agent) => void; onSelectHuman: (contact: HumanContact) => void; onAddHuman: () => void;
}) {
  return <div className="staff-delegation-cards">
    {!humanOnly && <section className="staff-delegation-card staff-primary" aria-label="AI Assistant — start here">
      <span className="staff-delegation-avatar">{hub && <StaffAvatar agent={hub} hub />}</span>
      <div className="min-w-0 flex-1"><p className="staff-card-eyebrow">AI Assistant · Start here</p>
        <h2>{hub?.name ?? 'AI Assistant'}</h2><p>Your first point of delegation. Your AI assistant coordinates the specialist team and brings decisions back to you.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3"><Link to="/assistant" className="staff-card-action">Open AI Assistant</Link>
          {hub && <><button type="button" onClick={() => onSelectAgent(hub)} className="staff-card-action">Agent details</button><AgentStatusBadge status={hub.status}/></>}
        </div>
      </div>
    </section>}
    <section className="staff-delegation-card staff-human" aria-label="Human assistants — delegation backstop">
      <span className="staff-delegation-avatar"><HumanAvatar/></span>
      <div className="min-w-0 flex-1"><p className="staff-card-eyebrow">HI Assistant · Human backstop</p>
        <h2>Your human assistant{humans.length > 1 ? 's' : ''}</h2><p>Human judgment and hands-on support when a delegated task needs a person.</p>
        {loading ? <p role="status" className="mt-3">Loading human staff…</p> : error ? <p role="status" className="mt-3">{error}</p> : humans.length ? <ul className="mt-3 space-y-2">{humans.map(contact => {
          const work = jobs.filter(j => j.contactId === contact.id && !['completed','cancelled','declined','rejected'].includes(j.status));
          return <li key={contact.id}><button type="button" className="staff-human-contact" aria-label={`${contact.displayName}, human assistant`} onClick={() => onSelectHuman(contact)}>
            <span><strong>{contact.displayName}</strong><span className="block text-xs">{contact.title || 'Human assistant'}</span></span>
            <span className="text-xs">{work.length ? `${work.length} open delegation${work.length === 1 ? '' : 's'}` : 'No open delegations'} <span aria-hidden>›</span></span>
          </button></li>;
        })}</ul> : <p className="mt-3">No human assistant added yet.</p>}
        <div className="mt-3 flex flex-wrap gap-3"><button type="button" className="staff-card-action" onClick={onAddHuman}>Add human assistant</button>
          {!humanOnly && <Link to="/human-assistant" className="staff-card-action">Open HI Assistant</Link>}
          {humanOnly && <Link to="/today" className="staff-card-action">Delegate from Today</Link>}
        </div><p className="staff-human-note">Delegations are prepared for your approval. Saving a contact does not grant application access.</p>
      </div>
    </section>
  </div>;
}
