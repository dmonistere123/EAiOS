/// <reference types="node" />
/**
 * allyGateway.ts — direct WS-RPC bridge from EAiOS to the Hermes gateway
 * for the My Assistant chat lane. The gateway's default profile already knows
 * it's Ally (proven: "I'm Ally, chief of staff to Don Monistere…").
 *
 * Instead of the browser speaking WS directly (current raw TCP pipe), the
 * server opens its OWN gateway WS, creates a session per prompt, submits it,
 * captures the streamed events, and returns the response to the browser via
 * a REST endpoint. This gives each chat session the FULL gateway agent
 * context (skills, memory, user profile) without spawning an anonymous agent
 * through the raw pipe.
 *
 * The sessions created here are independent (no shared history between
 * conversations). The gateway agent starts fresh each time but loads the
 * same config, skills, and memory as this Telegram session.
 */
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Local type mirroring AssistantAttachment from the UI adapter layer.
// Defined here so this server module does not need a cross-layer import.
interface BridgeAttachment {
  name: string;
  mimeType: string;
  content: string;
  encoding: 'text' | 'base64';
}

// ─── WS framing helpers (RFC 6455, text frames only) ──────────────────

/** Decode a single WebSocket frame from a buffer. Returns { opcode, payload, consumed } or null. */
function decodeWsFrame(buf: Buffer): { opcode: number; payload: Buffer; consumed: number } | null {
  if (buf.length < 2) return null;
  const first = buf[0];
  const opcode = first & 0x0f;
  const masked = !!(buf[1] & 0x80);
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;
  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + payloadLen) return null;
  let payload = buf.subarray(offset + maskLen, offset + maskLen + payloadLen);
  if (masked) {
    const mask = buf.subarray(offset, offset + 4);
    payload = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
  }
  return { opcode, payload, consumed: offset + maskLen + payloadLen };
}

/** Encode a MASKED WebSocket text frame (RFC 6455 — client-to-server frames MUST be masked). */
function encodeWsFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8');
  const len = data.length;
  // Generate random 4-byte mask
  const mask = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) mask[i] = Math.floor(Math.random() * 256);
  // Mask the payload
  const masked = Buffer.from(data.map((byte, i) => byte ^ mask[i % 4]));
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2 + 4);
    header[0] = 0x81; // FIN + text
    header[1] = 0x80 | len; // MASK bit + length
    header.set(mask, 2);
  } else if (len < 65536) {
    header = Buffer.alloc(4 + 4);
    header[0] = 0x81;
    header[1] = 0x80 | 126; // MASK bit + 126 (16-bit length follows)
    header.writeUInt16BE(len, 2);
    header.set(mask, 4);
  } else {
    header = Buffer.alloc(10 + 4);
    header[0] = 0x81;
    header[1] = 0x80 | 127; // MASK bit + 127 (64-bit length follows)
    header.writeBigUInt64BE(BigInt(len), 2);
    header.set(mask, 10);
  }
  return Buffer.concat([header, masked]);
}

// ─── RPC client ───────────────────────────────────────────────────────

interface RpcPending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class GatewayRpcClient {
  private sock: import('node:net').Socket | null = null;
  private pending = new Map<number, RpcPending>();
  private nextId = 1;
  private buf = Buffer.alloc(0);
  private host: string;
  private port: number;
  private token: string;
  private connected = false;

  constructor(host: string, port: number, token: string) {
    this.host = host;
    this.port = port;
    this.token = token;
  }

  connect(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.sock) this.sock.destroy();
      const sock = connect(this.port, this.host, () => {
        // HTTP upgrade request
        const path = `/api/ws?token=${encodeURIComponent(this.token)}`;
        const req = [
          `GET ${path} HTTP/1.1`,
          `host: ${this.host}:${this.port}`,
          'upgrade: websocket',
          'connection: upgrade',
          'sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==',
          'sec-websocket-version: 13',
          '', '',
        ].join('\r\n');
        sock.write(req);
      });

      sock.setTimeout(timeoutMs);
      let upgradeDone = false;
      let upgradeBuf = Buffer.alloc(0);

