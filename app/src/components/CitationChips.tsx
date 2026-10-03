import { parseCitations } from '../domain/citations';
export function CitationChips({ text, onOpen }: { text: string; onOpen: (chunkId: string) => void }) {
  const ids = parseCitations(text);
  if (!ids.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {ids.map((id, i) => (
        <button
          key={id}
          onClick={() => onOpen(id)}
          title={`Open source chunk ${id}`}
          className="rounded-md border border-signal/30 bg-signal/10 px-2 py-0.5 text-[10px] font-medium text-signal hover:bg-signal/20"
        >
          ⧉ source {i + 1}
        </button>
      ))}
    </div>
  );
}
