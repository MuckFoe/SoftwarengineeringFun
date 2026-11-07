def biggest_clear_lot(site: list[str]) -> int:
    if not site:
        return 0
    width = len(site[0])
    heights = [0] * width
    best = 0
    for row in site:
        for j in range(width):
            heights[j] = heights[j] + 1 if row[j] == "1" else 0
        stack = []
        for j in range(width + 1):
            cur = heights[j] if j < width else 0
            start = j
            while stack and stack[-1][1] >= cur:
                s, h = stack.pop()
                best = max(best, h * (j - s))
                start = s
            stack.append((start, cur))
    return best
