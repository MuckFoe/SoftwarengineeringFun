from math import factorial


def kth_banner_arrangement(letters: str, k: int) -> str:
    counts = {}
    for ch in letters:
        counts[ch] = counts.get(ch, 0) + 1

    def arrangements(total, cnt):
        result = factorial(total)
        for v in cnt.values():
            result //= factorial(v)
        return result

    out = []
    remaining = len(letters)
    while remaining:
        for ch in sorted(counts):
            if counts[ch] == 0:
                continue
            counts[ch] -= 1
            block = arrangements(remaining - 1, counts)
            if k < block:
                out.append(ch)
                break
            k -= block
            counts[ch] += 1
        remaining -= 1
    return "".join(out)
