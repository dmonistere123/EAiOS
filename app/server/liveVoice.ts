import type { IncomingMessage, ServerResponse } from 'node:http';
/** Only the two live-voice endpoints are bridged. Long-lived provider keys stay in Hermes. */
export async function handleLiveVoice(req: IncomingMessage, res: ServerResponse, gateway: string, token: string): Promise<boolean> {
 const url = new URL(req.url ?? '/', 'http://localhost');
 if (!url.pathname.startsWith('/api/audio/voice-live/')) return false;
 res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Type','application/json');
 const fail = (status:number,error:string) => { res.statusCode=status; res.end(JSON.stringify({error})); return true; };
 const status = url.pathname === '/api/audio/voice-live/status';
 if (!status && url.pathname !== '/api/audio/voice-live/session') return fail(404,'Unknown voice endpoint');
 if (req.method !== (status ? 'GET' : 'POST')) return fail(405,'Method not allowed');
 if (!status) {
  let sameOrigin=false;
  try { sameOrigin=new URL(String(req.headers.origin)).host===req.headers.host; } catch { /* missing origin */ }
  if (!sameOrigin) return fail(403,'Voice must be started from this application');
  if (!String(req.headers['content-type']).startsWith('application/json')) return fail(415,'JSON required');
 }
 const profile=url.searchParams.get('profile');
 if (profile && !/^[a-zA-Z0-9_-]{1,80}$/.test(profile)) return fail(400,'Invalid profile');
 let body:string|undefined;
 try {
  if (!status) {
   const chunks:Buffer[]=[];let bytes=0;
   for await (const chunk of req) { bytes+=chunk.length;if(bytes>128000)return fail(413,'Voice request too large');chunks.push(Buffer.from(chunk)); }
   body=Buffer.concat(chunks).toString('utf8');const parsed=JSON.parse(body);
   if (typeof parsed.sdp!=='string'||!parsed.sdp.trim()) return fail(400,'Audio connection offer required');
  }
  const upstream=await fetch(gateway+url.pathname+(profile?'?profile='+encodeURIComponent(profile):''),{method:req.method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body,signal:AbortSignal.timeout(45000)});
  if (!upstream.ok) return fail(upstream.status,'Hermes voice is unavailable. Check its voice configuration.');
  const data=await upstream.json();
  // Explicit response fields: never proxy credentials or provider debug bodies.
  const safe=status?{ok:data.ok,mode:data.mode,available:data.available,model:data.model,voice:data.voice,reason:data.available?null:'Voice credentials unavailable'}:{ok:data.ok,session:{id:data.session?.id},transport:{sdp:data.transport?.sdp,type:data.transport?.type}};
  res.end(JSON.stringify(safe));return true;
 } catch {return fail(502,'Could not connect to Hermes voice. No automatic retry was attempted.');}
}
