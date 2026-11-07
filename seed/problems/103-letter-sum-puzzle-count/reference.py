def letter_sum_puzzle_count(words: list[str], result: str) -> int:
    rows = words + [result]
    width = max(len(w) for w in rows)
    leading = {w[0] for w in rows if len(w) > 1}
    seen = set()
    fresh = []
    for col in range(width):
        new = []
        for w in rows:
            if len(w) > col:
                ch = w[-1 - col]
                if ch not in seen:
                    seen.add(ch)
                    new.append(ch)
        fresh.append(new)
    if len(seen) > 10:
        return 0
    value = {}
    used = [False] * 10

    def column(col, carry):
        if col == width:
            return 1 if carry == 0 else 0
        return assign(col, 0, carry)

    def assign(col, i, carry):
        new = fresh[col]
        if i == len(new):
            s = carry + sum(value[w[-1 - col]] for w in words if len(w) > col)
            want = value[result[-1 - col]] if len(result) > col else 0
            if s % 10 != want:
                return 0
            return column(col + 1, s // 10)
        ch = new[i]
        total = 0
        for d in range(10):
            if used[d] or (d == 0 and ch in leading):
                continue
            used[d] = True
            value[ch] = d
            total += assign(col, i + 1, carry)
            used[d] = False
            del value[ch]
        return total

    return column(0, 0)
