def spread_across_every_stretch(values: list[int]) -> int:
    mod = 1_000_000_007
    n = len(values)

    def sum_of_maxima(xs):
        left = [0] * n
        stack = []
        for i in range(n):
            while stack and xs[stack[-1]] < xs[i]:
                stack.pop()
            left[i] = i - (stack[-1] if stack else -1)
            stack.append(i)
        right = [0] * n
        stack = []
        for i in range(n - 1, -1, -1):
            while stack and xs[stack[-1]] <= xs[i]:
                stack.pop()
            right[i] = (stack[-1] if stack else n) - i
            stack.append(i)
        return sum(xs[i] * left[i] * right[i] for i in range(n))

    total = sum_of_maxima(values) + sum_of_maxima([-v for v in values])
    return total % mod
