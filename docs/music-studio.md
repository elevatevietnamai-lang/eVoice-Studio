# Music Studio

A page of its own (`/music`, "Music Studio" in the sidebar and command palette) for generating music
locally with ACE-Step 1.5 (MIT). The same engine powers the optional **AI background music** panel in Dub.

- **Install:** the first visit shows *Install music engine*. It downloads the pinned ACE-Step source,
  its Python environment (`uv sync --locked`, torch included) and the model (about 10 GB on its own),
  about 15 GB in total, into `<engines dir>/acestep`. Nothing is uploaded; generation runs on this computer.
- **Install progress:** the two long steps print almost nothing, so the backend measures bytes on disk
  every few seconds: the Python environment shows the amount downloaded so far (its total is not known
  up front), the model shows downloaded of total. A step whose bytes stop growing for 20 minutes is
  stopped with an error; files already downloaded are kept, so trying again resumes. Hugging Face's
  progress bars are switched off for the model step: their carriage-return redraws overflowed the
  line reader and aborted the install.
- **PyTorch download:** on Windows and Linux x64 the CUDA torch wheel (about 3 GB) is not left to
  `uv`, which restarts a dropped transfer from zero. `uv sync --dry-run` names the torch version to
  install, the wheel and its SHA-256 come from the engine's `uv.lock`, and the backend downloads it
  with HTTP Range into `<engines dir>/acestep/.wheels`, continuing after a dropped connection or an
  app restart. The verified file is installed with `uv pip install --no-index`; everything else
  comes from `uv sync --no-install-package torch`.
- **Generate:** describe the music, choose instrumental or add lyrics, length (10–240 s) and an
  optional BPM. Tracks are saved to the library (`<data dir>/music`, an audio file plus a `.json` per
  track), where they can be played, downloaded and deleted.
