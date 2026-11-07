def echo_alarms(readings: list[int], window: int) -> list[int]:
    last = {}
    out = []
    for i, v in enumerate(readings):
        j = last.get(v)
        if j is not None and i - j <= window:
            out.append(i)
        last[v] = i
    return out
