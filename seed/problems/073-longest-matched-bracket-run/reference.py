def longest_matched_bracket_run(text: str) -> int:
    partner = {")": "(", "]": "[", "}": "{"}
    stack = [-1]
    best = 0
    for i, ch in enumerate(text):
        if ch in "([{":
            stack.append(i)
            continue
        top = stack[-1]
        if top >= 0 and text[top] == partner[ch]:
            stack.pop()
            best = max(best, i - stack[-1])
        else:
            stack = [i]
    return best
