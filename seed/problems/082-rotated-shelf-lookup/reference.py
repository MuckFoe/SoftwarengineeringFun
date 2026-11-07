def find_on_rotated_shelf(books: list[int], target: int) -> int:
    lo, hi = 0, len(books) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if books[mid] == target:
            return mid
        if books[lo] <= books[mid]:
            if books[lo] <= target < books[mid]:
                hi = mid - 1
            else:
                lo = mid + 1
        else:
            if books[mid] < target <= books[hi]:
                lo = mid + 1
            else:
                hi = mid - 1
    return -1
