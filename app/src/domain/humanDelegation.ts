/** Human contacts are private per-box data, never Hermes profiles. */
export interface HumanContact {
  id: string;
  displayName: string;
  email: string;
  phone?: string;
  title?: string;
  organization?: string;
  timeZone?: string;
  notes?: string;
  active: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export type HumanContactInput = Pick<HumanContact, 'displayName'|'email'|'phone'|'title'|'organization'|'timeZone'|'notes'>;
export type HumanDelegationStatus = 'draft'|'pending_approval'|'rejected'|'sending'|'awaiting_acceptance'|'accepted'|'in_progress'|'blocked'|'completed'|'declined'|'no_response'|'cancelled'|'send_failed'|'delivery_uncertain';
export interface HumanDelegationArtifact {
  artifactId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
}
export interface HumanDelegationPackage {
  recipient: {displayName: string; email: string};
  sender: {provider: 'gmail'|'outlook'; accountId: string; email: string};
  subject: string;
  body: string;
  artifacts: HumanDelegationArtifact[];
  packageHash: string;
}
export interface HumanDelegation {
  receipt?: {id:string;provider:string};
  deliveryError?:string;
  id: string;
  workItemId: string;
  contactId: string;
  status: HumanDelegationStatus;
  dueAt?: string;
  instructions: string;
  package?: HumanDelegationPackage;
  approvalTaskId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface HumanDelegationEvent {
  id: number;
  delegationId: string;
  eventType: string;
  actorType: 'executive'|'system';
  note: string;
  occurredAt: string;
}
export type HumanDelegationRequest =
  | {kind: 'agent'; agentId: string; note?: string}
  | {kind: 'human'; contactId: string; dueAt?: string; instructions?: string; artifactIds: string[]};
export interface HumanDirectoryAdapter {
  listContacts(): Promise<HumanContact[]>;
  createContact(input: HumanContactInput): Promise<HumanContact>;
  updateContact(id: string, input: HumanContactInput, revision: number): Promise<HumanContact>;
  retireContact(id: string, revision: number): Promise<HumanContact>;
}
