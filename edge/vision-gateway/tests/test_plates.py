from sparkle_vision.plates import PlateRead, PlateTracker, edit_distance, normalize_plate


def test_normalize_matches_api_rules():
    assert normalize_plate("p-123 456") == "P123456"
    assert normalize_plate("ab") is None
    assert normalize_plate("A" * 13) is None
    assert normalize_plate(None) is None


def test_edit_distance():
    assert edit_distance("P123456", "P123456") == 0
    assert edit_distance("P123456", "P12345G") == 1
    assert edit_distance("ABC", "XYZ") == 3


def test_tracker_votes_across_noisy_reads_and_emits_once():
    tracker = PlateTracker(min_reads=3, window=5, cooldown=60)
    assert tracker.update([PlateRead("P123456", 0.9, 0.0)], 0.0) == []
    assert tracker.update([PlateRead("P12345G", 0.4, 0.5)], 0.5) == []
    events = tracker.update([PlateRead("p-123 456", 0.8, 1.0)], 1.0)
    assert [e.plate for e in events] == ["P123456"]
    assert events[0].reads == 3
    assert 0 < events[0].confidence <= 0.9
    assert events[0].first_seen == 0.0
    # Same car still in front of the camera: no repeat event during cooldown.
    for t in range(2, 10):
        assert tracker.update([PlateRead("P123456", 0.9, float(t))], float(t)) == []


def test_tracker_reemits_after_cooldown_and_tracks_cars_separately():
    tracker = PlateTracker(min_reads=2, window=5, cooldown=30)
    reads = [PlateRead("AAA111", 0.9, 0.0), PlateRead("ZZZ999", 0.9, 0.0)]
    tracker.update(reads, 0.0)
    events = tracker.update([PlateRead("AAA111", 0.9, 1.0), PlateRead("ZZZ999", 0.9, 1.0)], 1.0)
    assert sorted(e.plate for e in events) == ["AAA111", "ZZZ999"]
    tracker.update([PlateRead("AAA111", 0.9, 40.0)], 40.0)
    assert [e.plate for e in tracker.update([PlateRead("AAA111", 0.9, 41.0)], 41.0)] == ["AAA111"]


def test_tracker_drops_stale_and_low_confidence_reads():
    tracker = PlateTracker(min_reads=2, window=2, cooldown=30, min_confidence=0.5)
    tracker.update([PlateRead("BBB222", 0.9, 0.0)], 0.0)
    assert tracker.update([PlateRead("BBB222", 0.9, 10.0)], 10.0) == []  # first read expired
    assert tracker.update([PlateRead("BBB222", 0.2, 10.5)], 10.5) == []  # too uncertain to count
