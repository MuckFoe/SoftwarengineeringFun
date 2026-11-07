def shorter_behind(heights: list[int]) -> list[int]:
    n = len(heights)
    ranks = {v: i + 1 for i, v in enumerate(sorted(set(heights)))}
    tree = [0] * (len(ranks) + 1)
    out = [0] * n
    for idx in range(n - 1, -1, -1):
        r = ranks[heights[idx]] - 1
        total = 0
        while r > 0:
            total += tree[r]
            r -= r & -r
        out[idx] = total
        r = ranks[heights[idx]]
        while r < len(tree):
            tree[r] += 1
            r += r & -r
    return out
