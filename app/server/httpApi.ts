import { assistantRequests, terminal } from './assistantRequests.ts';
import { requestArtifacts } from './assistantArtifacts.ts';
import {travelPlaces,travelRecommendations} from './travelGuide.ts';
import { travelAction } from './travelBooking.ts';
/// <reference types="node" />
/**
 * httpApi (Phase 8.1, F10) — one router for every EAiOS /api endpoint,
 * shared by the production server (server/prod.ts). Handlers are plain
 * node:http functions so they run with zero framework deps. Caches (30s)
 * mirror the dev middleware; write endpoints bust them on mutation.
 *
 * Endpoints (semantics identical to vite.config.ts's dev middleware):
 *   GET  /api/skills-index        frontmatter walk of <hermesHome>/skills
 *   GET  /api/playbooks-index     playbooks index; PUT = confined write (W7)
 *   POST /api/skill-create        confined SKILL.md create, 409 on exists (W7)
 *   GET  /api/profile-env         key EXISTENCE only (never values)
 *   POST /api/profile-env         write one allowlisted key, chmod 600
 *   GET  /api/usage               state.db session_model_usage aggregates
 *   GET  /api/usage/daily?days=N  rate-card $ per local day, all profiles (F29)
 *   GET  /api/eaios-settings      EAiOS settings (settings.local.json)
 *   PUT  /api/eaios-settings      allowlisted patch, atomic
 *   GET  /api/artifacts           kanban task_attachments index
 *   GET  /api/artifacts/<id>/raw  confined file stream (+?download=1)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  listArtifacts,
  listKanbanRuns,
  listKanbanTasks,
  loadRateCard,
  queryDailySpend,
  queryUsage,
  rawArtifact,
  readBuildVersion,
  readSettings,
  readUpdateLog,
  rootExists,
  scanPlaybooks,
  scanSkills,
  updateKanbanTaskBody,
  writeSettings,
} from './apiCore.ts';
import { TravelApiError, updateTravelTrip, addTravelPlan, createTrip, decideTravelApproval, getTrip, listTrips, proposeBooking, searchTravel, travelAgent } from './travel.ts';
import { deletePlaybook, deleteSkill, updatePlaybookEnabled, updateSkillStatus, writePlaybook, writeSkill } from './authoring.ts';
import type { PlaybookInput, SkillInput } from './authoring.ts';
import type { CreateTripInput, TravelSearchParams } from '../src/adapters/interfaces.ts';
import type { BuildVersion } from './apiCore.ts';
import type { ApprovalDecision } from '../src/domain/types.ts';
import { hasProfileEnvKey, setProfileEnvKey } from './profileEnv.ts';
import { dismissWorkItem, listDismissed, undismissWorkItem } from './dismissed.ts';
import { optionsFor, requireSameOriginJson, checkUpdates, getUpdateStatus, launchReleaseInstall } from './updates.ts';
import { allyChat, allyChatStream } from './allyGateway.ts';
import { detectMedia, startBackupJob, listJobs, humanSize } from './backupCore.ts';
import type { BackupJob } from './backupCore.ts';

export interface ApiContext {
  /** Hermes home (default ~/.hermes) — skills/, profiles/, state.db, kanban.db. */
  hermesHome: string;
  /** EAiOS root (the dir ABOVE app/) — playbooks/, settings.local.json. */
  eaiosRoot: string;
  dataRoot?: string;
  /** Production captures its manifest at startup; null means unavailable. */
  buildVersion?: BuildVersion | null;
  /** Hermes gateway HTTP base for server-to-server calls (default http://127.0.0.1:9119). */
  hermesGatewayUrl?: string;
  /** Hermes gateway auth token; loaded from EAIOS_HERMES_TOKEN_FILE by default. */
  hermesGatewayToken?: string;
}

interface CacheEntry {
  at: number;
  body: string;
}
const CACHE_TTL = 30_000;
let skillsCache: CacheEntry | undefined;
let playbooksCache: CacheEntry | undefined;
let usageCache: { key: string } & CacheEntry | undefined;
let usageDailyCache: { key: string } & CacheEntry | undefined;
let artifactsCache: CacheEntry | undefined;
let kanbanCache: CacheEntry | undefined;
let kanbanRunsCache: CacheEntry | undefined;

