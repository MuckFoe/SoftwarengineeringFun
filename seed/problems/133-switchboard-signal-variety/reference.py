def switchboard_signal_variety(levels: list[int]) -> int:
    basis = [0] * 30
    rank = 0
    for v in levels:
        for b in range(29, -1, -1):
            if not (v >> b) & 1:
                continue
            if basis[b] == 0:
                basis[b] = v
                rank += 1
                break
            v ^= basis[b]
    return 1 << rank
