# Channel Kit and image sources

A **Channel Kit** keeps one brand's materials on this machine so every video made
for that channel looks and sounds the same: logos, colours, fonts, motion rules,
the brand voice (a cloned eVoice voice), music and SFX, characters, tone of
voice, audience, products, channel formats, caption style, legal lines,
reference videos and a memory of past episodes. **Image sources** are optional
generators (off by default) that make illustrations in the Kit's style.

The desktop page is **Channel** in the menu (`/channel-kit`); image sources are
set in **Settings → Image sources** (`/settings/image-sources`).

## Storage and `.evkit`

- Kits live in `<data folder>/channel_kits/<kit id>/kit.json` with their files in
  `assets/`. Asset files are renamed to a random id with an allow-listed
  extension; the original name is kept only as a label.
- Accepted assets: images `.png .jpg .jpeg .webp`, fonts `.ttf .otf .woff .woff2`,
  audio `.mp3 .wav .ogg .m4a .flac`, video `.mp4 .webm .mov`, Lottie
  `.json .lottie`, Rive `.riv`. SVG is refused. Each file's bytes are checked
  (Pillow for images, magic bytes for the rest). Limits: 256 MB per file,
  1 GB and 400 files per Kit.
- **Export** writes a `.evkit` (ZIP of `kit.json` + `assets/<id><ext>`) with only
  the assets the Kit uses. **Import** checks every entry name and size before
  reading (`core/safe_archive.py`), reads only members `kit.json` names, checks
  each file's content and gives the Kit and every asset new ids. A Kit from a
  newer schema is refused rather than half-read.

## Guideline → draft Kit

Drop a brand guideline (PDF, Markdown, text or an image) on the Channel page.

- **Text and PDF** are sent to the LLM provider chosen in Settings → LLM
  providers, only after the page has shown which one; the request names that
  provider and is refused if it changed. `OMNIVOICE_LLM_BACKEND=off` or no
  provider means the button explains why and nothing is sent. The guideline is
  wrapped as data and the model is told never to follow instructions in it.
- **Images** never leave the machine: their palette is measured locally.
- The result is a **draft**: each section is shown with *Use* / *Skip*; nothing is
  saved until the user applies the chosen sections and saves the Kit.

## Brand compliance check

`POST /kits/{id}/check` runs locally, with no LLM. Callers describe their
project in a neutral shape (boxes are fractions of the frame, origin top-left)
and get issues per clip:

| Code | Severity | Meaning |
|---|---|---|
| `color_off_palette` | error | A colour is further than ΔE 12 from every Kit colour (white/black pass unless the Kit turns neutrals off) |
| `font_off_kit` | error | A font is not one of the Kit fonts (generic `sans-serif` etc. pass) |
| `logo_wrong_variant` | error | A logo variant or file not in the Kit |
| `logo_clear_space` | error | Another text/sticker overlaps the logo's clear space at the same time |
| `logo_too_small` | warning | Narrower than the logo's minimum width |
| `text_in_platform_ui` | warning | Text, caption or logo under the platform's own buttons/captions |
| `voice_not_brand` | error | Narration voice is neither the brand voice nor a Kit character's voice |
| `transition_not_allowed` | warning | A transition the Kit does not allow |
| `banned_word` | error | Text uses a banned word |
| `missing_cta` | warning | No Kit call to action appears in the text |
| `missing_disclaimer` | error | The Kit's disclaimer is missing |
| `missing_ai_label` | error | `ai_content` is true and the Kit's AI label text is missing |
| `duration_out_of_format` / `aspect_out_of_format` | warning | Outside the channel format |

Default platform UI zones (fractions of a vertical frame) — TikTok top 0.09,
bottom 0.20, left 0.04, right 0.15; Reels top 0.10, bottom 0.20, right 0.12;
Shorts top 0.08, bottom 0.18, right 0.13; YouTube bottom 0.10. A Kit format's
`safe_zone` replaces them.

## Image sources

Settings → Image sources is **Off** by default; with Off nothing is probed,
started or contacted, and every other feature works.

