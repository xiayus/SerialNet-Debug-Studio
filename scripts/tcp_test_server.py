#!/usr/bin/env python3
"""Local TCP test server: echoes lines and periodically sends telemetry (line protocol).

Author: Allen Liao
Date: 2026-04-09
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib


async def client_task(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    peer = writer.get_extra_info("peername")
    print(f"[TCP] Client connected: {peer}")
    counter = 0

    async def ticker() -> None:
        nonlocal counter
        try:
            while True:
                await asyncio.sleep(0.4)
                counter += 1
                line = (
                    f"t={counter},fl={80 + counter % 10},fr={82 + counter % 8},"
                    f"l={30 + counter % 5},r={32},err=0,yaw={counter * 0.1:.2f}\n"
                )
                writer.write(line.encode("utf-8"))
                await writer.drain()
        except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
            raise

    tick = asyncio.create_task(ticker())
    try:
        while True:
            data = await reader.read(4096)
            if not data:
                break
            text = data.decode("utf-8", errors="replace")
            print(f"[TCP] RX {peer}: {text!r}")
            writer.write(b"echo:" + data)
            await writer.drain()
    finally:
        tick.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await tick
        writer.close()
        with contextlib.suppress(Exception):
            await writer.wait_closed()
        print(f"[TCP] Client closed: {peer}")


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    server = await asyncio.start_server(client_task, args.host, args.port)
    print(f"[TCP] Listening on {args.host}:{args.port}")
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
