# Video editor (Electron)

**Video editor** (`/editor`, under Dubbing in the menu) is a multi-track editor
in the style of CapCut: import clips, stills and audio, lay them out on a
timeline, add titles and captions, and export an MP4. Everything runs on your
computer; nothing is uploaded.

## Using it

1. **Import** clips, images or audio in the **Media** column. Each file is kept by
   the local engine (`POST /promo/media`), so it survives a restart.
2. **Add to the timeline** with **+**: clips and stills join the **main track**,
   audio goes to an audio track. The layers button adds a clip or still as an
   **overlay** on its own track above the main one. The playhead moves to the end
   of a clip added to the main track, so the next one lands after it.
3. **Edit on the timeline.**
   - The main track is magnetic: its clips always play end to end from 0:00, so
     trimming, splitting, deleting or reordering closes the gap.
   - Overlay, text and audio tracks place clips freely. A clip dropped where it
     would overlap another lands on a new track.
   - Drag a clip to move it (also to another track of its kind), drag an edge to
     trim, click or drag the ruler to move the playhead. Edges snap to other
     clips and the playhead.
   - **S** splits the selected clip at the playhead, **Delete** removes it,
     **Space** plays or pauses, **←/→** steps one frame (Shift: one second),
     **Ctrl+Z / Ctrl+Shift+Z** undo and redo, **Ctrl+wheel** zooms.
   - Each track can be muted or hidden from its label.
4. **Properties** (right column) edit the selected clip at the playhead:
   - **Position, scale, rotation, opacity.** The diamond adds or removes a
     keyframe at the playhead; once a property has keyframes, changing it edits
     the keyframe at the playhead, and the value is animated in between. Dragging
     on the preview moves the selected picture or title.
   - **Colour:** a look (original, vivid, warm, cool, black & white, vintage) plus
     brightness, contrast and saturation, per clip or still.
   - **Mask:** a rectangle, a circle or a horizontal band, placed relative to the
     clip, with its position, size, rotation and softness (each keyframable
     with the diamond, so a mask can follow something) and **Invert mask** to
     keep the outside instead.
   - **Chroma key:** turn on **Remove a background color** to make a colour
     (green by default, or blue, or any colour you pick) see-through, so the
     tracks below show. **Strength** sets how far from the colour a pixel may be
     and still go, **Edge softness** blends the border, and **Remove color
     spill** takes the screen's tint out of what stays (hair, edges).
   - **Text:** content (new lines are kept), font (Inter or Space Grotesk, both
     bundled), size, colour, bold and a background box.
   - **Sound:** the clip's own sound on or off, volume (keyframable), fade in and
     out, speed from 0.25× to 4×, and for audio clips **Lower under voices**,
     which turns the clip down by about 12 dB while another clip has sound.
     Speed changes also change pitch.
   - **Transition to the next clip** (main-track clips that have one after
     them): dissolve, fade through black, slide, push, zoom or wipe, 0.1 to 2
     seconds. The two clips overlap for the transition, so the video gets
     shorter by its length, and their sound crossfades. A transition lasts at
     most half of the shorter of the two clips; it shows on the timeline as a
     marker over the overlap, which selects the clip it leaves. Splitting a clip
     keeps its transition at the end, on the right-hand part.
   - With nothing selected, the project's name, format (9:16, 1:1, 16:9), frame
     rate (30 or 60 fps) and background colour.
5. **Auto captions** mixes the project's sound, transcribes it with the local
   speech engine (`POST /transcribe`) and adds a caption track, one title per
   phrase on a dark box. When the engine returns words without timings, the
   lines are spread over the stretch where there is speech. If no speech model
   is installed, the message says how to add one.
6. **Export** renders the video at the project's size and frame rate with the
   sound mixed in, then asks where to save the MP4 (the browser UI downloads
   it). Up to 5 minutes.

A file the project uses that is no longer on the computer (another data
folder, a deleted file) shows **File missing** in the Media column, and Export
is blocked until those clips are deleted or the file is imported again.

## Projects

**Projects** (top bar) lists every editor project, most recently opened first.
Open one, start a **New project**, or rename, duplicate or delete one. Each
project keeps its own timeline, undo history (for the session) and settings,
and is saved in the app's browser storage as you edit: the library index under
`voicestudio.editor.library.v1` and each project under
`voicestudio.editor.project.<id>`. If storage refuses a save (it is full), the
editor says so.

Deleting or duplicating a project never touches the imported files: projects
share them, so a file stays on the computer while any project may still use it.

The first editor release kept a single project under `voicestudio.editor.v1`.
The first time the library opens, that project is copied in as the first
project, with its keyframes, captions and speeds as they were; the old entry is
left untouched.

## How it works

The editor runs on the renderer of **OpenCut** (MIT), vendored in
`electron/src/renderer/src/lib/opencut/vendor/`, with its compositor
`opencut-wasm` (WebAssembly, WebGPU or WebGL). The preview and the export draw
every frame with the same renderer, so the preview shows the exported frames.

- **Preview** plays on the AudioContext clock: sound and picture stay together
  and a slow frame is skipped rather than drifting.
- **Sound** is one schedule of every clip with audio (offset, speed, volume
  keyframes, fades, ducking), played live for the preview and rendered with an
  `OfflineAudioContext` for the export and for captions.
- **Export** encodes in the app with WebCodecs through `mediabunny`: H.264 and
  AAC in an MP4 where the system has an H.264 encoder. Where it does not, it
  writes VP9 and Opus in a WebM, and `POST /editor/finalize` converts that to an
  MP4 with the bundled ffmpeg, so every platform saves an MP4.
- The renderer needs `'wasm-unsafe-eval'` in the renderer's Content Security
  Policy (`electron/src/renderer/index.html`). It allows compiling WebAssembly
  only; JavaScript `eval` stays blocked.

Changes to the vendored OpenCut code are marked `eVoice Studio:` in comments:
pooled video frames carry their timestamp as a texture revision (OpenCut showed
a stale frame after a seek), and colour looks are drawn with a canvas filter as
a frame reaches the compositor. Transitions are per-frame adjustments
(`lib/opencut/frame-adjust.ts`) on the clips' opacity, position, scale and a
canvas band for the wipe, plus a black layer that fades in and out over the
main track for a fade through black; two clips of one file on screen at once
get their own decoders. Masks use OpenCut's own mask shapes; their params animate under the paths
`mask.<param>` in the clip's keyframes and are resolved per frame before the
mask is drawn (`lib/opencut/mask-keyframes.ts`). The chroma key runs after the colour look, in one
shared WebGL2 context (`lib/opencut/chroma-key.ts`), or with the same formula
on the CPU where WebGL2 is missing. Stickers, Iconify icons and audio time-stretch
(`soundtouchjs`, LGPL) are stubbed out. See `LICENSE-NOTICE.md`.

## Limits

- Export length is capped at 5 minutes because the encoder keeps the file in
  memory until it is saved.
- Speed changes shift the pitch of the clip's sound.
- The preview renders at the project's full size; a slow GPU may skip frames
  while playing (the export never does).
