def squared_in_order(offsets: list[int]) -> list[int]:
    n = len(offsets)
    out = [0] * n
    i, j = 0, n - 1
    for k in range(n - 1, -1, -1):
        a, b = offsets[i] * offsets[i], offsets[j] * offsets[j]
        if a > b:
            out[k] = a
            i += 1
        else:
            out[k] = b
            j -= 1
    return out
