def count_k_kinds(items: list[int], k: int) -> int:
    def at_most(limit: int) -> int:
        if limit <= 0:
            return 0
        counts = {}
        left = 0
        total = 0
        for right, v in enumerate(items):
            counts[v] = counts.get(v, 0) + 1
            while len(counts) > limit:
                u = items[left]
                counts[u] -= 1
                if counts[u] == 0:
                    del counts[u]
                left += 1
            total += right - left + 1
        return total
    return at_most(k) - at_most(k - 1)
