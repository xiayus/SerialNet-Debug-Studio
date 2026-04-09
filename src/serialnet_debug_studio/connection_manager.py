"""Single active connection coordinator: RX framing, WebSocket broadcast, lifecycle.

Author: Allen Liao
Date: 2026-04-09
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

import serial
from fastapi import WebSocket

from .parser import parse_line
from .transports.base_transport import BaseTransport
from .transports.serial_transport import SerialTransport
from .transports.tcp_transport import TcpTransport
from .transports.udp_transport import UdpTransport

logger = logging.getLogger(__name__)


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ConnectionManager:
    """One transport at a time; I/O in transports never blocks the event loop."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._state: str = "disconnected"
        self._mode: Optional[str] = None
        self._transport: Optional[BaseTransport] = None
        self._recv_task: Optional[asyncio.Task[Any]] = None
        self._websockets: Set[WebSocket] = set()
        self._line_buf = bytearray()
        self._error_detail: Optional[str] = None

    def status_payload(self) -> Dict[str, Any]:
        return {
            "state": self._state,
            "mode": self._mode,
            "detail": self._error_detail,
        }

    def _status_ws_message(self) -> Dict[str, Any]:
        return {"type": "status", **self.status_payload()}

    async def register_websocket(self, websocket: WebSocket) -> None:
        self._websockets.add(websocket)
        try:
            await websocket.send_json(self._status_ws_message())
        except Exception as exc:  # noqa: BLE001
            logger.debug("WS welcome send failed: %s", exc)
            self._websockets.discard(websocket)

    async def unregister_websocket(self, websocket: WebSocket) -> None:
        self._websockets.discard(websocket)

    async def broadcast_json(self, message: Dict[str, Any]) -> None:
        dead: List[WebSocket] = []
        for ws in list(self._websockets):
            try:
                await ws.send_json(message)
            except Exception as exc:  # noqa: BLE001
                logger.debug("WS send failed: %s", exc)
                dead.append(ws)
        for ws in dead:
            self._websockets.discard(ws)

    async def log(self, channel: str, message: str) -> None:
        await self.broadcast_json(
            {
                "type": "log",
                "channel": channel,
                "message": message,
                "ts": _utc_iso(),
            }
        )

    async def disconnect(self) -> None:
        task: Optional[asyncio.Task[Any]] = None
        transport: Optional[BaseTransport] = None
        had_connected = False
        async with self._lock:
            transport = self._transport
            self._transport = None
            self._line_buf.clear()
            had_connected = self._state == "connected"
            self._state = "disconnected"
            self._mode = None
            self._error_detail = None
            task = self._recv_task
            self._recv_task = None

        if transport:
            with contextlib.suppress(Exception):
                await transport.close()

        if task and not task.done():
            with contextlib.suppress(Exception):
                await task

        await self.broadcast_json(self._status_ws_message())
        if had_connected:
            await self.log("SYS", "Disconnected")

    def _map_serial_settings(self, cfg: Dict[str, Any]) -> Dict[str, Any]:
        data_bits = int(cfg.get("data_bits", 8))
        size_map = {
            5: serial.FIVEBITS,
            6: serial.SIXBITS,
            7: serial.SEVENBITS,
            8: serial.EIGHTBITS,
        }
        bytesize = size_map.get(data_bits, serial.EIGHTBITS)

        parity_raw = str(cfg.get("parity", "none")).lower()
        parity_map = {
            "none": serial.PARITY_NONE,
            "even": serial.PARITY_EVEN,
            "odd": serial.PARITY_ODD,
        }
        parity = parity_map.get(parity_raw, serial.PARITY_NONE)

        stop_raw = cfg.get("stop_bits", 1)
        try:
            stop_num = float(stop_raw)
        except (TypeError, ValueError):
            stop_num = 1.0
        if stop_num == 1:
            stopbits = serial.STOPBITS_ONE
        elif stop_num == 1.5:
            stopbits = serial.STOPBITS_ONE_POINT_FIVE
        else:
            stopbits = serial.STOPBITS_TWO

        timeout = float(cfg.get("read_timeout", 0.2))
        return {
            "port": str(cfg["port"]),
            "baudrate": int(cfg.get("baudrate", 115200)),
            "bytesize": bytesize,
            "parity": parity,
            "stopbits": stopbits,
            "timeout": timeout,
        }

    def _build_transport(self, mode: str, body: Dict[str, Any]) -> BaseTransport:
        if mode == "serial":
            cfg = body.get("serial") or body
            s = self._map_serial_settings(cfg)
            return SerialTransport(
                port=s["port"],
                baudrate=s["baudrate"],
                bytesize=s["bytesize"],
                parity=s["parity"],
                stopbits=s["stopbits"],
                timeout=s["timeout"],
            )
        if mode == "tcp":
            cfg = body.get("tcp") or body
            host = str(cfg.get("host", "192.168.1.100"))
            port = int(cfg.get("port", 5000))
            return TcpTransport(host=host, port=port)
        if mode == "udp":
            cfg = body.get("udp") or body
            rh = str(cfg.get("remote_host", cfg.get("host", "192.168.1.100")))
            rp = int(cfg.get("remote_port", cfg.get("port", 5001)))
            local_port = cfg.get("local_listen_port")
            lp = (
                int(local_port)
                if local_port is not None and str(local_port).strip() != ""
                else None
            )
            listen = bool(cfg.get("listen", False))
            if listen and lp is None:
                raise ValueError("UDP listen enabled but local_listen_port is missing")
            return UdpTransport(
                remote_host=rh, remote_port=rp, local_listen_port=lp, listen=listen
            )
        raise ValueError(f"Unknown mode: {mode}")

    async def connect(self, mode: str, body: Dict[str, Any]) -> None:
        mode = mode.lower().strip()
        await self.disconnect()

        async with self._lock:
            self._error_detail = None
            self._state = "connecting"
            self._mode = mode

        await self.broadcast_json(self._status_ws_message())

        transport: Optional[BaseTransport] = None
        try:
            transport = self._build_transport(mode, body)
            await transport.open()
            async with self._lock:
                self._transport = transport
                transport = None
                self._state = "connected"
            self._recv_task = asyncio.create_task(self._recv_loop())
            await self.broadcast_json(self._status_ws_message())
            await self.log("SYS", f"Connected ({mode})")
        except Exception as exc:  # noqa: BLE001
            if transport:
                with contextlib.suppress(Exception):
                    await transport.close()
            async with self._lock:
                self._transport = None
                self._recv_task = None
                self._state = "error"
                self._error_detail = str(exc)
                self._mode = mode
            await self.broadcast_json(self._status_ws_message())
            await self.log("ERR", str(exc))
            logger.exception("Connect failed")

    async def _emit_rx_line(self, line: str) -> None:
        await self.log("RX", line)
        try:
            parsed = parse_line(line)
            if parsed:
                await self.broadcast_json(
                    {
                        "type": "parsed_data",
                        "values": parsed,
                        "raw_line": line,
                    }
                )
        except Exception as exc:  # noqa: BLE001
            logger.debug("parse emit skipped: %s", exc)

    async def _recv_finished_cleanup(self) -> None:
        async with self._lock:
            if self._recv_task is asyncio.current_task():
                self._recv_task = None
            was_connected = self._state == "connected"
            # Transport may already be cleared by explicit disconnect
            orphan = self._transport
            self._transport = None
            self._line_buf.clear()
            self._state = "disconnected"
            self._mode = None
            self._error_detail = None
        if orphan:
            with contextlib.suppress(Exception):
                await orphan.close()
        await self.broadcast_json(self._status_ws_message())
        if was_connected:
            await self.log("SYS", "Connection closed")

    async def _recv_loop(self) -> None:
        try:
            while True:
                async with self._lock:
                    t = self._transport
                if t is None:
                    break
                try:
                    chunk = await t.read_chunk()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    await self.log("ERR", repr(exc))
                    break

                if chunk is None:
                    break

                self._line_buf.extend(chunk)
                while True:
                    nl = self._line_buf.find(b"\n")
                    if nl < 0:
                        break
                    raw = self._line_buf[:nl]
                    del self._line_buf[: nl + 1]
                    text = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                    if text:
                        await self._emit_rx_line(text)
        except asyncio.CancelledError:
            return
        finally:
            await self._recv_finished_cleanup()

    async def send_text(self, text: str) -> None:
        raw_for_log = text
        if text and not text.endswith("\n"):
            text = text + "\n"
        async with self._lock:
            if self._state != "connected" or self._transport is None:
                raise RuntimeError("Not connected")
            transport = self._transport
        assert transport is not None
        await transport.send(text.encode("utf-8"))
        await self.log("TX", raw_for_log.rstrip("\r\n"))

    async def send_bytes(self, data: bytes) -> None:
        """Send raw bytes as-is (no newline coercion, no WebSocket TX log — client echoes)."""
        async with self._lock:
            if self._state != "connected" or self._transport is None:
                raise RuntimeError("Not connected")
            transport = self._transport
        assert transport is not None
        await transport.send(data)

    async def shutdown(self) -> None:
        await self.disconnect()
