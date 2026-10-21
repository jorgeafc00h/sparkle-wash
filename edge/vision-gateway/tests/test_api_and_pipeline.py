import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np

from sparkle_vision.api import SparkleWashClient, build_observation, device_event_id
from sparkle_vision.detection import Detection
from sparkle_vision.gateway import Pipeline, closest_evidence
from sparkle_vision.plates import PlateEvent

EVENT = PlateEvent("P123456", 0.87, 1_760_000_000.25, 1_760_000_002.0, 4)


def test_observation_payload_matches_api_contract():
    payload = build_observation("entrance-cam", EVENT, b"\xff\xd8jpeg")
    assert payload["deviceEventId"] == "entrance-cam-P123456-1760000000250"
    assert payload["cameraId"] == "entrance-cam"
    assert payload["plateCandidate"] == "P123456"
    assert payload["confidence"] == 0.87
    assert payload["capturedAt"].startswith("2025-10-09T08:53:20.25")
    assert payload["photoBase64"] == "/9hqcGVn"
    assert device_event_id("cam", EVENT) == device_event_id("cam", EVENT)  # retries replay the same ID


def test_client_sends_ingest_key_and_reads_tracking_result():
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            seen["key"] = self.headers["X-SparkleWash-Ingest-Key"]
            seen["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            body = json.dumps({"observation": {"id": "obs1"}, "duplicate": False, "trackedJobId": "job9"}).encode()
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        client = SparkleWashClient(f"http://127.0.0.1:{server.server_port}/", "edge-key", retries=0)
        result = client.post_observation(build_observation("bay-cam", EVENT, None))
    finally:
        server.shutdown()
    assert seen["key"] == "edge-key"
    assert seen["body"]["plateCandidate"] == "P123456" and "photoBase64" not in seen["body"]
    assert (result.status, result.observation_id, result.tracked_job_id) == (201, "obs1", "job9")


class FakeVehicles:
    def detect(self, image):
        return [Detection("car", 0.8, (10, 10, 100, 60))]


class FakePlates:
    def detect(self, image):
        return [Detection("plate", 0.9, (20, 30, 40, 12))]


class FakeReader:
    def read(self, plate_image):
        assert plate_image.shape[:2] == (12, 40)
        return [("P123456", 0.5)]


def test_pipeline_scales_ocr_confidence_by_vehicle_confidence():
    frame = np.zeros((200, 200, 3), np.uint8)
    vehicles, reads, evidence = Pipeline(FakeVehicles(), FakeReader(), FakePlates()).process(frame, 5.0)
    assert len(vehicles) == 1
    assert [(r.text, r.confidence, r.at) for r in reads] == [("P123456", 0.4, 5.0)]
    assert evidence["P123456"].shape[:2] == (66, 110)
    assert closest_evidence(evidence, "P12345G") is evidence["P123456"]
    assert closest_evidence(evidence, "ZZZ") is None
