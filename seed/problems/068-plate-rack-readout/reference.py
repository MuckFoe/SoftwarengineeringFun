def plate_rack_readout(ops: list[int]) -> list[int]:
    rack = []
    readout = []
    for op in ops:
        if op > 0:
            rack.append(op)
        elif rack:
            rack.pop()
        readout.append(rack[-1] if rack else -1)
    return readout