| Source | Where the prompt and references go | How it runs |
|---|---|---|
| Codex CLI | OpenAI, through the account signed in to the user's Codex CLI | `codex exec --skip-git-repo-check -s workspace-write --ephemeral -C <fresh temp folder> - [-i refs…]`, prompt on stdin; the image is read from that folder |
| Antigravity CLI (`agy`) | Google, through the account signed in to the user's `agy` | `agy --mode accept-edits --input-format stream-json --output-format stream-json -p=` in a fresh temp folder; the `conversation_id` from its output picks `~/.gemini/antigravity-cli/brain/<id>/`, which is polled for up to 5 minutes because the first run can exit before the image is written |
| ComfyUI | The user's ComfyUI at `127.0.0.1:8188` (loopback, or a network in `OMNIVOICE_TRUSTED_NETWORKS`) | An API-format workflow with `{{prompt}}` (and optionally `{{seed}}`) placeholders |
| OpenAI-style API | The base URL the user enters (HTTPS, or HTTP on loopback), with the user's key | `/images/generations`, or `/images/edits` with references; the key is stored encrypted and never returned |

The CLIs are found on `PATH` without a shell: a Windows npm shim is read and its
script run with `node` directly. They run with the backend's own tokens
removed from their environment, inside a nested process owner so cancel and
shutdown stop the whole tree.

Before each generation the page shows the **exact prompt** (the user's words plus
the Kit's style, colours and character), the reference images, the destination
and an estimated time. Results are checked (PNG/JPEG/WebP, at least 64 px, at
most 64 MP and 50 MB), added to the media library the promo builder and video
editor use (`/audio/promo_media/<id>`) and recorded with their prompt, source,
time and an "AI image" label in `<outputs>/image_provenance/<id>.json`.

## API for the editor agent

All routes are on the backend; errors carry `detail = "kits:<code>"` or
`"images:<code>"`.

- `GET /kits` → `{kits: [{id, name, description, updated_at, logo_url}]}`
- `GET /kits/{id}` → the whole Kit (schema in `backend/services/channel_kit.py`);
  `assets[asset_id] = {kind, name, ext, size, mime, url}`
- `POST /kits`, `PUT /kits/{id}`, `DELETE /kits/{id}`; `POST /kits/{id}/assets`
  (multipart `file`); `DELETE /kits/{id}/assets/{asset_id}`
- `GET /kits/{id}/export`, `POST /kits/import` (multipart `file`)
- `POST /kits/{id}/memory` `{date, title, topic, hook, cta}` — record a finished episode
- `POST /kits/{id}/check` with:

  ```json
  {"platform": "tiktok", "aspect": "9:16", "format_id": null, "duration": 30, "ai_content": false,
   "clips": [{"id": "c1", "kind": "text", "start": 0, "duration": 3, "bbox": [0.1, 0.4, 0.6, 0.1],
              "text": "Follow for more", "font": "Inter", "color": "#e63946", "colors": [],
              "logo_variant": "", "asset": "", "voice_id": "", "transition": "fade"}]}
  ```

  `kind` is `text | caption | logo | video | image | scene | audio | sticker | other`.
  Returns `{ok, issues: [{clip_id, code, severity, detail}]}`.
- `GET /kits/guideline` → the LLM provider a text guideline would go to;
  `POST /kits/guideline` (multipart `file`, `provider_id`, `language`) → `{draft, sent_to}`
- `GET /images/sources`, `PUT /images/sources`
- `POST /images/preview` `{prompt, kit_id?, character_id?, reference_media_ids?, use_character_references?, transparent?, size?}`
  → `{source_id, destination, local, prompt, references, estimate_seconds}`.
  **Show this to the user before generating.**
- `POST /images/generate` with the preview's `source_id` and `prompt` unchanged
  (plus the same reference fields) → `{job_id}`; `409 images:source_changed` when
  the selected source changed.
- `GET /images/jobs/{id}` → `{status: queued|running|done|failed|cancelled, progress, stage, error, media}`;
  `POST /images/jobs/{id}/cancel`; `GET /images/library`.
