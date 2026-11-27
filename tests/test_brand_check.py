"""Brand compliance check: every rule fires on a planted mistake and stays quiet otherwise."""

from __future__ import annotations

from services.brand_check import ProjectDescriptor, check, delta_e
from services.channel_kit import Kit

KIT = Kit.model_validate({
    "id": "a" * 12, "name": "Brand",
    "identity": {
        "palette": [{"hex": "#e63946", "role": "primary"}, {"hex": "#1d3557", "role": "text"}],
        "fonts": [{"family": "Inter", "role": "body"}],
        "logos": [{"id": "main", "variant": "primary", "clear_space": 0.5}],
    },
    "motion": {"transitions_allowed": ["fade"]},
    "audio": {"brand_voice_id": "voice-brand"},
    "characters": [{"id": "fox", "name": "Fox", "voice_id": "voice-fox"}],
    "voice_tone": {"ctas": ["Follow for more"], "banned_words": ["cheap"]},
    "formats": [{"id": "tt", "platform": "tiktok", "aspect": "9:16", "duration_min": 15, "duration_max": 60}],
    "legal": {"disclaimer": "Results vary", "ai_label": True, "ai_label_text": "Made with AI"},
})

CLEAN = {
    "platform": "tiktok", "aspect": "9:16", "duration": 30, "ai_content": True,
    "clips": [
        {"id": "t1", "kind": "text", "start": 0, "duration": 3, "bbox": [0.1, 0.3, 0.6, 0.1],
         "text": "Follow for more", "font": "Inter", "color": "#E63946"},
        {"id": "t2", "kind": "text", "start": 3, "duration": 3, "bbox": [0.1, 0.5, 0.6, 0.05],
         "text": "Results vary. Made with AI", "font": "inter", "color": "#1d3558"},
        {"id": "l", "kind": "logo", "start": 0, "duration": 30, "bbox": [0.05, 0.12, 0.1, 0.05],
         "logo_variant": "primary"},
        {"id": "a", "kind": "audio", "voice_id": "voice-fox"},
        {"id": "v", "kind": "video", "transition": "fade", "bbox": [0, 0, 1, 1]},
    ],
}


def _codes(project: dict) -> list[str]:
    return [i["code"] for i in check(KIT, ProjectDescriptor.model_validate(project))]


def test_clean_project_passes():
    assert _codes(CLEAN) == []


def test_each_planted_mistake_is_reported():
    clips = [dict(c) for c in CLEAN["clips"]]
    clips[0].update(color="#00ff00", font="Comic Sans", text="So cheap!")  # no CTA any more
    clips[1].update(text="Nothing else", bbox=[0.1, 0.9, 0.6, 0.05])  # UI zone, no disclaimer / AI label
    clips[2].update(logo_variant="dark")
    clips[3].update(voice_id="someone-else")
    clips[4].update(transition="glitch")
    clips.append({"id": "crowd", "kind": "text", "start": 1, "duration": 1, "bbox": [0.12, 0.13, 0.05, 0.02],
                  "text": "x", "font": "Inter", "color": "#1d3557"})
    project = {**CLEAN, "duration": 90, "aspect": "16:9", "clips": clips}
    codes = set(_codes(project))
    assert codes >= {
        "color_off_palette", "font_off_kit", "banned_word", "missing_cta", "text_in_platform_ui",
        "missing_disclaimer", "missing_ai_label", "logo_wrong_variant", "voice_not_brand",
        "transition_not_allowed", "duration_out_of_format", "aspect_out_of_format",
    }


def test_logo_clear_space_uses_logo_rule():
    clips = [*CLEAN["clips"], {"id": "near", "kind": "text", "start": 0, "duration": 1,
                               "bbox": [0.16, 0.12, 0.1, 0.02], "text": "x", "font": "Inter"}]
    issues = check(KIT, ProjectDescriptor.model_validate({**CLEAN, "clips": clips}))
    assert [(i["code"], i["clip_id"], i["detail"]["other"]) for i in issues] == [
        ("logo_clear_space", "l", "near")]


def test_delta_e_tolerance():
    assert delta_e("#e63946", "#e63946") == 0
    assert delta_e("#e63946", "#e6394a") < 3
    assert delta_e("#e63946", "#00ff00") > 50
