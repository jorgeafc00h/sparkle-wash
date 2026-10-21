"""Plate text recognition. Uses EasyOCR when installed, otherwise Tesseract, otherwise disabled."""

from __future__ import annotations

from typing import Protocol

import numpy as np

from .plates import normalize_plate


class PlateReader(Protocol):
    def read(self, plate_image: np.ndarray) -> list[tuple[str, float]]: ...


def preprocess(plate_image: np.ndarray) -> np.ndarray:
    """Upscale small ESP32-CAM crops and binarize; OCR engines do much better on ~100px-tall text."""
    import cv2

    gray = cv2.cvtColor(plate_image, cv2.COLOR_BGR2GRAY) if plate_image.ndim == 3 else plate_image
    scale = max(1.0, 100.0 / max(gray.shape[0], 1))
    gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    return cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]


class EasyOcrReader:
    def __init__(self, languages: list[str] | None = None):
        import easyocr

        self._reader = easyocr.Reader(languages or ["en"], gpu=False)

    def read(self, plate_image: np.ndarray) -> list[tuple[str, float]]:
        results = self._reader.readtext(preprocess(plate_image), allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")
        joined = "".join(text for _, text, _ in results)
        confidence = min((float(c) for _, _, c in results), default=0.0)
        plate = normalize_plate(joined)
        return [(plate, confidence)] if plate else []


class TesseractReader:
    def __init__(self):
        import pytesseract

        self._tesseract = pytesseract

    def read(self, plate_image: np.ndarray) -> list[tuple[str, float]]:
        data = self._tesseract.image_to_data(
            preprocess(plate_image), config="--psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
            output_type=self._tesseract.Output.DICT)
        words = [(w, float(c)) for w, c in zip(data["text"], data["conf"]) if w.strip() and float(c) >= 0]
        plate = normalize_plate("".join(w for w, _ in words))
        if not plate:
            return []
        return [(plate, min(c for _, c in words) / 100.0)]


def default_reader() -> PlateReader | None:
    for factory in (EasyOcrReader, TesseractReader):
        try:
            return factory()
        except ImportError:
            continue
    return None
