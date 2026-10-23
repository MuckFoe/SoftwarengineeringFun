def shift_letters(s: str, amount: int) -> str:
    result = []
    for ch in s:
        if "a" <= ch <= "z":
            shifted = (ord(ch) - ord("a") + amount) % 26
            result.append(chr(ord("a") + shifted))
        else:
            result.append(ch)
    return "".join(result)
