def tightest_ticker(ticker: str, needs: str) -> str:
    if not needs:
        return ""
    need = {}
    for c in needs:
        need[c] = need.get(c, 0) + 1
    missing = len(needs)
    best_start, best_len = 0, 0
    left = 0
    for right, c in enumerate(ticker):
        if need.get(c, 0) > 0:
            missing -= 1
        need[c] = need.get(c, 0) - 1
        if missing == 0:
            while need[ticker[left]] < 0:
                need[ticker[left]] += 1
                left += 1
            length = right - left + 1
            if best_len == 0 or length < best_len:
                best_start, best_len = left, length
            need[ticker[left]] += 1
            missing += 1
            left += 1
    return ticker[best_start:best_start + best_len]
