import asyncio

import pytest

from services import gpu_exclusive


@pytest.fixture(autouse=True)
def _reset():
    gpu_exclusive.register_music_stop(None)
    yield
    gpu_exclusive.register_music_stop(None)
    assert gpu_exclusive.state() == {"dub_active": 0, "music_active": 0}


def test_dub_job_stops_idle_music_server():
    stopped = []

    async def stop():
        stopped.append(gpu_exclusive.state()["dub_active"])

    gpu_exclusive.register_music_stop(stop)

    async def run():
        async with gpu_exclusive.dub_job():
            assert gpu_exclusive.state()["dub_active"] == 1

    asyncio.run(run())
    assert stopped == [1]


def test_music_refused_while_dub_runs():
    async def run():
        async with gpu_exclusive.dub_job():
            with pytest.raises(gpu_exclusive.GpuBusy):
                with gpu_exclusive.music_job():
                    pass

    asyncio.run(run())


def test_dub_refused_while_music_generates_and_music_not_stopped():
    stopped = []

    async def stop():
        stopped.append(1)

    gpu_exclusive.register_music_stop(stop)

    async def run():
        with gpu_exclusive.music_job():
            with pytest.raises(gpu_exclusive.GpuBusy):
                async with gpu_exclusive.dub_job():
                    pass

    asyncio.run(run())
    assert stopped == []


def test_released_on_error_and_stop_failure_does_not_block():
    async def stop():
        raise OSError("boom")

    gpu_exclusive.register_music_stop(stop)

    async def run():
        with pytest.raises(ValueError):
            async with gpu_exclusive.dub_job():
                raise ValueError("job failed")
        async with gpu_exclusive.dub_job():
            pass
        with gpu_exclusive.music_job():
            pass

    asyncio.run(run())


def test_music_generate_stream_reports_gpu_busy_with_code():
    import json

    from fastapi.testclient import TestClient

    from api.routers import music as music_router
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(music_router.router)

    async def hold():
        async with gpu_exclusive.dub_job():
            return await asyncio.to_thread(_post, app)

    def _post(a):
        import services.music as m

        orig = m.is_installed
        m.is_installed = lambda: True
        try:
            return TestClient(a).post("/music/generate", json={"prompt": "calm"}).text
        finally:
            m.is_installed = orig

    body = asyncio.run(hold())
    assert '"error_code": "gpu_busy"' in body and '"busy_with": "dub"' in body
    assert json.dumps("gpu_busy") in body


def test_only_one_music_job_at_a_time():
    with gpu_exclusive.music_job():
        with pytest.raises(gpu_exclusive.GpuBusy) as info:
            with gpu_exclusive.music_job():
                pass
        assert info.value.busy_with == "music"


def test_dub_busy_reports_who_holds_the_gpu():
    async def run():
        async with gpu_exclusive.dub_job():
            with pytest.raises(gpu_exclusive.GpuBusy) as info:
                with gpu_exclusive.music_job():
                    pass
            assert info.value.busy_with == "dub"

    asyncio.run(run())
