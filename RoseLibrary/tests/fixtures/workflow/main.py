from .utils import add


def calculate_total(items):
    """Calculate the total price of all items."""
    total = 0
    for item in items:
        total = add(total, item.price)
    return total
