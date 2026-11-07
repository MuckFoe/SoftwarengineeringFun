def podium_names(names: list[str], scores: list[int]) -> list[str]:
    ranked = sorted(zip(names, scores), key=lambda e: (-e[1], e[0]))
    return [e[0] for e in ranked[:3]]
