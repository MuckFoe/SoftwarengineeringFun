def count_vowels(s: str) -> int:
    return sum(1 for c in s if c in "aeiou")
