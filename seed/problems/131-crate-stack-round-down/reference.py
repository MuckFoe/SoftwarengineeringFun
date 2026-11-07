def crate_stack_round_down(n: int) -> int:
    if n <= 0:
        return 0
    return 1 << (n.bit_length() - 1)
