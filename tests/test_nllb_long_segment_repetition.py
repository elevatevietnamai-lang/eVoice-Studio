"""NLLB translates long segments sentence by sentence, with a repeat guard.

Fed a whole paragraph, NLLB looped: "khoa học" came back nineteen times in
one Vietnamese segment. It is a sentence-level model; long text is now split
into sentence pieces, decoded with ``no_repeat_ngram_size``, and rejoined.
"""

import pytest

from services.mt_split import MT_PIECE_MAX_CHARS, join_mt_pieces, split_for_mt

_ZH_LONG = (
    "我们今天发布了旗舰版本。这个版本的画质媲美专业相机！"
    "它支持本地运行，不需要联网，也不需要账号？"
    "科学家们花了三年时间研究，科学的方法让产品更加稳定。"
    "接下来我们会介绍每一个功能，以及它们如何帮助你更快完成工作。"
)


def test_short_text_is_left_whole():
    assert split_for_mt("Hello there.") == ["Hello there."]


def test_long_text_splits_at_sentence_ends_in_order():
    pieces = split_for_mt(_ZH_LONG)
    assert len(pieces) > 1
    assert "".join(pieces) == _ZH_LONG
    assert all(len(piece) <= MT_PIECE_MAX_CHARS for piece in pieces)
    assert all(piece[-1] in "。！？" for piece in pieces)


def test_unpunctuated_asr_text_falls_back_to_clauses_then_a_hard_cap():
    clauses = "，".join(["我们今天讨论科学的方法和它的应用"] * 20)
    pieces = split_for_mt(clauses)
    assert len(pieces) > 1
    assert "".join(pieces) == clauses
    assert all(len(piece) <= MT_PIECE_MAX_CHARS for piece in pieces)
    run = "科" * 500
    assert "".join(split_for_mt(run)) == run
    assert all(len(piece) <= MT_PIECE_MAX_CHARS for piece in split_for_mt(run))


def test_latin_text_splits_after_full_stops():
    text = " ".join(["This is one sentence about science and its methods."] * 6)
    pieces = split_for_mt(text)
    assert len(pieces) > 1
    assert " ".join(pieces) == text


def test_join_uses_no_space_for_chinese_and_japanese_targets():
    assert join_mt_pieces(["Xin chào.", "Tạm biệt."], "vie_Latn") == "Xin chào. Tạm biệt."
    assert join_mt_pieces(["你好。", "再见。"], "zho_Hans") == "你好。再见。"


@pytest.mark.asyncio
async def test_nllb_translates_pieces_with_a_repeat_guard_and_rejoins(monkeypatch):
    from api.routers import dub_translate
    from schemas.requests import TranslateRequest
    from services import performance_profiles, translation_engines

    class FakeTokenizer:
        src_lang = None

        def __call__(self, texts, **kwargs):
            return {"input_ids": list(texts)}

        def convert_tokens_to_ids(self, target):
            return target

        def batch_decode(self, tokens, **kwargs):
            return list(tokens)

    class FakeModel:
        def __init__(self):
            self.inputs = []
            self.kwargs = []

        def generate(self, *, input_ids, forced_bos_token_id, **kwargs):
            self.inputs.extend(input_ids)
            self.kwargs.append(kwargs)
            return [f"<{text}>" for text in input_ids]

    model = FakeModel()
    monkeypatch.setattr(dub_translate, "_nllb_tokenizer", FakeTokenizer())
    monkeypatch.setattr(dub_translate, "_nllb_model", model)
    monkeypatch.setattr(dub_translate, "_nllb_device", "cpu")
    monkeypatch.setattr(translation_engines, "is_installed", lambda _: True)
    monkeypatch.setattr(translation_engines, "is_ready", lambda _: True)
    monkeypatch.setattr(performance_profiles, "translation_decode_defaults", lambda: {"num_beams": 2})
    monkeypatch.setenv("OMNIVOICE_UNLOAD_NLLB", "0")

    request = TranslateRequest(
        provider="nllb", source_lang="zh", target_lang="vi", quality="fast",
        segments=[{"id": "long", "text": _ZH_LONG}, {"id": "short", "text": "你好。"}],
    )
    response = await dub_translate.dub_translate(request)

    pieces = split_for_mt(_ZH_LONG)
    assert model.inputs.count("你好。") == 1
    assert [text for text in model.inputs if text != "你好。"] == pieces
    assert all(kw["no_repeat_ngram_size"] == 3 and kw["num_beams"] == 2 for kw in model.kwargs)
    rows = {row["id"]: row["text"] for row in response["translated"]}
    assert rows["long"] == " ".join(f"<{piece}>" for piece in pieces)
    assert rows["short"] == "<你好。>"
