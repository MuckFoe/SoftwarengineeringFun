def gray_dial_distance(a: int, b: int) -> int:
    def position(g):
        k = 0
        while g:
            k ^= g
            g >>= 1
        return k
    return abs(position(a) - position(b))
