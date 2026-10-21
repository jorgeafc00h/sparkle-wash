"""Main loop: ESP32-CAM -> YOLO vehicles -> plate region -> OCR -> tracker -> SparkleWash API.

    python -m sparkle_vision.gateway --camera-url http://192.168.1.50/cam-hi.jpg \
        --camera-id entrance-cam --api http://localhost:5001 --device-key $SPARKLEWASH_DEVICE_KEY --show
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from pathlib import Path

import numpy as np

from .api import SparkleWashClient, build_observation, heartbeat_payload
from .camera import decode_jpeg, encode_evidence, fetch_jpeg, fetch_status
from .detection import VEHICLE_CLASSES, Detection, YoloDetector, find_plate_regions, load_labels
from .ocr import PlateReader, default_reader
from .plates import PlateEvent, PlateRead, PlateTracker, edit_distance

log = logging.getLogger("sparkle_vision")
MODELS = Path(__file__).resolve().parent.parent / "models"
HEARTBEAT_SECONDS = 30


class Pipeline:
    def __init__(self, vehicles: YoloDetector, reader: PlateReader | None, plates: YoloDetector | None = None):
        self.vehicles = vehicles
        self.plates = plates
        self.reader = reader

    def process(self, frame: np.ndarray, now: float) -> tuple[list[Detection], list[PlateRead], dict[str, np.ndarray]]:
        """Returns vehicle detections, plate reads, and the best vehicle crop per plate (evidence photo)."""
        vehicles = self.vehicles.detect(frame)
        reads: list[PlateRead] = []
        evidence: dict[str, np.ndarray] = {}
        if self.reader is None:
            return vehicles, reads, evidence
        for vehicle in vehicles:
            crop = vehicle.crop(frame, pad=0.05)
            if crop.size == 0:
                continue
            regions = ([d.box for d in self.plates.detect(crop)] if self.plates else find_plate_regions(crop))
            for x, y, w, h in regions:
                for text, confidence in self.reader.read(crop[y:y + h, x:x + w]):
                    reads.append(PlateRead(text, confidence * vehicle.confidence, now))
                    evidence.setdefault(text, crop)
        return vehicles, reads, evidence


def annotate(frame: np.ndarray, vehicles: list[Detection], reads: list[PlateRead]) -> np.ndarray:
    import cv2

    out = frame.copy()
    for d in vehicles:
        x, y, w, h = d.box
        cv2.rectangle(out, (x, y), (x + w, y + h), (34, 197, 94), 2)
        cv2.putText(out, f"{d.label} {d.confidence:.2f}", (x, max(12, y - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (34, 197, 94), 1)
    for i, r in enumerate(reads):
        cv2.putText(out, f"{r.text} ({r.confidence:.2f})", (8, 22 + 20 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (56, 189, 248), 2)
    return out


def run(args: argparse.Namespace) -> None:
    labels = load_labels(Path(args.labels))
    vehicles = YoloDetector(Path(args.weights), labels, Path(args.cfg), args.input_size,
                            args.confidence, args.nms, keep=VEHICLE_CLASSES)
    plates = YoloDetector(Path(args.plate_model), ["plate"], None, 640, 0.4, 0.3) if args.plate_model else None
    reader = default_reader()
    if reader is None:
        log.warning("No OCR engine installed (pip install easyocr, or install tesseract + pytesseract); "
                    "running vehicle detection only")
    pipeline = Pipeline(vehicles, reader, plates)
    tracker = PlateTracker(args.min_reads, args.window, args.cooldown)
    client = SparkleWashClient(args.api, args.ingest_key or None, device_key=args.device_key or None) if args.api else None
    evidence: dict[str, np.ndarray] = {}
    frames_since_beat = 0
    last_beat = 0.0

    while True:
        started = time.time()
        try:
            frame = decode_jpeg(fetch_jpeg(args.camera_url))
        except OSError as error:
            log.warning("camera unreachable: %s", error)
            time.sleep(2)
            continue
        if frame is None:
            continue
        frames_since_beat += 1
        if client is not None and started - last_beat >= HEARTBEAT_SECONDS:
            fps = frames_since_beat / (started - last_beat) if last_beat else None
            code = client.heartbeat(heartbeat_payload(fetch_status(args.camera_url), fps, args.camera_url))
            if code == 401:
                log.error("API rejected the device key: it was rotated or the camera was disabled in Administración")
            frames_since_beat, last_beat = 0, started
        detections, reads, crops = pipeline.process(frame, started)
        for text, crop in crops.items():
            evidence.setdefault(text, crop)
        for event in tracker.update(reads, started):
            publish(event, closest_evidence(evidence, event.plate), client, args.camera_id)
        if len(evidence) > 50:
            evidence.clear()
        if args.show:
            import cv2

            cv2.imshow(args.camera_id, annotate(frame, detections, reads))
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        time.sleep(max(0.0, args.interval - (time.time() - started)))


def closest_evidence(evidence: dict[str, np.ndarray], plate: str) -> np.ndarray | None:
    """The consensus plate may differ by a character from any single read; use the nearest read's crop."""
    if not evidence:
        return None
    text = min(evidence, key=lambda key: edit_distance(key, plate))
    return evidence[text] if edit_distance(text, plate) <= 2 else None


