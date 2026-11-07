def chain_merge_belt(crates: list[int]) -> list[int]:
    row = []
    for c in crates:
        row.append(c)
        while len(row) >= 2 and row[-1] == row[-2]:
            total = row.pop() + row.pop()
            row.append(total)
    return row
