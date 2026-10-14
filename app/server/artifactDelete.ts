/** Delete only an explicitly selected, confined attachment; preserve its task. */
import {DatabaseSync} from 'node:sqlite';
import {lstatSync,realpathSync,renameSync,unlinkSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
export function deleteArtifact(home:string,id:string){
 if(!/^att-[1-9]\d*$/.test(id))throw new Error('Only task artifacts can be deleted.');
 const root=join(home,'kanban','attachments');
 if(lstatSync(root).isSymbolicLink())throw new Error('Artifact storage must not be a symbolic link.');
 const realRoot=realpathSync(root);
 if(!realRoot.startsWith(realpathSync(home)+sep))throw new Error('Artifact storage is outside the private home.');
 const db=new DatabaseSync(join(home,'kanban.db'));let moved:string|undefined;let original:string|undefined;let committed=false;
 try{
  db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  const row=db.prepare('SELECT stored_path FROM task_attachments WHERE id=?').get(Number(id.slice(4)));
  if(!row)throw new Error('Artifact was already removed. Refresh the list.');
  original=resolve(String(row.stored_path));
  if(!original.startsWith(realRoot+sep)||realpathSync(original)!==original||!lstatSync(original).isFile())throw new Error('Artifact file is not a regular file within storage.');
  const shared=db.prepare('SELECT stored_path FROM task_attachments WHERE id<>?').all(Number(id.slice(4))).some(r=>{try{return realpathSync(String(r.stored_path))===original;}catch{return false;}});
  if(!shared){moved=join(realRoot,'.delete-'+randomUUID());renameSync(original,moved);}
  db.prepare('DELETE FROM task_attachments WHERE id=?').run(Number(id.slice(4)));
  db.exec('COMMIT');committed=true;
  if(moved)unlinkSync(moved);
  return {ok:true,sharedFileRetained:shared};
 }catch(e){
  if(!committed){if(db.isTransaction)db.exec('ROLLBACK');if(moved&&original)renameSync(moved,original);}
  throw e;
 }finally{db.close();}
}
