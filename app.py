"""Repo-root uvicorn entry (`uvicorn app:app` loads the package under `src`)."""

from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent / "src"
_SRC_STR = str(_SRC.resolve())
if _SRC_STR not in sys.path:
    sys.path.insert(0, _SRC_STR)

from serialnet_debug_studio.app import app  # noqa: E402

__all__ = ["app"]
