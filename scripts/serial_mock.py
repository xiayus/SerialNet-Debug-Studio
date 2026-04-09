#!/usr/bin/env python3
"""
Periodically write telemetry lines to a serial port (for exercising Serial mode).

Author: Allen Liao
Date: 2026-04-09

Windows 虚拟串口对测（任选其一）:
  - 安装 com0com / Virtual Serial Port Driver，创建一对互联端口（如 COM10 <-> COM11）。
  - 本脚本占用 COM11 发送；网页端连接 COM10，参数一致。

Linux / macOS:
  - 可使用 USB 串口线环回，或 `socat` 创建伪终端对后映射为串口（需自行配置）。

用法:
  python scripts/serial_mock.py --port COM11
"""

from __future__ import annotations

import argparse
import time

import serial


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, help="例如 COM3 或 /dev/ttyUSB0")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--interval", type=float, default=0.5)
    args = parser.parse_args()

    ser = serial.Serial(port=args.port, baudrate=args.baud, timeout=0.2)
    print(f"[Serial] Writing mock lines to {args.port} @ {args.baud} (Ctrl+C stop)")
    counter = 0
    try:
        while True:
            counter += 1
            line = (
                f"t={counter},fl={60 + counter % 15},fr={65 + counter % 11},"
                f"l={10 + counter % 6},r={18},err=2,yaw={counter * 0.03:.2f}\n"
            )
            ser.write(line.encode("utf-8"))
            ser.flush()
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("stopped")
    finally:
        ser.close()


if __name__ == "__main__":
    main()
