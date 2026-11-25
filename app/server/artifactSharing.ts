/** Approved public snapshots. Publication is a deterministic server operation,
 * never a runnable AI task. The existing kanban backup includes snapshots. */
import { DatabaseSync } from 'node:sqlite';
import { constants, closeSync, existsSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep, basename } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { releaseArtifact } from './releaseArtifacts.ts';
import { ApprovalGateError } from './approvalGate.ts';
import type { ApiContext } from './httpApi.ts';

interface Hosting { sshConfig: string; sshHost: string; remoteRoot: string; publicBaseUrl: string }
interface ShareRow { id: string; artifact_id: string; task_id: string; filename: string; mime: string; sha256: string; content: Uint8Array; hosting: string; status: string; url: string | null; error: string | null; updated_at: number }
const LIMIT = 100 * 1024 * 1024;
function fail(message: string): never { throw new ApprovalGateError(message); }
function hash(data: Uint8Array | string) { return createHash('sha256').update(data).digest('hex'); }
function database(home: string) {
  const db = new DatabaseSync(join(home, 'kanban.db'));
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS eaios_artifact_shares (
      id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, task_id TEXT UNIQUE NOT NULL,
      filename TEXT NOT NULL, mime TEXT NOT NULL, sha256 TEXT NOT NULL, content BLOB NOT NULL,
      hosting TEXT NOT NULL, status TEXT NOT NULL, url TEXT, error TEXT, updated_at INTEGER NOT NULL
    );`);
  return db;
}
export function sharingConfig(home: string): Hosting {
  let c: Hosting;
  try { c = JSON.parse(readFileSync(join(home, 'eaios', 'artifact-sharing.json'), 'utf8')); }
  catch { return fail('Public sharing is not configured on this box yet. Your artifact remains private.'); }
  let url: URL;
  try { url = new URL(c.publicBaseUrl); } catch { return fail('Public sharing URL is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(c.sshHost ?? '') ||
      typeof c.sshConfig !== 'string' || !c.sshConfig.startsWith('/') || !existsSync(c.sshConfig) ||
      !/^\/(?:[A-Za-z0-9_-]+\/)+eaios-shares$/.test(c.remoteRoot ?? '') ||
      !url.pathname.replace(/\/$/, '').endsWith('/eaios-shares')) fail('Public sharing configuration is incomplete.');
  return { sshConfig: c.sshConfig, sshHost: c.sshHost, remoteRoot: c.remoteRoot, publicBaseUrl: url.href.replace(/\/$/, '') };
}
function snapshot(ctx: ApiContext, id: string) {
  const release = releaseArtifact(ctx, id);
  if (release) return { filename: release.filename, mime: 'text/markdown', content: Buffer.from(release.content), agent: 'default' };
  if (!/^att-[1-9]\d*$/.test(id)) fail('Artifact not found.');
  const db = new DatabaseSync(join(ctx.hermesHome, 'kanban.db'), { readOnly: true });
  try {
    const row = db.prepare('SELECT a.*, t.assignee FROM task_attachments a LEFT JOIN tasks t ON t.id=a.task_id WHERE a.id=?').get(Number(id.slice(4)));
    if (!row) fail('Artifact not found.');
    const root = realpathSync(join(ctx.hermesHome, 'kanban', 'attachments'));
    const path = resolve(String(row.stored_path));
    if (!root.startsWith(realpathSync(ctx.hermesHome) + sep) || !path.startsWith(root + sep) || realpathSync(path) !== path) fail('Artifact is outside private storage.');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size === 0 || stat.size > LIMIT) fail('Share a nonempty artifact smaller than 100 MB.');
      const content = readFileSync(fd);
      if (!content.length || content.length > LIMIT) fail('Artifact size changed. Try again.');
      // eslint-disable-next-line no-control-regex -- strip controls from download filenames
      return { filename: basename(String(row.filename).replaceAll('\\','/')).replace(/[\x00-\x1f\x7f:]/g, '_').replace(/^\.+$/, 'artifact').slice(0, 200) || 'artifact', mime: String(row.content_type ?? 'application/octet-stream'), content, agent: String(row.assignee || 'default') };
    } finally { closeSync(fd); }
  } finally { db.close(); }
}
export function requestArtifactShare(ctx: ApiContext, artifactId: string) {
  const hosting = sharingConfig(ctx.hermesHome), file = snapshot(ctx, artifactId), sha = hash(file.content);
  const db = database(ctx.hermesHome);
  try {
    db.exec('BEGIN IMMEDIATE');
    const existing = db.prepare("SELECT id,task_id,status FROM eaios_artifact_shares WHERE artifact_id=? AND sha256=? AND hosting=? AND status IN ('pending','uploading','uncertain','published') ORDER BY updated_at DESC LIMIT 1").get(artifactId, sha, JSON.stringify(hosting));
    if (existing) { db.exec('COMMIT'); return { ok: true, auditEventId: String(existing.task_id), status: String(existing.status) }; }
    const id = randomBytes(24).toString('hex'), taskId = `share_${id}`, now = Math.floor(Date.now()/1000);
    const text = /^(text\/|application\/(json|csv))/.test(file.mime) ? file.content.toString('utf8').slice(0, 12000) : '';
    const env = { eaios: 'approval', actionType: 'publish', targetSystem: 'artifact-public-link', targetObject: file.filename, risk: 'high', requestedBy: file.agent,
      artifactShare: { id, filename: file.filename, sizeBytes: file.content.length, sha256: sha },
      evidence: [{ kind: 'artifact', label: file.filename, uri: `eaios://artifact/${artifactId}` }],
      payload: `Publish a copy of ${file.filename} (${file.content.length} bytes) at ${hosting.publicBaseUrl}.\nAnyone with the link can view or download this copy.\nSHA-256: ${sha}\n\n${text ? 'Content preview (first 12,000 characters):\n' + text : 'Binary artifact. Review the saved snapshot using the download link before approving.'}`,
      rollbackPlan: 'An administrator can remove this public copy from website hosting. Downloads already made by recipients cannot be recalled. The original local artifact remains private.' };
    db.prepare('INSERT INTO eaios_artifact_shares (id,artifact_id,task_id,filename,mime,sha256,content,hosting,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, artifactId, taskId, file.filename, file.mime, sha, file.content, JSON.stringify(hosting), 'pending', now);
    db.prepare("INSERT INTO tasks (id,title,body,status,assignee,block_kind,created_by,created_at) VALUES(?,?,?,'blocked',NULL,'needs_input','eaios-executive',?)").run(taskId, `Create public link: ${file.filename}`, JSON.stringify(env), now);
    db.prepare('INSERT INTO task_events (task_id,kind,payload,created_at) VALUES(?,?,?,?)').run(taskId, 'approval_requested', JSON.stringify({ actor: 'eaios-executive', shareId: id }), now);
    db.exec('COMMIT');
    return { ok: true, auditEventId: taskId, status: 'pending' };
  } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; } finally { db.close(); }
}
export function publicShares(home: string) {
  const db = new DatabaseSync(join(home, 'kanban.db'), { readOnly: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='eaios_artifact_shares'").get()) return [];
    return db.prepare('SELECT id,artifact_id AS artifactId,filename,status,url,error,updated_at AS updatedAt FROM eaios_artifact_shares ORDER BY updated_at DESC').all();
  } finally { db.close(); }
}
export function shareSnapshot(home: string, id: string) {
  const db = database(home);
  try { return db.prepare('SELECT filename,content FROM eaios_artifact_shares WHERE id=?').get(id) as {filename:string;content:Uint8Array}|undefined; } finally { db.close(); }
}
function escapeHtml(s: string) { return s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!); }
/** Store the original inside a ZIP: arbitrary HTML/PHP cannot run on the website. */
export function artifactZip(filename: string, content: Buffer) {
  const name = Buffer.from(filename), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  let crc = 0xffffffff;
  for (const byte of content) { crc ^= byte; for (let k=0;k<8;k++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  crc=(crc^0xffffffff)>>>0;
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6); local.writeUInt16LE(33,12); local.writeUInt32LE(crc,14); local.writeUInt32LE(content.length,18); local.writeUInt32LE(content.length,22); local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0x800,8); central.writeUInt16LE(33,14); central.writeUInt32LE(crc,16); central.writeUInt32LE(content.length,20); central.writeUInt32LE(content.length,24); central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length+name.length,12); end.writeUInt32LE(local.length+name.length+content.length,16);
  return Buffer.concat([local,name,content,central,name,end]);
}
export function publicPage(row: Pick<ShareRow,'filename'|'mime'|'content'>) {
  const title=escapeHtml(row.filename), content=Buffer.from(row.content), text=content.toString('utf8');
  const preview=content.length>2*1024*1024 ? '<p>Download the file below to view its complete contents.</p>' : row.mime==='text/html' ? `<iframe title="Artifact preview" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeHtml(text)}"></iframe>` : /^(text\/|application\/(json|csv))/.test(row.mime) ? `<pre>${escapeHtml(text)}</pre>` : '<p>This artifact is available to download.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src 'self' about:; img-src data:; base-uri 'none'; form-action 'none'"><title>${title}</title><style>body{background:#0b1220;color:#e2e8f0;font:16px system-ui;margin:0;padding:32px}main{max-width:1100px;margin:auto}h1{overflow-wrap:anywhere;font-size:24px}a{display:inline-block;color:#38bdf8;margin:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}iframe{width:100%;height:75vh;border:0;background:white}.muted{color:#94a3b8}</style></head><body><main><p class="muted">Shared with EAiOS</p><h1>${title}</h1><p>This is a shared copy. Anyone with this link can access it.</p><a href="artifact.zip" download="${title}.zip">Download original file (ZIP)</a>${preview}</main></body></html>`;
}
export const remoteScript = `import os,sys,json,base64,hashlib,tempfile,shutil,re
p=json.load(sys.stdin)
root=p['root']; token=p['id']; files=p['files']
assert re.fullmatch(r'[a-f0-9]{48}',token)
assert root.endswith('/eaios-shares') and os.path.realpath(os.path.dirname(root))==os.path.dirname(root)
os.makedirs(root,mode=0o755,exist_ok=True)
assert os.path.realpath(root)==root
# Prevent the public share root from exposing a directory of private link tokens.
index=os.path.join(root,'index.html')
if not os.path.exists(index):
 with open(index,'x') as f: f.write('<!doctype html><meta name=robots content=noindex,nofollow><title>Shared files</title><p>A complete sharing link is required.</p>')
 os.chmod(index,0o644)
final=os.path.join(root,token)
if os.path.exists(final):
 assert os.path.realpath(final)==final
 for name,data in files.items():
  path=os.path.join(final,name)
  assert not os.path.islink(path)
  assert hashlib.sha256(open(path,'rb').read()).hexdigest()==hashlib.sha256(base64.b64decode(data)).hexdigest()
else:
 stage=tempfile.mkdtemp(prefix='.pending-',dir=root)
 try:
  for name,data in files.items():
   assert name in ['index.html','artifact.zip']
   path=os.path.join(stage,name)
   with open(path,'xb') as f: f.write(base64.b64decode(data))
   os.chmod(path,0o644)
  os.chmod(stage,0o755)
  os.rename(stage,final)
 finally:
  if os.path.exists(stage): shutil.rmtree(stage)
print('published')`;
export async function uploadShare(row: ShareRow) {
  const config: Hosting = JSON.parse(row.hosting);
  const payload=JSON.stringify({root:config.remoteRoot,id:row.id,files:{'index.html':Buffer.from(publicPage(row)).toString('base64'),'artifact.zip':artifactZip(row.filename,Buffer.from(row.content)).toString('base64')}});
  await new Promise<void>((resolvePromise,reject)=>{
    const child=spawn('ssh',['-F',config.sshConfig,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',config.sshHost,`python3 -c '${remoteScript.replace(/'/g,"'\\''")}'`],{stdio:['pipe','pipe','pipe']});
    let output=''; const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Upload timed out.'));},120000);
    child.stdout.on('data',chunk=>{output+=String(chunk);});child.stderr.resume();child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Upload connection unavailable.'));});
    child.on('close',code=>{clearTimeout(timer);if(code===0&&output.trim()==='published')resolvePromise();else reject(new Error('Upload not confirmed.'));});
    child.stdin.end(payload);
  });
  return `${config.publicBaseUrl}/${row.id}/`;
}
export async function decideArtifactShare(ctx: ApiContext, taskId: string, input: Record<string,unknown>, uploader=uploadShare) {
  // Read without creating tables for ordinary approval traffic.
  const read=new DatabaseSync(join(ctx.hermesHome,'kanban.db'),{readOnly:true});
  let match=false;
  try { match=!!read.prepare("SELECT 1 FROM sqlite_master WHERE name='eaios_artifact_shares'").get() && !!read.prepare('SELECT 1 FROM eaios_artifact_shares WHERE task_id=?').get(taskId); } finally { read.close(); }
  if(!match)return undefined;
  const db=database(ctx.hermesHome);let row:ShareRow;
  try {
    db.exec('BEGIN IMMEDIATE');
    row=db.prepare('SELECT * FROM eaios_artifact_shares WHERE task_id=?').get(taskId) as unknown as ShareRow;
    const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId)!;
    const env=JSON.parse(String(task.body));
    if(!['approved','rejected','changes_requested'].includes(String(input.decision)))fail('Invalid sharing decision.');
    if(row.status==='published'&&input.decision==='approved'){db.exec('COMMIT');return {ok:true,auditEventId:taskId,publicUrl:row.url};}
    if(row.status!=='pending')fail('This share has already been decided. Check its status in Artifacts.');
    if(task.body!==input.expectedBody)fail('The share changed. Review it again before deciding.');
    if(task.status!=='blocked'||task.assignee||task.claim_lock||task.current_run_id||env.decision||env.artifactShare?.id!==row.id)fail('This share is not awaiting approval.');
    if(hash(row.content)!==row.sha256)fail('The saved snapshot failed verification. Create a new share.');
    const now=Math.floor(Date.now()/1000);
    if(input.decision==='approved'&&JSON.stringify(sharingConfig(ctx.hermesHome))!==row.hosting)fail('Hosting changed. Create a new share approval.');
    if(input.decision==='approved' && db.prepare("SELECT 1 FROM sqlite_master WHERE name='task_links'").get() && db.prepare("SELECT 1 FROM task_links l JOIN tasks t ON t.id=l.parent_id WHERE l.child_id=? AND t.status NOT IN ('done','archived') LIMIT 1").get(taskId))fail('A prerequisite is unfinished. The share remains private.');
    const next=input.decision==='approved'?'uploading':String(input.decision);
    db.prepare('UPDATE eaios_artifact_shares SET status=?,updated_at=? WHERE id=?').run(next,now,row.id);
    db.prepare('UPDATE tasks SET body=?,assignee=NULL WHERE id=?').run(JSON.stringify({...env,decision:input.decision,decidedAt:new Date().toISOString()}),taskId);
    db.prepare('INSERT INTO task_events (task_id,kind,payload,created_at) VALUES(?,?,?,?)').run(taskId,'approval_decided',JSON.stringify({decision:input.decision,actor:'eaios-executive'}),now);
    db.exec('COMMIT');
    if(input.decision!=='approved')return {ok:true,auditEventId:taskId};
  } catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}
  return finishUpload(ctx.hermesHome,row!,uploader);
}
async function finishUpload(home:string,row:ShareRow,uploader:typeof uploadShare){
  let url:string;
  try { url=await uploader(row); }
  catch {
    const db=database(home);try{db.prepare("UPDATE eaios_artifact_shares SET status='uncertain',error=?,updated_at=? WHERE id=?").run('Publication was not confirmed. Retry checks the same public copy; it does not create another link.',Math.floor(Date.now()/1000),row.id);}finally{db.close();}
    fail('Publication was not confirmed. Open Artifacts to check or retry this approved share.');
  }
  const db=database(home);
  try{
    db.exec('BEGIN IMMEDIATE');
    db.prepare("UPDATE eaios_artifact_shares SET status='published',url=?,error=NULL,updated_at=? WHERE id=?").run(url,Math.floor(Date.now()/1000),row.id);
    db.prepare("UPDATE tasks SET status='done',completed_at=?,result=?,assignee=NULL WHERE id=?").run(Math.floor(Date.now()/1000),`Public artifact link: ${url}`,row.task_id);
    db.prepare('INSERT INTO task_events (task_id,kind,payload,created_at) VALUES(?,?,?,?)').run(row.task_id,'artifact_published',JSON.stringify({url,sha256:row.sha256}),Math.floor(Date.now()/1000));
    db.exec('COMMIT');
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}
  return {ok:true,auditEventId:row.task_id,publicUrl:url};
}
export async function retryArtifactShare(ctx:ApiContext,id:string,uploader=uploadShare){
  const db=database(ctx.hermesHome);let row:ShareRow;
  try{
    db.exec('BEGIN IMMEDIATE');row=db.prepare('SELECT * FROM eaios_artifact_shares WHERE id=?').get(id) as unknown as ShareRow;
    if(!row)fail('Share not found.');
    const env=JSON.parse(String(db.prepare('SELECT body FROM tasks WHERE id=?').get(row.task_id)?.body));
    if(env.decision!=='approved')fail('Approval is required before publishing.');
    if(row.status==='published'){db.exec('COMMIT');return {ok:true,publicUrl:row.url};}
    if(row.status!=='uncertain'&&!(row.status==='uploading'&&row.updated_at<Math.floor(Date.now()/1000)-300))fail('This share is still publishing.');
    if(JSON.stringify(sharingConfig(ctx.hermesHome))!==row.hosting||hash(row.content)!==row.sha256)fail('Sharing configuration or snapshot changed. Contact your administrator.');
    db.prepare("UPDATE eaios_artifact_shares SET status='uploading',updated_at=? WHERE id=?").run(Math.floor(Date.now()/1000),id);db.exec('COMMIT');
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}
  return finishUpload(ctx.hermesHome,row!,uploader);
}
