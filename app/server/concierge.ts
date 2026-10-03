import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { parse } from 'yaml';
import { CONCIERGE_LIMITS as LIMIT, validConciergeHistory } from '../src/domain/concierge.ts';
import type { ConciergeInfo } from '../src/domain/concierge.ts';

const PROVIDERS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', key: 'OPENROUTER_API_KEY' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY' },
} as const;
export class ConciergeError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function boundedFile(path: string, max: number) {
  if (statSync(path).size > max) throw new Error('File too large');
  return readFileSync(path, 'utf8');
}
/** Read only existing server configuration. No Hermes imports, auth flows or writes. */
export function conciergeConfig(root: string, home: string, env = process.env) {
  let instructions: string;
  try { instructions = boundedFile(join(root, 'concierge', 'SOUL.md'), LIMIT.soul * 4); }
  catch { throw new ConciergeError(503, 'Concierge instructions are unavailable. Ask your administrator to check the installation.'); }
  if (!instructions.trim() || instructions.length > LIMIT.soul) throw new ConciergeError(503, 'Concierge instructions are unavailable.');
  let provider: unknown = env.EAIOS_CONCIERGE_PROVIDER;
  let model: unknown = env.EAIOS_CONCIERGE_MODEL;
  if (provider !== undefined || model !== undefined) {
    if (!provider || !model) throw new ConciergeError(503, 'Concierge needs both provider and model overrides, or neither.');
  } else {
    try {
      const config = parse(boundedFile(join(home, 'config.yaml'), 1024 * 1024), { maxAliasCount: 0, uniqueKeys: true });
      provider = config?.model?.provider; model = config?.model?.default;
      if (config?.model?.base_url) throw new Error('Custom endpoints are not supported');
    } catch { throw new ConciergeError(503, 'Concierge cannot use this model configuration. Configure a supported provider and model.'); }
  }
  if (typeof provider !== 'string' || !Object.hasOwn(PROVIDERS, provider)
    || typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,199}$/.test(model)) {
    throw new ConciergeError(503, 'Concierge supports explicitly configured OpenRouter or OpenAI API models. No alternative model was selected.');
  }
  const selected = PROVIDERS[provider as keyof typeof PROVIDERS];
  let fileEnv: Record<string, string | undefined> = {};
  try { fileEnv = parseEnv(boundedFile(join(home, '.env'), 1024 * 1024)); } catch { /* an environment key can suffice */ }
  const key = env[selected.key] ?? fileEnv[selected.key];
  if (!key || !key.trim() || /[\r\n]/.test(key)) throw new ConciergeError(503, `Concierge needs a server-side ${selected.key}. Ask your administrator to configure it securely.`);
  const revision = createHash('sha256').update(JSON.stringify([instructions, provider, model])).digest('hex');
  return { instructions, provider, model, key: key.trim(), url: selected.url, revision };
}
export function conciergeInfo(root: string, home: string): ConciergeInfo {
  const { revision, provider, model } = conciergeConfig(root, home);
  return { revision, provider, model };
}

async function boundedResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('No response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 128 * 1024) throw new Error('Response too large');
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

/** Single bounded text completion. No tools, execution loop, retries or fallback. */
export async function conciergeReply(root: string, home: string, body: Record<string, unknown>, signal: AbortSignal) {
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > LIMIT.question
    || typeof body.currentRoute !== 'string' || body.currentRoute.length > 128
    || !validConciergeHistory(body.history)) throw new ConciergeError(400, 'The question or conversation exceeds Concierge limits. Start a new chat or shorten the question.');
  const config = conciergeConfig(root, home);
  if (body.revision !== config.revision) throw new ConciergeError(409, 'Concierge instructions or model changed. Retry to start a fresh guide conversation.');
  try {
    const response = await fetch(config.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, stream: false, max_completion_tokens: 1200,
        messages: [{ role: 'system', content: config.instructions },
          ...body.history.map(row => ({ role: row.role, content: row.content })),
          { role: 'user', content: `Current page reported by the browser (not observed): ${JSON.stringify(body.currentRoute)}\n\n${body.message}` }],
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ConciergeError(response.status === 429 ? 429 : 502,
        response.status === 429 ? 'The model provider is busy or rate-limited. No retry was sent.' : 'The model provider could not answer. Check the configured model and credentials. No retry was sent.');
    }
    const data = await boundedResponse(response) as { choices?: { finish_reason?: string; message?: { content?: unknown; tool_calls?: unknown; function_call?: unknown } }[] };
    const choice = data?.choices?.[0]; const message = choice?.message;
    if (!message || message.tool_calls || message.function_call || choice?.finish_reason !== 'stop'
      || typeof message.content !== 'string' || !message.content.trim() || message.content.length > LIMIT.answer) {
      throw new ConciergeError(502, 'The provider returned an incomplete or unsupported reply. No actions were executed. Try a shorter question.');
    }
    return { revision: config.revision, answer: message.content.trim() };
  } catch (error) {
    if (error instanceof ConciergeError) throw error;
    throw new ConciergeError(502, signal.aborted ? 'Concierge request cancelled. The provider may already have processed it; no retry was sent.' : 'Concierge could not receive a reply before the connection or time limit ended. The provider may have processed the request; no retry was sent.');
  }
}
