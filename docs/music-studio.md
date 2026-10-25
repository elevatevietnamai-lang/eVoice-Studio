# Music Studio

A page of its own (`/music`, "Music Studio" in the sidebar and command palette) for generating music
locally with ACE-Step 1.5 (MIT). The same engine powers the optional **AI background music** panel in Dub.

- **Install:** the first visit shows *Install music engine*. It downloads the pinned ACE-Step source,
  its Python environment (`uv sync --locked`, torch included) and the model, about 8 GB in total, into
  `<engines dir>/acestep`. Nothing is uploaded; generation runs on this computer.
- **Generate:** describe the music, choose instrumental or add lyrics, length (10–240 s) and an
  optional BPM. Tracks are saved to the library (`<data dir>/music`, a `.wav` plus a `.json` per track),
  where they can be played, downloaded and deleted.
- **Memory:** the music server starts on demand, listens on a random loopback port with a random key and
  stops after 5 minutes idle. *Free GPU memory* stops it immediately. Do not generate music and dub at the
  same time on a small GPU.
- **API:** `GET /music/status`, `GET /music/install-stream`, `POST /music/generate` (SSE),
  `GET /music/library`, `GET /music/audio/{id}`, `DELETE /music/library/{id}`, `POST /music/stop`.