      sock.on('data', (data) => {
        if (!upgradeDone) {
          upgradeBuf = Buffer.concat([upgradeBuf, data]);
          const boundary = upgradeBuf.indexOf('\r\n\r\n');
          if (boundary !== -1) {
            const headers = upgradeBuf.subarray(0, boundary).toString();
            if (!headers.startsWith('HTTP/1.1 101 ')) {
              sock.destroy();
              reject(new Error('gateway WebSocket upgrade failed'));
              return;
            }
            upgradeDone = true;
            // The connect deadline must not become a five-second thinking deadline.
            sock.setTimeout(0);
            this.connected = true;
            this.buf = upgradeBuf.subarray(boundary + 4);
            this.processFrames();
            resolve();
          }
          return;
        }
        this.buf = Buffer.concat([this.buf, data]);
        this.processFrames();
      });

      sock.on('close', () => {
        this.connected = false;
        if (!upgradeDone) reject(new Error('gateway connection closed'));
        this.rejectAll(new Error('gateway connection closed'));
      });

      sock.on('error', (err) => {
        this.connected = false;
        if (!upgradeDone) reject(err);
        else this.rejectAll(err);
      });

      sock.on('timeout', () => {
        sock.destroy();
        if (!upgradeDone) reject(new Error('gateway connect timeout'));
      });

      this.sock = sock;
    });
  }

  private processFrames(): void {
    while (this.buf.length > 0) {
      const frame = decodeWsFrame(this.buf);
      if (!frame) break;
      this.buf = this.buf.subarray(frame.consumed);
      if (frame.opcode === 0x8) {
        // close frame
        this.sock?.destroy();
        this.rejectAll(new Error('gateway closed connection'));
        return;
      }
      if (frame.opcode === 0x9) {
        // ping — reply pong
        const pong = Buffer.alloc(2);
        pong[0] = 0x8a;
        pong[1] = 0;
        this.sock?.write(pong);
        continue;
      }
      if (frame.opcode === 0x1) {
        const text = frame.payload.toString('utf8');
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(text); } catch { continue; }
        // RPC response or notification
        if (msg.id !== undefined && msg.id !== null) {
          const id = Number(msg.id);
          const p = this.pending.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(id);
            if (msg.error) p.reject(new Error(String((msg.error as Record<string, unknown>).message ?? 'RPC error')));
            else p.resolve(msg.result);
          }
        }
        // Notifications (events like message.start/delta/complete)
        if (msg.method === 'event' && msg.params) {
          this.onEvent?.(msg.params as Record<string, unknown>);
        }
      }
    }
  }

  onEvent: ((params: Record<string, unknown>) => void) | null = null;

  async call(method: string, params: Record<string, unknown>, timeoutMs = 120_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.sock?.write(encodeWsFrame(payload));
    });
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  get isConnected(): boolean { return this.connected; }

  disconnect(): void {
    this.onEvent = null;
    this.sock?.destroy();
    this.sock = null;
    this.connected = false;
  }
}

// ─── Token loader ─────────────────────────────────────────────────────