def publish(event: PlateEvent, crop: np.ndarray | None, client: SparkleWashClient | None, camera_id: str) -> None:
    log.info("plate %s conf=%.2f reads=%d", event.plate, event.confidence, event.reads)
    if client is None:
        return
    photo = encode_evidence(crop) if crop is not None else None
    result = client.post_observation(build_observation(camera_id, event, photo))
    if result.tracked_job_id:
        log.info("  -> sighting linked to open job %s", result.tracked_job_id)
    elif result.status in (200, 201):
        log.info("  -> new arrival %s waiting for staff confirmation", result.observation_id)
    elif result.status == 403:
        log.error("  -> this device key belongs to another camera: --camera-id must match the camera linked in Administración")
    elif result.status == 401:
        log.error("  -> API rejected the key (rotated, disabled or mistyped)")
    else:
        log.error("  -> API rejected observation (HTTP %s)", result.status)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--camera-url", default=os.environ.get("ESP32_CAM_URL", "http://192.168.1.50/cam-hi.jpg"))
    p.add_argument("--camera-id", default=os.environ.get("SPARKLEWASH_CAMERA_ID", "entrance-cam"))
    p.add_argument("--api", default=os.environ.get("SPARKLEWASH_API_URL"))
    p.add_argument("--device-key", default=os.environ.get("SPARKLEWASH_DEVICE_KEY", ""),
                   help="per-camera key from Administración > Cámaras (recommended)")
    p.add_argument("--ingest-key", default=os.environ.get("SPARKLEWASH_INGEST_KEY", ""),
                   help="legacy shared key of the default carwash")
    p.add_argument("--cfg", default=str(MODELS / "yolov3.cfg"))
    p.add_argument("--weights", default=str(MODELS / "yolov3.weights"))
    p.add_argument("--labels", default=str(MODELS / "coco.names"))
    p.add_argument("--plate-model", default=os.environ.get("SPARKLEWASH_PLATE_MODEL"),
                   help="optional single-class licence-plate YOLO model (.onnx)")
    p.add_argument("--input-size", type=int, default=416)
    p.add_argument("--confidence", type=float, default=0.5)
    p.add_argument("--nms", type=float, default=0.3)
    p.add_argument("--interval", type=float, default=0.5, help="seconds between frames")
    p.add_argument("--min-reads", type=int, default=3)
    p.add_argument("--window", type=float, default=8.0)
    p.add_argument("--cooldown", type=float, default=300.0)
    p.add_argument("--show", action="store_true", help="display annotated frames (press q to quit)")
    args = p.parse_args(argv)
    if args.api and not (args.device_key or args.ingest_key):
        p.error("--device-key (or SPARKLEWASH_DEVICE_KEY) is required when --api is set")
    return args


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run(parse_args())


if __name__ == "__main__":
    main()
