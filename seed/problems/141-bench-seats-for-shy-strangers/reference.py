def shy_seats(bench: str) -> int:
    seats = list(bench)
    n = len(seats)
    placed = 0
    for i in range(n):
        if seats[i] != "E":
            continue
        left_free = i == 0 or seats[i - 1] != "X"
        right_free = i == n - 1 or seats[i + 1] != "X"
        if left_free and right_free:
            seats[i] = "X"
            placed += 1
    return placed
