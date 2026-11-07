def quiet_shelf_picks(values: list[int]) -> int:
    took, skipped = 0, 0
    for v in values:
        took, skipped = skipped + v, max(took, skipped)
    return max(took, skipped)
