def zero_total_picks(a: list[int], b: list[int], c: list[int], d: list[int]) -> int:
    left = {}
    for x in a:
        for y in b:
            s = x + y
            left[s] = left.get(s, 0) + 1
    total = 0
    for x in c:
        for y in d:
            total += left.get(-(x + y), 0)
    return total
