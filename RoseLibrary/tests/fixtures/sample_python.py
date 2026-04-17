from .utils import helper_func
from .utils import another as aliased_helper

def top_level_function(x, y):
    """Adds two numbers together."""
    result = helper_func(x)
    return result + y

class MyClass:
    """A sample class."""

    def method_one(self, value):
        """First method."""
        return aliased_helper(value)

    def method_two(self):
        """Second method."""
        fn = helper_func
        return fn(42)
