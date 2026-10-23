def average(xs: list[float]) -> float | None:
    if not xs:
        return None
    return sum(xs) / len(xs)
