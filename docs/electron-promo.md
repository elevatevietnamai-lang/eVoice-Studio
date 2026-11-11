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
4 GB per uploaded file.

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
- Beat detection is plain numpy (spectral-flux onsets and their
  autocorrelation); no audio-analysis package is installed.
- The finished file is `outputs/promo_<id>.mp4`, served at `/audio/<name>`.

The page keeps its draft in `localStorage` (`voicestudio.promo.v1`); uploaded
files stay in `outputs/promo_media` until you delete them from the data folder.
