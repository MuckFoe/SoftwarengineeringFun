def best_two_hauls(values: list[int], a: int, b: int) -> int:
    n = len(values)
    if a + b > n:
        return -1
    pre = [0]
    for v in values:
        pre.append(pre[-1] + v)

    def solve(x: int, y: int) -> int:
        # group of x ends before the group of y starts
        best_x = 0
        best = -1
        for start in range(x + y - 0, n + 1):
            # y-group occupies [start - y, start)
            end_x = start - y
            best_x = max(best_x, pre[end_x] - pre[end_x - x])
            best = max(best, best_x + pre[start] - pre[start - y])
        return best

    return max(solve(a, b), solve(b, a))
