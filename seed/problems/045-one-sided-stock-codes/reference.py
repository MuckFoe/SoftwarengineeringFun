def one_sided(shelf_a: list[str], shelf_b: list[str]) -> list[str]:
    return sorted(set(shelf_a) ^ set(shelf_b))
