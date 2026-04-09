"""FastAPI entry: REST + WebSocket + static SPA.

Author: Allen Liao
Date: 2026-04-09
"""

from __future__ import annotations

import base64
import binascii
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import serial.tools.list_ports

from .connection_manager import ConnectionManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]
manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await manager.shutdown()


app = FastAPI(title="SerialNet Debug Studio", lifespan=lifespan)


@app.get("/api/ports")
async def api_ports():
    try:
        ports = [p.device for p in serial.tools.list_ports.comports()]
    except Exception as exc:  # noqa: BLE001
        logger.exception("List ports failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ports": ports}


@app.post("/api/connect")
async def api_connect(request: Request):
    try:
        body = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    mode = str(body.get("mode", "tcp")).lower().strip()
    try:
        await manager.connect(mode, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Connect error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"ok": True}


@app.post("/api/disconnect")
async def api_disconnect():
    try:
        await manager.disconnect()
    except Exception as exc:  # noqa: BLE001
        logger.exception("Disconnect error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/api/send")
async def api_send(request: Request):
    try:
        body = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    raw_b64 = body.get("bytes_b64")
    if raw_b64 is not None:
        if not isinstance(raw_b64, str):
            raise HTTPException(status_code=400, detail="bytes_b64 must be a string")
        try:
            data = base64.b64decode(raw_b64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid base64") from exc
        try:
            await manager.send_bytes(data)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            logger.exception("Send failed")
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"ok": True}

    text = body.get("text")
    if text is None:
        text = body.get("line", "")
    if not isinstance(text, str):
        text = str(text)

    try:
        await manager.send_text(text)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Send failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"ok": True}


@app.get("/api/status")
async def api_status():
    return manager.status_payload()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await manager.register_websocket(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.debug("WS session ended: %s", exc)
    finally:
        await manager.unregister_websocket(websocket)


app.mount(
    "/",
    StaticFiles(directory=str(_REPO_ROOT / "static"), html=True),
    name="static",
)
