def self_avoiding_garden_walks(grid: list[str]) -> int:
    rows, cols = len(grid), len(grid[0])
    if grid[0][0] == "#" or grid[rows - 1][cols - 1] == "#":
        return 0
    seen = [[False] * cols for _ in range(rows)]

    def go(r, c):
        if r == rows - 1 and c == cols - 1:
            return 1
        seen[r][c] = True
        total = 0
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == "." and not seen[nr][nc]:
                total += go(nr, nc)
        seen[r][c] = False
        return total

    return go(0, 0)
