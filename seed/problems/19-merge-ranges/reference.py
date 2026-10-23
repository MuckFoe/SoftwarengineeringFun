def merge_ranges(ranges: list[list[int]]) -> list[list[int]]:
    ordered = sorted(ranges)
    merged: list[list[int]] = []
    for start, end in ordered:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged
