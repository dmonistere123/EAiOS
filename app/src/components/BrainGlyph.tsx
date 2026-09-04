/** Shared hand-rolled line-art brain glyph — no image assets, no icon library.
 * Extracted from OrgChart (F26, 2026-08-30) so the concierge widget FAB uses
 * the same mark as the Staff-page hub. */
export function BrainGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden data-brain-hub className={className}>
      {/* hemispheres outline */}
      <path
        d="M32 10c-7-5-17-2-19 7-5 3-6 11-2 15-2 8 5 14 12 13 3 3 7 4 9 4s6-1 9-4c7 1 14-5 12-13 4-4 3-12-2-15-2-9-12-12-19-7Z"
        fill="rgba(50,197,255,0.07)"
        stroke="var(--color-signal)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* longitudinal fissure */}
      <path d="M32 12v38" stroke="var(--color-signal-dim)" strokeWidth="2" strokeLinecap="round" />
      {/* sulci */}
      <path
        d="M20 21c3 2 5 5 4 9M16 35c3 1 6 4 7 8M44 21c-3 2-5 5-4 9M48 35c-3 1-6 4-7 8"
        stroke="var(--color-signal-dim)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
