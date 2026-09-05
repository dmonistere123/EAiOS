/**
 * Node bridge to the Python browser-use runner.
 *
 * The EAiOS server is not allowed to import browser_use directly (different
 * Python environment), so we spawn the uv-installed browser-use Python with
 * runner.py and exchange JSON over stdin/stdout.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TravelSearchParams, TravelSearchResult } from '../../src/adapters/interfaces.ts';
import type { Playbook, PlaybookStep } from './playbooks.ts';
import { resyCitySlug } from './playbooks.ts';

export interface BrowserJob {
  task: string;
  chromeBin?: string;
  headless?: boolean;
  cookies?: unknown[];
  llm?: {
    provider?: string;
    model?: string;
    apiKey?: string;
  };
  extractionSchema?: Record<string, unknown>;
}

export interface BrowserRunResult {
  ok: boolean;
  answer?: string;
  extracted?: unknown;
  finalUrl?: string;
  screenshot?: string;
  logs: Array<{ ts: string; action: string; detail?: string }>;
  error?: string;
}

function detectBrowserUsePython(): string {
  const env = process.env.BROWSER_USE_PYTHON;
  if (env) return env;
  const uvTool = join(
    process.env.HOME ?? '/home/ally-landry',
    '.local/share/uv/tools/browser-use/bin/python',
  );
  if (existsSync(uvTool)) return uvTool;
  const hermesVenv = join(
    process.env.HOME ?? '/home/ally-landry',
    '.hermes/hermes-agent/venv/bin/python',
  );
  if (existsSync(hermesVenv)) return hermesVenv;
  return 'python3';
}

export async function runBrowserJob(job: BrowserJob): Promise<BrowserRunResult> {
  const python = detectBrowserUsePython();
  const script = new URL('runner.py', import.meta.url).pathname;
  const child = spawn(python, [script], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
  });

  const input = JSON.stringify(job);
  child.stdin.write(input, 'utf8');
  child.stdin.end();

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  return new Promise((resolve) => {
    child.on('error', (err) => {
      resolve({
        ok: false,
        error: `Failed to spawn browser runner: ${err.message}`,
        logs: [{ ts: new Date().toISOString(), action: 'spawn_error', detail: err.message }],
      });
    });

    child.on('close', (code) => {
      const lastLine = stdout.trim().split('\n').pop() ?? stdout;
      try {
        const parsed = JSON.parse(lastLine) as BrowserRunResult;
        if (!parsed.ok && stderr) {
          parsed.error = parsed.error ? `${parsed.error}\n${stderr}` : stderr;
        }
        resolve(parsed);
      } catch {
        resolve({
          ok: false,
          error: `Browser runner exited ${code ?? 'unknown'} and returned non-JSON:\n${stdout}\nstderr:\n${stderr}`,
          logs: [{ ts: new Date().toISOString(), action: 'runner_exit', detail: `code=${code}` }],
        });
      }
    });
  });
}

function substituteParams(value: string, params: TravelSearchParams, result?: TravelSearchResult): string {
  let out = value
    .replace(/<destination>/g, (params.destination ?? ''))
    .replace(/<origin>/g, (params.origin ?? ''))
    .replace(/<checkIn>/g, (params.checkIn ?? ''))
    .replace(/<checkOut>/g, (params.checkOut ?? ''))
    .replace(/<departureDate>/g, (params.departureDate ?? ''))
    .replace(/<returnDate>/g, (params.returnDate ?? ''))
    .replace(/<date>/g, (params.date ?? ''))
    .replace(/<pickupLocation>/g, (params.pickupLocation ?? ''))
    .replace(/<dropoffLocation>/g, (params.dropoffLocation ?? ''))
    .replace(/<partySize>/g, String(params.partySize ?? '2'));
  if (result) {
    out = out
      .replace(/<externalUrl>/g, (result.externalUrl ?? ''))
      .replace(/<result\.([a-zA-Z0-9_]+)>/g, (_m, key: string) => result.meta[key] ?? '');
  }
  // Curly-brace substitutions for Resy/city-slug style URLs (no impact on
  // sites using angle-bracket params only).
  out = out
    .replace(/\{destination\}/g, params.destination ?? '')
    .replace(/\{citySlug\}/g, resyCitySlug(params.destination ?? ''))
    .replace(/\{searchDate\}/g, params.date ?? params.checkIn ?? new Date().toISOString().slice(0, 10))
    .replace(/\{partySize\}/g, String(params.partySize ?? '2'))
    .replace(/\{venueSlug\}/g, result?.meta?.venueSlug ?? '');
  return out;
}

function buildTaskFromPlaybook(playbook: Playbook, params: TravelSearchParams, mode: 'search' | 'book', result?: TravelSearchResult): string {
  const steps = mode === 'search' ? playbook.searchSteps : playbook.bookingSteps;
  const parts: string[] = [];
  parts.push(`You are booking ${playbook.kind}s on ${playbook.displayName}.`);

  if (mode === 'search') {
    parts.push(`Search parameters:`);
    if (params.destination) parts.push(`- destination: ${params.destination}`);
    if (params.origin) parts.push(`- origin: ${params.origin}`);
    if (params.checkIn) parts.push(`- check-in: ${params.checkIn}`);
    if (params.checkOut) parts.push(`- check-out: ${params.checkOut}`);
    if (params.departureDate) parts.push(`- pickup/departure: ${params.departureDate}`);
    if (params.returnDate) parts.push(`- dropoff/return: ${params.returnDate}`);
    if (params.date) parts.push(`- date: ${params.date}`);
    if (params.partySize) parts.push(`- party size: ${params.partySize}`);
  } else if (result) {
    parts.push(`The user already selected this option: ${result.title} / ${result.subtitle}. Proceed to the review page.`);
  }

  for (const step of steps) {
    const sParams = (v: string) => substituteParams(v, params, mode === 'book' ? result : undefined);
    if (step.action === 'goto') {
      parts.push(`Go to ${sParams(step.url)}.`);
    } else if (step.action === 'fill') {
      parts.push(`Fill "${step.selector}" with "${sParams(step.value)}".`);
    } else if (step.action === 'click') {
      parts.push(`Click "${step.selector}".`);
    } else if (step.action === 'wait') {
      parts.push(`Wait ${step.ms}ms.`);
    } else if (step.action === 'select') {
      parts.push(`Select "${step.value}" in "${step.selector}".`);
    } else if (step.action === 'extract' || step.action === 'extract_list') {
      parts.push(`Extract: ${sParams(step.prompt)}`);
      if (step.action === 'extract_list') {
        const itemKeys = Object.keys(step.items).join(', ');
        parts.push(`Return ONLY a JSON object with a "results" array. Each item in the array is an object with these fields: ${itemKeys}.`);
      } else {
        parts.push(`Return ONLY a JSON object matching this schema: ${JSON.stringify(step.schema)}`);
      }
    } else if (step.action === 'screenshot') {
      parts.push(`Take a screenshot.`);
    }
  }

  parts.push(`CRITICAL: Do not click any final "Book", "Pay", "Complete reservation", or "Confirm" button. Stop at the review page.`);
  return parts.join('\n');
}

export function buildSearchJob(
  playbook: Playbook,
  params: TravelSearchParams,
  cookies: unknown[],
  chromeBin?: string,
): BrowserJob {
  const schema = buildExtractionSchema(playbook.searchSteps);
  return {
    task: buildTaskFromPlaybook(playbook, params, 'search'),
    chromeBin,
    headless: true,
    cookies,
    llm: {
      provider: process.env.BROWSER_USE_LLM_PROVIDER ?? 'openrouter',
      model: process.env.BROWSER_USE_LLM_MODEL ?? 'deepseek/deepseek-v4-flash',
      apiKey: process.env.OPENROUTER_API_KEY,
    },
    extractionSchema: schema,
  };
}

export function buildBookingJob(
  playbook: Playbook,
  params: TravelSearchParams,
  result: TravelSearchResult,
  cookies: unknown[],
  chromeBin?: string,
): BrowserJob {
  const schema = buildExtractionSchema(playbook.bookingSteps);
  return {
    task: buildTaskFromPlaybook(playbook, params, 'book', result),
    chromeBin,
    headless: true,
    cookies,
    llm: {
      provider: process.env.BROWSER_USE_LLM_PROVIDER ?? 'openrouter',
      model: process.env.BROWSER_USE_LLM_MODEL ?? 'deepseek/deepseek-v4-flash',
      apiKey: process.env.OPENROUTER_API_KEY,
    },
    extractionSchema: schema,
  };
}

function buildExtractionSchema(steps: PlaybookStep[]): Record<string, unknown> | undefined {
  const extract = steps.find((s) => s.action === 'extract' || s.action === 'extract_list');
  if (!extract) return undefined;
  if (extract.action === 'extract_list') {
    const itemProps: Record<string, unknown> = {};
    const itemRequired: string[] = [];
    for (const [key, type] of Object.entries(extract.items)) {
      itemProps[key] = { type };
      itemRequired.push(key);
    }
    return {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: { type: 'object', properties: itemProps, required: itemRequired },
        },
      },
      required: ['results'],
    };
  }
  // 'extract' — flat schema
  if (!extract.schema) return undefined;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, type] of Object.entries(extract.schema)) {
    properties[key] = { type };
    required.push(key);
  }
  return {
    type: 'object',
    properties,
    required,
  };
}

export function parseSearchResults(extracted: unknown, kind: TravelSearchParams['kind']): TravelSearchResult[] {
  if (!extracted || typeof extracted !== 'object') return [];
  const obj = extracted as Record<string, unknown>;
  const raw = Array.isArray(obj.results) ? obj.results : Array.isArray(obj) ? obj : [];
  return raw
    .map((item: unknown, idx: number) => {
      if (!item || typeof item !== 'object') return null;
      const r = item as Record<string, unknown>;
      const id = `bru-${kind}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
      const title = String(r.title ?? r.hotelName ?? r.restaurantName ?? r.company ?? 'Option');
      const subtitle = String(r.subtitle ?? `${r.roomType ?? r.carType ?? r.cuisine ?? ''} · ${r.address ?? ''}`.trim());
      const price = typeof r.priceUsd === 'number' ? r.priceUsd : undefined;
      const meta: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        if (v !== undefined && v !== null) meta[k] = String(v);
      }
      return {
        id,
        kind,
        title,
        subtitle,
        priceUsd: price,
        provider: 'browser-use-consumer',
        externalUrl: r.externalUrl ? String(r.externalUrl) : undefined,
        meta,
      } as TravelSearchResult;
    })
    .filter(Boolean) as TravelSearchResult[];
}
