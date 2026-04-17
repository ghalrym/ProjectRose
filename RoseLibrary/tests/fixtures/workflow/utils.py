def add(a, b):
    """Add two numbers together and return the result."""
    return a + b


def multiply(a, b):
    """Multiply two numbers using repeated addition."""
    result = 0
    for _ in range(b):
        result = add(result, a)
    return result
