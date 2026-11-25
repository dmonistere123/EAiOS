/** Read-only bridges for explicitly provisioned staging roots. No profile discovery,
 * network calls, task mutations, or production authorization assumptions. */
import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,readSync,fstatSync,realpathSync,constants} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import type {DcrArtifact,DcrArtifactPreview,DcrConnections,DcrWork,DcrWorkKind} from '../src/domain/dcr.ts';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value:unknown,max=500)=>typeof value==='string'?value.slice(0,max):'';
type Attachment={id:number;filename:string;stored_path:string;content_type:string|null;task_title:string|null;task_id:string;created_at:number};
export class DcrConnectionsReader {
  private readonly roots:{kanban:string;attachments:string;human:string};
  readonly label:string;
  constructor(roots:{kanban:string;attachments:string;human:string},label='Isolated staging examples'){this.roots=roots;this.label=label;}
  private read<T>(file:string,fn:(db:DatabaseSync)=>T):T {
    const db=new DatabaseSync(file,{readOnly:true});
    try {db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000');return fn(db);}finally{db.close();}
  }
  private attachments(id?:number):Attachment[]{
    return this.read(this.roots.kanban,db=>db.prepare(`SELECT a.id,a.filename,a.stored_path,a.content_type,a.task_id,a.created_at,t.title AS task_title
      FROM task_attachments a LEFT JOIN tasks t ON t.id=a.task_id ${id===undefined?'ORDER BY a.created_at DESC LIMIT 100':'WHERE a.id=?'}`).all(...(id===undefined?[]:[id])) as unknown as Attachment[]);
  }
  private supported(row:Attachment){return ['text/plain','text/markdown','text/csv','application/json'].includes(row.content_type??'')||(!row.content_type&&/\.(txt|md|csv|json)$/i.test(row.filename));}
  private metadata(row:Attachment):DcrArtifact{return {id:`att-${row.id}`,title:text(row.filename,300),taskTitle:text(row.task_title)};}
  artifactPage(after=0){return this.read(this.roots.kanban,db=>db.prepare('SELECT id,filename,content_type FROM task_attachments WHERE id>? ORDER BY id LIMIT 50').all(after)).map(r=>({id:Number(r.id),supported:this.supported(r as Attachment)}));}
  artifact(id:string):DcrArtifactPreview {
    if(!/^att-[1-9]\d*$/.test(id))throw Error('Invalid Artifact reference.');
    const row=this.attachments(Number(id.slice(4)))[0];
    if(!row||!this.supported(row))throw Error('Artifact unavailable or unsupported. Choose a current text Artifact.');
    const root=realpathSync(this.roots.attachments),file=resolve(row.stored_path);
    // Reject traversal, final and intermediate symlinks, including a link to another
    // file inside the root. Read through one no-follow descriptor with a fixed bound.
    if(!file.startsWith(root+sep)||realpathSync(file)!==file)throw Error('Artifact is outside the permitted storage.');
    const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      if(process.platform==='linux'&&realpathSync(`/proc/self/fd/${fd}`)!==file)throw Error('Artifact storage changed while opening.');
      const before=fstatSync(fd);
      if(!before.isFile()||before.size>60000)throw Error('Choose a text Artifact up to 20,000 characters (60 KB).');
      const bytes=Buffer.alloc(60001);let length=0,count=0;
      do {count=readSync(fd,bytes,length,bytes.length-length,null);length+=count;}while(count&&length<bytes.length);
      const after=fstatSync(fd);
      if(length>60000||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('Artifact changed while reading. Preview it again.');
      const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
      if(!content.trim()||content.length>20000||content.includes('\0'))throw Error('Choose a nonempty UTF-8 text Artifact up to 20,000 characters.');
      return {...this.metadata(row),text:content,version:hash({row,content,ino:after.ino,dev:after.dev,mtime:after.mtimeMs,ctime:after.ctimeMs})};
    }finally{closeSync(fd);}
  }
  private tasks(id?:string):DcrWork[]{
    return this.read(this.roots.kanban,db=>db.prepare(`SELECT id,title,status,assignee,result FROM tasks ${id===undefined?'ORDER BY created_at DESC LIMIT 100':'WHERE id=?'}`).all(...(id===undefined?[]:[id])).map(row=>{
      const work={kind:'task' as const,id:String(row.id),title:text(row.title),status:text(row.status),owner:text(row.assignee),summary:text(row.result,4000)};
      return {...work,version:hash(work)};
    }));
  }
  private humans(id?:string):DcrWork[]{
    return this.read(this.roots.human,db=>db.prepare(`SELECT d.id,d.body,c.body AS contact FROM human_delegations d
      LEFT JOIN human_contacts c ON c.id=d.contact_id ${id===undefined?'ORDER BY d.rowid DESC LIMIT 100':'WHERE d.id=?'}`).all(...(id===undefined?[]:[id])).map(row=>{
      const d=JSON.parse(String(row.body)),contact=row.contact?JSON.parse(String(row.contact)):{};
      const work={kind:'human' as const,id:String(row.id),title:text(d.package?.subject)||`Human delegation · ${text(d.workItemId)}`,status:text(d.status),owner:text(contact.displayName),summary:text(d.completionNote,4000)};
      return {...work,version:hash({...work,revision:d.revision,workItemId:d.workItemId})};
    }));
  }
  work(kind:DcrWorkKind,id:string):DcrWork|null {
    try{return (kind==='task'?this.tasks(id):kind==='human'?this.humans(id):[]).find(w=>w.id===id)??null;}catch{return null;}
  }
  catalog():DcrConnections {
    const result:DcrConnections={label:this.label,artifacts:[],work:[],errors:[]};
    try{result.artifacts=this.attachments().filter(r=>this.supported(r)).map(r=>this.metadata(r));}catch{result.errors.push('Artifacts are unavailable.');}
    try{result.work.push(...this.tasks());}catch{result.errors.push('Agent tasks are unavailable.');}
    try{result.work.push(...this.humans());}catch{result.errors.push('Human delegations are unavailable.');}
    return result;
  }
}
