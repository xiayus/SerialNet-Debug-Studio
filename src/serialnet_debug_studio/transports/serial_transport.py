"""Serial (COM) transport using pyserial; reads in background task.

Author: Allen Liao
Date: 2026-04-09
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any, Optional

import serial

from .base_transport import BaseTransport


class SerialTransport(BaseTransport):
    def __init__(
        self,
        port: str,
        baudrate: int = 115200,
        bytesize: int = serial.EIGHTBITS,
        parity: str = serial.PARITY_NONE,
        stopbits: float = serial.STOPBITS_ONE,
        timeout: float = 0.2,
    ) -> None:
        super().__init__()
        self._port = port
        self._baudrate = baudrate
        self._bytesize = bytesize
        self._parity = parity
        self._stopbits = stopbits
        self._timeout = timeout
        self._ser: Optional[serial.Serial] = None
        self._read_task: Optional[asyncio.Task[Any]] = None
        self._stop = asyncio.Event()

    async def open_transport(self) -> None:
        self._stop.clear()

        def _open() -> serial.Serial:
            return serial.Serial(
                port=self._port,
                baudrate=self._baudrate,
                bytesize=self._bytesize,
                parity=self._parity,
                stopbits=self._stopbits,
                timeout=self._timeout,
            )

        self._ser = await asyncio.to_thread(_open)
        self._read_task = asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> None:
        assert self._ser is not None
        try:
            while self._open and not self._stop.is_set():
                try:

                    def _read() -> bytes:
                        return self._ser.read(4096)  # type: ignore[union-attr]

                    chunk = await asyncio.to_thread(_read)
                except Exception:  # noqa: BLE001
                    self._enqueue(None)
                    return
                if chunk:
                    self._enqueue(chunk)
                else:
                    await asyncio.sleep(0)
        finally:
            self._enqueue(None)

    async def close_transport(self) -> None:
        self._stop.set()
        if self._read_task:
            self._read_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._read_task
            self._read_task = None
        if self._ser is not None:
            ser = self._ser
            self._ser = None

            def _close() -> None:
                with contextlib.suppress(Exception):
                    ser.close()

            await asyncio.to_thread(_close)

    async def send(self, data: bytes) -> None:
        if not self._ser or not self._ser.is_open:
            raise OSError("Serial port not open")

        def _write() -> None:
            self._ser.write(data)  # type: ignore[union-attr]
            self._ser.flush()  # type: ignore[union-attr]

        await asyncio.to_thread(_write)
