"""AI background music for Dub jobs via a local ACE-Step UI server.

ACE-Step 1.5 (MIT) generates royalty-free instrumental music. We talk to the
ace-step-ui backend (default http://127.0.0.1:3001), which wraps the ACE-Step
Gradio API (port 8001) behind a small REST API:

    GET  /api/auth/auto            -> {token}       (404 until a local user exists)
    POST /api/auth/setup           -> {token}       (create the local user)
    POST /api/generate             -> {jobId}
    GET  /api/generate/status/{id} -> {status, progress, stage, result:{audioUrls}}
    GET  /audio/<file>                              (generated file)

Nothing here is required by the rest of VoiceStudio: when the server is not
running, the feature reports "not running" and does nothing.
"""
from __future__ import annotations

import asyncio
import os
from typing import AsyncIterator, Optional

import httpx

DEFAULT_URL = "http://127.0.0.1:3001"
_LOCAL_USER = "voicestudio"
MAX_TRACK_SECONDS = 240  # ACE-Step handles ~4 min well; longer videos loop the track


def base_url() -> str:
    url = (os.environ.get("ACESTEP_UI_URL") or DEFAULT_URL).rstrip("/")
    # Local-only by design: the music server receives no user data but must
    # never be pointed at a remote host by configuration mistakes.
    host = httpx.URL(url).host
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise RuntimeError("ACESTEP_UI_URL must point at this computer (127.0.0.1).")
    return url


async def status() -> dict:
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(f"{base_url()}/api/generate/health")
            data = r.json() if r.status_code == 200 else {}
            return {"running": True, "model_ready": bool(data.get("healthy")), "url": base_url()}
    except Exception as exc:
        return {"running": False, "model_ready": False, "url": DEFAULT_URL, "error": str(exc)[:200]}


async def _token(client: httpx.AsyncClient) -> str:
    r = await client.get(f"{base_url()}/api/auth/auto")
    if r.status_code == 404:
        r = await client.post(f"{base_url()}/api/auth/setup", json={"username": _LOCAL_USER})
    r.raise_for_status()
    token = r.json().get("token")
    if not token:
        raise RuntimeError("The music server did not return an access token.")
    return token


async def generate(style: str, duration: float, out_path: str, seed: Optional[int] = None,
                   bpm: Optional[int] = None) -> AsyncIterator[dict]:
    """Generate one instrumental track; yields progress events, writes `out_path`."""
    seconds = int(max(10, min(MAX_TRACK_SECONDS, round(duration))))
    payload = {
        "customMode": True,
        "style": style.strip() or "calm cinematic background music",
        "lyrics": "",
        "instrumental": True,
        "duration": seconds,
        "batchSize": 1,
        "audioFormat": "wav",
        "thinking": False,
        "randomSeed": seed is None,
    }
    if seed is not None:
        payload["seed"] = int(seed)
    if bpm:
        payload["bpm"] = int(bpm)
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, read=600.0)) as client:
        headers = {"Authorization": f"Bearer {await _token(client)}"}
        r = await client.post(f"{base_url()}/api/generate", json=payload, headers=headers)
        if r.status_code >= 400:
            raise RuntimeError(f"Music generation was refused: {r.text[:300]}")
        job_id = r.json()["jobId"]
        yield {"type": "progress", "progress": 0.02, "message": "queued"}
        while True:
            await asyncio.sleep(2.0)
            s = (await client.get(f"{base_url()}/api/generate/status/{job_id}", headers=headers)).json()
            state = s.get("status")
            if state == "failed":
                raise RuntimeError(s.get("error") or "Music generation failed.")
            if state == "succeeded":
                urls = ((s.get("result") or {}).get("audioUrls") or [])
                if not urls:
                    raise RuntimeError("Music generation finished without a file.")
                url = urls[0]
                if not url.startswith("/"):
                    raise RuntimeError("Unexpected audio location from the music server.")
                audio = await client.get(f"{base_url()}{url}")
                audio.raise_for_status()
                tmp = out_path + ".part"
                with open(tmp, "wb") as f:
                    f.write(audio.content)
                os.replace(tmp, out_path)
                yield {"type": "done", "seconds": seconds}
                return
            progress = s.get("progress")
            yield {"type": "progress",
                   "progress": float(progress) / 100 if isinstance(progress, (int, float)) and progress > 1
                   else float(progress or 0.1),
                   "message": str(s.get("stage") or state or "")}
