def rehearsal_rooms(slots: list[list[int]]) -> int:
    starts = sorted(s[0] for s in slots)
    ends = sorted(s[1] for s in slots)
    rooms = best = 0
    j = 0
    for s in starts:
        while ends[j] <= s:
            j += 1
            rooms -= 1
        rooms += 1
        best = max(best, rooms)
    return best
