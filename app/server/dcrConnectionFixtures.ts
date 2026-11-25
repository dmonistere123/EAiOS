/** Disposable, fictional source databases. Never call against a Hermes home. */
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DcrConnectionsReader} from './dcrConnections.ts';

export function stageDcrConnections(stageRoot:string){
  const root=join(stageRoot,'connection-fixtures'),attachments=join(root,'attachments');
  mkdirSync(attachments,{recursive:true,mode:0o700});
  const kanban=join(root,'kanban.db'),human=join(root,'human-delegation.db');
  if(!existsSync(kanban)){
    const db=new DatabaseSync(kanban);
    try{
      db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,status TEXT,assignee TEXT,result TEXT,created_at INTEGER);
        CREATE TABLE task_attachments(id INTEGER PRIMARY KEY,task_id TEXT,filename TEXT,stored_path TEXT,content_type TEXT,size INTEGER,created_at INTEGER);`);
      const path=join(attachments,'northstar-pilot-brief.txt');
      const content='Fictional staging Artifact. Northstar pilot review: the executive will prepare success measures for the original pilot locations. Maya Chen will review the measures before any expansion is considered. No deadline was agreed. Completion means Maya has reviewed and accepted the measures; producing a draft alone does not fulfill the promise.';
      writeFileSync(path,content,{mode:0o600});
      db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?)').run('t_dcr_sample_metrics','Sample · Draft Northstar success measures','done','research','Draft prepared for executive review. Maya has not confirmed acceptance.',1);
      db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?)').run('t_dcr_sample_review','Sample · Coordinate the Northstar review','blocked',null,'Waiting for the executive to select a review time.',2);
      db.prepare('INSERT INTO task_attachments VALUES(1,?,?,?,?,?,?)').run('t_dcr_sample_metrics','Northstar pilot brief.txt',path,'text/plain',Buffer.byteLength(content),1);
    }finally{db.close();}
  }
  if(!existsSync(human)){
    const db=new DatabaseSync(human);
    try{
      db.exec(`CREATE TABLE human_contacts(id TEXT PRIMARY KEY,body TEXT);
        CREATE TABLE human_delegations(id TEXT PRIMARY KEY,work_item_id TEXT,contact_id TEXT,status TEXT,body TEXT);`);
      db.prepare('INSERT INTO human_contacts VALUES(?,?)').run('hc_dcr_sample',JSON.stringify({displayName:'Jordan · sample HI assistant'}));
      const d={id:'hd_dcr_sample_review',workItemId:'t_dcr_sample_review',contactId:'hc_dcr_sample',status:'in_progress',revision:1,package:{subject:'Sample · Arrange Maya’s pilot review'},completionNote:''};
      db.prepare('INSERT INTO human_delegations VALUES(?,?,?,?,?)').run(d.id,d.workItemId,d.contactId,d.status,JSON.stringify(d));
    }finally{db.close();}
  }
  return new DcrConnectionsReader({kanban,attachments,human});
}
