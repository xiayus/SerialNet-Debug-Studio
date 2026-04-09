"""Line-based key=value protocol parser for telemetry lines.

Author: Allen Liao
Date: 2026-04-09
"""

from __future__ import annotations

import re
from typing import Dict


def _to_number(s: str) -> int | float | None:
    s = s.strip()
    if not s:
        return None
    try:
        if "." in s or "e" in s.lower():
            return float(s)
        return int(s, 0) if re.match(r"^[+-]?0[xX]", s) else int(s, 10)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return None


def _split_kv(part: str) -> tuple[str, str] | None:
    """Split one segment into key and value; supports key=value or key:value."""
    part = part.strip()
    if not part:
        return None
    if "=" in part:
        key, _, val = part.partition("=")
    elif ":" in part:
        key, _, val = part.partition(":")
    else:
        return None
    key = key.strip()
    val = val.strip()
    if not key:
        return None
    return key, val


def parse_line(line: str) -> Dict[str, int | float]:
    """
    Parse a comma-separated line into numeric fields only.
    Each segment may be key=value or key:value (e.g. leftSide:144,fl=88).
    Non-numeric values are ignored. Malformed segments are skipped.
    """
    result: Dict[str, int | float] = {}
    if not line or not line.strip():
        return result
    parts = line.split(",")
    for part in parts:
        kv = _split_kv(part)
        if kv is None:
            continue
        key, val = kv
        num = _to_number(val)
        if num is not None:
            result[key] = num
    return result
