"""Argos pairs with no direct pack install through the English pivot.

Argos publishes zh → en and en → vi but no zh → vi. Install raised "No Argos
language pack is available" and the Dub translate step stayed blocked for
good, although ``argostranslate.translate`` chains two installed packs itself.
"""

import sys
import types

import pytest

from services import translation_engines


class _Pack:
    def __init__(self, from_code, to_code):
        self.from_code, self.to_code = from_code, to_code

    def download(self):
        return f"{self.from_code}-{self.to_code}.argosmodel"


@pytest.fixture
def argos(monkeypatch):
    """A fake ``argostranslate.package`` over an in-memory index."""
    state = {"installed": set(), "index": set(), "downloads": []}
    package = types.ModuleType("argostranslate.package")
    package.get_installed_packages = lambda: [_Pack(*p) for p in sorted(state["installed"])]
    package.update_package_index = lambda: None
    package.get_available_packages = lambda: [_Pack(*p) for p in sorted(state["index"])]

    def install_from_path(path):
        pair = tuple(path.removesuffix(".argosmodel").split("-"))
        state["downloads"].append(pair)
        state["installed"].add(pair)

    package.install_from_path = install_from_path
    root = types.ModuleType("argostranslate")
    root.package = package
    monkeypatch.setitem(sys.modules, "argostranslate", root)
    monkeypatch.setitem(sys.modules, "argostranslate.package", package)
    monkeypatch.delenv("OMNIVOICE_CACHE_DIR", raising=False)
    return state


def test_pair_without_direct_pack_installs_both_english_legs(argos):
    argos["index"] = {("zh", "en"), ("en", "vi"), ("en", "zh")}
    status = translation_engines.install_argos_packs("zh", ["vi"])
    assert argos["downloads"] == [("zh", "en"), ("en", "vi")]
    assert status["pairs"] == [{
        "source_lang": "zh", "target_lang": "vi", "installed": True,
        "route": ["zh", "en", "vi"],
    }]


def test_status_counts_the_pivot_as_installed(argos):
    argos["installed"] = {("zh", "en"), ("en", "vi")}
    pair = translation_engines.argos_pack_status("zh-CN", ["vi"])["pairs"][0]
    assert pair["installed"] is True
    assert pair["route"] == ["zh", "en", "vi"]
    argos["installed"] = {("zh", "en")}
    assert translation_engines.argos_pack_status("zh", ["vi"])["pairs"][0]["installed"] is False


def test_direct_pack_is_preferred_and_installed_legs_are_reused(argos):
    argos["index"] = {("zh", "en"), ("en", "vi"), ("en", "zh"), ("en", "fr")}
    argos["installed"] = {("zh", "en")}
    translation_engines.install_argos_packs("zh", ["vi", "en"])
    assert argos["downloads"] == [("en", "vi")]
    argos["index"].add(("fr", "de"))
    argos["installed"] = set()
    argos["downloads"].clear()
    translation_engines.install_argos_packs("fr", ["de"])
    assert argos["downloads"] == [("fr", "de")]


def test_uncovered_pair_is_reported_after_installing_the_rest(argos):
    argos["index"] = {("zh", "en"), ("en", "vi")}
    with pytest.raises(translation_engines.ArgosPackUnavailable) as raised:
        translation_engines.install_argos_packs("zh", ["vi", "eo"])
    assert raised.value.pairs == [("zh", "eo")]
    assert raised.value.code == "argos_pack_unavailable"
    assert ("en", "vi") in argos["installed"]


def test_install_route_reports_a_typed_error(argos, monkeypatch):
    import asyncio

    from fastapi import HTTPException

    from api.routers import engines

    argos["index"] = set()
    request = engines.ArgosPackRequest(source_lang="zh", target_langs=["vi"])
    with pytest.raises(HTTPException) as raised:
        asyncio.run(engines.install_argos_packs(request))
    assert raised.value.status_code == 422
    assert raised.value.detail["code"] == "argos_pack_unavailable"
    assert raised.value.detail["pairs"] == ["zh → vi"]
