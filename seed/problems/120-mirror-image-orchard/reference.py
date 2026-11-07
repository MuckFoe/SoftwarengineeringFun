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


def is_mirror_orchard(level_order):
    left, right, vals = _parse(level_order)
    if not vals:
        return True
    stack = [(left[0], right[0])]
    while stack:
        a, b = stack.pop()
        if a == -1 and b == -1:
            continue
        if a == -1 or b == -1 or vals[a] != vals[b]:
            return False
        stack.append((left[a], right[b]))
        stack.append((right[a], left[b]))
    return True
