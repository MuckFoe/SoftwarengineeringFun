def count_summits(heights: list[int]) -> int:
    count = 0
    for i in range(1, len(heights) - 1):
        if heights[i] > heights[i - 1] and heights[i] > heights[i + 1]:
            count += 1
    return count
