def scribble_pad_undo(ops: list[str]) -> list[str]:
    pad = []
    for op in ops:
        if op == "undo":
            if pad:
                pad.pop()
        else:
            pad.append(op[len("write:"):])
    return pad
