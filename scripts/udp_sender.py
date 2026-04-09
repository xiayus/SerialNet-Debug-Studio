#!/usr/bin/env python3
"""Send periodic UDP telemetry lines to a remote host (for testing UDP RX in the web app).

Author: Allen Liao
Date: 2026-04-09
"""

from __future__ import annotations

import argparse
import asyncio
import socket


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5001)
    parser.add_argument("--interval", type=float, default=0.5)
    args = parser.parse_args()

    addr = (args.host, args.port)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print(f"[UDP] Sending telemetry to {addr} every {args.interval}s (Ctrl+C stop)")
    counter = 0
    loop = asyncio.get_running_loop()
    try:
        while True:
            counter += 1
            line = (
                f"t={counter},fl={70 + counter % 12},fr={75 + counter % 9},"
                f"l={20 + counter % 7},r={25},err=-1,yaw={counter * 0.05:.2f}\n"
            )
            await loop.sock_sendto(sock, line.encode("utf-8"), addr)
            await asyncio.sleep(args.interval)
    except asyncio.CancelledError:
        raise
    finally:
        sock.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("stopped")
