def aisle_routes(rows: int, cols: int, blocked: list[list[int]]) -> int:
    walls = {(r, c) for r, c in blocked}
    grid = [[0] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            if (r, c) in walls:
                continue
            if r == 0 and c == 0:
                grid[r][c] = 1
                continue
            up = grid[r - 1][c] if r else 0
            left = grid[r][c - 1] if c else 0
            grid[r][c] = up + left
    return grid[rows - 1][cols - 1]
