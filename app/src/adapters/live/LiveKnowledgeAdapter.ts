/**
 * LiveKnowledgeAdapter — EAiOS knowledge sidecar via the dev proxy at
 * /knowledge-api (vite forwards to the loopback Python sidecar, so the
 * browser never touches it directly — same trust pattern as /composio-api).
 * Self-detects a down sidecar on first call and permanently falls back to
 * the mock adapter (graceful degradation, spec §2).
 */
import type { AuditResult, EvidenceRef, KnowledgeSource } from '../../domain/types';
import type { KnowledgeAdapter, KnowledgeChunk, KnowledgeSearchResult, KnowledgeSourceInput } from '../interfaces';
import { knowledge as mock } from '../mock/MockKnowledgeAdapter';

class LiveKnowledgeAdapter implements KnowledgeAdapter {
  /** once the sidecar is unreachable, stick to mock for the session */
  private useMock: boolean | undefined;

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/knowledge-api${path}`, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `sidecar HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  /** Routes through mock when the sidecar is known-down. */
  private async call<T>(fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    if (this.useMock) return fallback();
    try {
      return await fn();
    } catch {
      this.useMock = true;
      return fallback();
    }
  }

  listSources(): Promise<KnowledgeSource[]> {
    return this.call(
      async () => (await this.api<{ sources: KnowledgeSource[] }>('/sources')).sources,
      () => mock.listSources(),
    );
  }

  uploadSource(file: File, metadata: KnowledgeSourceInput): Promise<KnowledgeSource> {
    return this.call(
      async () => {
        const form = new FormData();
        form.append('file', file);
        form.append('name', metadata.name);
        form.append('scope', metadata.scope);
        form.append('citationEnabled', String(metadata.citationEnabled));
        if (metadata.allowedAgentIds) form.append('allowedAgentIds', JSON.stringify(metadata.allowedAgentIds));
        return (await this.api<{ source: KnowledgeSource }>('/sources/upload', { method: 'POST', body: form })).source;
      },
      () => mock.uploadSource(file, metadata),
    );
  }

  addUrl(url: string, metadata: KnowledgeSourceInput): Promise<KnowledgeSource> {
    return this.call(
      async () =>
        (
          await this.api<{ source: KnowledgeSource }>('/sources/url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, ...metadata }),
          })
        ).source,
      () => mock.addUrl(url, metadata),
    );
  }

  async reindex(sourceId: string): Promise<AuditResult> {
    try {
      await this.api(`/sources/${encodeURIComponent(sourceId)}/reindex`, { method: 'POST' });
      return { ok: true, auditEventId: `k-reindex-${sourceId}` };
    } catch (e) {
      if (this.useMock) return mock.reindex(sourceId);
      return { ok: false, auditEventId: `k-err-${Date.now()}`, error: { code: 'reindex_failed', safeMessage: e instanceof Error ? e.message : 'Reindex failed.', retryable: true } };
    }
  }

  async removeSource(sourceId: string): Promise<AuditResult> {
    try {
      await this.api(`/sources/${encodeURIComponent(sourceId)}`, { method: 'DELETE' });
      return { ok: true, auditEventId: `k-remove-${sourceId}` };
    } catch (e) {
      if (this.useMock) return mock.removeSource(sourceId);
      return { ok: false, auditEventId: `k-err-${Date.now()}`, error: { code: 'remove_failed', safeMessage: e instanceof Error ? e.message : 'Remove failed.', retryable: true } };
    }
  }

  searchKnowledge(query: string, limit = 8): Promise<KnowledgeSearchResult[]> {
    return this.call(
      // Executive context: no agent_id — the UI sees every ready source.
      async () => (await this.api<{ results: KnowledgeSearchResult[] }>(`/search?q=${encodeURIComponent(query)}&limit=${limit}`)).results,
      () => mock.searchKnowledge(query, limit),
    );
  }

  getChunk(chunkId: string): Promise<KnowledgeChunk> {
    return this.call(
      () => this.api<KnowledgeChunk>(`/chunks/${encodeURIComponent(chunkId)}`),
      () => mock.getChunk(chunkId),
    );
  }

  getRetrievalEvidence(answerId: string): Promise<EvidenceRef[]> {
    return mock.getRetrievalEvidence(answerId); // answer→chunk store lands with the live Assistant page
  }
}

export const liveKnowledge = new LiveKnowledgeAdapter();
