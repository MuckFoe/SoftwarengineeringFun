def stacked_exponent_remainder(nums: list[int], m: int) -> int:
    def phi(x):
        r = x
        p = 2
        while p * p <= x:
            if x % p == 0:
                while x % p == 0:
                    x //= p
                r -= r // p
            p += 1
        if x > 1:
            r -= r // x
        return r

    def cap(x, md):
        return x if x < md else x % md + md

    def powcap(base, e, md):
        result = 1
        b = cap(base, md)
        while e:
            if e & 1:
                result = cap(result * b, md)
            b = cap(b * b, md)
            e >>= 1
        return result

    n = len(nums)

    def tower(i, md):
        if md == 1:
            return 1
        if i == n - 1:
            return cap(nums[i], md)
        if nums[i] == 1:
            return 1 % md if md > 1 else 1
        e = tower(i + 1, phi(md))
        return powcap(nums[i], e, md)

    return tower(0, m) % m
