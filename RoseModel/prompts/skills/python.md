---
name: python-guidelines
description: "Best practices and style guidelines for writing Python code"
---

When writing Python code, follow these guidelines:

- Use type hints for function parameters and return values.
- Prefer f-strings over .format() or % formatting.
- Use pathlib.Path over os.path when working with file paths.
- Use list/dict/set comprehensions where they improve readability.
- Follow PEP 8 naming conventions: snake_case for functions and variables, PascalCase for classes.
- Use context managers (with statements) for resource management.
- Prefer raising specific exceptions over generic Exception.
- Use dataclasses or Pydantic models for structured data instead of plain dicts.
