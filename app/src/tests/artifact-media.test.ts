// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sendArtifactBytes } from '../../server/artifactMedia';
function response(range?: string, method = 'GET', ifRange?: string) {
  const headers: Record<string,string> = {};
  let body: string | Buffer = '';
  const res = { statusCode: 0, setHeader: (k: string,v: string) => { headers[k] = v; }, end: (b: string | Buffer) => { body = b; } };
  sendArtifactBytes({method,headers:{range,'if-range':ifRange}},res,Buffer.from('0123456789'));
  return {status:res.statusCode,headers,body:String(body)};
}
describe('artifact media byte ranges',()=>{
 it('serves full bytes and HEAD metadata',()=>{
  expect(response()).toEqual({status:200,headers:{'Accept-Ranges':'bytes','Content-Length':'10'},body:'0123456789'});
  expect(response(undefined,'HEAD').body).toBe('');
  expect(response(undefined,'HEAD').headers['Content-Length']).toBe('10');
 });
 it.each([['bytes=2-5','2345','bytes 2-5/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-3','789','bytes 7-9/10'],['bytes=8-99','89','bytes 8-9/10'],['bytes=-99','0123456789','bytes 0-9/10']])('serves %s',(range,body,contentRange)=>{
  const r=response(range);expect(r.status).toBe(206);expect(r.body).toBe(body);expect(r.headers['Content-Range']).toBe(contentRange);expect(r.headers['Content-Length']).toBe(String(body.length));
 });
 it.each(['bytes=10-','bytes=5-2','bytes=-0','bytes=99999999999999999-'])('rejects unsatisfiable %s',range=>{
  const r=response(range);expect(r.status).toBe(416);expect(r.body).toBe('');expect(r.headers['Content-Range']).toBe('bytes */10');
 });
 it.each(['bytes=1-2,4-5','cats=1-2','bytes=-','bytes=garbage'])('ignores unsupported %s',range=>{expect(response(range).status).toBe(200);expect(response(range).body).toBe('0123456789');});
 it('returns complete content when an If-Range validator cannot be matched',()=>{expect(response('bytes=2-5','GET','"old"').status).toBe(200);});
});
