"""TCP client transport.

Author: Allen Liao
Date: 2026-04-09
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any, Optional

from .base_transport import BaseTransport


class TcpTransport(BaseTransport):
    def __init__(self, host: str, port: int, connect_timeout: float = 10.0) -> None:
        super().__init__()
        self._host = host
        self._port = port
        self._connect_timeout = connect_timeout
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._read_task: Optional[asyncio.Task[Any]] = None

    async def open_transport(self) -> None:
        self._reader, self._writer = await asyncio.wait_for(
            asyncio.open_connection(self._host, self._port),
            timeout=self._connect_timeout,
        )
        self._read_task = asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> None:
        assert self._reader is not None
        try:
            while self._open:
                try:
                    data = await self._reader.read(65536)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    break
                if not data:
                    break
                self._enqueue(data)
        finally:
            self._enqueue(None)

    async def close_transport(self) -> None:
        if self._read_task:
            self._read_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._read_task
            self._read_task = None
        writer = self._writer
        self._writer = None
        self._reader = None
        if writer:
            with contextlib.suppress(Exception):
                writer.close()
                await writer.wait_closed()

    async def send(self, data: bytes) -> None:
        if not self._writer:
            raise OSError("TCP not connected")
        self._writer.write(data)
        await self._writer.drain()
