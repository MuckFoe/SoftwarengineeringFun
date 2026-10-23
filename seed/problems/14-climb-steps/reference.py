def count_ways(n: int) -> int:
    a, b = 1, 1  # ways(0), ways(1)
    for _ in range(n):
        a, b = b, a + b
    return a
