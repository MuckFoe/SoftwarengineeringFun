def lamp_count(stalls: list[int], reach: int) -> int:
    lamps = 0
    covered_to = None
    for pos in sorted(stalls):
        if covered_to is None or pos > covered_to:
            lamps += 1
            covered_to = pos + 2 * reach
    return lamps
