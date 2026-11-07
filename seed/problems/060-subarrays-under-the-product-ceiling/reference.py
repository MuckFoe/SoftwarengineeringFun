def count_under_ceiling(values: list[int], ceiling: int) -> int:
    if ceiling <= 1:
        return 0
    prod = 1
    left = 0
    total = 0
    for right, v in enumerate(values):
        prod *= v
        while prod >= ceiling:
            prod //= values[left]
            left += 1
        total += right - left + 1
    return total
