def shelf_split_cost(weights: list[int], groups: int) -> int:
    n = len(weights)
    pre = [0]
    for w in weights:
        pre.append(pre[-1] + w)

    def cost(i: int, j: int) -> int:  # block covering items i..j-1
        s = pre[j] - pre[i]
        return s * s

    inf = float("inf")
    prev = [inf] * (n + 1)
    prev[0] = 0
    for g in range(1, groups + 1):
        cur = [inf] * (n + 1)
        # cur[j] = min over i in [g-1, j-1] of prev[i] + cost(i, j)
        stack = [(g, n, g - 1, n - 1)]
        while stack:
            lo, hi, opt_lo, opt_hi = stack.pop()
            if lo > hi:
                continue
            mid = (lo + hi) // 2
            best, best_i = inf, opt_lo
            for i in range(opt_lo, min(mid - 1, opt_hi) + 1):
                if prev[i] == inf:
                    continue
                cand = prev[i] + cost(i, mid)
                if cand < best:
                    best, best_i = cand, i
            cur[mid] = best
            stack.append((lo, mid - 1, opt_lo, best_i))
            stack.append((mid + 1, hi, best_i, opt_hi))
        prev = cur
    return prev[n]
