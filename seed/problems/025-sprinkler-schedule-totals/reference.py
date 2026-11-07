def sprinkler_totals(n: int, jobs: list[list[int]]) -> list[int]:
    diff = [0] * (n + 1)
    for left, right, amount in jobs:
        diff[left] += amount
        diff[right + 1] -= amount
    out = []
    run = 0
    for i in range(n):
        run += diff[i]
        out.append(run)
    return out
