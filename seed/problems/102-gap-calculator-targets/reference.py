def gap_calculator_targets(digits: str, target: int) -> int:
    n = len(digits)

    def go(pos, total, term):
        if pos == n:
            return 1 if total + term == target else 0
        count = 0
        for end in range(pos + 1, n + 1):
            if end - pos > 1 and digits[pos] == "0":
                break
            num = int(digits[pos:end])
            count += go(end, total + term, num)
            count += go(end, total + term, -num)
            count += go(end, total, term * num)
        return count

    count = 0
    for end in range(1, n + 1):
        if end > 1 and digits[0] == "0":
            break
        count += go(end, 0, int(digits[:end]))
    return count
