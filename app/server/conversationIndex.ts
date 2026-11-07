import { DatabaseSync } from 'node:sqlite';
import { profileStatePath } from './assistantEvidence.ts';

export interface ConversationFilter { query?: string; day?: string; }
const visible = `COALESCE(s.hidden,0)=0 AND COALESCE(s.archived,0)=0
  AND m.role IN ('user','assistant') AND COALESCE(m.display_kind,'') NOT IN ('hidden','interim')
  AND length(trim(COALESCE(m.content,'')))>0`;
const localDay = "strftime('%Y-%m-%d',m.timestamp,'unixepoch','localtime')";
const dateText = (day: string) => new Date(day+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
export function conversationFilter(filter: ConversationFilter = {}) {
  let query = (filter.query ?? '').trim().slice(0,200);
  let day = filter.day ?? '';
  if (!day && /^\d{4}-\d{2}-\d{2}$/.test(query)) { day=query; query=''; }
  if (!day && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(query)) {
    const [m,d,y]=query.split('/');day=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;query='';
  }
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day+'T12:00:00Z')) || new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)) throw new Error('Invalid date');
  return {query,day};
}

/** Groups visible Telegram messages by their actual local calendar day, across
 * sessions. Full stored text is searched in SQL, not truncated previews. */
export function telegramDays(home: string, profile?: string, filter: ConversationFilter = {}) {
  const {query,day}=conversationFilter(filter);
  const db=new DatabaseSync(profileStatePath(home,profile),{readOnly:true});
  try {
    const rows=db.prepare(`SELECT ${localDay} AS day,MAX(m.timestamp) AS activity,COUNT(*) AS count,
      MAX(CASE WHEN instr(lower(m.content),lower(?))>0 OR instr(lower(COALESCE(s.title,'')),lower(?))>0 THEN 1 ELSE 0 END) AS matches
      FROM messages m JOIN sessions s ON s.id=m.session_id WHERE ${visible} AND s.source='telegram'
      AND (?='' OR ${localDay}=?) GROUP BY day HAVING matches=1 ORDER BY day DESC LIMIT 366`).all(query,query,day,day);
    return rows.map(r=>{
      const preview=db.prepare(`SELECT substr(m.content,1,160) AS text FROM messages m JOIN sessions s ON s.id=m.session_id
        WHERE ${visible} AND s.source='telegram' AND ${localDay}=? ORDER BY m.timestamp DESC,m.id DESC LIMIT 1`).get(String(r.day));
      return {id:`telegram-day:${r.day}`,title:dateText(String(r.day)),day:String(r.day),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
        preview:String(preview?.text??''),source:'telegram',startedAt:new Date(Number(r.activity)*1000).toISOString(),messageCount:Number(r.count)};
    });
  } finally {db.close();}
}

export function readTelegramDay(home:string,day:string,profile?:string) {
  conversationFilter({day});
  const db=new DatabaseSync(profileStatePath(home,profile),{readOnly:true});
  try {
    const rows=db.prepare(`SELECT m.id,m.role,m.timestamp,substr(m.content,1,16384) AS text,length(m.content)>16384 AS shortened
      FROM messages m JOIN sessions s ON s.id=m.session_id WHERE ${visible} AND s.source='telegram' AND ${localDay}=?
      ORDER BY m.timestamp DESC,m.id DESC LIMIT 501`).all(day);
    let bytes=0;const messages=[];
    for(const r of rows.slice(0,500)) {
      bytes+=Buffer.byteLength(String(r.text));if(bytes>1024*1024)break;
      messages.push({id:`stored-${r.id}`,role:r.role==='user'?'you':'ally',text:String(r.text)+(r.shortened?'\n[Message display shortened.]':''),at:new Date(Number(r.timestamp)*1000).toISOString()});
    }
    return {messages:messages.reverse(),limited:messages.length<rows.length,root:`telegram-day:${day}`,sessionId:undefined};
  }finally{db.close();}
}

/** Search returns EAiOS/Desktop conversations as sessions, never daily fragments.
 * Staff/background runs remain in their own navigation section. */
export function searchConversationSessions(home:string,profile?:string,filter:ConversationFilter={}) {
  const {query,day}=conversationFilter(filter);
  const db=new DatabaseSync(profileStatePath(home,profile),{readOnly:true});
  try {
    const rows=db.prepare(`SELECT s.id,s.title,s.source,MAX(m.timestamp) AS activity,COUNT(*) AS count,
      MAX(CASE WHEN (instr(lower(m.content),lower(?))>0 OR instr(lower(COALESCE(s.title,'')),lower(?))>0)
      AND (?='' OR ${localDay}=?) THEN 1 ELSE 0 END) AS matches
      FROM messages m JOIN sessions s ON s.id=m.session_id WHERE ${visible}
      AND s.source IN ('web','desktop','tui','cli') GROUP BY s.id HAVING matches=1 ORDER BY activity DESC LIMIT 200`).all(query,query,day,day);
    return rows.map(r=>({id:String(r.id),title:String(r.title||'Untitled conversation'),preview:'',source:String(r.source),
      startedAt:new Date(Number(r.activity)*1000).toISOString(),messageCount:Number(r.count)}));
  }finally{db.close();}
}
