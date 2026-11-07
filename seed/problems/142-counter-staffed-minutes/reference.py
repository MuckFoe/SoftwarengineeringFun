def staffed_minutes(shifts: list[list[int]]) -> int:
    total = 0
    cur_start = cur_end = None
    for start, end in sorted(shifts):
        if cur_end is None or start > cur_end:
            if cur_end is not None:
                total += cur_end - cur_start
            cur_start, cur_end = start, end
        elif end > cur_end:
            cur_end = end
    if cur_end is not None:
        total += cur_end - cur_start
    return total
