"""Write the beat-snapping fixtures the Electron timeline test compares against.

The promo timeline (electron/src/renderer/src/features/promo/timeline-model.ts)
ports services/promo_video.snap_to_beats so it can show what the render will
cut. This script records the backend's answers for random plans; the TS test
must reproduce every one exactly. Rerun after changing snap_to_beats:

    uv run python scripts/export_promo_snap_fixtures.py
"""
from __future__ import annotations

import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from services import promo_video as pv  # noqa: E402

OUT = os.path.join(
    ROOT, "electron", "src", "renderer", "src", "features", "promo", "snap-fixtures.json"
)


def build_cases() -> list[dict]:
    rng = random.Random(20261112)
    names = list(pv.TRANSITIONS)
    cases = []
    for _ in range(40):
        count = rng.randint(2, 9)
        shots = [
            {
                "duration": round(rng.uniform(pv.MIN_SHOT_SECONDS, 4.0), 3),
                "transition": rng.choice(names),
                "transitionSeconds": round(rng.uniform(0, 1.2), 2),
            }
            for _ in range(count)
        ]
        period = round(rng.uniform(0.25, 0.9), 4)
        plan = pv.PromoPlan(shots=[
            pv.Shot("x", "video", s["duration"], transition=s["transition"],
                    transition_seconds=s["transitionSeconds"])
            for s in shots
        ])
        snapped = pv.snap_to_beats(plan, period, 0.0)
        again = pv.snap_to_beats(pv.PromoPlan(shots=[
            pv.Shot(**{**shot.__dict__, "duration": d}) for shot, d in zip(plan.shots, snapped)
        ]), period, 0.0)
        cases.append({"period": period, "shots": shots, "snapped": snapped, "again": again})
    return cases


def main() -> None:
    cases = build_cases()
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(cases, fh, indent=1)
        fh.write("\n")
    print(f"wrote {len(cases)} cases to {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
