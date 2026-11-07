def cheapest_finish(tolls: list[int]) -> int:
    a, b = tolls[0], tolls[1]
    for t in tolls[2:]:
        a, b = b, min(a, b) + t
    return min(a, b)
