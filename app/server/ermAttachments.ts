import type { IncomingMessage,ServerResponse } from 'node:http';
import { createHash,randomUUID } from 'node:crypto';
import { ErmError } from '../src/domain/erm.ts';
import { ErmStore,ERM_OWNER } from './ermStore.ts';
const MAX_BYTES=10*1024*1024,MAX_FILES=5;
interface Attachment {id:string;name:string;size:number;createdAt:string}
function requireNote(db:Parameters<Parameters<ErmStore['transaction']>[0]>[0],contact:string,note:string){
 if(!db.prepare('SELECT 1 FROM erm_notes WHERE owner=? AND contact_id=? AND id=?').get(ERM_OWNER,contact,note))throw new ErmError(404,'not_found','Note not found.');
 db.exec('CREATE TABLE IF NOT EXISTS erm_note_attachments(owner TEXT NOT NULL,note_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(owner,note_id,id),UNIQUE(owner,note_id,request_id),FOREIGN KEY(owner,note_id) REFERENCES erm_notes(owner,id));');
}
const safeName=(name:string)=>Array.from(name).map(c=>/[\uD800-\uDFFF]/u.test(c)&&c.length===1?'_':c).join('');
export async function ermAttachmentRoute(req:IncomingMessage,res:ServerResponse,store:ErmStore,url:URL,contact:string,note:string,id?:string){
 const json=(status:number,value:unknown)=>{res.statusCode=status;res.end(JSON.stringify(value));};
 const dbList='SELECT id,name,size,created_at AS createdAt FROM erm_note_attachments WHERE owner=? AND note_id=?';
 if(req.method==='GET'&&!id){json(200,store.transaction(db=>{requireNote(db,contact,note);return db.prepare(dbList+' ORDER BY created_at,id').all(ERM_OWNER,note);}));return;}
 if(req.method==='GET'&&id){
  const row=store.transaction(db=>{requireNote(db,contact,note);return db.prepare('SELECT name,bytes FROM erm_note_attachments WHERE owner=? AND note_id=? AND id=?').get(ERM_OWNER,note,id) as {name:string;bytes:Uint8Array}|undefined;});
  if(!row)throw new ErmError(404,'not_found','Attachment not found.');
  const file=safeName(row.name);const encoded=encodeURIComponent(file).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
  res.statusCode=200;res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename="attachment"; filename*=UTF-8''${encoded}`);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Length',row.bytes.byteLength);res.end(Buffer.from(row.bytes));return;
 }
 if(req.method!=='POST'||id)throw new ErmError(405,'method','Method not supported.');
 if(!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host)throw new ErmError(403,'origin','Use E-CRM from this application.');
 if(req.headers['content-type']!=='application/octet-stream')throw new ErmError(415,'type','Upload an attachment as a file.');
 const name=(url.searchParams.get('name')??'').trim(),requestId=url.searchParams.get('requestId')??'';
 if(!name||name.length>255||/[\u0000-\u001f\u007f/\\]/.test(name)||!/^[-\w]{1,100}$/.test(requestId))throw new ErmError(400,'invalid_attachment','Choose a file with a valid name.');
 if(Number(req.headers['content-length'])>MAX_BYTES)throw new ErmError(413,'too_large','Attachments must be 10 MB or smaller.');
 let size=0; const chunks:Buffer[]=[];
 for await(const chunk of req){size+=chunk.length;if(size>MAX_BYTES)throw new ErmError(413,'too_large','Attachments must be 10 MB or smaller.');chunks.push(Buffer.from(chunk));}
 if(!size)throw new ErmError(400,'empty','Choose a non-empty attachment.');
 const bytes=Buffer.concat(chunks),digest=createHash('sha256').update(bytes).digest('hex');
 const saved=store.transaction(db=>{
  requireNote(db,contact,note);
  const prior=db.prepare(dbList.replace(' AS createdAt',' AS createdAt,digest')+' AND request_id=?').get(ERM_OWNER,note,requestId) as (Attachment&{digest:string})|undefined;
  if(prior){if(prior.digest!==digest||prior.name!==name)throw new ErmError(409,'changed','This attachment changed. Choose it again.');return {id:prior.id,name:prior.name,size:prior.size,createdAt:prior.createdAt};}
  const count=Number(db.prepare('SELECT count(*) AS n FROM erm_note_attachments WHERE owner=? AND note_id=?').get(ERM_OWNER,note)?.n);
  if(count>=MAX_FILES)throw new ErmError(409,'attachment_limit','Up to five files can be stored per note.');
  const id=randomUUID(),createdAt=new Date().toISOString();
  db.prepare('INSERT INTO erm_note_attachments VALUES(?,?,?,?,?,?,?,?,?)').run(ERM_OWNER,note,id,name,size,createdAt,requestId,digest,bytes);
  return {id,name,size,createdAt};
 });
 json(201,saved);
}