- **Style tags and song sections:** *Style tags* adds genre, instrument and mood words the model
  understands to the description (in English, the model's vocabulary). Above the lyrics, the section
  buttons insert `[intro]`, `[verse]`, `[pre-chorus]`, `[chorus]`, `[bridge]`, `[outro]` or
  `[instrumental]` on a line of its own at the cursor; ACE-Step uses them to shape the song.
- **Vocal language:** with lyrics, pick the language they are sung in (ACE-Step's 50 languages; it
  starts on the app language when ACE-Step supports it). A wrong language garbles pronunciation.
- **Advanced:** key (24 major and minor keys, or Auto), time signature (2/4, 3/4, 4/4, 6/8, or Auto)
  and seed. Each saved track records the seed the server actually used, and *Reuse seed* puts it back
  in the form to refine a take you liked. *Reuse settings* puts every setting of a saved track back.
  - **Variants:** 1–4 versions in one run (the server allows 8; 4 keeps memory and waiting in check).
    Each is saved as its own track, marked *Variant 1…4*, with its own seed. With a fixed seed only
    *Variant 1* uses it; ACE-Step draws the others (seeds run 0–4,294,967,295). The library must have
    room for all of them before the run starts. Re-running one variant's seed alone gives very close,
    not bit-identical, audio; a single track on the same seed and settings repeats exactly.
  - **Steps:** 4–8 on Turbo (default 8). The pinned engine clamps Turbo to 8 steps, so more would
    change nothing; fewer are faster and rougher.
  - **Sampler:** *Stable (ODE)*, the default, or *Varied (SDE)*, which adds randomness at each step.
  - **File format:** WAV (default), FLAC or MP3; the library serves each with its own media type.
- **Thinking:** off by default. When on, ACE-Step's 5Hz language model plans the song (its audio codes)
  before the DiT renders it, and fills a BPM, key or time signature left on Auto. The caption, lyrics
  and language stay exactly what you wrote. It is slower, and switching Thinking on or off restarts the
  music server, because a loaded language model also changes requests that did not ask for it.
  - Which model runs follows ACE-Step's own GPU tiers, measured once in the engine's Python:
    more than 12 GB uses the 1.7B model that ships with the main download; 6–12 GB uses the 0.6B model,
    a pinned optional download of about 1.4 GB (`ACE-Step/acestep-5Hz-lm-0.6B`, MIT) into
    `<engines dir>/acestep/src/checkpoints`; 6 GB or less, and CPU-only machines, cannot use Thinking
    and the switch says so. This depends on hardware, not on the operating system.
  - No download happens at startup: the model named is already on disk and is the one ACE-Step's own
    tiering picks (it reads total GPU memory, so the answer is fixed per machine). As a backstop the
    server runs with its download source fixed (no google.com probe), Hugging Face offline and an
    unreachable proxy for everything but loopback, so a fallback fetch from Hugging Face or
    ModelScope fails instead of downloading an unpinned model.
  - **Expert: language model** (shown while Thinking is on, closed by default): temperature 0.1–2
    (0.85), prompt guidance 1–5 (2.5), top-K off or 1–200, top-P 0.1–1 (0.9), repetition penalty 1–2
    (1.0) and a negative prompt (up to 500 characters). Values left at the engine's defaults are not
    sent, so an untouched form sends exactly what it did before; *Restore defaults* resets them. The
    values used are saved with the track.
  - Custom timestep schedules are not offered: the pinned engine's REST API does not read them.
  - The server loads the model before it reports ready (eager init). If startup reports anything but
    that model loaded, the server is stopped and the track fails with a message instead of running
    without the model.
- **Cover and Repaint:** *Mode* switches between *New song*, *Cover* and *Repaint*; the selected
  track also has *Cover* and *Repaint* shortcuts. Both take a source: a library track, or a file you
  upload (WAV, MP3, FLAC, OGG or M4A, up to 100 MB and 10 minutes; M4A is stored as FLAC, because
  the engine cannot read it). The result keeps the source's
  length and is saved as a new track; the source is never changed.
  - *Cover* plays the source again in the style you describe. *Stay close to the original* (0–100 %,
    default 70 %) sets how much of the source survives; low values are a looser style transfer.
  - *Repaint* regenerates the region you select (it starts on the middle third) and keeps the rest.
    *How much to change*: Little, Balanced (with a strength) or Freely.
  - **Style reference** (under Advanced, any mode): an optional track or upload whose sound,
    instruments and mood the new music follows.
  - **Uploads stay local and are named by id only.** `POST /music/upload` stores the file under
    `<data dir>/music/uploads` (the newest 20 are kept), checks it with ffprobe and returns an id;
    requests name sources by library or upload id and the backend resolves the path itself. The file
    is handed to the ACE-Step server as a multipart upload, because the server only accepts absolute
    paths inside its own temp folder.
  - *Extend* (also a shortcut on the selected track) adds 5–120 s of new music after the end or before
    the start of the source, up to 10 minutes in all; the result is a new, longer track. *Smooth join*
    (0–10 s, default 2) redoes that much of the source with the new part so the seam is not heard; the
    rest of the source is kept exactly (checked on the pinned engine). It is a repaint past the source's
    edge: `repainting_end` beyond its length, or a negative `repainting_start`, and the server pads the
    source with silence and fills it. *How much to change* applies as for Repaint.
- **Polish with the language model:** shown once Thinking's model is ready. It sends the description,
  lyrics and settings to ACE-Step's formatter, which tidies the description and lyrics and suggests a
  BPM, key, time signature, length and language. A dialog shows each change next to your own; nothing
  changes until you choose *Apply changes*. Every suggestion is checked like user input (an unknown key
  or a BPM out of range is dropped). It runs on the same language-model server as Thinking. The 0.6B
  model writes English well but garbles Vietnamese lyrics; review them before applying.
- **Models (Advanced → Model):** *Turbo* (default, installed with the engine: 4–8 steps, no
  guidance) or the optional *SFT* and *Base* models (about 4.8 GB each, MIT, pinned downloads of
  `ACE-Step/acestep-v15-sft` and `ACE-Step/acestep-v15-base` into `<engines dir>/acestep/src/checkpoints`).
  SFT and Base run 8–64 steps (32 to start) and show the options Turbo ignores: *Guidance (CFG)*
  1–15, *Shift* 1–5, the *Guidance interval* and *Adaptive guidance (ADG)*; those are only sent for
  them. Switching models restarts the music server with that model; a model that is not downloaded
  is refused before the server starts, and SFT/Base run with the same offline guard as Thinking, so
  ACE-Step's fallback can never fetch an unpinned model. Each saved track records its model.
- **LoRA (Advanced, desktop app only):** *Choose a LoRA file* (a LoKr/LyCORIS `.safetensors`) or
  *Choose a LoRA folder* (a PEFT adapter with `adapter_config.json`, or `lokr_weights.safetensors`).
  The path comes only from the app's own file dialog: Electron main checks the choice and writes a
  one-shot grant, the page sends the grant token, and `POST /music/lora` (admin and desktop only)
  turns it into the path. The page never sees or sends a path, and the browser build has no picker.
  The choice is kept in `<data dir>/music/lora.json`. You can turn it on or off, set its strength
  (0–100 %) or remove it. A LoRA only fits the DiT it was trained for, so the page warns when another
  model is selected. While a LoRA is on, the music server loads its model at startup (a LoRA needs it
  in memory) and the LoRA is loaded again after any restart. Saved tracks record its name and strength.
  Nothing is downloaded, and the LoRA's license is yours to check. Training LoRAs is not part of the app.
- **Memory:** the music server starts on demand, listens on a random loopback port with a random key and
  stops after 5 minutes idle. *Free GPU memory* stops it immediately. Measured on an RTX 3060 12 GB
  (Windows): the first start takes about 3 minutes, then a 30–40 s Turbo track takes 6–8 s and about
  7.3 GB; Thinking with the 0.6B model 27 s (85 s when it restarts the server); repaint and cover up to
  9.7 GB; SFT at 32 steps about 22 s. Do not generate music and dub at the
  same time on a small GPU.
- **API:** `GET /music/status`, `GET /music/install-stream`, `GET /music/lm` (which language model
  Thinking uses here and whether it is ready), `GET /music/lm-install-stream` (download the 0.6B model),
  `POST /music/generate` (SSE; adds `vocal_language`, `key_scale`, `time_signature`, `thinking`,
  `batch_size`, `inference_steps`, `infer_method`, `audio_format`; a `track` event per saved variant,
  then `done` with `tracks`; `task`, `source_track_id`/`source_upload_id`,
  `reference_track_id`/`reference_upload_id`, `cover_strength`, `repaint_start`, `repaint_end`,
  `repaint_mode`, `repaint_strength`; `task=extend` with `extend_side`, `extend_seconds`, `extend_overlap`;
  with Thinking `lm_temperature`, `lm_cfg_scale`, `lm_top_k`, `lm_top_p`, `lm_repetition_penalty`,
  `lm_negative_prompt`), `POST /music/format` (the formatter's suggestions, nothing
  saved), `POST /music/upload` (multipart `file`; returns `upload_id`, `name`, `duration`),
  `GET /music/models` (turbo, sft, base and which are downloaded), `GET /music/model-install-stream?model=sft|base`
  (SSE), and on generate `model`, `guidance_scale`, `shift`, `use_adg`, `cfg_interval_start`, `cfg_interval_end`,
  `GET`/`POST`/`PATCH`/`DELETE /music/lora` (the POST takes only a desktop grant `authorization`
  and the target `model`),
  `GET /music/library`, `GET /music/audio/{id}`, `DELETE /music/library/{id}`, `POST /music/stop`.

## GPU exclusion

Dubbing (dub generate, ASR transcription, on-screen subtitle OCR/removal) and the ACE-Step music server never share the GPU (`backend/services/gpu_exclusive.py`). Starting one of those jobs stops an idle music server; if a track is being generated, the job is refused with `gpu_busy`. Generating music (Music Studio or background music) while such a job runs is refused the same way.
