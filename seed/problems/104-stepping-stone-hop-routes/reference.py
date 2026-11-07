def hop_routes(stones: int, hops: list[int]) -> int:
    ways = [0] * (stones + 1)
    ways[0] = 1
    for pos in range(1, stones + 1):
        for h in hops:
            if h <= pos:
                ways[pos] += ways[pos - h]
    return ways[stones]
