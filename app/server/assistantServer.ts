/** A separate HTTP listener exposing only assignment-scoped assistant routes. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { handleAssistantPortal, sendJson } from './assistantPortal.ts';
export function createAssistantServer(home:string,dist:string,origin:string,port=5280) {
  const publicUrl=new URL(origin);
  if(publicUrl.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(publicUrl.hostname))throw new Error('The assistant origin must use HTTPS.');
  if(publicUrl.username||publicUrl.password||publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash)throw new Error('Use a dedicated assistant origin without a path.');
  const hosts=new Set([publicUrl.host,`127.0.0.1:${port}`,`localhost:${port}`]);
  return createServer((req,res)=>{
    res.setHeader('cache-control','no-store');
    res.setHeader('referrer-policy','no-referrer');
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if(!hosts.has(req.headers.host??'')){sendJson(res,403,{error:'Invalid assistant host.'});return;}
    const path=new URL(req.url??'/','http://localhost').pathname;
    if(path.startsWith('/api/')){void handleAssistantPortal(req,res,home);return;}
    if(!['GET','HEAD'].includes(req.method??'')){sendJson(res,405,{error:'Method not supported.'});return;}
    const asset=/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|svg|woff2?)$/.test(path);
    if(!asset&&path!=='/assistant-task'){sendJson(res,404,{error:'Not available in the assistant workspace.'});return;}
    try {
      const file=asset?join(dist,path):join(dist,'index.html');
      const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2'};
      const bytes=readFileSync(file);res.setHeader('content-type',types[extname(file)]);res.end(req.method==='HEAD'?undefined:bytes);
    }catch{sendJson(res,404,{error:'Page not found.'});}
  });
}
