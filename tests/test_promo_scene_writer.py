"""Promo scene writer: only the confirmed, configured provider is ever called.

settings_store is in-memory and the LLM call is monkeypatched, so nothing here
touches the network.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

os.environ.setdefault("OMNIVOICE_MODEL", "test")
os.environ.setdefault("OMNIVOICE_DISABLE_FILE_LOG", "1")

GOOD = {
    "name": "Sale banner",
    "duration": 4,
    "html": '<div class="b">{{title}}</div>',
    "css": ".b { color: {{ink}}; animation: in 1s both; } @keyframes in { from { opacity: 0 } }",
    "js": "",
    "params": [
        {"key": "title", "type": "text", "label": "Title", "value": "Giảm 50%"},
        {"key": "ink", "type": "color", "label": "Ink", "value": "#FFD400"},
    ],
}


@pytest.fixture
def store(monkeypatch, clean_llm_env):
    from services import settings_store as ss

    text: dict[str, str] = {}
    secrets: dict[str, str] = {}
    monkeypatch.setattr(ss, "get_text", lambda k, default=None: text.get(k, default))
    monkeypatch.setattr(ss, "set_text", lambda k, v: text.__setitem__(k, v))
    monkeypatch.setattr(ss, "get_secret", lambda n: secrets.get(n))
    monkeypatch.setattr(
        ss, "set_secret",
        lambda n, v: secrets.__setitem__(n, v) if v else secrets.pop(n, None))
    monkeypatch.setattr(ss, "list_secret_names", lambda: list(secrets))
    from core import prefs
    monkeypatch.setattr(prefs, "get", lambda key, default=None: text.get("pref." + key, default))
    return types.SimpleNamespace(text=text, secrets=secrets)


@pytest.fixture
def calls(monkeypatch):
    """Replace the network call; record which provider would have been used."""
    from services import llm_backend

    seen: list[dict] = []
    reply = {"text": json.dumps(GOOD)}

    def chat(self, *, system, user, timeout=None, temperature=None, reasoning_effort=None):
        seen.append({"provider": self._provider.id if self._provider else None,
                     "system": system, "user": user})
        return reply["text"]

    monkeypatch.setattr(llm_backend.OpenAICompatBackend, "chat", chat)
    return types.SimpleNamespace(seen=seen, reply=reply)


def _activate(store, pid="groq"):
    store.secrets[f"llm_key.{pid}"] = "test-key"
    store.text["llm.active_provider"] = pid


def _writer():
    from services import promo_scene_writer
    return promo_scene_writer


def test_no_provider_is_not_ready_and_never_calls(store, calls):
    w = _writer()
    assert w.describe() == {"ready": False, "reason": "no_provider", "provider_id": None,
                            "display_name": None, "local": None, "transport": None}
    with pytest.raises(w.WriterError) as err:
        w.write_scene("a banner", "groq", "overlay", "en")
    assert err.value.code == "no_provider" and err.value.status == 409
    assert calls.seen == []


def test_describe_names_the_active_provider(store):
    _activate(store)
    info = _writer().describe()
    assert info["ready"] is True
    assert info["provider_id"] == "groq"
    assert info["display_name"]
    assert info["local"] is False


def test_kill_switch_blocks_the_call(store, calls, monkeypatch):
    _activate(store)
    monkeypatch.setenv("OMNIVOICE_LLM_BACKEND", "off")
    w = _writer()
    assert w.describe()["reason"] == "disabled"
    with pytest.raises(w.WriterError) as err:
        w.write_scene("a banner", "groq", "overlay", "en")
    assert err.value.code == "disabled"
    assert calls.seen == []


def test_llm_preference_off_blocks_the_call(store, calls):
    _activate(store)
    store.text["pref.llm_backend"] = "off"
    w = _writer()
    with pytest.raises(w.WriterError) as err:
        w.write_scene("a banner", "groq", "overlay", "en")
    assert err.value.code == "disabled"
    assert calls.seen == []


def test_provider_changed_after_it_was_shown_is_refused(store, calls):
    _activate(store, "groq")
    w = _writer()
    shown = w.describe()["provider_id"]
    _activate(store, "openai")
    with pytest.raises(w.WriterError) as err:
        w.write_scene("a banner", shown, "overlay", "en")
    assert err.value.code == "provider_changed" and err.value.status == 409
    assert calls.seen == []


def test_unconfigured_provider_never_falls_back(store, calls):
    store.secrets["llm_key.groq"] = "test-key"  # a configured provider exists...
    store.text["llm.active_provider"] = "openai"  # ...but the chosen one has no key
    w = _writer()
    assert w.describe()["reason"] == "unconfigured"
    with pytest.raises(w.WriterError):
        w.write_scene("a banner", "openai", "overlay", "en")
    assert calls.seen == []


def test_calls_only_the_confirmed_provider_with_the_description(store, calls):
    _activate(store)
    scene = _writer().write_scene("  a yellow sale banner  ", "groq", "shot", "vi")
    assert len(calls.seen) == 1
    assert calls.seen[0]["provider"] == "groq"
    assert calls.seen[0]["user"] == "a yellow sale banner"
    assert "FULL-FRAME" in calls.seen[0]["system"]
    assert '"vi"' in calls.seen[0]["system"]
    assert scene["id"] is None and scene["assets"] == []
    assert scene["name"] == "Sale banner"
    assert scene["params"][1]["value"] == "#ffd400"


def test_description_limits(store, calls):
    _activate(store)
    w = _writer()
    for text, code in (("   ", "empty"), ("x" * (w.MAX_DESCRIPTION + 1), "too_long")):
        with pytest.raises(w.WriterError) as err:
            w.write_scene(text, "groq", "overlay", "en")
        assert err.value.code == code
    assert calls.seen == []


def test_provider_failure_is_reported_without_details(store, calls, monkeypatch):
    from services import llm_backend

    _activate(store)

    def boom(self, **_):
        raise RuntimeError("secret upstream body")

    monkeypatch.setattr(llm_backend.OpenAICompatBackend, "chat", boom)
    w = _writer()
    with pytest.raises(w.WriterError) as err:
        w.write_scene("a banner", "groq", "overlay", "en")
    assert err.value.code == "provider_failed" and err.value.status == 502
    assert "secret" not in str(err.value)


# ── Reply parsing: untrusted model output ─────────────────────────────────────


def test_reply_in_a_code_fence_is_accepted():
    scene = _writer().parse_reply("```json\n" + json.dumps(GOOD) + "\n```")
    assert scene["html"] == GOOD["html"]


@pytest.mark.parametrize("reply", ["no json here", "{not json}", json.dumps({"css": "a{}"}),
                                   json.dumps({"html": "   "}), json.dumps(["html"])])
def test_bad_replies_are_refused(reply):
    w = _writer()
    with pytest.raises(w.WriterError) as err:
        w.parse_reply(reply)
    assert err.value.code == "bad_reply"


def test_oversized_code_is_refused():
    w = _writer()
    big = dict(GOOD, css="a{}" * (w.MAX_CODE_BYTES // 3 + 1))
    with pytest.raises(w.WriterError) as err:
        w.parse_reply(json.dumps(big))
    assert err.value.code == "too_large"


def test_params_are_cleaned_to_the_scene_rules():
    w = _writer()
    params = [
        {"key": "Title", "type": "text", "value": "bad key"},
        {"key": "width", "type": "text", "value": "reserved"},
        {"key": "logo", "type": "image", "value": "../../etc/passwd"},
        {"key": "bg", "type": "color", "value": "red"},
        {"key": "t", "type": "script", "value": "x"},
        {"key": "msg", "type": "text", "label": "L" * 99, "value": "v\n" * 300},
        {"key": "msg", "type": "text", "value": "duplicate"},
    ] + [{"key": f"k{n}", "type": "text", "value": "x"} for n in range(20)]
    scene = w.parse_reply(json.dumps(dict(GOOD, params=params, duration="x", name="N" * 99)))
    keys = [p["key"] for p in scene["params"]]
    assert keys[:3] == ["logo", "bg", "msg"]
    assert len(keys) == w.MAX_PARAMS
    by_key = {p["key"]: p for p in scene["params"]}
    assert by_key["logo"]["value"] == ""  # a model never names a file
    assert by_key["bg"]["value"] == "#ffffff"
    assert len(by_key["msg"]["label"]) == w.MAX_LABEL
    assert len(by_key["msg"]["value"]) <= w.MAX_TEXT and "\n" not in by_key["msg"]["value"]
    assert scene["duration"] == 5.0
    assert len(scene["name"]) == w.MAX_NAME


def test_duration_is_clamped():
    w = _writer()
    assert w.parse_reply(json.dumps(dict(GOOD, duration=999)))["duration"] == w.MAX_SECONDS
    assert w.parse_reply(json.dumps(dict(GOOD, duration=0)))["duration"] == w.MIN_SECONDS


# ── Router ────────────────────────────────────────────────────────────────────


def test_router_maps_refusals_to_codes(store, calls):
    from fastapi import HTTPException

    from api.routers import promo

    req = promo.SceneWriterRequest(description="a banner", provider_id="groq")
    with pytest.raises(HTTPException) as err:
        asyncio.run(promo.promo_scene_write(req))
    assert err.value.status_code == 409 and err.value.detail == "scene_writer:no_provider"

    bad = promo.SceneWriterRequest(description="a banner", provider_id="groq",
                                   language="en; drop")
    with pytest.raises(HTTPException) as err:
        asyncio.run(promo.promo_scene_write(bad))
    assert err.value.detail == "scene_writer:language"


def test_router_returns_the_draft(store, calls):
    from api.routers import promo

    _activate(store)
    info = asyncio.run(promo.promo_scene_writer())
    assert info["provider_id"] == "groq"
    out = asyncio.run(promo.promo_scene_write(promo.SceneWriterRequest(
        description="a banner", provider_id="groq", shape="overlay", language="vi")))
    assert out["scene"]["params"][0]["value"] == "Giảm 50%"


def test_loopback_custom_server_counts_as_this_machine(store, monkeypatch):
    monkeypatch.setenv("TRANSLATE_BASE_URL", "http://127.0.0.1:8000/v1")
    monkeypatch.setenv("TRANSLATE_MODEL", "m")
    info = _writer().describe()
    assert info["provider_id"] == "custom" and info["local"] is True
    monkeypatch.setenv("TRANSLATE_BASE_URL", "https://llm.example.com/v1")
    assert _writer().describe()["local"] is False
