"""Mutual exclusion between dubbing-side GPU work and the ACE-Step music server.

Both want most of the card's VRAM, so they never run together:

* a dub / ASR / on-screen-subtitle job stops an idle music server first and is
  refused while a track is actually being generated;
* a music generation is refused while any such job is running.

Counters are only touched from the event loop, and every check-and-increment
happens before the first ``await``, so there is no window between "is it free"
and "mark it taken".
"""
from __future__ import annotations

import contextlib
from typing import Awaitable, Callable, Iterator, AsyncIterator

DUB_BUSY_MESSAGE = "A dubbing job is using the GPU. Wait for it to finish, then generate music."
MUSIC_BUSY_MESSAGE = "Music is being generated on the GPU. Wait for it to finish, then run this step."
MAX_MUSIC_JOBS = 1

_dub_active = 0
_music_active = 0
_stop_music: Callable[[], Awaitable[None]] | None = None


class GpuBusy(RuntimeError):
    """The GPU is held by someone else; ``busy_with`` says who (``"dub"`` or ``"music"``)."""

    def __init__(self, message: str, busy_with: str):
        super().__init__(message)
        self.busy_with = busy_with


def register_music_stop(callback: Callable[[], Awaitable[None]] | None) -> None:
    global _stop_music
    _stop_music = callback


def state() -> dict:
    return {"dub_active": _dub_active, "music_active": _music_active}


@contextlib.contextmanager
def music_job() -> Iterator[None]:
    global _music_active
    if _dub_active:
        raise GpuBusy(DUB_BUSY_MESSAGE, "dub")
    if _music_active >= MAX_MUSIC_JOBS:
        raise GpuBusy(MUSIC_BUSY_MESSAGE, "music")
    _music_active += 1
    try:
        yield
    finally:
        _music_active -= 1


@contextlib.asynccontextmanager
async def dub_job() -> AsyncIterator[None]:
    global _dub_active
    if _music_active:
        raise GpuBusy(MUSIC_BUSY_MESSAGE, "music")
    _dub_active += 1
    try:
        if _stop_music is not None:
            try:
                await _stop_music()
            except Exception:  # a failed stop must not block dubbing
                pass
        yield
    finally:
        _dub_active -= 1
