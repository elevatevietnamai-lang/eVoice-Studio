"""The timeline's beat-snapping fixtures must match the backend they record.

electron/.../promo/timeline-model.ts ports snap_to_beats and is tested against
snap-fixtures.json; if snap_to_beats changes without regenerating them
(scripts/export_promo_snap_fixtures.py), the timeline would stop showing what
the render cuts.
"""
from __future__ import annotations

import importlib.util
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_snap_fixtures_are_current():
    path = os.path.join(ROOT, "scripts", "export_promo_snap_fixtures.py")
    spec = importlib.util.spec_from_file_location("export_promo_snap_fixtures", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with open(module.OUT, encoding="utf-8") as fh:
        recorded = json.load(fh)
    assert module.build_cases() == recorded, (
        "Run: uv run python scripts/export_promo_snap_fixtures.py"
    )
