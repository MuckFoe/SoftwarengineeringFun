def courtyard_tilings(rows: int, cols: int, holes: list[list[int]]) -> int:
    mod = 1_000_000_007
    if cols > rows:
        # transpose so the profile is the narrower side
        rows, cols = cols, rows
        holes = [[c, r] for r, c in holes]
    blocked = {(r, c) for r, c in holes}
    # mask bit c set means cell (current row, c) is already covered from above
    # or, for cells behind the cursor, that the cell below is covered.
    states = {0: 1}
    for r in range(rows):
        for c in range(cols):
            nxt = {}
            for mask, ways in states.items():
                bit = 1 << c
                covered = bool(mask & bit)
                if (r, c) in blocked:
                    if covered:
                        continue
                    nxt[mask] = (nxt.get(mask, 0) + ways) % mod
                    continue
                if covered:
                    m2 = mask & ~bit
                    nxt[m2] = (nxt.get(m2, 0) + ways) % mod
                    continue
                # vertical domino down
                if r + 1 < rows and (r + 1, c) not in blocked:
                    m2 = mask | bit
                    nxt[m2] = (nxt.get(m2, 0) + ways) % mod
                # horizontal domino right
                if c + 1 < cols and (r, c + 1) not in blocked and not (mask & (bit << 1)):
                    m2 = mask | (bit << 1)
                    nxt[m2] = (nxt.get(m2, 0) + ways) % mod
            states = nxt
    return states.get(0, 0) % mod
