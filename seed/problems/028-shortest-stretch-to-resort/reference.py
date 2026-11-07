def shortest_resort_window(xs: list[int]) -> int:
    n = len(xs)
    right = -1
    run_max = None
    for i, v in enumerate(xs):
        if run_max is not None and v < run_max:
            right = i
        if run_max is None or v > run_max:
            run_max = v
    if right == -1:
        return 0
    left = 0
    run_min = None
    for i in range(n - 1, -1, -1):
        v = xs[i]
        if run_min is not None and v > run_min:
            left = i
        if run_min is None or v < run_min:
            run_min = v
    return right - left + 1
