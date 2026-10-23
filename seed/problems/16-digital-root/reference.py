def digital_root(n: int) -> int:
    if n < 10:
        return n
    return digital_root(sum(int(d) for d in str(n)))
