# Exporting dubbed video

Video exports can contain both the source audio and one or more dubbed tracks.
VoiceStudio marks the selected dubbed language as the default so ordinary video
players and messaging apps play the dub immediately. Choose **Original** in the
Default Track control when the source audio should play first instead.

## Subtitles only (no dub)

**Video + subtitles** in Export options keeps the video's original audio and
burns the translated subtitles into the picture, without generating a dub. It
is the export for translating burned-in subtitles: read the on-screen
subtitles, remove them, translate (or paste a translation), then export. When
the original subtitles were removed, each translated line goes where its
original was; **Dual** adds the original under the translation.

The option is offered for video jobs once a language has translated lines. It
burns the lines as the editor shows them: the app first sends them with
`POST /dub/subtitle-cues/{job_id}` (`{"lang", "cues": [{id, start, end, text,
text_original}]}`), then saves `GET /dub/download/{job_id}?subtitles_only=1&lang=&dual=`.
With no posted lines, a generated track's text for that language is used; with
neither, the export answers 400 "No translated subtitles to burn yet".

## Hardsub captions

Turning on **Burn subtitles into picture (hardsub)** re-encodes the video with
captions rendered into the frames. Windows caption paths are passed to ffmpeg
with forward slashes so drive-letter paths open in the subtitles and ass
filters; POSIX filenames keep literal backslashes. Two caption styles are available:

- **Line** (default) — static line subtitles, unchanged from previous releases.
- **Karaoke (word highlight)** — each word fills with the highlight colour in
  sequence across the line. Word timings recorded at transcription time drive
  the sweep when they still spell the burned text; otherwise (older jobs, or
  translated tracks) the timing is spread evenly across each line. Karaoke is
  not available together with the dual-layout (translation + original) style —
  switching dual on falls back to the line burn.

Smart Fit exports burn captions after the video retime, so both styles follow
the fitted timeline. The karaoke script can also be downloaded on its own from
`GET /dub/ass/{job_id}` as an `.ass` sidecar.
