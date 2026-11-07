def longest_twice_seen(s: str) -> int:
    if len(s) < 2:
        return 0
    nxt = [{}]
    link = [-1]
    length = [0]
    cnt = [0]
    last = 0
    for ch in s:
        cur = len(nxt)
        nxt.append({})
        length.append(length[last] + 1)
        link.append(0)
        cnt.append(1)
        p = last
        while p != -1 and ch not in nxt[p]:
            nxt[p][ch] = cur
            p = link[p]
        if p != -1:
            q = nxt[p][ch]
            if length[p] + 1 == length[q]:
                link[cur] = q
            else:
                clone = len(nxt)
                nxt.append(dict(nxt[q]))
                length.append(length[p] + 1)
                link.append(link[q])
                cnt.append(0)
                while p != -1 and nxt[p].get(ch) == q:
                    nxt[p][ch] = clone
                    p = link[p]
                link[q] = clone
                link[cur] = clone
        last = cur
    order = sorted(range(1, len(nxt)), key=lambda v: -length[v])
    best = 0
    for v in order:
        if cnt[v] >= 2 and length[v] > best:
            best = length[v]
        cnt[link[v]] += cnt[v]
    return best