function loadGatewayToken(): string {
  // Try env first
  if (process.env.EAIOS_HERMES_TOKEN) return process.env.EAIOS_HERMES_TOKEN;
  // Try the token file
  try {
    const file = process.env.EAIOS_HERMES_TOKEN_FILE ?? join(homedir(), '.hermes', '.eaios-dev-token');
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

// ─── Per-request RPC client ────────────────────────────────────────────

function getClient(): GatewayRpcClient | null {
  const host = process.env.EAIOS_HERMES_WS_HOST ?? '127.0.0.1';
  const port = Number(process.env.EAIOS_HERMES_WS_PORT ?? 9119);
  const token = loadGatewayToken();
  if (!token) return null;
  return new GatewayRpcClient(host, port, token);
}

// ─── Public API ───────────────────────────────────────────────────────

export interface AllyChatResult {
  text: string;
  finishReason: string;
  sessionId?: string;
  error?: string;
}

export interface AllyChatStreamCallbacks {
  onStart?: () => void;
  onDelta?: (text: string) => void;
  onProgress?: (text: string) => void;
  onComplete?: (result: AllyChatResult) => void;
  onError?: (error: string) => void;
}

export interface AllyChatOptions {
  /** Hermes profile to run Ally on (default profile when omitted). */
  profile?: string;
  attachments?: BridgeAttachment[];
  timeoutMs?: number;
}

/**
 * Send a prompt to the Ally gateway session and return the complete response.
 * Creates a new session on the configured profile each call (no shared history).
 */
export async function allyChat(text: string, options: AllyChatOptions = {}): Promise<AllyChatResult> {
  let result: AllyChatResult = { text: '', finishReason: 'error', error: 'No response received.' };
  await allyChatStream(text, {
    onComplete: (value) => { result = value; },
    onError: (error) => { result = { text: '', finishReason: 'error', error }; },
  }, options);
  return result;
}

/** Stream one isolated gateway turn. Only events belonging to its session are forwarded. */
export async function allyChatStream(
  text: string,
  callbacks: AllyChatStreamCallbacks,
  options: AllyChatOptions = {},
): Promise<void> {
  const { profile, attachments, timeoutMs = 1_200_000 } = options; // 20 min: real tool-using Ally turns take 2-70 min; 120s watchdog stranded completed replies in orphaned sessions (t_9fea4c72)
  const attachmentBlock = attachments?.length
    ? '\n\n--- attached documents ---\n' + attachments.map((a) => `File: ${a.name}\n${a.encoding === 'base64' ? '[base64 content omitted]' : a.content}`).join('\n---\n')
    : '';
  const fullText = text + attachmentBlock;
  if (!fullText.trim()) {
    callbacks.onError?.('text or attachments are required');
    return;
  }
  const client = getClient();
  if (!client) {
    callbacks.onError?.('gateway token not configured');
    return;
  }
  let sessionId: string | undefined;
  let complete = false;
  try {
    await client.connect(5_000);
    const createParams: Record<string, unknown> = { title: 'EAiOS — My Assistant' };
    if (profile) createParams.profile = profile;
    const created = await client.call('session.create', createParams) as { session_id?: string };
    sessionId = created.session_id;
    if (!sessionId) throw new Error('failed to create gateway session');

    let responseText = '';
    let failure: string | undefined;
    client.onEvent = (params) => {
      if (String(params.session_id ?? params.sid ?? '') !== sessionId) return;
      const type = String(params.type ?? '');
      const payload = (params.payload ?? {}) as Record<string, unknown>;
      if (type === 'message.delta' && typeof payload.text === 'string') {
        responseText += payload.text;
        callbacks.onDelta?.(payload.text);
      } else if (type === 'message.complete') {
        if (typeof payload.text === 'string' && payload.text.trim()) responseText = payload.text;
        if (payload.status && payload.status !== 'complete') failure = 'Ally could not finish this response.';
        complete = true;
      } else if (type === 'turn.error' || type === 'error') {
        failure = String(payload.message ?? params.message ?? 'Ally could not finish this response.');
        complete = true;
      } else if (type === 'tool.start' || type === 'tool.complete') {
        const name = typeof payload.name === 'string' ? payload.name.replace(/_/g, ' ').slice(0, 80) : 'a tool';
        callbacks.onProgress?.(`${type === 'tool.start' ? 'Using' : 'Finished'} ${name}`);
      } else if (type === 'status.update' || type === 'message.interim') {
        if (typeof payload.text === 'string' && payload.text.trim()) callbacks.onProgress?.(payload.text.slice(0, 500));
      } else if (type === 'reasoning.delta' || type === 'thinking.delta') {
        callbacks.onProgress?.('Thinking through your question…');
      }
    };
    callbacks.onStart?.();
    const deadline = Date.now() + timeoutMs;
    await client.call('prompt.submit', { session_id: sessionId, text: fullText }, timeoutMs);
    while (!complete && Date.now() < deadline) {
      if (!client.isConnected) throw new Error('The connection to Ally was interrupted. Check Conversations for a saved reply before retrying.');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!complete) throw new Error('Ally is taking longer than expected. Check Conversations for a saved reply before retrying.');
    if (failure) throw new Error(failure);
    if (!responseText.trim()) throw new Error('Ally returned no text. Please try again or check Conversations.');
    callbacks.onComplete?.({ text: responseText, finishReason: 'complete', sessionId });
  } catch (error) {
    callbacks.onError?.(error instanceof Error ? error.message : String(error));
  } finally {
    // Do not close a still-running turn on timeout; its saved reply can be recovered.
    if (sessionId && complete && client.isConnected) {
      try { await client.call('session.close', { session_id: sessionId }, 5_000); } catch { /* best effort */ }
    }
    client.disconnect();
  }
}
