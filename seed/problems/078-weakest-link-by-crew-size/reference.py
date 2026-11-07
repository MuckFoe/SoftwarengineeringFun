def weakest_link_by_crew_size(skills: list[int]) -> list[int]:
    n = len(skills)
    if n == 0:
        return []
    left = [-1] * n
    right = [n] * n
    stack = []
    for i in range(n):
        while stack and skills[stack[-1]] >= skills[i]:
            right[stack.pop()] = i
        left[i] = stack[-1] if stack else -1
        stack.append(i)
    best = [None] * (n + 1)
    for i in range(n):
        size = right[i] - left[i] - 1
        if best[size] is None or skills[i] > best[size]:
            best[size] = skills[i]
    for size in range(n - 1, 0, -1):
        if best[size] is None or (best[size + 1] is not None and best[size + 1] > best[size]):
            best[size] = best[size + 1]
    return best[1:]