function readJsonBody(req: IncomingMessage, maxBytes = Infinity): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    let body = ''; let bytes = 0; let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { tooLarge = true; reject(new Error('Request body too large')); return; }
      body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolvePromise(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(body);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Issue a server-to-server request to the Hermes gateway. Falls back to
 * 127.0.0.1:9119 when no override is provided so tests and the prod server
 * both resolve the same default. */
async function hermesGatewayFetch(ctx: ApiContext, path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const base = (ctx.hermesGatewayUrl ?? 'http://127.0.0.1:9119').replace(/\/$/, '');
  const token = ctx.hermesGatewayToken ?? '';
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  const upstreamHeaders = init?.headers as Record<string, string> | undefined;
  if (upstreamHeaders) {
    for (const [k, v] of Object.entries(upstreamHeaders)) headers[k] = v;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 10_000);
  try {
    return await fetch(`${base}${path}`, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Route one request. Returns true when the path was handled (response
 * ended); false when the caller should continue (static/proxy/404). */
export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, ctx: ApiContext): Promise<boolean> {
  const url = new URL(req.url ?? '', 'http://localhost');
  const path = url.pathname;
  const skillsRoot = join(ctx.hermesHome, 'skills');
  const profilesRoot = join(ctx.hermesHome, 'profiles');
  const dataRoot = ctx.dataRoot ?? ctx.eaiosRoot;
  const playbooksRoot = join(dataRoot, 'playbooks');
  const settingsFile = join(dataRoot, 'settings.local.json');

  try {

    if (path === '/api/assistant/requests' || path.startsWith('/api/assistant/requests/')) {
      const manager = assistantRequests(dataRoot);
      const parts = path.slice('/api/assistant/requests'.length).split('/').filter(Boolean);
      const view = (id: string) => { const row = manager.get(id); return row ? { ...row, ...requestArtifacts(ctx.hermesHome, manager.sessionRoots(id), row.profile) } : undefined; };
      res.setHeader('cache-control', 'no-store');
      if (req.method === 'POST') {
        try {
          requireSameOriginJson(req);
          const body = await readJsonBody(req, 4200000);
          if (!parts.length) {
            const settings = readSettings(settingsFile) as { allyProfile?: string | null };
            const attachments = Array.isArray(body.attachments) ? body.attachments : [];
            if (attachments.some(a => !a || typeof a.name !== 'string' || typeof a.content !== 'string' || typeof a.mimeType !== 'string' || !['text', 'base64'].includes(a.encoding))) throw new Error('Invalid attachments');
            const receipt = manager.accept(String(body.id ?? ''), String(body.text ?? ''), attachments, settings.allyProfile ?? undefined);
            json(res, 202, JSON.stringify(receipt));
          } else if (parts.length === 2 && parts[1] === 'cancel') {
            const row = manager.cancel(parts[0]); json(res, row ? 200 : 404, JSON.stringify(row ?? { error: 'Request not found' }));
          } else json(res, 404, JSON.stringify({ error: 'Unknown request route' }));
        } catch (e) { json(res, 400, JSON.stringify({ error: errMessage(e) })); }
      } else if (req.method === 'GET' && !parts.length) {
        json(res, 200, JSON.stringify({ requests: manager.list().map(r => view(r.id)) }));
      } else if (req.method === 'GET' && parts.length === 1) {
        const row = view(parts[0]); json(res, row ? 200 : 404, JSON.stringify(row ?? { error: 'Request not found' }));
      } else if (req.method === 'GET' && parts.length === 2 && parts[1] === 'events') {
        if (!manager.get(parts[0])) { json(res, 404, JSON.stringify({ error: 'Request not found' })); return true; }
        res.setHeader('content-type', 'text/event-stream');
        res.flushHeaders();
        // Each event is a complete versioned snapshot: reconnect needs no lossy delta replay.
        let previous = ''; let heartbeat: ReturnType<typeof setInterval> | undefined;
        const cleanup = () => { clearInterval(heartbeat); res.off('close', cleanup); };
        const tick = () => {
          if (res.destroyed) { cleanup(); return; }
          if (res.writableLength > 1000000) { cleanup(); res.end(); return; }
          const row = view(parts[0]); if (!row) { cleanup(); res.end(); return; }
          const payload = JSON.stringify(row);
          if (payload !== previous) { res.write(`id: ${row.revision}\nevent: snapshot\ndata: ${payload}\n\n`); previous = payload; }
          else res.write(': heartbeat\n\n');
          // Completed requests remain pollable for later linked artifacts.
          if (terminal(row)) { cleanup(); res.end(); }
        };
        heartbeat = setInterval(tick, 2000); res.on('close', cleanup); tick();
      } else { json(res, 405, JSON.stringify({ error: 'Method not allowed' })); }
      return true;
    }

    if (path === '/api/updates' || path === '/api/updates/check' || path === '/api/updates/install') {
      try {
        if (ctx.buildVersion === null) throw new Error('Running build unavailable');
        const current = ctx.buildVersion ?? readBuildVersion(ctx.eaiosRoot);
        if (path === '/api/updates' && req.method === 'GET') {
          json(res, 200, JSON.stringify(getUpdateStatus(optionsFor(ctx), current.version)));
        } else if (req.method === 'POST' && path !== '/api/updates') {
          try { requireSameOriginJson(req); } catch { json(res, 403, JSON.stringify({ error: { safeMessage: 'Same-origin JSON request required' } })); return true; }
          if (path === '/api/updates/check') {
            await checkUpdates(optionsFor(ctx));
            json(res, 200, JSON.stringify(getUpdateStatus(optionsFor(ctx), current.version)));
          } else {
            const body = await readJsonBody(req);
            if (!Number.isSafeInteger(body.releaseId) || Number(body.releaseId) <= 0) throw new Error('A checked release is required');
            json(res, 202, JSON.stringify(await launchReleaseInstall(ctx, current.version, Number(body.releaseId))));
          }
        } else json(res, 405, JSON.stringify({ error: { safeMessage: 'Method not allowed' } }));
      } catch (error) { json(res, 409, JSON.stringify({ error: { safeMessage: errMessage(error) } })); }
      return true;
    }
    /* version + update history */
    if (path === '/api/version' && req.method === 'GET') {
      try {
        if (ctx.buildVersion === null) throw new Error('Build version manifest unavailable at startup');
        const current = ctx.buildVersion ?? readBuildVersion(ctx.eaiosRoot);
        const log = readUpdateLog(join(ctx.hermesHome, 'state.db'));
        json(res, 200, JSON.stringify({ current, log }));
      } catch (e) {
        json(res, 503, JSON.stringify({ error: String(e) }));
      }
      return true;
    }

    /* skills index */
    if (path === '/api/skills-index' && req.method === 'GET') {
      if (!skillsCache || Date.now() - skillsCache.at > CACHE_TTL) {
        skillsCache = { at: Date.now(), body: JSON.stringify({ skills: rootExists(skillsRoot) ? scanSkills(skillsRoot) : [] }) };
      }
      json(res, 200, skillsCache.body);
      return true;
    }

    if (path === '/api/skills-index' && (req.method === 'PUT' || req.method === 'DELETE')) {
      try {
        const body = await readJsonBody(req);
        const slug = String(body.slug ?? '');
        const category = String(body.category ?? '');
        if (req.method === 'PUT') {
          const status = String(body.status ?? '');
          if (status !== 'enabled' && status !== 'disabled') {
            json(res, 400, JSON.stringify({ error: 'status must be enabled or disabled' }));
            return true;
          }
          updateSkillStatus(skillsRoot, category, slug, status);
        } else {
          deleteSkill(skillsRoot, category, slug);
        }
        skillsCache = undefined; // bust
        json(res, 200, JSON.stringify({ ok: true }));
      } catch (e) {
        json(res, 400, JSON.stringify({ error: errMessage(e) }));
      }
      return true;
    }

    /* playbooks index (GET) + confined write (PUT) + lifecycle (PUT/DELETE /api/playbooks-index) */
    if (path === '/api/playbooks-index') {
      if (req.method === 'PUT') {
        try {
          const body = (await readJsonBody(req)) as unknown as PlaybookInput & { enabled?: boolean };
          if (body.enabled !== undefined && !body.body && !body.name) {
            // enable/disable lifecycle toggle
            const slug = String(body.id ?? '');
            if (!slug) {
              json(res, 400, JSON.stringify({ error: 'id is required' }));
              return true;
            }
            updatePlaybookEnabled(playbooksRoot, slug, Boolean(body.enabled));
            playbooksCache = undefined;
            json(res, 200, JSON.stringify({ ok: true }));
            return true;
          }
          const saved = writePlaybook(playbooksRoot, body);
          playbooksCache = undefined; // bust — the next GET re-scans
          const playbook = scanPlaybooks(playbooksRoot).find((p) => p.id === saved.id);
          json(res, saved.created ? 201 : 200, JSON.stringify({ playbook: { ...(playbook ?? {}), id: saved.id, version: saved.version, status: saved.status } }));
        } catch (e) {
          json(res, 400, JSON.stringify({ error: errMessage(e) }));
        }
        return true;
      }
      if (req.method === 'DELETE') {
        try {
          const body = await readJsonBody(req);
          const slug = String(body.id ?? '');
          if (!slug) {
            json(res, 400, JSON.stringify({ error: 'id is required' }));
            return true;
          }
          deletePlaybook(playbooksRoot, slug);
          playbooksCache = undefined;
          json(res, 200, JSON.stringify({ ok: true }));
        } catch (e) {
          json(res, 400, JSON.stringify({ error: errMessage(e) }));
        }
        return true;
      }
      if (req.method === 'GET') {
        if (!playbooksCache || Date.now() - playbooksCache.at > CACHE_TTL) {
          playbooksCache = { at: Date.now(), body: JSON.stringify({ playbooks: rootExists(playbooksRoot) ? scanPlaybooks(playbooksRoot) : [] }) };
        }
        json(res, 200, playbooksCache.body);
        return true;
      }
    }

    /* skill create (confined; create-only) */
    if (path === '/api/skill-create') {
      if (req.method !== 'POST') {
        json(res, 405, JSON.stringify({ error: 'POST only' }));
        return true;
      }
      try {
        const body = (await readJsonBody(req)) as unknown as SkillInput;
        const saved = writeSkill(skillsRoot, body);
        skillsCache = undefined; // bust — the next GET re-walks
        json(res, 201, JSON.stringify({ name: saved.name, category: saved.category }));
      } catch (e) {
        const code = (e as { code?: string }).code === 'already_exists' ? 409 : 400;
        json(res, code, JSON.stringify({ error: errMessage(e) }));
      }
      return true;
    }

    /* agent lifecycle: delete a staff agent and its Hermes profile */
    const agentDeleteMatch = path.match(/^\/api\/agents\/([^/]+)$/);
    if (agentDeleteMatch && req.method === 'DELETE') {
      try {
        const agentId = agentDeleteMatch[1];
        if (!agentId || agentId === 'default' || agentId === 'ally') {
          json(res, 403, JSON.stringify({ error: 'cannot delete the default orchestrator profile' }));
          return true;
        }
        if (!/^[a-z0-9_-]+$/.test(agentId)) {
          json(res, 400, JSON.stringify({ error: 'invalid agent id' }));
          return true;
        }

        // Clear EAiOS-local references first so a failed Hermes call still leaves EAiOS consistent.
        const currentSettings = readSettings(settingsFile) as { allyProfile?: string | null };
        if (currentSettings.allyProfile === agentId) {
          writeSettings(settingsFile, { allyProfile: null });
        }

        // Ask Hermes Desktop to delete the linked profile.
        const upstream = await hermesGatewayFetch(ctx, `/api/profiles/${encodeURIComponent(agentId)}`, { method: 'DELETE', timeoutMs: 15_000 });
        if (!upstream.ok) {
          const text = await upstream.text().catch(() => 'Hermes gateway error');
          json(res, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502, JSON.stringify({ error: text }));
          return true;
        }
        json(res, 200, JSON.stringify({ ok: true, agentId }));
      } catch (e) {
        json(res, 500, JSON.stringify({ error: errMessage(e) }));
      }
      return true;
    }

    /* profile env (telegram bot binding; existence-only reads) */
    if (path === '/api/profile-env') {
      if (req.method === 'GET') {
        try {
          json(res, 200, JSON.stringify({ present: hasProfileEnvKey(profilesRoot, url.searchParams.get('profile') ?? '', url.searchParams.get('key') ?? '') }));
        } catch (e) {
          json(res, 400, JSON.stringify({ error: errMessage(e) }));
        }
        return true;
      }
      if (req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          setProfileEnvKey(profilesRoot, String(body.profile ?? ''), String(body.key ?? ''), String(body.value ?? ''));
          json(res, 200, JSON.stringify({ ok: true })); // never echoes the value
        } catch (e) {
          json(res, 400, JSON.stringify({ error: errMessage(e) }));
        }
        return true;
      }
      json(res, 405, JSON.stringify({ error: 'GET or POST only' }));
      return true;
    }

    /* kanban board read (dogfood 2026-08-29: cli.exec truncates at 48000
     * chars — this endpoint is the truncation-proof board read; short cache
     * because the board is the app's most-polled slice) */
    if (path === '/api/kanban') {
      if (req.method === 'GET') {
        try {
          if (!kanbanCache || Date.now() - kanbanCache.at > 5_000) {
            kanbanCache = { at: Date.now(), body: JSON.stringify(listKanbanTasks(join(ctx.hermesHome, 'kanban.db'))) };
          }
          json(res, 200, kanbanCache.body);
        } catch (e) {
          json(res, 503, JSON.stringify({ error: String(e) }));
        }
        return true;
      }
      if (req.method === 'PUT') {
        try {
          const body = await readJsonBody(req);
          const taskId = String(body.id ?? '');
          const taskBody = String(body.body ?? '');
          if (!taskId || !taskBody) {
            json(res, 400, JSON.stringify({ error: 'id and body are required' }));
            return true;
          }
          // Guard: only update tasks whose current body is an approval envelope.
          const dbPath = join(ctx.hermesHome, 'kanban.db');
          const tasks = listKanbanTasks(dbPath).tasks as unknown as { id: string; body?: string | null }[];
          const current = tasks.find((t) => t.id === taskId);
          if (!current) {
            json(res, 404, JSON.stringify({ error: 'task not found' }));
            return true;
          }
          const parsed = JSON.parse(current.body ?? '{}') as { eaios?: string };
          if (parsed.eaios !== 'approval') {
            json(res, 403, JSON.stringify({ error: 'task body update is allowed only for approval envelopes' }));
            return true;
          }
          // Validate the new body is also a valid approval envelope.
          const next = JSON.parse(taskBody) as { eaios?: string };
          if (next.eaios !== 'approval') {
            json(res, 400, JSON.stringify({ error: 'new body must be a valid approval envelope' }));
            return true;
          }
          updateKanbanTaskBody(dbPath, taskId, taskBody);
          kanbanCache = undefined; // bust
          json(res, 200, JSON.stringify({ ok: true }));
        } catch (e) {
          const msg = errMessage(e);
          json(res, msg.includes('not found') ? 404 : 400, JSON.stringify({ error: msg }));
        }
        return true;
      }
    }

    /* delegated runs: tasks joined to worker sessions (ATTACH state.db —
     * the gateway deny-lists kanban sessions from session.list, but
     * resume+history works; the rail renders the transcript from this) */
    if (path === '/api/kanban-runs' && req.method === 'GET') {
      try {
        if (!kanbanRunsCache || Date.now() - kanbanRunsCache.at > 5_000) {
          kanbanRunsCache = { at: Date.now(), body: JSON.stringify(listKanbanRuns(join(ctx.hermesHome, 'kanban.db'), join(ctx.hermesHome, 'state.db'))) };
        }
        json(res, 200, kanbanRunsCache.body);
      } catch (e) {
        json(res, 503, JSON.stringify({ error: String(e) }));
      }
      return true;
    }

    /* usage aggregates */
    if (path === '/api/usage' && req.method === 'GET') {
      try {
        const now = new Date();
        const from = url.searchParams.get('from') ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const to = url.searchParams.get('to') ?? now.toISOString();
        const key = `${from}|${to}`;
        if (!usageCache || usageCache.key !== key || Date.now() - usageCache.at > CACHE_TTL) {
          usageCache = { key, at: Date.now(), body: JSON.stringify(queryUsage(join(ctx.hermesHome, 'state.db'), from, to)) };
        }
        json(res, 200, usageCache.body);
      } catch (e) {
        // DB missing/locked/error → 503 → adapter falls back to mock (spec §2)
        json(res, 503, JSON.stringify({ error: String(e) }));
      }
      return true;
    }

    /* daily estimated spend (F29) — rate-card $ per local day, all profiles */
    if (path === '/api/usage/daily' && req.method === 'GET') {
      try {
        const days = Number(url.searchParams.get('days') ?? 14) || 14;
        const settings = readSettings(settingsFile) as { dailySpendAlertUsd?: number };
        const threshold = typeof settings.dailySpendAlertUsd === 'number' ? settings.dailySpendAlertUsd : 5.0;
        const key = `${days}|${threshold}`;
        if (!usageDailyCache || usageDailyCache.key !== key || Date.now() - usageDailyCache.at > CACHE_TTL) {
          const card = loadRateCard(ctx.eaiosRoot);
          const dbPaths = [join(ctx.hermesHome, 'state.db')];
          try {
            for (const p of readdirSync(join(ctx.hermesHome, 'profiles'), { withFileTypes: true })) {
              if (p.isDirectory()) dbPaths.push(join(ctx.hermesHome, 'profiles', p.name, 'state.db'));
            }
          } catch {
            // no profiles dir = default-only, honest
          }
          usageDailyCache = { key, at: Date.now(), body: JSON.stringify(queryDailySpend(dbPaths, days, card.rates, card.fallback, threshold)) };
        }
        json(res, 200, usageDailyCache.body);
      } catch (e) {
        json(res, 503, JSON.stringify({ error: String(e) }));
      }
      return true;
    }

    /* eaios settings */
    if (path === '/api/eaios-settings') {
      if (req.method === 'PUT') {
        try {
          const patch = await readJsonBody(req);
          json(res, 200, JSON.stringify(writeSettings(settingsFile, patch)));
        } catch (e) {
          const msg = errMessage(e);
          json(res, msg.startsWith('keys must be') || msg.includes('must be a positive number') ? 400 : 500, JSON.stringify({ error: msg }));
        }
        return true;
      }
      json(res, 200, JSON.stringify(readSettings(settingsFile)));
      return true;
    }

    /* dismissed work items — server-side so dismissal follows the user across browsers/machines */
    if (path === '/api/dismissed') {
      if (req.method === 'GET') {
        json(res, 200, JSON.stringify({ ids: listDismissed(dataRoot) }));
        return true;
      }
      if (req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const id = String(body.id ?? '');
          if (!id) {
            json(res, 400, JSON.stringify({ error: 'id is required' }));
            return true;
          }
          json(res, 200, JSON.stringify({ ids: dismissWorkItem(dataRoot, id) }));
        } catch (e) {
          json(res, 500, JSON.stringify({ error: errMessage(e) }));
        }
        return true;
      }
      json(res, 405, JSON.stringify({ error: 'GET or POST only' }));
      return true;
    }
    if (path.startsWith('/api/dismissed/')) {
      const id = path.slice('/api/dismissed/'.length);
      if (!id) return false;
      if (req.method === 'DELETE') {
        json(res, 200, JSON.stringify({ ids: undismissWorkItem(dataRoot, id) }));
        return true;
      }
      json(res, 405, JSON.stringify({ error: 'DELETE only' }));
      return true;
    }

    /* artifacts index + confined raw stream */
    if (path === '/api/artifacts' || path.startsWith('/api/artifacts/')) {
      try {
        const rawMatch = path.match(/^\/api\/artifacts\/(?:att-)?(\d+)\/raw$/);
        if (rawMatch) {
          const rec = rawArtifact(join(ctx.hermesHome, 'kanban.db'), join(ctx.hermesHome, 'kanban', 'attachments'), rawMatch[1]);
          if (!rec) {
            json(res, 404, JSON.stringify({ error: 'not found' }));
            return true;
          }
          res.statusCode = 200;
          res.setHeader('content-type', rec.mime);
          res.setHeader('x-content-type-options', 'nosniff');
          if (url.searchParams.get('download') === '1') {
            res.setHeader('content-disposition', `attachment; filename="${rec.filename.replace(/"/g, '')}"`);
          }
          res.end(readFileSync(rec.path));
          return true;
        }
        if (path !== '/api/artifacts') return false; // unknown subpath → 404 by caller
        if (!artifactsCache || Date.now() - artifactsCache.at > CACHE_TTL) {
          artifactsCache = { at: Date.now(), body: JSON.stringify(listArtifacts(join(ctx.hermesHome, 'kanban.db'))) };
        }
        json(res, 200, artifactsCache.body);
      } catch (e) {
        json(res, 503, JSON.stringify({ error: String(e) }));
      }
      return true;
    }

    /* travel (F31) — Duffel/browser-use/OpenTable proxy; 503 when no provider is configured */
    if (path === '/api/travel/trips' && req.method === 'GET') {
      try {
        json(res, 200, JSON.stringify({ trips: await listTrips(ctx.dataRoot ?? ctx.eaiosRoot) }));
      } catch (e) {
        json(res, e instanceof TravelApiError ? e.status : 503, JSON.stringify({ error: e instanceof TravelApiError ? e.message : String(e) }));
      }
      return true;
    }
    const detailsMatch = path.match(/^\/api\/travel\/trips\/([^/]+)\/details$/);
    const recommendationsMatch = path.match(/^\/api\/travel\/trips\/([^/]+)\/recommendations$/);
    if ((path === '/api/travel/places' && req.method === 'GET') || (recommendationsMatch && req.method === 'GET') || (detailsMatch && req.method === 'POST')) {
      try {
        const result = detailsMatch ? await updateTravelTrip(detailsMatch[1],await readJsonBody(req) as unknown as CreateTripInput,ctx.dataRoot??ctx.eaiosRoot)
          : recommendationsMatch ? {shortlists:await travelRecommendations(recommendationsMatch[1],ctx.dataRoot??ctx.eaiosRoot)}
          : {places:await travelPlaces(url.searchParams.get('query')??'')};
        json(res,200,JSON.stringify(result));
      } catch(error) {json(res,error instanceof TravelApiError?error.status:503,JSON.stringify({error:error instanceof Error?error.message:'Travel request failed.'}));}
      return true;
    }
    const planMatch = path.match(/^\/api\/travel\/trips\/([^/]+)\/plans$/);
    const confirmationMatch = path.match(/^\/api\/travel\/trips\/([^/]+)\/bookings\/([^/]+)\/action$/);
    if ((planMatch || confirmationMatch) && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const result = planMatch
          ? await addTravelPlan(planMatch[1], body as unknown as import('../src/domain/travelPlan.ts').TravelPlanInput, ctx.dataRoot ?? ctx.eaiosRoot)
          : await travelAction(confirmationMatch![1], confirmationMatch![2], body as unknown as import('../src/domain/travelPlan.ts').TravelAction, ctx.dataRoot ?? ctx.eaiosRoot);
        json(res, 200, JSON.stringify(result));
      } catch (error) {
        json(res, error instanceof TravelApiError ? error.status : 503, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return true;
    }
    if (path.startsWith('/api/travel/trips/')) {
      const tripMatch = path.match(/^\/api\/travel\/trips\/([^/]+)$/);
      if (tripMatch && req.method === 'GET') {
        try {
          json(res, 200, JSON.stringify({ trip: await getTrip(tripMatch[1], ctx.dataRoot ?? ctx.eaiosRoot) }));
        } catch (e) {
          json(res, e instanceof TravelApiError ? e.status : 503, JSON.stringify({ error: e instanceof TravelApiError ? e.message : String(e) }));
        }
        return true;
      }
      const proposalMatch = path.match(/^\/api\/travel\/trips\/([^/]+)\/(proposals|choices)$/);
      if (proposalMatch && req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const result = await proposeBooking(proposalMatch[1], String(body.resultId ?? ''), String(body.note ?? ''), ctx.dataRoot ?? ctx.eaiosRoot, proposalMatch[2] === 'choices');
          json(res, result.ok ? 200 : 400, JSON.stringify(result));
        } catch (e) {
          json(res, e instanceof TravelApiError ? e.status : 503, JSON.stringify({ error: e instanceof TravelApiError ? e.message : String(e) }));
        }
        return true;
      }
    }
    if (path === '/api/travel/trips' && req.method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as unknown as CreateTripInput;
        const result = await createTrip(body, ctx.dataRoot ?? ctx.eaiosRoot);
        json(res, result.ok ? 201 : 400, JSON.stringify(result));
      } catch (e) {
        json(res, e instanceof TravelApiError ? e.status : 503, JSON.stringify({ error: e instanceof TravelApiError ? e.message : String(e) }));
      }
      return true;
    }
    if (path === '/api/travel/search' && req.method === 'GET') {
      try {
        const params: TravelSearchParams = {
          latitude: url.searchParams.has('latitude') ? Number(url.searchParams.get('latitude')) : undefined,
          longitude: url.searchParams.has('longitude') ? Number(url.searchParams.get('longitude')) : undefined,
          kind: url.searchParams.get('kind') as TravelSearchParams['kind'],
          origin: url.searchParams.get('origin') ?? undefined,
          destination: url.searchParams.get('destination') ?? undefined,
          checkIn: url.searchParams.get('checkIn') ?? undefined,
          checkOut: url.searchParams.get('checkOut') ?? undefined,
          departureDate: url.searchParams.get('departureDate') ?? undefined,
          returnDate: url.searchParams.get('returnDate') ?? undefined,
          date: url.searchParams.get('date') ?? undefined,
          pickupLocation: url.searchParams.get('pickupLocation') ?? undefined,
          dropoffLocation: url.searchParams.get('dropoffLocation') ?? undefined,
          partySize: url.searchParams.has('partySize') ? Number(url.searchParams.get('partySize')) : undefined,
        };
        json(res, 200, JSON.stringify({ results: await searchTravel(params, ctx.dataRoot ?? ctx.eaiosRoot) }));
      } catch (e) {
        json(res, e instanceof TravelApiError ? e.status : 503, JSON.stringify({ error: e instanceof TravelApiError ? e.message : String(e) }));
      }
      return true;
    }
    if (path.startsWith('/api/travel/approvals/')) {
      const approvalMatch = path.match(/^\/api\/travel\/approvals\/([^/]+)$/);
      if (approvalMatch && req.method === 'POST') {
        try {
          const body = (await readJsonBody(req)) as unknown as ApprovalDecision;
          const result = await decideTravelApproval(approvalMatch[1], body, ctx.dataRoot ?? ctx.eaiosRoot);
          json(res, result.ok ? 200 : 400, JSON.stringify(result));
        } catch (e) {
          json(res, e instanceof TravelApiError ? e.status : 503, JSON.stringify({ error: e instanceof TravelApiError ? e.message : String(e) }));
        }
        return true;
      }
    }

    /* travel agent — NL query → structured search */
    if (path === '/api/travel/agent' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const query = String(body.query ?? '').trim();
        if (!query) {
          json(res, 400, JSON.stringify({ error: 'query is required' }));
          return true;
        }
        const result = await travelAgent({ query }, ctx);
        json(res, 200, JSON.stringify(result));
      } catch (e) {
        json(res, e instanceof TravelApiError ? e.status : 503, JSON.stringify({ error: e instanceof TravelApiError ? e.message : String(e) }));
      }
      return true;
    }

    /* travel browser-use status (archived post-beta; always disabled) */
    if (path === '/api/travel/browser-status' && req.method === 'GET') {
      json(res, 200, JSON.stringify({
        enabled: false,
        vaultUnlocked: false,
        configuredSites: [] as string[],
        sessionSites: [] as string[],
        playbooks: [],
      }));
      return true;
    }

    /* ally chat — REST bridge to the Hermes gateway for My Assistant */
    if (path === '/api/chat-ally' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const text = String(body.text ?? '').trim();
        const attachments = Array.isArray(body.attachments) ? body.attachments : undefined;
        if (!text && !attachments?.length) {
          json(res, 400, JSON.stringify({ error: 'text or attachments are required' }));
          return true;
        }
        const settings = readSettings(settingsFile) as { allyProfile?: string | null };
        const result = await allyChat(text, { profile: settings.allyProfile ?? undefined, attachments });
        json(res, result.error ? 503 : 200, JSON.stringify(result));
      } catch (e) {
        json(res, 500, JSON.stringify({ error: errMessage(e) }));
      }
      return true;
    }

    /* ally chat streaming — SSE spike */
    if (path === '/api/chat-ally/stream' && req.method === 'POST') {
      let ka: ReturnType<typeof setInterval> | undefined;
      const cleanup = () => clearInterval(ka);
      res.on('close', cleanup);
      try {
        const body = await readJsonBody(req);
        const text = String(body.text ?? '').trim();
        const attachments = Array.isArray(body.attachments) ? body.attachments : undefined;
        if (!text && !attachments?.length) {
          res.statusCode = 400;
          res.setHeader('content-type', 'text/event-stream');
          res.setHeader('cache-control', 'no-cache');
          res.end(`event: error\ndata: ${JSON.stringify({ error: 'text or attachments are required' })}\n\n`);
          return true;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.write('event: start\ndata: {}\n\n');
        // Keepalive: real Ally turns run 2-70 min; comment heartbeats stop
        // proxies/browsers from idle-cutting the SSE stream mid-turn.
        ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { /* client gone */ } }, 15_000);
        const streamSettings = readSettings(settingsFile) as { allyProfile?: string | null };
        await allyChatStream(text, {
          onDelta: (delta) => res.write(`event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`),
          onProgress: (text) => res.write(`event: progress\ndata: ${JSON.stringify({ text })}\n\n`),
          onComplete: (result) => {
            clearInterval(ka);
            res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
            res.end();
          },
          onError: (error) => {
            clearInterval(ka);
            res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
            res.end();
          },
        }, { profile: streamSettings.allyProfile ?? undefined, attachments });
      } catch (e) {
        clearInterval(ka);
        res.statusCode = 500;
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.end(`event: error\ndata: ${JSON.stringify({ error: errMessage(e) })}\n\n`);
      } finally { cleanup(); res.off('close', cleanup); }
      return true;
    }

    /* backup to removable media (Hermes + EAiOS, excludes Ollama models) */
    if (path === '/api/backup/media' && req.method === 'GET') {
      try {
        const media = await detectMedia();
        json(res, 200, JSON.stringify({ media }));
      } catch (e) {
        json(res, 500, JSON.stringify({ error: errMessage(e) }));
      }
      return true;
    }
    if (path === '/api/backup' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const target = String(body.target ?? '').trim();
        const job = await startBackupJob(target, {
          hermesHome: ctx.hermesHome,
          eaiosRoot: ctx.eaiosRoot,
          eaiosDataRoot: dataRoot,
          systemdUser: join(homedir(), '.config', 'systemd', 'user'),
        });
        json(res, 202, JSON.stringify({
          jobId: job.id,
          status: job.status,
          archivePath: job.archivePath,
          sources: job.sources,
        }));
      } catch (e) {
        const status = e && typeof e === 'object' && 'status' in e ? Number(e.status) : 500;
        json(res, status, JSON.stringify({ error: errMessage(e) }));
      }
      return true;
    }
    if (path === '/api/backup/status' && req.method === 'GET') {
      try {
        const jobId = url.searchParams.get('jobId') ?? '';
        const jobs = await listJobs({
          hermesHome: ctx.hermesHome,
          eaiosRoot: ctx.eaiosRoot,
          eaiosDataRoot: dataRoot,
          systemdUser: join(homedir(), '.config', 'systemd', 'user'),
        });
        const job = jobs.find((j: BackupJob) => j.id === jobId);
        if (!job) {
          json(res, 404, JSON.stringify({ error: 'job not found' }));
          return true;
        }
        const payload: Record<string, unknown> = {
          id: job.id,
          status: job.status,
          startedAt: job.startedAt,
          updatedAt: job.finishedAt ?? job.startedAt,
        };
        if (job.archivePath) payload.archivePath = job.archivePath;
        if (job.archiveSizeBytes !== undefined) {
          payload.archiveSizeBytes = job.archiveSizeBytes;
          payload.archiveSize = humanSize(job.archiveSizeBytes);
        }
        if (job.sources) payload.sources = job.sources;
        if (job.exclusions) payload.exclusions = job.exclusions;
        if (job.finishedAt) payload.finishedAt = job.finishedAt;
        if (job.warning) payload.warning = job.warning;
        if (job.error) payload.error = job.error;
        json(res, 200, JSON.stringify(payload));
      } catch (e) {
        json(res, 500, JSON.stringify({ error: errMessage(e) }));
      }
      return true;
    }

    return false;
  } catch (e) {
    json(res, 500, JSON.stringify({ error: String(e) }));
    return true;
  }
}
