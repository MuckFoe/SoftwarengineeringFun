def even_crates_loading(weights: list[int], k: int) -> bool:
    total = sum(weights)
    if total % k:
        return False
    cap = total // k
    if max(weights) > cap:
        return False
    n = len(weights)
    full = (1 << n) - 1
    fill = [-1] * (1 << n)
    fill[0] = 0
    for mask in range(1 << n):
        if fill[mask] < 0:
            continue
        for i in range(n):
            if mask >> i & 1:
                continue
            nxt = fill[mask] + weights[i]
            if nxt <= cap:
                nm = mask | 1 << i
                if fill[nm] < 0:
                    fill[nm] = nxt % cap
    return fill[full] == 0
