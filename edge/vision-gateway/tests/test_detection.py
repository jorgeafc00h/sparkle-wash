import cv2
import numpy as np

from sparkle_vision.camera import decode_jpeg, encode_evidence
from sparkle_vision.detection import VEHICLE_CLASSES, Detection, find_plate_regions, postprocess

LABELS = ["person", "bicycle", "car", "motorbike"]


def row(cx, cy, w, h, class_id, score):
    scores = [0.0] * len(LABELS)
    scores[class_id] = score
    return [cx, cy, w, h, score, *scores]


def test_postprocess_filters_classes_confidence_and_overlaps():
    output = np.array([
        row(0.5, 0.5, 0.4, 0.4, 2, 0.9),   # car
        row(0.51, 0.5, 0.4, 0.4, 2, 0.7),  # same car, suppressed by NMS
        row(0.2, 0.2, 0.1, 0.3, 0, 0.95),  # person, not a vehicle
        row(0.8, 0.8, 0.1, 0.1, 3, 0.3),   # below threshold
    ], dtype=np.float32)
    detections = postprocess([output], 640, 480, LABELS, 0.5, 0.3, keep=VEHICLE_CLASSES)
    assert detections == [Detection("car", 0.9, (192, 144, 256, 192))]


def test_crop_clamps_to_image():
    image = np.zeros((100, 100, 3), np.uint8)
    assert Detection("car", 1.0, (90, 90, 30, 30)).crop(image, pad=0.1).shape == (13, 13, 3)


def test_plate_shaped_regions_are_found():
    vehicle = np.full((240, 320, 3), 90, np.uint8)
    cv2.rectangle(vehicle, (100, 160), (220, 195), (255, 255, 255), -1)
    cv2.rectangle(vehicle, (100, 160), (220, 195), (0, 0, 0), 2)
    regions = find_plate_regions(vehicle)
    assert regions
    x, y, w, h = regions[0]
    assert abs(x - 100) <= 4 and abs(y - 160) <= 4 and 2.0 <= w / h <= 6.0


def test_evidence_photo_round_trips_under_limit():
    noisy = np.random.default_rng(1).integers(0, 255, (600, 800, 3), dtype=np.uint8)
    encoded = encode_evidence(noisy, max_bytes=150_000)
    assert len(encoded) <= 150_000 and encoded[:2] == b"\xff\xd8"
    assert decode_jpeg(encoded) is not None
