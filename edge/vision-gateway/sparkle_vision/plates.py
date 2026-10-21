"""Plate normalization and multi-frame voting.

OCR on a single ESP32-CAM frame is noisy (motion blur, glare, 'O' vs '0').
Instead of posting every read, the tracker collects reads for a few frames,
groups near-identical strings, and emits one consensus plate per vehicle visit.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

# Mirrors ArrivalStore.NormalizePlate in the API: uppercase ASCII letters/digits, 3-12 chars.
_NOT_PLATE_CHAR = re.compile(r"[^A-Z0-9]")


def normalize_plate(text: str | None) -> str | None:
    if not text:
        return None
    cleaned = _NOT_PLATE_CHAR.sub("", text.upper())
    return cleaned if 3 <= len(cleaned) <= 12 else None


def edit_distance(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


@dataclass(frozen=True)
class PlateRead:
    text: str
    confidence: float
    at: float  # seconds (monotonic or epoch, as long as it is consistent)


@dataclass(frozen=True)
class PlateEvent:
    plate: str
    confidence: float
    first_seen: float
    last_seen: float
    reads: int


@dataclass
class _Track:
    reads: list[PlateRead] = field(default_factory=list)

    @property
    def first_seen(self) -> float:
        return self.reads[0].at

    @property
    def last_seen(self) -> float:
        return self.reads[-1].at

    def matches(self, text: str, max_distance: int) -> bool:
        return any(edit_distance(text, read.text) <= max_distance for read in self.reads[-5:])

    def consensus(self) -> tuple[str, float]:
        """Confidence-weighted vote, character by character among reads of the most common length."""
        lengths = Counter(len(r.text) for r in self.reads)
        length = lengths.most_common(1)[0][0]
        same_length = [r for r in self.reads if len(r.text) == length]
        chars = []
        agreement = []
        for position in range(length):
            votes: dict[str, float] = defaultdict(float)
            for read in same_length:
                votes[read.text[position]] += max(read.confidence, 0.01)
            best, weight = max(votes.items(), key=lambda item: item[1])
            chars.append(best)
            agreement.append(weight / sum(votes.values()))
        mean_confidence = sum(r.confidence for r in same_length) / len(same_length)
        return "".join(chars), round(mean_confidence * min(agreement), 3)


class PlateTracker:
    """Groups OCR reads into vehicle visits and emits one event per visit.

    min_reads    reads needed before a plate is trusted
    window       a track is dropped if not seen for this many seconds
    cooldown     the same plate is not re-emitted within this many seconds
                 (a car parked in front of the camera is one visit, not fifty)
    """

    def __init__(self, min_reads: int = 3, window: float = 8.0, cooldown: float = 300.0,
                 max_distance: int = 1, min_confidence: float = 0.3):
        self.min_reads = min_reads
        self.window = window
        self.cooldown = cooldown
        self.max_distance = max_distance
        self.min_confidence = min_confidence
        self._tracks: list[_Track] = []
        self._emitted: dict[str, float] = {}

    def update(self, reads: list[PlateRead], now: float) -> list[PlateEvent]:
        # Expire first, so a car returning after the window starts a fresh visit.
        self._tracks = [t for t in self._tracks if now - t.last_seen <= self.window]
        for read in reads:
            plate = normalize_plate(read.text)
            if plate is None or read.confidence < self.min_confidence:
                continue
            normalized = PlateRead(plate, read.confidence, read.at)
            track = next((t for t in self._tracks if t.matches(plate, self.max_distance)), None)
            if track is None:
                self._tracks.append(_Track([normalized]))
            else:
                track.reads.append(normalized)

        events = []
        remaining = []
        for track in self._tracks:
            if len(track.reads) >= self.min_reads:
                plate, confidence = track.consensus()
                if self._recently_emitted(plate, now):
                    # Keep absorbing reads of a car that is still in view, but stay silent.
                    if now - track.last_seen <= self.window:
                        remaining.append(track)
                    continue
                self._emitted[plate] = now
                events.append(PlateEvent(plate, confidence, track.first_seen, track.last_seen, len(track.reads)))
                continue
            if now - track.last_seen <= self.window:
                remaining.append(track)
        self._tracks = remaining
        self._emitted = {p: t for p, t in self._emitted.items() if now - t < self.cooldown}
        return events

    def _recently_emitted(self, plate: str, now: float) -> bool:
        return any(now - at < self.cooldown and edit_distance(plate, p) <= self.max_distance
                   for p, at in self._emitted.items())
