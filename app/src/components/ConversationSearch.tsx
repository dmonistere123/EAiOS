export function ConversationSearch({query,day,onQuery,onDay}: {query:string;day:string;onQuery:(value:string)=>void;onDay:(value:string)=>void}) {
  return <div className="mb-3 space-y-2">
    <input type="search" aria-label="Search conversations" value={query} onChange={e=>onQuery(e.target.value)} placeholder="Keyword or YYYY-MM-DD" className="w-full min-w-0 rounded-lg border border-edge bg-canvas px-2 py-2 text-xs"/>
    <div className="flex items-center gap-2">
      <input type="date" aria-label="Conversation date" value={day} onChange={e=>onDay(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-edge bg-canvas px-2 py-1 text-xs [color-scheme:dark]"/>
      {(query || day) && <button type="button" onClick={()=>{onQuery('');onDay('');}} className="text-xs text-signal">Clear</button>}
    </div>
    <p className="text-[10px] text-ink-faint">2EP by session · Telegram by day (box time)</p>
  </div>;
}
