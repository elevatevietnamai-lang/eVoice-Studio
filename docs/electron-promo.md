# Promo video (Electron)

**Promo video** (`/promo`, under Dubbing in the menu) cuts short clips and stills
into one MP4 with transitions, a music bed, optional narration and a logo. It
runs on the CPU with the bundled ffmpeg, on macOS, Windows and Linux, in the
desktop app and in the browser UI alike.

## Using it

1. **Add clips or images.** Each file becomes a shot. Set its length, where a
   clip starts, how it fills the frame (fill and crop, or the whole picture over
   a blurred copy), and for stills a slow zoom in or out.
2. **Pick transitions.** Each shot after the first has a transition in: cut,
   fade, flash (fade through white), dip to black, slide, push, wipe, zoom,
   circle or blur, with its length. A transition is held to at most 45 % of the
   shorter of the two shots it joins.
3. **Choose the format and look.** 9:16 vertical (1080×1920), 1:1 square
   (1080×1080) or 16:9 wide (1920×1080), at 30 or 60 fps. A colour look (warm,
   cool, vivid, black & white) is applied to every shot so clips from different
   sources match.
4. **Add music and narration.** Music loops if it is shorter than the video,
   fades in and out, and is mixed under the narration. **Cut on the beat**
   detects the music's tempo, starts the music on a beat and moves each cut
   onto the nearest beat; the shot lengths in the list update to the values
   used.
5. **Add a logo.** A PNG with transparency works best. It can sit in a corner
   as a watermark (left off during the ending) and close the video on a
   coloured background for the chosen number of seconds.
6. **Render video**, then **Save video**.

Limits: 40 shots, 0.5–60 s per shot, 5 minutes in total, 10 s of logo ending,
4 GB per uploaded file, 12 animated titles.

## Animated titles (desktop app only)

The **Animated titles** section lays an animated layer over the video, from a
chosen second, in the video's format. Pick a template, fill in its fields and
colours, and watch the live preview (it loops, on a checkerboard where the
layer is transparent):

| Template | Shows | Fonts |
|---|---|---|
| Glowing title | A title rising in with a pulsing glow, and a second line | Inter |
| Handwriting | A title written left to right with an underline drawn under it | Dancing Script, Inter |
| Search bar | A search box that types the text letter by letter | Inter |
| Contact card | A name, a second line and up to three rows (phone, address, website) | Oswald, Inter |
| Logo reveal | The logo from the **Logo** section, with an optional brand name and line | Oswald, Inter |

All fonts cover Vietnamese. Long text is set smaller, so every field at its
80-character limit still fits a 9:16, 1:1 or 16:9 frame, and a second line
never outgrows its title. The logo reveal and the logo ending both show the
logo, so place the reveal before the ending. Titles are rendered on your
computer; the browser UI and Docker say they need the desktop app.

The first time, **Turn on animated titles** shows the download size and asks
before fetching Chrome Headless Shell (about 271 MB, one pinned build from
Google's Chrome for Testing storage) into the app's data folder
(`promo-browser`). Nothing is downloaded until you confirm, and the rest of the
page works without it. Chrome for Testing has builds for macOS (Apple Silicon
and Intel), Windows x64 (also used on Windows on Arm) and Linux x64 and arm64;
elsewhere the section says it is unavailable.

Each title becomes a transparent WebM stored like an uploaded file, listed under
**Overlays** with its start time. A title needs the backend on this computer,
since the render uses the backend's ffmpeg.

### How animated titles are rendered

- Electron main writes a small project (`index.html`, `fonts.css`, the fonts
  that template names and, for the logo reveal, the logo) from
  `electron/src/main/promo-templates.ts`. Fonts come from `backend/assets`
  (Oswald and Dancing Script live in `backend/assets/promo-fonts`, apart from
  the subtitle-burning fonts). Text is NFC-normalized and HTML-escaped, the
  search bar types by grapheme so Vietnamese marks stay on their letters, and
  colours must be `#rrggbb`. The logo is fetched from promo media over loopback
  by its id (20 MB at most); the renderer never passes a path or URL. Templates
  use CSS animation only (GSAP's licence does not fit AGPL).
- The preview is the same page with fonts and logo inlined, shown in a
  sandboxed `srcdoc` frame without scripts in the app window, so it needs no
  download.
- A utility process (`promo-render-worker.ts`) renders it with HyperFrames
  (`@hyperframes/producer`, pinned) to VP9 WebM with alpha, using the app's
  Chrome Headless Shell and the backend's ffmpeg. Its `HOME` and caches point
  at a temporary folder, so nothing cached elsewhere on the machine is used.
- **No network.** The render process blocks every socket, name lookup and
  `fetch` that is not loopback (`promo-network-guard.ts`), and a render that
  tried one is discarded. HyperFrames would otherwise fetch Google Fonts for a
  font without a local `@font-face`. Chrome itself runs outside that guard, so
  every template must carry its fonts and contain no remote URL; a test checks
  both.
- Main uploads the WebM to `POST /promo/media`; the page sends it in
  `overlays` with its start time.

## How it works

- `POST /promo/media` stores an uploaded file under
  `outputs/promo_media/<random id>.<ext>`. Only video, image (`.png`, `.jpg`,
  `.webp`, `.bmp`) and audio extensions are accepted, and ffprobe must be able
  to read the file. Render requests refer to files by that id, never by path.
- `POST /promo/render` builds one ffmpeg command
  (`backend/services/promo_video.py`). Every shot is scaled to the output
  size, given the output frame rate, pixel format and timebase, then joined
  with `xfade` (or `concat` for a cut). The video length is the sum of the shot
  lengths minus each transition, plus the logo ending.
- `overlays` in the render request lay transparent layers over the video
  from a start time: a WebM (VP9 with alpha, decoded with libvpx so the alpha
  survives), a MOV (ProRes 4444) or a still image, fitted inside the frame and
  centred, above the shots and below the watermark. Animated titles rendered
  on the desktop arrive this way.
- Beat detection is plain numpy (spectral-flux onsets and their
  autocorrelation); no audio-analysis package is installed.
- The finished file is `outputs/promo_<id>.mp4`, served at `/audio/<name>`.

The page keeps its draft in `localStorage` (`voicestudio.promo.v1`); uploaded
files stay in `outputs/promo_media` until you delete them from the data folder.
