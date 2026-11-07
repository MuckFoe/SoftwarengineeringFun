def longest_rising_streak(balances: list[int]) -> int:
    best = 0
    run = 0
    for i, v in enumerate(balances):
        if i > 0 and v > balances[i - 1]:
            run += 1
        else:
            run = 1
        best = max(best, run)
    return best
