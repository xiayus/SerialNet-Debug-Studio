"""Abstract transport: one active connection, async RX queue.

Author: Allen Liao
Date: 2026-04-09
"""

from __future__ import annotations

import asyncio
import contextlib
from abc import ABC, abstractmethod
from typing import Optional

BYTES_TYPE = bytes


class BaseTransport(ABC):
    def __init__(self) -> None:
        self._rx: asyncio.Queue[Optional[BYTES_TYPE]] = asyncio.Queue()
        self._open = False

    @property
    def is_open(self) -> bool:
        return self._open

    def _enqueue(self, data: Optional[BYTES_TYPE]) -> None:
        self._rx.put_nowait(data)

    async def read_chunk(self) -> Optional[BYTES_TYPE]:
        """Return next chunk; None means stream ended."""
        return await self._rx.get()

    @abstractmethod
    async def open_transport(self) -> None:
        """Open underlying device/socket."""

    @abstractmethod
    async def close_transport(self) -> None:
        """Release resources (idempotent)."""

    async def open(self) -> None:
        self._open = True
        try:
            await self.open_transport()
        except BaseException:
            self._open = False
            raise

    async def close(self) -> None:
        self._open = False
        try:
            await self.close_transport()
        finally:
            with contextlib.suppress(Exception):
                self._enqueue(None)

    @abstractmethod
    async def send(self, data: bytes) -> None:
        """Send raw bytes to peer."""
