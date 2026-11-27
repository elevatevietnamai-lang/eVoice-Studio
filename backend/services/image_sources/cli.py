"""Find the user's Codex / Antigravity CLI without going through a shell.

A Windows npm shim (``codex.cmd``) is never executed: cmd.exe would re-parse
the arguments. Like the desktop's agent runner (``repair-agents.ts``
``locate``), the shim is read, its JavaScript target resolved, and run with
``node`` directly. A native ``.exe`` or a POSIX executable runs as is.
"""

from __future__ import annotations

import os
import re
import shutil
from typing import Optional

#: Tests point a source at a fake CLI (``[sys.executable, "fake.py"]``).
COMMAND_OVERRIDES: dict[str, list[str]] = {}

_SHIM_TARGET = re.compile(r"[\"']([^\"']+\.(?:exe|m?js|cjs))[\"']", re.IGNORECASE)


def _windows_candidates(name: str) -> list[str]:
    found = []
    for folder in os.environ.get("PATH", "").split(os.pathsep):
        folder = folder.strip().strip('"')
        if not folder:
            continue
        for ext in (".exe", ".com", ".cmd", ".bat"):
            path = os.path.join(folder, name + ext)
            if os.path.isfile(path):
                found.append(path)
    return found


def _from_shim(shim: str) -> Optional[list[str]]:
    try:
        with open(shim, "r", encoding="utf-8", errors="replace") as handle:
            source = handle.read(64 * 1024)
    except OSError:
        return None
    folder = os.path.dirname(shim)
    targets = []
    for raw in _SHIM_TARGET.findall(source):
        if re.match(r"^%~?dp0%?", raw, re.IGNORECASE):
            raw = os.path.join(folder, re.sub(r"^%~?dp0%?[\\/]*", "", raw, flags=re.IGNORECASE))
        target = os.path.normpath(raw)
        if os.path.isfile(target) and os.path.basename(target).lower() != "node.exe":
            targets.append(target)
    # npm shims name node.exe first and the package's script second.
    script = next((t for t in targets if t.lower().endswith((".js", ".mjs", ".cjs"))), None)
    if script:
        local_node = os.path.join(folder, "node.exe")
        node = local_node if os.path.isfile(local_node) else shutil.which("node")
        return [node, script] if node else None
    return [targets[0]] if targets else None


def locate(name: str) -> Optional[list[str]]:
    """The argv prefix that runs ``name``, or ``None`` when it is not installed."""
    if name in COMMAND_OVERRIDES:
        return list(COMMAND_OVERRIDES[name])
    if os.name == "nt":
        candidates = _windows_candidates(name)
        native = next((p for p in candidates if p.lower().endswith((".exe", ".com"))), None)
        if native:
            return [native]
        shim = next((p for p in candidates if p.lower().endswith((".cmd", ".bat"))), None)
        return _from_shim(shim) if shim else None
    path = shutil.which(name)
    return [path] if path else None
