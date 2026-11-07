def count_tickets(lo: int, hi: int, modulus: int) -> int:
    def upto(limit: int) -> int:
        if limit < 0:
            return 0
        if limit == 0:
            return 1
        digits = [int(ch) for ch in str(limit)]
        n = len(digits)
        # free[k][prev][rem]: ways to fill k more digits (any digits, not equal to
        # the digit before, may be 0) so the added digit sum is rem mod modulus.
        # Build counts of fillings with total remainder r.
        free = [[[0] * modulus for _ in range(11)] for _ in range(n + 1)]
        for prev in range(11):
            free[0][prev][0] = 1
        for k in range(1, n + 1):
            for prev in range(11):
                row = free[k][prev]
                for d in range(10):
                    if d == prev:
                        continue
                    sub = free[k - 1][d]
                    shift = d % modulus
                    for r in range(modulus):
                        c = sub[r]
                        if c:
                            row[(r + shift) % modulus] += c
        total = 0
        # shorter numbers (no leading zero), lengths 1..n-1
        for length in range(1, n):
            for first in range(1, 10):
                total += free[length - 1][first][(-first) % modulus]
        # numbers of the same length bounded by limit
        acc = 0
        prev = 10
        for pos, bound in enumerate(digits):
            start = 1 if pos == 0 else 0
            for d in range(start, bound):
                if d == prev:
                    continue
                need = (-(acc + d)) % modulus
                total += free[n - pos - 1][d][need]
            if bound == prev:
                break
            acc += bound
            prev = bound
        else:
            if acc % modulus == 0:
                total += 1
        if limit >= 0:
            total += 1  # the number 0 itself is tidy (digit sum 0)
        return total

    return upto(hi) - upto(lo - 1)
