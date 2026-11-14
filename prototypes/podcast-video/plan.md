# Podcast whiteboard prototype

An 84.55-second visual treatment of the existing “Stop Scaling Heroics” podcast.
Keep the original recording; no regenerated voice or additional factual claims.

Narrative arc: a capable employee rescues work, but repeated rescue reveals a
system problem. Make broken handoffs visible, record recurring failures, and
assign a corrective owner. The visual payoff is a repaired process, with the
employee still valued.

| Time | Visual |
| --- | --- |
| 0–6 | Draw the title and a simple rescue-to-system motif |
| 6–15.6 | Employee, ordinary project, rescue connection |
| 15.6–22.5 | Three capable people beside uneven results |
| 22.5–31.7 | Promise → scope → handoff → delivery; weak links appear |
| 31.7–42 | A person bridges the gaps; repeat arrows reveal the cycle |
| 42–55.5 | Deployment and incident-response controls; warning motif |
| 55.5–75.9 | Draw a rescue register, then the owner and weekly review |
| 75.9–84.55 | Appreciate the person; repair the system |

Visual direction: warm white paper, navy ink, teal emphasis, muted coral for
failures, amber highlights. Progressive line drawing with an illustrated marker
hand. Large labels, generous whitespace, optional transcript captions. Retain
the source's qualifications around the Knight Capital example.

The Hermes Manim skill informed planning. Its runtime is unavailable here, so
this proof of concept uses Pillow paths and FFmpeg. Transcription alignment uses
the existing locally cached Whisper model; captions are corrected against the
source transcript. This is an authored style sample, not an automatic arbitrary
MP3-to-storyboard pipeline. No production integration or provider calls.

Private audio, transcript alignment, captions, renders, and the review server
live beneath ignored `.local/whiteboard/`, outside the versioned prototype.
