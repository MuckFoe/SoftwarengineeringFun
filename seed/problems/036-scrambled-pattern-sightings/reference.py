def scrambled_sightings(text: str, pattern: str) -> int:
    m = len(pattern)
    if m > len(text):
        return 0
    need = [0] * 26
    for c in pattern:
        need[ord(c) - 97] -= 1
    have = need[:]
    # have[x] = window count - pattern count; window is a match when all zero
    for c in text[:m]:
        have[ord(c) - 97] += 1
    bad = sum(1 for x in have if x != 0)
    count = 1 if bad == 0 else 0
    for i in range(m, len(text)):
        for c, d in ((text[i], 1), (text[i - m], -1)):
            k = ord(c) - 97
            if have[k] == 0:
                bad += 1
            have[k] += d
            if have[k] == 0:
                bad -= 1
        if bad == 0:
            count += 1
    return count
