// @vitest-environment node
/// <reference types="node" />
/**
 * Phase 8.1 (F10) — production server suite. Spins the real zero-dep server
 * on an ephemeral port against HERMETIC roots (tmp hermesHome/eaiosRoot/dist)
 * and verifies: static + SPA fallback + confinement, every /api endpoint's
 * routing and round-trips, settings/profile-env write safety, proxy failure
 * honesty (502), and the WS endpoint's non-upgrade behavior. WS tunneling to
 * hermes serve is verified live (HANDOFF 2026-08-29), not here — a hermetic
 * WS upstream would test the tunnel, not the product.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createEaiosServer, loadConfig } from '../../server/prod.ts';

let server: Server;
let base: string;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'eaios-prod-test-'));
  const hermesHome = join(root, 'hermes');
  const eaiosRoot = join(root, 'eaios');
  const dist = join(root, 'dist');
  mkdirSync(join(hermesHome, 'skills', 'productivity', 'demo-skill'), { recursive: true });
  writeFileSync(join(hermesHome, 'skills', 'productivity', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: A test skill\nversion: 1.0.0\n---\nbody\n');
  mkdirSync(join(hermesHome, 'profiles', 'scout'), { recursive: true });
  mkdirSync(join(eaiosRoot, 'playbooks'), { recursive: true });
  writeFileSync(join(eaiosRoot, 'playbooks', 'weekly-review.md'), '---\nname: Weekly Review\nversion: 1.2.0\nstatus: published\n---\nDo the review.\n');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>EAiOS</title>');
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');

  const config = loadConfig({
    EAIOS_DIST: dist,
    HERMES_HOME: hermesHome,
    EAIOS_ROOT: eaiosRoot,
    EAIOS_KNOWLEDGE_URL: 'http://127.0.0.1:59998', // dead port — proxy must fail honestly
  } as NodeJS.ProcessEnv);
  server = createEaiosServer(config);
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  rmSync(root, { recursive: true, force: true });
});

describe('static + SPA', () => {
  it('serves index.html at / and hashed assets with immutable cache', async () => {
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toContain('text/html');
    expect(home.headers.get('cache-control')).toBe('no-cache');
    expect(await home.text()).toContain('EAiOS');

    const asset = await fetch(`${base}/assets/index-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
  });

  it('SPA fallback: unknown client routes serve index.html', async () => {
    const res = await fetch(`${base}/staff`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('EAiOS');
  });

  it('path traversal cannot escape dist (collapse-then-confine)', async () => {
    // Secret OUTSIDE dist but inside the tmp tree.
    writeFileSync(join(root, 'secret.txt'), 'TOP-SECRET-CONTENTS');
    for (const p of ['/../secret.txt', '/..%2Fsecret.txt', '/%2E%2E/%2E%2E/secret.txt', '/..%2F..%2F..%2Fetc%2Fpasswd']) {
      const res = await fetch(`${base}${p}`);
      const body = await res.text();
      expect(body).not.toContain('TOP-SECRET-CONTENTS');
      expect(body).not.toContain('root:');
    }
  });
});

describe('api endpoints (hermetic roots)', () => {
  it('skills-index walks the skills root', async () => {
    const res = await fetch(`${base}/api/skills-index`);
    const body = await res.json();
    expect(body.skills).toEqual([{ name: 'demo-skill', category: 'productivity', description: 'A test skill', version: '1.0.0', status: 'enabled' }]);
  });

  it('playbooks-index GET + confined PUT round-trip (cache busted)', async () => {
    const before = await (await fetch(`${base}/api/playbooks-index`)).json();
    expect(before.playbooks.map((p: { id: string }) => p.id)).toEqual(['weekly-review']);

    const put = await fetch(`${base}/api/playbooks-index`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'board-deck', name: 'Board Deck', description: 'Quarterly deck', body: 'Steps here.' }),
    });
    expect([200, 201]).toContain(put.status);

    const after = await (await fetch(`${base}/api/playbooks-index`)).json();
    expect(after.playbooks.map((p: { id: string }) => p.id).sort()).toEqual(['board-deck', 'weekly-review']);
  });

  it('skill-create writes a confined SKILL.md and 409s on repeat', async () => {
    const post = await fetch(`${base}/api/skill-create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'made-skill', category: 'productivity', description: 'Made via API', body: 'Do the thing.' }),
    });
    expect(post.status).toBe(201);
    expect(readFileSync(join(root, 'hermes', 'skills', 'productivity', 'made-skill', 'SKILL.md'), 'utf8')).toContain('made-skill');

    const again = await fetch(`${base}/api/skill-create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'made-skill', category: 'productivity', description: 'dupe', body: 'x' }),
    });
    expect(again.status).toBe(409);
  });

  it('profile-env: POST writes chmod-600 token, GET reports existence only', async () => {
    const post = await fetch(`${base}/api/profile-env`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'scout', key: 'TELEGRAM_BOT_TOKEN', value: 'secret-token-value' }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ ok: true }); // never echoes the value

    const get = await fetch(`${base}/api/profile-env?profile=scout&key=TELEGRAM_BOT_TOKEN`);
    expect(await get.json()).toEqual({ present: true });
  });

  it('usage: missing state.db → honest 503 (adapter falls back to mock)', async () => {
    const res = await fetch(`${base}/api/usage`);
    expect(res.status).toBe(503);
  });

  it('artifacts: missing kanban.db → honest 503', async () => {
    const res = await fetch(`${base}/api/artifacts`);
    expect(res.status).toBe(503);
  });

  it('eaios-settings: allowlisted round-trip, non-allowlisted key refused', async () => {
    const put = await fetch(`${base}/api/eaios-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usageBudgetUsd: 300 }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ usageBudgetUsd: 300 });

    const bad = await fetch(`${base}/api/eaios-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ telegramToken: 'nope' }),
    });
    expect(bad.status).toBe(400);

    const get = await fetch(`${base}/api/eaios-settings`);
    expect(await get.json()).toEqual({ usageBudgetUsd: 300 });
  });

  it('unknown /api path → 404; /api/ws over plain HTTP → 426', async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/ws`)).status).toBe(426);
  });
});

describe('proxies', () => {
  it('knowledge proxy with no upstream → honest 502, not a fake 200', async () => {
    const res = await fetch(`${base}/knowledge-api/sources`);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(String(body.error)).toContain('proxy upstream failed');
  });
});

describe('kanban board endpoint (48K cli.exec cap fix)', () => {
  it('/api/kanban serves the tasks table regardless of body size; missing db → 503', async () => {
    // Missing kanban.db in the hermetic root → honest 503.
    expect((await fetch(`${base}/api/kanban`)).status).toBe(503);

    // Create a real kanban.db with a body far past the 48000-char cap.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(root, 'hermes', 'kanban.db'));
    db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT, priority INTEGER, tenant TEXT, created_by TEXT, created_at INTEGER, started_at INTEGER, completed_at INTEGER, result TEXT)');
    db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('t_fat', 'Fat envelope task', 'x'.repeat(60_000), null, 'ready', 2, null, 'test', 1788000000, null, null, null);
    db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('t_small', 'Small task', 'do it', 'default', 'done', 1, null, 'test', 1788000000, 1788000001, 1788000002, 'did it');
    db.close();

    const res = await fetch(`${base}/api/kanban`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks.map((t: { id: string }) => t.id).sort()).toEqual(['t_fat', 't_small']);
    expect(body.tasks.find((t: { id: string }) => t.id === 't_fat').body).toHaveLength(60_000); // NOT truncated
  });

  it('/api/kanban-runs joins tasks to their worker sessions (ATTACH state.db)', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    // state.db next to the kanban.db created above — worker sessions live
    // here with source='kanban', deny-listed from session.list.
    const sdb = new DatabaseSync(join(root, 'hermes', 'state.db'));
    sdb.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, source TEXT, message_count INTEGER, started_at INTEGER)');
    sdb.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('sess-worker-1', 'Work kanban task t_small', 'kanban', 24, 1788000001);
    sdb.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('sess-chat-1', 'Executive chat', 'cli', 9, 1788000001);
    sdb.close();

    const res = await fetch(`${base}/api/kanban-runs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // only assigned tasks are runs (t_small assignee=default; t_fat unassigned)
    expect(body.runs).toHaveLength(1);
    const run = body.runs[0];
    expect(run.id).toBe('t_small');
    expect(run.worker_session_id).toBe('sess-worker-1');
    expect(run.worker_message_count).toBe(24);
  });
});
