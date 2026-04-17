from pathlib import Path

from roselibrary.parsing.parser import CodeParser

FIXTURES = Path(__file__).parent / "fixtures"


def test_detect_language():
    parser = CodeParser()
    assert parser.detect_language("src/main.py") == "python"
    assert parser.detect_language("lib/utils.js") == "javascript"
    assert parser.detect_language("app.jsx") == "javascript"
    assert parser.detect_language("index.mjs") == "javascript"
    assert parser.detect_language("readme.md") is None
    assert parser.detect_language("data.json") is None


def test_python_function_extraction():
    parser = CodeParser()
    source = (FIXTURES / "sample_python.py").read_text()
    tree = parser.parse(source, "python")
    symbols = parser.extract_symbols(tree, source, "python")

    names = [s.name for s in symbols]
    assert "top_level_function" in names
    assert "MyClass" in names

    func = next(s for s in symbols if s.name == "top_level_function")
    assert func.type == "function"
    assert func.qualified_name == "top_level_function"
    assert func.parameters == "x, y"
    assert func.docstring == "Adds two numbers together."
    assert "def top_level_function" in func.source_code


def test_python_class_extraction():
    parser = CodeParser()
    source = (FIXTURES / "sample_python.py").read_text()
    tree = parser.parse(source, "python")
    symbols = parser.extract_symbols(tree, source, "python")

    cls = next(s for s in symbols if s.name == "MyClass")
    assert cls.type == "class"
    assert cls.docstring == "A sample class."
    assert len(cls.children) == 2

    method1 = next(m for m in cls.children if m.name == "method_one")
    assert method1.type == "method"
    assert method1.qualified_name == "MyClass.method_one"
    assert method1.parameters == "self, value"
    assert method1.docstring == "First method."

    method2 = next(m for m in cls.children if m.name == "method_two")
    assert method2.type == "method"
    assert method2.qualified_name == "MyClass.method_two"


def test_python_line_numbers():
    parser = CodeParser()
    source = (FIXTURES / "sample_python.py").read_text()
    tree = parser.parse(source, "python")
    symbols = parser.extract_symbols(tree, source, "python")

    func = next(s for s in symbols if s.name == "top_level_function")
    assert func.line_start == 4
    assert func.line_end > func.line_start


def test_js_function_extraction():
    parser = CodeParser()
    source = (FIXTURES / "sample_javascript.js").read_text()
    tree = parser.parse(source, "javascript")
    symbols = parser.extract_symbols(tree, source, "javascript")

    names = [s.name for s in symbols]
    assert "processInput" in names
    assert "UserService" in names
    assert "fetchData" in names


def test_js_class_with_methods():
    parser = CodeParser()
    source = (FIXTURES / "sample_javascript.js").read_text()
    tree = parser.parse(source, "javascript")
    symbols = parser.extract_symbols(tree, source, "javascript")

    cls = next(s for s in symbols if s.name == "UserService")
    assert cls.type == "class"
    assert len(cls.children) == 2

    create = next(m for m in cls.children if m.name == "create")
    assert create.type == "method"
    assert create.qualified_name == "UserService.create"
    assert create.parameters == "userData"

    delete = next(m for m in cls.children if m.name == "delete")
    assert delete.qualified_name == "UserService.delete"


def test_js_arrow_function():
    parser = CodeParser()
    source = (FIXTURES / "sample_javascript.js").read_text()
    tree = parser.parse(source, "javascript")
    symbols = parser.extract_symbols(tree, source, "javascript")

    arrow = next(s for s in symbols if s.name == "fetchData")
    assert arrow.type == "function"
    assert arrow.parameters == "url"


def test_js_docstring():
    parser = CodeParser()
    source = (FIXTURES / "sample_javascript.js").read_text()
    tree = parser.parse(source, "javascript")
    symbols = parser.extract_symbols(tree, source, "javascript")

    func = next(s for s in symbols if s.name == "processInput")
    assert func.docstring is not None
    assert "Processes user input" in func.docstring


def test_empty_source():
    parser = CodeParser()
    tree = parser.parse("", "python")
    symbols = parser.extract_symbols(tree, "", "python")
    assert symbols == []
