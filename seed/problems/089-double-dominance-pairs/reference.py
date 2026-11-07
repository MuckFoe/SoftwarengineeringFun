def double_dominance_pairs(xs: list[int]) -> int:
    items = list(xs)
    n = len(items)
    buf = [0] * n
    count = 0
    width = 1
    while width < n:
        for lo in range(0, n, 2 * width):
            mid = min(lo + width, n)
            hi = min(lo + 2 * width, n)
            j = mid
            for i in range(lo, mid):
                while j < hi and items[i] > 2 * items[j]:
                    j += 1
                count += j - mid
            i, j, k = lo, mid, lo
            while i < mid and j < hi:
                if items[i] <= items[j]:
                    buf[k] = items[i]
                    i += 1
                else:
                    buf[k] = items[j]
                    j += 1
                k += 1
            while i < mid:
                buf[k] = items[i]
                i += 1
                k += 1
            while j < hi:
                buf[k] = items[j]
                j += 1
                k += 1
        items, buf = buf, items
        width *= 2
    return count
