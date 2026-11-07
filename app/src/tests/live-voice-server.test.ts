// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {handleLiveVoice} from '../../server/liveVoice';
afterEach(()=>vi.unstubAllGlobals());
async function call(path:string,method='GET',body='',origin='https://box.example'){
 const req=Readable.from(body?[Buffer.from(body)]:[]) as IncomingMessage;req.url=path;req.method=method;req.headers={host:'box.example',origin,'content-type':'application/json'};
 let output='';const res={statusCode:200,setHeader:vi.fn(),end:(v:string)=>{output=v;}};
 const handled=await handleLiveVoice(req,res as unknown as ServerResponse,'http://127.0.0.1:9119','secret-server-token');return {handled,status:res.statusCode,output};
}
it('bridges readiness with server credentials while filtering provider fields',async()=>{const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,available:true,mode:'gpt-live',api_key:'never-client'})});vi.stubGlobal('fetch',fetch);const r=await call('/api/audio/voice-live/status');expect(r.status).toBe(200);expect(r.output).not.toContain('never-client');expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-server-token');});
it('rejects foreign-origin paid session creation before contacting provider',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect((await call('/api/audio/voice-live/session','POST','{"sdp":"offer"}','https://evil.example')).status).toBe(403);expect(fetch).not.toHaveBeenCalled();});
it('allows only the session and status routes, not credential configuration',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect((await call('/api/audio/voice-live/credentials')).status).toBe(404);expect((await call('/api/audio/voice-live/session','GET')).status).toBe(405);expect(fetch).not.toHaveBeenCalled();});
it('validates profile and bounds request size',async()=>{vi.stubGlobal('fetch',vi.fn());expect((await call('/api/audio/voice-live/status?profile=../other')).status).toBe(400);expect((await call('/api/audio/voice-live/session','POST','x'.repeat(128001))).status).toBe(413);});
it('forwards the approved connection offer and only returns SDP and session id',async()=>{const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,session:{id:'s1',key:'secret'},transport:{type:'answer',sdp:'answer'},api_key:'secret'})});vi.stubGlobal('fetch',fetch);const r=await call('/api/audio/voice-live/session','POST','{"sdp":"offer"}');expect(JSON.parse(r.output)).toEqual({ok:true,session:{id:'s1'},transport:{type:'answer',sdp:'answer'}});expect(fetch).toHaveBeenCalledTimes(1);});
