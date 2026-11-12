# v0.1.20 — Travel planning with human booking

Travel keeps the existing Duffel flight search and selection screen. Hotel and
restaurant suggestions include web sources. Flights, hotel, car and dining choices
become a saved itinerary artifact attached to a human delegation email, reviewed
in Approvals before sending. EAiOS does not purchase reservations.

The human assistant can record completed items, references, costs and notes in an
assignment-only checklist. Completion creates an executive approval; requesting
changes keeps it open, and approval archives it while retaining history.

Both installer editions include this workflow. Core continues to exclude Ticker;
existing module choices, agents, credentials and custom instructions are preserved.
The dedicated HTTPS assistant endpoint requires per-box configuration described in
INSTALL.md. It is never exposed automatically by installation.

Existing installations can use Settings → App Settings → Check for updates.
New Core installations are pinned to v0.1.20. Production deployments use real mail
only after the exact email and itinerary receive approval; staging still captures
mail locally and never sends it.
