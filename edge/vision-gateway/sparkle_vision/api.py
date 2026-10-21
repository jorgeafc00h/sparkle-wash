"""Posts plate events to POST /api/arrivals/observations.

The deviceEventId is derived from camera + plate + first-seen time, so a retry after a
timeout replays the same event and the API answers 200 duplicate instead of creating a
second arrival.
"""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone

from .plates import PlateEvent


@dataclass(frozen=True)
class PostResult:
    status: int
    observation_id: str | None
    tracked_job_id: str | None
    duplicate: bool


def device_event_id(camera_id: str, event: PlateEvent) -> str:
    return f"{camera_id}-{event.plate}-{int(event.first_seen * 1000)}"[:128]


def build_observation(camera_id: str, event: PlateEvent, photo: bytes | None) -> dict:
    payload = {
        "deviceEventId": device_event_id(camera_id, event),
        "cameraId": camera_id,
        "plateCandidate": event.plate,
        "confidence": max(0.0, min(1.0, event.confidence)),
        "capturedAt": datetime.fromtimestamp(event.first_seen, tz=timezone.utc).isoformat(),
    }
    if photo is not None:
        payload["photoBase64"] = base64.b64encode(photo).decode("ascii")
    return payload


class SparkleWashClient:
    """Talks to the SparkleWash API as one camera.

    device_key   per-device key from the admin view (Administración > Cámaras). Preferred: it is bound
                 to one carwash and one camera id, and can be rotated or disabled on its own.
    ingest_key   legacy shared key of the default carwash.
    """

    def __init__(self, base_url: str, ingest_key: str | None = None, timeout: float = 10.0, retries: int = 3,
                 device_key: str | None = None):
        if not device_key and not ingest_key:
            raise ValueError("a device key or an ingest key is required")
        self.base_url = base_url.rstrip("/")
        self.ingest_key = ingest_key
        self.device_key = device_key
        self.timeout = timeout
        self.retries = retries

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.device_key:
            headers["X-SparkleWash-Device-Key"] = self.device_key
        else:
            headers["X-SparkleWash-Ingest-Key"] = self.ingest_key or ""
        return headers

    def post_observation(self, payload: dict) -> PostResult:
        body = json.dumps(payload).encode("utf-8")
        delay = 1.0
        for attempt in range(self.retries + 1):
            request = urllib.request.Request(
                f"{self.base_url}/api/arrivals/observations", data=body, method="POST", headers=self._headers())
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    data = json.loads(response.read() or b"{}")
                    observation = data.get("observation") or {}
                    return PostResult(response.status, observation.get("id"), data.get("trackedJobId"),
                                      bool(data.get("duplicate")))
            except urllib.error.HTTPError as error:
                # 4xx is a permanent answer (bad key, wrong camera id, invalid payload, conflicting evidence); don't retry.
                if error.code < 500 or attempt == self.retries:
                    return PostResult(error.code, None, None, False)
            except (urllib.error.URLError, TimeoutError):
                if attempt == self.retries:
                    raise
            time.sleep(delay)
            delay *= 2
        raise RuntimeError("unreachable")

    def heartbeat(self, status: dict) -> int:
        """Reports the camera as alive (device keys only). Returns the HTTP status; never raises."""
        if not self.device_key:
            return 0
        request = urllib.request.Request(f"{self.base_url}/api/devices/heartbeat", data=json.dumps(status).encode("utf-8"),
                                         method="POST", headers=self._headers())
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code
        except (urllib.error.URLError, TimeoutError, OSError):
            return 0


def heartbeat_payload(camera_status: dict | None, fps: float | None, camera_url: str) -> dict:
    """Maps the ESP32-CAM /status JSON (plus measured fps) to the API's heartbeat fields."""
    from urllib.parse import urlparse

    status = camera_status or {}
    payload: dict = {"ip": urlparse(camera_url).hostname}
    for source, target in (("rssi", "rssi"), ("uptimeMs", "uptimeMs"), ("freeHeap", "freeHeap"), ("firmware", "firmware")):
        if status.get(source) is not None:
            payload[target] = status[source]
    if fps is not None:
        payload["fps"] = round(fps, 2)
    return payload
