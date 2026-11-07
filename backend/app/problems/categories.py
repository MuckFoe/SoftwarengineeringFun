"""Fixed problem category list (spec 018 plan.md "Data model"). Single source of truth:
ids, labels and display order. The same ids are CHECK-constrained in migration 0010."""

CATEGORIES: list[tuple[str, str]] = [
    ("arrays", "Arrays"),
    ("strings", "Strings"),
    ("hash-maps-sets", "Hash maps & sets"),
    ("two-pointers-windows", "Two pointers & sliding window"),
    ("stacks-queues", "Stacks & queues"),
    ("sorting-searching", "Sorting & searching"),
    ("recursion-backtracking", "Recursion & backtracking"),
    ("dynamic-programming", "Dynamic programming"),
    ("graphs-trees", "Graphs & trees"),
    ("math-bits", "Math & bit tricks"),
    ("greedy-intervals", "Greedy & intervals"),
]
CATEGORY_IDS: list[str] = [c[0] for c in CATEGORIES]
DIFFICULTIES: list[str] = ["easy", "medium", "hard"]
