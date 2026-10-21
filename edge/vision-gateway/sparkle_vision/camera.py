"""ESP32-CAM frame source: the board serves a fresh JPEG at /cam-hi.jpg (see edge/esp32-cam)."""

from __future__ import annotations

import urllib.request

import numpy as np


def fetch_jpeg(url: str, timeout: float = 5.0) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read()


def fetch_status(camera_url: str, timeout: float = 3.0) -> dict | None:
    """Reads the camera's /status JSON (rssi, uptime, heap, firmware). None when unreachable."""
    import json
    from urllib.parse import urlparse, urlunparse

    parts = urlparse(camera_url)
    try:
        with urllib.request.urlopen(urlunparse(parts._replace(path="/status", query="")), timeout=timeout) as response:
            return json.loads(response.read())
    except (OSError, ValueError):
        return None


def decode_jpeg(data: bytes) -> np.ndarray | None:
    import cv2

    return cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)


def encode_evidence(image: np.ndarray, max_bytes: int = 200_000) -> bytes:
    """JPEG-encode a vehicle crop under the API's photo limit (256 KiB), lowering quality then size."""
    import cv2

    frame = image
    for _ in range(6):
        for quality in (85, 70, 55, 40):
            ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
            if ok and len(encoded) <= max_bytes:
                return encoded.tobytes()
        frame = cv2.resize(frame, None, fx=0.75, fy=0.75, interpolation=cv2.INTER_AREA)
    raise ValueError("Could not encode evidence photo under the size limit")
