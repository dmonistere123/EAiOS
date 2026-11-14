# Podcast whiteboard style prototype

An authored 84.55-second excerpt of the November 4, 2026 "Stop Scaling Heroics"
podcast, presented in a standalone staging review page. This is a style and
timing proof of concept, not the completed upload/generation feature.

## Render

Requires Python with Pillow, FFmpeg/ffprobe, and the Lato fonts in the path
specified in `render.py`. No AI provider credentials are required.

```sh
python3 prototypes/podcast-video/render.py \
  --audio /path/to/original-podcast.mp3 \
  --out .local/whiteboard/review
cp prototypes/podcast-video/index.html .local/whiteboard/review/index.html
python3 prototypes/podcast-video/serve.py --directory .local/whiteboard/review
```

The visual script is deliberately authored for this recording. Supplying an
unrelated recording does not generate a new storyboard. Original narration is
preserved with a 180ms audio fade at the excerpt's end. No speech is synthesized.

`--stills` produces scene thumbnails and a poster without rendering the video.
The drawing hand is off by default, following executive feedback. `--show-hand`
opts into the original hand treatment. Line and text reveals retain their timing.
The review page uses `captions.vtt`, prepared from local timestamped transcription
and checked against the podcast's existing transcript. Caption preparation is
currently a separate editorial step. Keep recordings, transcriptions, generated
videos, and provenance in ignored `.local/whiteboard/`, not in Git.

The preview offers actual video playback, scene seeking, captions, and an MP4
download. Navigation labels provide module context. Uploading, automatic
storyboards, assistant revisions, and artifact persistence remain future work.

This prototype has no backend routes, writes no production data, and invokes no
providers. For a product implementation, add background jobs, validated uploads,
durable state, cancellation, and retry handling behind the Podcast adapter.

## Combined Podcast page mockup

With the media review server running on 5291, start the existing application in
the dedicated isolated preview profile:

```sh
cd app
npm ci
npx vite --config vite.podcast-preview.config.ts
```

Open `http://127.0.0.1:5292/podcasts`. The profile uses mock adapters, disables
live backend routes and env-file loading, and proxies only the local media
preview. Provide `source.mp3` and `source-transcript.txt` in the private review
directory for the sample episode's existing audio player and transcript.

The promo appears underneath the existing audio controls. Before/After creation
controls let reviewers inspect both states. The create button reveals the
existing 85-second style sample, not a newly generated 90-second video. Revision
requests appear locally in the prompt area with an explicit mockup status; no
render or assistant call occurs. Episode generation is disabled in this profile.
Assistant names use the existing app configuration, including custom names.

This is a desktop layout review. The existing application shell's three-pane
mobile layout still needs separate responsive work. The feature is gated behind
`VITE_PODCAST_PROMO_PREVIEW=1`; regular production builds do not display it.
