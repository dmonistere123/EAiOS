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
python3 -m http.server 5291 --bind 127.0.0.1 --directory .local/whiteboard/review
```

The visual script is deliberately authored for this recording. Supplying an
unrelated recording does not generate a new storyboard. Original narration is
preserved with a 180ms audio fade at the excerpt's end. No speech is synthesized.

`--stills` produces scene thumbnails and a poster without rendering the video.
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
