"""An LLM translation into a non-CJK language must not keep source Han.

qwen2.5:7b translating Chinese to Vietnamese returned "phiên bản" followed by
the untranslated Han for "flagship". The script-ratio gate passed it — the
line is mostly Latin — so it reached the dub. Now the segment is retried once
with the leaked characters named, and flagged if they survive.
"""

import types

import pytest

from services.translator import cjk_leak, refine_output_ok

HAN = "旗舰"  # "flagship", the characters qwen2.5:7b left in place


def test_cjk_leak_only_for_non_cjk_targets():
    assert cjk_leak(f"phiên bản{HAN}", "vi") == HAN
    assert cjk_leak("phiên bản cao cấp", "vi") == ""
    assert cjk_leak(f"{HAN}版本", "zh") == ""
    assert cjk_leak(f"{HAN}", "ja") == ""
    assert cjk_leak("가나", "en-US") == "가나"


def test_refine_pass_cannot_reintroduce_cjk():
    ok, reason = refine_output_ok("phiên bản cao cấp", f"phiên bản{HAN}", "vi")
    assert not ok and reason.endswith("cjk-leak")


class _ScriptedLLM:
    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts = []
        outer = self

        class _Completions:
            def create(self, **kw):
                outer.prompts.append(kw["messages"][0]["content"])
                msg = types.SimpleNamespace(content=outer.replies.pop(0))
                return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])

        self.chat = types.SimpleNamespace(completions=_Completions())


async def _translate(monkeypatch, replies):
    from api.routers import dub_translate
    from schemas.requests import TranslateRequest, TranslateSegment
    from services import llm_skills, translation_engines

    for var in ("TRANSLATE_API_KEY", "TRANSLATE_BASE_URL", "TRANSLATE_MODEL"):
        monkeypatch.delenv(var, raising=False)
    fake = _ScriptedLLM(replies)
    handle = types.SimpleNamespace(client=fake, model="m", provider_id="ollama", timeout=5.0)
    monkeypatch.setattr(llm_skills, "resolve_skill_client", lambda sid: handle)
    monkeypatch.setattr(translation_engines, "is_ready", lambda provider: True)
    req = TranslateRequest(
        segments=[TranslateSegment(id="s1", text=f"{HAN}版本")],
        target_lang="vi", provider="openai", source_lang="zh", quality="fast",
        auto_glossary=False, reflect=False,
    )
    return fake, (await dub_translate.dub_translate(req))["translated"][0]


@pytest.mark.asyncio
async def test_leaked_line_is_retried_naming_the_characters(monkeypatch):
    fake, row = await _translate(monkeypatch, [f"phiên bản{HAN}", "phiên bản cao cấp"])
    assert row["text"] == "phiên bản cao cấp"
    assert "script_leak" not in row
    assert len(fake.prompts) == 2
    assert HAN in fake.prompts[1]


@pytest.mark.asyncio
async def test_a_leak_that_survives_the_retry_is_kept_and_flagged(monkeypatch):
    fake, row = await _translate(monkeypatch, [f"phiên bản{HAN}", f"bản{HAN}"])
    # The mostly translated line is kept, not swapped back to the source.
    assert row["text"] == f"bản{HAN}"
    assert row["script_leak"] == HAN
    assert "error" not in row
