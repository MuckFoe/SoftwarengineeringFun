def best_conveyor_run(loads: list[int]) -> int:
    best_max = cur_max = loads[0]
    best_min = cur_min = loads[0]
    for v in loads[1:]:
        cur_max = max(v, cur_max + v)
        best_max = max(best_max, cur_max)
        cur_min = min(v, cur_min + v)
        best_min = min(best_min, cur_min)
    total = sum(loads)
    if best_max < 0:
        return best_max
    return max(best_max, total - best_min)
