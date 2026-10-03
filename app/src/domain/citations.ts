/** 6.4b: citation refs Ally emits per the Phase 5 contract (`eaios://chunk/<id>`). */
export function parseCitations(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/eaios:\/\/chunk\/([A-Za-z0-9_-]+)/g)) ids.add(m[1]);
  return [...ids];
}
