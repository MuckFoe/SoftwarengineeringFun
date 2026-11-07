def disjoint_mask_pairs(masks: list[int]) -> int:
    B = 17
    size = 1 << B
    cnt = [0] * size
    for m in masks:
        cnt[m] += 1
    sub = cnt[:]
    for b in range(B):
        bit = 1 << b
        for m in range(size):
            if m & bit:
                sub[m] += sub[m ^ bit]
    full = size - 1
    total = 0
    for m in masks:
        total += sub[full ^ m]
        if m == 0:
            total -= 1
    return total // 2
