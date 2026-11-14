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
  optional BPM. Tracks are saved to the library (`<data dir>/music`, a `.wav` plus a `.json` per track),
  where they can be played, downloaded and deleted.
- **Vocal language:** with lyrics, pick the language they are sung in (ACE-Step's 50 languages; it
  starts on the app language when ACE-Step supports it). A wrong language garbles pronunciation.
- **Advanced:** key (24 major and minor keys, or Auto), time signature (2/4, 3/4, 4/4, 6/8, or Auto)
  and seed. Each saved track records the seed the server actually used, and *Reuse seed* puts it back
  in the form to refine a take you liked.
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
  - The server loads the model before it reports ready (eager init). If startup reports anything but
    that model loaded, the server is stopped and the track fails with a message instead of running
    without the model.
- **Not available yet:** guidance (CFG), shift and the other base-model options have no effect on the
  turbo model installed here, so they are not shown. Cover, repaint and extend are planned.
- **Memory:** the music server starts on demand, listens on a random loopback port with a random key and
  stops after 5 minutes idle. *Free GPU memory* stops it immediately. Do not generate music and dub at the
  same time on a small GPU.
- **API:** `GET /music/status`, `GET /music/install-stream`, `GET /music/lm` (which language model
  Thinking uses here and whether it is ready), `GET /music/lm-install-stream` (download the 0.6B model),
  `POST /music/generate` (SSE; adds `vocal_language`, `key_scale`, `time_signature`, `thinking`),
  `GET /music/library`, `GET /music/audio/{id}`, `DELETE /music/library/{id}`, `POST /music/stop`.

## GPU exclusion

Dubbing (dub generate, ASR transcription, on-screen subtitle OCR/removal) and the ACE-Step music server never share the GPU (`backend/services/gpu_exclusive.py`). Starting one of those jobs stops an idle music server; if a track is being generated, the job is refused with `gpu_busy`. Generating music (Music Studio or background music) while such a job runs is refused the same way.
