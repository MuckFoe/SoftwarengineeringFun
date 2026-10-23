def flatten_pairs(pairs: list[list[int]]) -> list[int]:
    result = []
    for pair in pairs:
        result.extend(pair)
    return result
