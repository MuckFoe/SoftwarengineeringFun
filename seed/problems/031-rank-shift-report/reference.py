from bisect import bisect_left


def smaller_after_counts(xs: list[int]) -> list[int]:
    ordered = sorted(set(xs))
    size = len(ordered)
    tree = [0] * (size + 1)
    out = [0] * len(xs)
    for idx in range(len(xs) - 1, -1, -1):
        rank = bisect_left(ordered, xs[idx])  # count of smaller distinct values
        total = 0
        i = rank
        while i > 0:
            total += tree[i]
            i -= i & -i
        out[idx] = total
        i = rank + 1
        while i <= size:
            tree[i] += 1
            i += i & -i
    return out
