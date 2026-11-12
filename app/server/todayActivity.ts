import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync, realpathSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiContext } from './httpApi.ts';
import type { TodayActivity, RecentScheduleRun } from '../src/domain/today.ts';
import type { InsightReport } from '../src/domain/insights.ts';
import { listKanbanTasks } from './apiCore.ts';
const reviewFile = (home:string) => join(home,'eaios','today-state.db');
export function readReviews(home:string):Record<string,number> {
  const path=reviewFile(home); if(!existsSync(path))return {};
  const db=new DatabaseSync(path,{readOnly:true});
  try {db.exec('PRAGMA busy_timeout=3000');return Object.fromEntries(db.prepare('SELECT key, reviewed_at FROM reviews').all().map(r=>[String(r.key),Number(r.reviewed_at)]));}
  finally {db.close();}
}
export function reviewActivity(home:string,key:unknown,now=Date.now()) {
  if(typeof key!=='string' || key.length>400 || !/^(run|work|human):[^\s]+$/.test(key))throw new Error('Invalid review key');
  mkdirSync(join(home,'eaios'),{recursive:true,mode:0o700});
  const db=new DatabaseSync(reviewFile(home));
  try {
    db.exec('PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS reviews(key TEXT PRIMARY KEY, reviewed_at INTEGER NOT NULL); BEGIN IMMEDIATE');
    db.prepare('DELETE FROM reviews WHERE reviewed_at<=?').run(now-7*86400000);
    db.prepare('INSERT INTO reviews VALUES(?,?) ON CONFLICT(key) DO UPDATE SET reviewed_at=excluded.reviewed_at').run(key,now);
    const keys=db.prepare('SELECT key FROM reviews').all().map(r=>String(r.key));db.exec('COMMIT');return keys;
  } finally {db.close();}
}
export function todayActivity(ctx:ApiContext,now=Date.now()):TodayActivity {
  const warnings:string[]=[], runs:RecentScheduleRun[]=[], links:Record<string,string[]>={};
  const roots=[{name:'Ally',path:ctx.hermesHome}];
  try{for(const e of readdirSync(join(ctx.hermesHome,'profiles'),{withFileTypes:true}))if(e.isDirectory()&&/^[\w-]+$/.test(e.name))roots.push({name:e.name,path:join(ctx.hermesHome,'profiles',e.name)});}catch{/* Single profile */}
  const seen=new Set<string>();
  for(const root of roots) {
    const path=join(root.path,'cron','executions.db');
    if(!existsSync(path)){if(existsSync(join(root.path,'cron','jobs.json')))warnings.push(`${root.name}: schedule run history unavailable.`);continue;}
    let db:DatabaseSync|undefined;
    try {
      const real=realpathSync(path);if(seen.has(real))continue;seen.add(real);
      let jobs:{id:string;name?:string}[]=[];
      try{const data=JSON.parse(readFileSync(join(root.path,'cron','jobs.json'),'utf8'));jobs=Array.isArray(data)?data:data.jobs??[];}catch{/* Deleted jobs remain in run history. */}
      db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000');
      const columns=new Set(db.prepare('PRAGMA table_info(executions)').all().map(r=>String(r.name)));
      const optional=['finished_at','delivery_outcome','work_item_id'].map(c=>columns.has(c)?c:`NULL AS ${c}`).join(',');
      const recent=columns.has('finished_at')?'COALESCE(finished_at,started_at,claimed_at)':'COALESCE(started_at,claimed_at)';
      const rows=db.prepare(`SELECT id,job_id,status,COALESCE(started_at,claimed_at) at,${optional} FROM executions WHERE julianday(${recent})>julianday(?) AND julianday(${recent})<=julianday(?) ORDER BY at DESC LIMIT 2001`).all(new Date(now-86400000).toISOString(),new Date(now).toISOString());
      if(rows.length>2000)warnings.push(`${root.name}: displaying the most recent 2,000 runs.`);
      for(const r of rows.slice(0,2000))runs.push({id:root.name+':'+r.id,jobId:String(r.job_id),title:jobs.find(j=>j.id===r.job_id)?.name ?? `Schedule ${r.job_id}`,profile:root.name,status:String(r.status),at:String(r.at),finishedAt:typeof r.finished_at==='string'?r.finished_at:undefined,deliveryOutcome:typeof r.delivery_outcome==='string'?r.delivery_outcome:undefined,workItemId:typeof r.work_item_id==='string'?r.work_item_id:undefined});
    }catch{warnings.push(`${root.name}: schedule run history unavailable.`);}finally{db?.close();}
  }
  try{for(const t of listKanbanTasks(join(ctx.hermesHome,'kanban.db')).tasks)if(typeof t.parents==='string')links[String(t.id)]=t.parents.split(',');}catch{warnings.push('Task relationships unavailable; linked records may appear separately.');}
  let report:InsightReport|null=null;
  const reportPath=join(ctx.hermesHome,'eaios','executive-insights','recommendations.json');
  if(existsSync(reportPath))try{const reports=JSON.parse(readFileSync(reportPath,'utf8')) as InsightReport[];report=reports.filter(r=>Array.isArray(r.recommendations)).sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt))[0]??null;}catch{warnings.push('Saved Executive Insights are unavailable.');}
  let reviewed:string[]=[];try{reviewed=Object.keys(readReviews(ctx.hermesHome));}catch{warnings.push('Review status unavailable. Previously reviewed results may reappear.');}
  return {runs,links,report,reviewed,warnings};
}
