def treasure_chest_weigh_ins(weights: list[int], target: int) -> int:
    def go(i, remaining):
        if i == len(weights):
            return 1 if remaining == 0 else 0
        return go(i + 1, remaining) + go(i + 1, remaining - weights[i])

    return go(0, target)
