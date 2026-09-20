// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { allyChatStream, GatewayRpcClient } from '../../server/allyGateway';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
  vi.unstubAllEnvs();
});

function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(body.length < 126 ? 2 : 4);
  header[0] = 0x81;
  header[1] = body.length < 126 ? body.length : 126;
  if (header.length === 4) header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

type Send = (type: string, payload: Record<string, unknown>, sid?: string) => void;
async function gateway(onPrompt: (send: Send, text: string) => void) {
  let nextSession = 0;
  let submissions = 0;
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    const sid = `session-${++nextSession}`;
    const send: Send = (type, payload, session = sid) => socket.write(frame({ method: 'event', params: { type, session_id: session, payload } }));
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        buffer = buffer.subarray(end + 4);
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        upgraded = true;
      }
      while (buffer.length >= 6) {
        let length = buffer[1] & 127;
        let offset = 2;
        if (length === 126) { if (buffer.length < 8) return; length = buffer.readUInt16BE(2); offset = 4; }
        if (buffer.length < offset + 4 + length) return;
        const mask = buffer.subarray(offset, offset + 4);
        const body = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
        for (let i = 0; i < length; i++) body[i] ^= mask[i % 4];
        buffer = buffer.subarray(offset + 4 + length);
        const request = JSON.parse(body.toString());
        socket.write(frame({ id: request.id, result: request.method === 'session.create' ? { session_id: sid } : { status: 'ok' } }));
        if (request.method === 'prompt.submit') {
          submissions++;
          onPrompt(send, request.params.text);
        }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  vi.stubEnv('EAIOS_HERMES_TOKEN', 'test-token');
  vi.stubEnv('EAIOS_HERMES_WS_PORT', String(port));
  return { port, submissions: () => submissions };
}

describe('Ally gateway delivery', () => {
  it('keeps an upgraded connection alive beyond its connection timeout', async () => {
    const { port } = await gateway(() => {});
    const client = new GatewayRpcClient('127.0.0.1', port, 'test-token');
    try {
      await client.connect(50);
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(client.isConnected).toBe(true);
      expect(await client.call('session.create', {}, 500)).toHaveProperty('session_id');
    } finally { client.disconnect(); }
  });

  it('delivers progress and the answer, ignores other sessions, and retains deltas on empty final text', async () => {
    await gateway(send => {
      send('message.complete', { text: 'wrong conversation' }, 'other-session');
      send('tool.start', { name: 'web_search', args: { secret: 'do not expose' } });
      send('message.delta', { text: 'The answer is 42.' });
      send('message.complete', { text: '', status: 'complete' });
    });
    const onComplete = vi.fn(), onError = vi.fn(), onProgress = vi.fn();
    await allyChatStream('question', { onComplete, onError, onProgress }, undefined, 1000);
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ text: 'The answer is 42.', finishReason: 'complete' }));
    expect(onProgress).toHaveBeenCalledWith('Using web search');
  });

  it.each(['empty', 'error', 'timeout'])('reports %s instead of completing a blank response', async kind => {
    await gateway(send => {
      if (kind !== 'timeout') send('message.complete', { text: '', status: kind === 'error' ? 'error' : 'complete' });
    });
    const onComplete = vi.fn(), onError = vi.fn();
    await allyChatStream('question', { onComplete, onError }, undefined, 50);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('isolates simultaneous requests on separate gateway connections', async () => {
    await gateway((send, text) => { setTimeout(() => send('message.complete', { text: `Answer to ${text}` }), 20); });
    const first = vi.fn(), second = vi.fn(), onError = vi.fn();
    await Promise.all([
      allyChatStream('one', { onComplete: first, onError }, undefined, 1000),
      allyChatStream('two', { onComplete: second, onError }, undefined, 1000),
    ]);
    expect(onError).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ text: 'Answer to one' }));
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ text: 'Answer to two' }));
  });
});
