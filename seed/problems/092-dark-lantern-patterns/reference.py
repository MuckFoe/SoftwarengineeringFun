def dark_lantern_patterns(n: int) -> list[str]:
    out = []

    def go(prefix):
        if len(prefix) == n:
            out.append(prefix)
            return
        go(prefix + "0")
        if not prefix or prefix[-1] != "1":
            go(prefix + "1")

    go("")
    return out
