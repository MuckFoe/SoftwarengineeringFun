def acronym_big_words(sentence: str) -> str:
    return ''.join(w[0].upper() for w in sentence.split() if len(w) >= 3)
