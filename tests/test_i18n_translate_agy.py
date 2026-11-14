"""The agy translation helper keeps a translation that starts with a {{placeholder}}."""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "i18n_translate_agy", Path(__file__).resolve().parents[1] / "scripts" / "i18n_translate_agy.py"
)
agy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(agy)


def test_leading_placeholder_is_not_leaked_json():
    good, bad = agy.validate(
        {"a": "Generate {{count}} variants", "b": "Name", "c": "Save {{n}}"},
        {"a": "{{count}} Varianten generieren", "b": '{"x": 1}', "c": "Speichern"},
    )
    assert good == {"a": "{{count}} Varianten generieren"}
    assert bad == {"b": "markup leaked in", "c": "placeholders changed"}
