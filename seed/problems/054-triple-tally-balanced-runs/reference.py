def count_balanced_runs(s: str) -> int:
    counts = {(0, 0): 1}
    a = b = c = 0
    total = 0
    for ch in s:
        if ch == "a":
            a += 1
        elif ch == "b":
            b += 1
        else:
            c += 1
        key = (a - b, b - c)
        k = counts.get(key, 0)
        total += k
        counts[key] = k + 1
    return total
