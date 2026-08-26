/**
 * MockKnowledgeAdapter — in-memory KnowledgeAdapter (fixtures + mutations).
 * Mirrors the sidecar's contract so pages behave identically in both modes.
 */
import type { AuditResult, EvidenceRef, KnowledgeSource } from '../../domain/types';
import type { KnowledgeAdapter, KnowledgeSourceInput } from '../interfaces';
import { knowledgeSources } from '../../mocks/fixtures';

const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms + Math.random() * 120));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
let seq = 100;

class MockKnowledgeAdapter implements KnowledgeAdapter {
  private sources = clone(knowledgeSources) as KnowledgeSource[];

  async listSources(): Promise<KnowledgeSource[]> {
    await delay();
    return clone(this.sources);
  }

  async uploadSource(file: File, metadata: KnowledgeSourceInput): Promise<KnowledgeSource> {
    await delay(300);
    const src: KnowledgeSource = {
      id: `k-mock-${seq++}`,
      type: 'file',
      name: metadata.name || file.name,
      scope: metadata.scope,
      allowedAgentIds: metadata.allowedAgentIds,
      indexingStatus: 'ready',
      freshnessAt: new Date().toISOString(),
      citationEnabled: metadata.citationEnabled,
    };
    this.sources = [src, ...this.sources];
    return clone(src);
  }

  async addUrl(url: string, metadata: KnowledgeSourceInput): Promise<KnowledgeSource> {
    await delay(300);
    const src: KnowledgeSource = {
      id: `k-mock-${seq++}`,
      type: 'url',
      name: metadata.name || url,
      uri: url,
      scope: metadata.scope,
      allowedAgentIds: metadata.allowedAgentIds,
      indexingStatus: 'ready',
      freshnessAt: new Date().toISOString(),
      citationEnabled: metadata.citationEnabled,
    };
    this.sources = [src, ...this.sources];
    return clone(src);
  }

  async reindex(sourceId: string): Promise<AuditResult> {
    await delay(250);
    if (!this.sources.some((s) => s.id === sourceId)) {
      return { ok: false, auditEventId: `k-err-${seq++}`, error: { code: 'not_found', safeMessage: 'Source not found.', retryable: false } };
    }
    this.sources = this.sources.map((s) => (s.id === sourceId ? { ...s, indexingStatus: 'ready', freshnessAt: new Date().toISOString() } : s));
    return { ok: true, auditEventId: `k-reindex-${sourceId}` };
  }

  async removeSource(sourceId: string): Promise<AuditResult> {
    await delay(250);
    this.sources = this.sources.filter((s) => s.id !== sourceId);
    return { ok: true, auditEventId: `k-remove-${sourceId}` };
  }

  async getRetrievalEvidence(_answerId: string): Promise<EvidenceRef[]> {
    await delay();
    return []; // evidence drill-down lands in Phase 5.3
  }
}

export const knowledge = new MockKnowledgeAdapter();
