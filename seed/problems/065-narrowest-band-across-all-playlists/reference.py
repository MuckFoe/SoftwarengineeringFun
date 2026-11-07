def narrowest_band(playlists: list[list[int]]) -> list[int]:
    k = len(playlists)
    items = []
    for idx, songs in enumerate(playlists):
        for v in songs:
            items.append((v, idx))
    items.sort()
    have = [0] * k
    covered = 0
    left = 0
    best = None
    for right in range(len(items)):
        idx = items[right][1]
        if have[idx] == 0:
            covered += 1
        have[idx] += 1
        while covered == k:
            lo, hi = items[left][0], items[right][0]
            if best is None or (hi - lo, lo) < (best[1] - best[0], best[0]):
                best = [lo, hi]
            li = items[left][1]
            have[li] -= 1
            if have[li] == 0:
                covered -= 1
            left += 1
    return best
