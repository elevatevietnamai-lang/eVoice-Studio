"""Channel Kit storage, assets, .evkit import/export and the /kits router."""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _png(color=(255, 0, 0), size=(80, 80)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture()
def kits(tmp_path, monkeypatch):
    from core import config

    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path))
    from services import channel_kit

    return channel_kit


@pytest.fixture()
def client(kits):
    from api.routers import kits as router

    app = FastAPI()
    app.include_router(router.router)
    return TestClient(app)


def test_create_update_and_list(kits):
    kit = kits.create(kits.KitBody(name="Shop", identity={"palette": [{"hex": "#FF8800"}]}))
    assert kit.identity.palette[0].hex == "#ff8800"
    assert kits.load(kit.id).name == "Shop"
    body = kits.KitBody(**{**kit.model_dump(include=set(kits.KitBody.model_fields)), "name": "Shop 2"})
    assert kits.update(kit.id, body).name == "Shop 2"
    assert [k.id for k in kits.list_kits()] == [kit.id]
    kits.delete(kit.id)
    assert kits.list_kits() == []


def test_unknown_fields_and_bad_ids_refused(kits):
    with pytest.raises(Exception):
        kits.KitBody(name="x", surprise=1)
    with pytest.raises(kits.KitError):
        kits.load("../etc")
    # A section may not point at an asset the Kit does not hold.
    with pytest.raises(kits.KitError) as err:
        kits.create(kits.KitBody(name="x", legal={"watermark_asset": "0" * 16}))
    assert err.value.code == "missing_asset"


def test_asset_content_is_checked(kits, tmp_path):
    kit = kits.create(kits.KitBody(name="x"))
    fake = tmp_path / "logo.png"
    fake.write_bytes(b"not an image at all")
    with pytest.raises(kits.KitError) as err:
        kits.add_asset(kit.id, str(fake), "logo.png")
    assert err.value.code == "bad_asset"
    svg = tmp_path / "logo.svg"
    svg.write_text("<svg/>")
    with pytest.raises(kits.KitError) as err:
        kits.add_asset(kit.id, str(svg), "logo.svg")
    assert err.value.code == "asset_type"
    good = tmp_path / "good.png"
    good.write_bytes(_png())
    asset_id, info = kits.add_asset(kit.id, str(good), "good.png")
    assert info.kind == "image" and not good.exists()
    path, _ = kits.asset_path(kit.id, asset_id)
    assert path.endswith(asset_id + ".png")


def test_evkit_round_trip_gives_new_ids(kits, tmp_path):
    kit = kits.create(kits.KitBody(name="Brand"))
    src = tmp_path / "l.png"
    src.write_bytes(_png())
    asset_id, _ = kits.add_asset(kit.id, str(src), "l.png")
    unused = tmp_path / "u.png"
    unused.write_bytes(_png((0, 0, 255)))
    kits.add_asset(kit.id, str(unused), "u.png")
    body = kits.KitBody(name="Brand", identity={"logos": [{"id": "main", "asset": asset_id}]})
    kits.update(kit.id, body)
    bundle = kits.export_bundle(kit.id, str(tmp_path / "b.evkit"))
    with zipfile.ZipFile(bundle) as zf:
        names = zf.namelist()
    assert names == ["kit.json", f"assets/{asset_id}.png"]  # the unused asset is left out
    imported = kits.import_bundle(bundle)
    assert imported.id != kit.id
    new_asset = imported.identity.logos[0].asset
    assert new_asset != asset_id and new_asset in imported.assets
    assert kits.asset_path(imported.id, new_asset)


def _bundle(tmp_path, kit_json: dict, members: dict[str, bytes]) -> str:
    path = tmp_path / "x.evkit"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("kit.json", json.dumps(kit_json))
        for name, data in members.items():
            zf.writestr(name, data)
    return str(path)


def test_evkit_import_refuses_traversal_and_fakes(kits, tmp_path):
    base = {"format": "evkit", "schema_version": 1, "id": "a" * 12, "name": "x"}
    with pytest.raises(kits.KitError) as err:
        kits.import_bundle(_bundle(tmp_path, base, {"../evil.txt": b"x"}))
    assert err.value.code == "bad_bundle"
    with pytest.raises(kits.KitError) as err:
        kits.import_bundle(_bundle(tmp_path, {**base, "schema_version": 99}, {}))
    assert err.value.code == "newer_kit"
    asset = "b" * 16
    fake = {**base, "assets": {asset: {"kind": "image", "name": "l", "ext": ".png", "size": 3}},
            "identity": {"logos": [{"id": "l", "asset": asset}]}}
    with pytest.raises(kits.KitError) as err:
        kits.import_bundle(_bundle(tmp_path, fake, {f"assets/{asset}.png": b"MZ\x90"}))
    assert err.value.code == "bad_asset"
    assert kits.list_kits() == []  # nothing half-imported


def test_router_crud_assets_export_import_and_check(client):
    r = client.post("/kits", json={"name": "Café", "voice_tone": {"ctas": ["Follow us"]},
                                   "identity": {"palette": [{"hex": "#112233"}]}})
    assert r.status_code == 200
    kit = r.json()
    r = client.post(f"/kits/{kit['id']}/assets", files={"file": ("logo.png", _png(), "image/png")})
    assert r.status_code == 200
    asset = r.json()
    got = client.get(asset["url"])
    assert got.headers["content-type"] == "image/png"
    assert got.headers["x-content-type-options"] == "nosniff"
    body = {k: v for k, v in kit.items() if k not in ("id", "format", "schema_version", "created_at",
                                                        "updated_at", "assets")}
    body["identity"]["logos"] = [{"id": "main", "asset": asset["id"]}]
    assert client.put(f"/kits/{kit['id']}", json=body).status_code == 200
    assert client.get("/kits").json()["kits"][0]["logo_url"] == asset["url"]
    assert client.delete(asset["url"]).json()["detail"] == "kits:asset_in_use"
    exported = client.get(f"/kits/{kit['id']}/export")
    assert exported.status_code == 200
    r = client.post("/kits/import", files={"file": ("Café.evkit", exported.content, "application/zip")})
    assert r.status_code == 200 and r.json()["name"] == "Café"
    r = client.post(f"/kits/{kit['id']}/check", json={"clips": [
        {"id": "c1", "kind": "text", "text": "hello", "color": "#ff0000"}]})
    codes = [i["code"] for i in r.json()["issues"]]
    assert "color_off_palette" in codes and "missing_cta" in codes and r.json()["ok"] is False
    r = client.post(f"/kits/{kit['id']}/memory", json={"title": "Ep 1", "hook": "Did you know"})
    assert r.json()["memory"][0]["title"] == "Ep 1"
    assert client.get("/kits/0123456789ab").json()["detail"] == "kits:not_found"
