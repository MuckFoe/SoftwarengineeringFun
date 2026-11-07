def matryoshka_depth(boxes: str) -> int:
    depth = deepest = 0
    for ch in boxes:
        if ch == '[':
            depth += 1
            deepest = max(deepest, depth)
        else:
            depth -= 1
    return deepest
