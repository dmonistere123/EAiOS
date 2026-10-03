export type RequestState = 'accepted' | 'running' | 'reconnecting' | 'cancelling' | 'completed' | 'recovered' | 'cancelled' | 'interrupted';
export interface AssistantRequest {
  id: string; text: string; state: RequestState; revision: number; createdAt: string; updatedAt: string;
  response: string; progress: string; storedSessionId?: string; runtimeSessionId?: string;
  attachmentNames?: string[]; lastActivityAt?: string; profile?: string; cancelRequested?: boolean; error?: string; recovered?: boolean;
}
export interface RequestArtifact { id: string; name: string; taskId: string; url: string; }
export interface RequestView extends AssistantRequest { artifacts?: RequestArtifact[]; taskIds?: string[]; }
