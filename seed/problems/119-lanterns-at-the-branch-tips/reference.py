def _parse(level):
    n = len(level)
    left, right, vals = [], [], []
    if n == 0 or level[0] is None:
        return left, right, vals
    queue = [0]
    vals.append(level[0]); left.append(-1); right.append(-1)
    i = 1
    head = 0
    while head < len(queue) and i < n:
        cur = queue[head]
        head += 1
        for side in (0, 1):
            if i >= n:
                break
            v = level[i]
            i += 1
            if v is not None:
                vals.append(v); left.append(-1); right.append(-1)
                idx = len(vals) - 1
                if side == 0:
                    left[cur] = idx
                else:
                    right[cur] = idx
                queue.append(idx)
    return left, right, vals


def count_branch_tip_lanterns(level_order):
    left, right, vals = _parse(level_order)
    return sum(1 for i in range(len(vals)) if left[i] == -1 and right[i] == -1)
