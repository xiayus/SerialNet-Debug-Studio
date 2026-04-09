"""UDP transport: sendto remote, optional local bind for receive.

Author: Allen Liao
Date: 2026-04-09
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Optional, Tuple, cast

from .base_transport import BaseTransport


class _UdpRxProtocol(asyncio.DatagramProtocol):
    def __init__(self, owner: "UdpTransport") -> None:
        self._owner = owner

    def datagram_received(self, data: bytes, addr: Tuple[str, int]) -> None:
        host, port = addr
        prefix = f"[{host}:{port}] ".encode("utf-8", errors="replace")
        self._owner._enqueue(prefix + data)

    def error_received(self, exc: Exception) -> None:
        self._owner._last_error = exc

    def connection_lost(self, exc: Optional[Exception]) -> None:
        if self._owner._open:
            self._owner._enqueue(None)


class UdpTransport(BaseTransport):
    def __init__(
        self,
        remote_host: str,
        remote_port: int,
        local_listen_port: Optional[int] = None,
        listen: bool = False,
    ) -> None:
        super().__init__()
        self._remote_host = remote_host
        self._remote_port = remote_port
        self._local_listen_port = local_listen_port
        self._listen = listen
        self._transport: Optional[asyncio.BaseTransport] = None
        self._protocol: Optional[asyncio.DatagramProtocol] = None
        self._last_error: Optional[Exception] = None

    async def open_transport(self) -> None:
        loop = asyncio.get_running_loop()
        local_addr: Optional[Tuple[str, int]] = None
        if self._listen and self._local_listen_port is not None:
            local_addr = ("0.0.0.0", self._local_listen_port)
        self._transport, self._protocol = await loop.create_datagram_endpoint(
            lambda: _UdpRxProtocol(self),
            local_addr=local_addr,
        )

    async def close_transport(self) -> None:
        t = self._transport
        self._transport = None
        self._protocol = None
        if t:
            with contextlib.suppress(Exception):
                t.close()

    async def send(self, data: bytes) -> None:
        if not self._transport:
            raise OSError("UDP not open")
        cast(asyncio.DatagramTransport, self._transport).sendto(
            data, (self._remote_host, self._remote_port)
        )
