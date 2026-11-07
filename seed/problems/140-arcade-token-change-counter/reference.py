def arcade_tokens(amount: int) -> int:
    count = 0
    for coin in (100, 50, 20, 10, 5, 2, 1):
        count += amount // coin
        amount %= coin
    return count
