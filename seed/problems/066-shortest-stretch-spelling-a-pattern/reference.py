def shortest_spelling(text: str, pattern: str) -> str:
    n, m = len(text), len(pattern)
    if m == 0 or n < m:
        return ""
    best_start, best_len = 0, 0
    i = 0
    while i < n:
        # forward pass: match the pattern greedily starting after i
        j = 0
        while i < n:
            if text[i] == pattern[j]:
                j += 1
                if j == m:
                    break
            i += 1
        if j < m:
            break
        end = i
        # backward pass: shrink the left end
        j = m - 1
        while j >= 0:
            if text[i] == pattern[j]:
                j -= 1
            i -= 1
        start = i + 1
        length = end - start + 1
        if best_len == 0 or length < best_len:
            best_start, best_len = start, length
        i = start + 1
    return text[best_start:best_start + best_len]
