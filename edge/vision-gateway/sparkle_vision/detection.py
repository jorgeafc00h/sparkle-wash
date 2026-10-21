"""YOLO object detection with OpenCV DNN, following the ESP32-CAM + YOLOv3 recipe:
fetch a JPEG from the camera, run it through a Darknet (or ONNX) YOLO network with
cv2.dnn, filter by confidence, then apply non-maximum suppression.

Two detectors are used:
  * vehicle detector - stock YOLOv3 COCO weights; we keep car/motorbike/bus/truck.
  * plate detector   - optional single-class YOLO model trained on licence plates.
                       Without it, plates are located with a contour heuristic.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

VEHICLE_CLASSES = {"car", "motorbike", "motorcycle", "bus", "truck"}


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float
    box: tuple[int, int, int, int]  # x, y, w, h in pixels

    def crop(self, image: np.ndarray, pad: float = 0.0) -> np.ndarray:
        x, y, w, h = self.box
        px, py = int(w * pad), int(h * pad)
        height, width = image.shape[:2]
        x0, y0 = max(0, x - px), max(0, y - py)
        x1, y1 = min(width, x + w + px), min(height, y + h + py)
        return image[y0:y1, x0:x1]


def postprocess(outputs: list[np.ndarray], width: int, height: int, labels: list[str],
                conf_threshold: float = 0.5, nms_threshold: float = 0.3,
                keep: set[str] | None = None) -> list[Detection]:
    """Turn raw YOLOv3-style outputs (rows of cx, cy, w, h, objectness, class scores...) into boxes."""
    boxes: list[list[int]] = []
    confidences: list[float] = []
    class_ids: list[int] = []
    for output in outputs:
        for row in np.asarray(output).reshape(-1, output.shape[-1]):
            scores = row[5:]
            class_id = int(np.argmax(scores))
            confidence = float(scores[class_id])
            if confidence < conf_threshold:
                continue
            label = labels[class_id] if class_id < len(labels) else str(class_id)
            if keep is not None and label not in keep:
                continue
            w, h = int(row[2] * width), int(row[3] * height)
            x, y = int(row[0] * width - w / 2), int(row[1] * height - h / 2)
            boxes.append([x, y, w, h])
            confidences.append(confidence)
            class_ids.append(class_id)
    if not boxes:
        return []
    indices = non_max_suppression(boxes, confidences, conf_threshold, nms_threshold)
    return [Detection(labels[class_ids[i]] if class_ids[i] < len(labels) else str(class_ids[i]),
                      round(confidences[i], 3), tuple(boxes[i])) for i in indices]


def non_max_suppression(boxes: list[list[int]], scores: list[float], score_threshold: float,
                        nms_threshold: float) -> list[int]:
    import cv2

    indices = cv2.dnn.NMSBoxes(boxes, scores, score_threshold, nms_threshold)
    return [int(i) for i in np.array(indices).flatten()]


class YoloDetector:
    """cv2.dnn wrapper. Accepts Darknet (.cfg + .weights) or a single .onnx file."""

    def __init__(self, model: Path, labels: list[str], config: Path | None = None, input_size: int = 416,
                 conf_threshold: float = 0.5, nms_threshold: float = 0.3, keep: set[str] | None = None):
        import cv2

        if config is not None:
            self.net = cv2.dnn.readNetFromDarknet(str(config), str(model))
        else:
            self.net = cv2.dnn.readNet(str(model))
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        self.output_names = self.net.getUnconnectedOutLayersNames()
        self.labels = labels
        self.input_size = input_size
        self.conf_threshold = conf_threshold
        self.nms_threshold = nms_threshold
        self.keep = keep

    def detect(self, image: np.ndarray) -> list[Detection]:
        import cv2

        height, width = image.shape[:2]
        blob = cv2.dnn.blobFromImage(image, 1 / 255.0, (self.input_size, self.input_size), [0, 0, 0], swapRB=True, crop=False)
        self.net.setInput(blob)
        outputs = self.net.forward(self.output_names)
        return postprocess(list(outputs), width, height, self.labels, self.conf_threshold, self.nms_threshold, self.keep)


def load_labels(path: Path) -> list[str]:
    return [line.strip() for line in path.read_text().splitlines() if line.strip()]


def find_plate_regions(vehicle: np.ndarray, max_regions: int = 3) -> list[tuple[int, int, int, int]]:
    """Fallback plate locator: edges -> contours -> keep plate-shaped rectangles (aspect 2-6)."""
    import cv2

    gray = cv2.cvtColor(vehicle, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 11, 17, 17)
    edges = cv2.Canny(gray, 30, 200)
    contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    height, width = gray.shape[:2]
    candidates = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:30]:
        x, y, w, h = cv2.boundingRect(contour)
        if h == 0:
            continue
        aspect = w / h
        area_ratio = (w * h) / float(width * height)
        if 2.0 <= aspect <= 6.0 and 0.005 <= area_ratio <= 0.25 and w >= 40:
            candidates.append((x, y, w, h))
    return candidates[:max_regions]
