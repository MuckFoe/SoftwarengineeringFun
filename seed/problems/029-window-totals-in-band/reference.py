from bisect import bisect_left, bisect_right


def count_band_windows(xs: list[int], lo: int, hi: int) -> int:
    prefix = [0]
    for v in xs:
        prefix.append(prefix[-1] + v)
    ordered = sorted(set(prefix))
    size = len(ordered)
    tree = [0] * (size + 1)

    def add(i: int) -> None:
        i += 1
        while i <= size:
            tree[i] += 1
            i += i & -i

    def upto(i: int) -> int:
        total = 0
        while i > 0:
            total += tree[i]
            i -= i & -i
        return total

    count = 0
    add(bisect_left(ordered, 0))
    for p in prefix[1:]:
        # earlier prefixes q with p - hi <= q <= p - lo
        left = bisect_left(ordered, p - hi)
        right = bisect_right(ordered, p - lo)
        count += upto(right) - upto(left)
        add(bisect_left(ordered, p))
    return count
