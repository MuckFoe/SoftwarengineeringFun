def closest_tide_gap(readings: list[int]) -> int:
    if len(readings) < 2:
        return -1
    ordered = sorted(readings)
    return min(b - a for a, b in zip(ordered, ordered[1:]))
