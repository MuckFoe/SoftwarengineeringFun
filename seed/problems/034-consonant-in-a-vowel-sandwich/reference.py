def sandwich_count(s: str) -> int:
    v = set('aeiou')
    return sum(1 for i in range(1, len(s) - 1) if s[i] not in v and s[i - 1] in v and s[i + 1] in v)
