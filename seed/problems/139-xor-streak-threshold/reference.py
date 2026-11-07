def xor_streak_threshold(xs: list[int], k: int) -> int:
    B = 30
    # trie as parallel arrays
    left = [0]
    right = [0]
    cnt = [0]
    child = [[-1, -1]]
    cnt = [0]

    def insert(v):
        node = 0
        for b in range(B - 1, -1, -1):
            bit = (v >> b) & 1
            if child[node][bit] == -1:
                child.append([-1, -1])
                cnt.append(0)
                child[node][bit] = len(child) - 1
            node = child[node][bit]
            cnt[node] += 1

    def count_ge(v):
        node = 0
        total = 0
        for b in range(B - 1, -1, -1):
            if node == -1:
                break
            vb = (v >> b) & 1
            kb = (k >> b) & 1
            if kb == 0:
                other = child[node][vb ^ 1]
                if other != -1:
                    total += cnt[other]
                node = child[node][vb]
            else:
                node = child[node][vb ^ 1]
        else:
            if node != -1:
                total += cnt[node]
        return total

    insert(0)
    pre = 0
    result = 0
    for x in xs:
        pre ^= x
        result += count_ge(pre)
        insert(pre)
    return result
