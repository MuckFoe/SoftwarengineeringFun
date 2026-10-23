def common_elements(a: list[int], b: list[int]) -> list[int]:
    return sorted(set(a) & set(b))
