JSON (JavaScript Object Notation) is a lightweight data interchange format.

Data types: string ("hello"), number (42, 3.14), boolean (true, false), null, object ({"key": "value"}), array ([1, 2, 3]).

Rules:
- Keys must be double-quoted strings.
- No trailing commas allowed.
- No comments allowed in standard JSON.
- Strings must use double quotes, not single quotes.
- Numbers cannot have leading zeros (except 0 itself).

Common operations:
- Parsing: Convert a JSON string into a native data structure.
- Serializing: Convert a native data structure into a JSON string.
- Pretty printing: Format JSON with indentation for readability.

In Python: json.loads(string) to parse, json.dumps(obj) to serialize, json.dumps(obj, indent=2) for pretty print.
In JavaScript: JSON.parse(string) to parse, JSON.stringify(obj) to serialize, JSON.stringify(obj, null, 2) for pretty print.
