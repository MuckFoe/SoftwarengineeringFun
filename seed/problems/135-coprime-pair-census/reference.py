def coprime_pair_census(n: int) -> int:
    if n <= 0:
        return 0
    phi = list(range(n + 1))
    for p in range(2, n + 1):
        if phi[p] == p:
            for k in range(p, n + 1, p):
                phi[k] -= phi[k] // p
    return sum(phi[1:])
