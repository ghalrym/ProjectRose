from pathlib import Path

from roselibrary.parsing.parser import CodeParser
from roselibrary.parsing.references import ReferenceExtractor

FIXTURES = Path(__file__).parent / "fixtures"


def test_detect_typescript():
    parser = CodeParser()
    assert parser.detect_language("src/app.ts") == "typescript"
    assert parser.detect_language("src/App.tsx") == "typescript"
    assert parser.detect_language("utils.js") == "javascript"


def test_typescript_function_extraction():
    parser = CodeParser()
    source = (FIXTURES / "sample_typescript.ts").read_text()
    tree = parser.parse(source, "typescript")
    symbols = parser.extract_symbols(tree, source, "typescript")

    names = [s.name for s in symbols]
    assert "validateUser" in names
    assert "AuthService" in names
    assert "processData" in names


def test_typescript_class_with_methods():
    parser = CodeParser()
    source = (FIXTURES / "sample_typescript.ts").read_text()
    tree = parser.parse(source, "typescript")
    symbols = parser.extract_symbols(tree, source, "typescript")

    cls = next(s for s in symbols if s.name == "AuthService")
    assert cls.type == "class"
    method_names = {m.name for m in cls.children}
    assert "constructor" in method_names
    assert "authenticate" in method_names
    assert "logout" in method_names

    auth = next(m for m in cls.children if m.name == "authenticate")
    assert auth.qualified_name == "AuthService.authenticate"
    assert auth.type == "method"
    assert auth.parameters is not None
    assert "name" in auth.parameters


def test_typescript_arrow_function():
    parser = CodeParser()
    source = (FIXTURES / "sample_typescript.ts").read_text()
    tree = parser.parse(source, "typescript")
    symbols = parser.extract_symbols(tree, source, "typescript")

    arrow = next(s for s in symbols if s.name == "processData")
    assert arrow.type == "function"
    assert "items" in arrow.parameters


def test_typescript_docstring():
    parser = CodeParser()
    source = (FIXTURES / "sample_typescript.ts").read_text()
    tree = parser.parse(source, "typescript")
    symbols = parser.extract_symbols(tree, source, "typescript")

    func = next(s for s in symbols if s.name == "validateUser")
    assert func.docstring is not None
    assert "Validates user input" in func.docstring


def test_typescript_skips_interfaces():
    """Interfaces are not runtime symbols and should not be extracted."""
    parser = CodeParser()
    source = (FIXTURES / "sample_typescript.ts").read_text()
    tree = parser.parse(source, "typescript")
    symbols = parser.extract_symbols(tree, source, "typescript")

    names = [s.name for s in symbols]
    assert "ValidationResult" not in names


def test_typescript_import_references():
    parser = CodeParser()
    extractor = ReferenceExtractor()
    source = (FIXTURES / "sample_typescript.ts").read_text()
    tree = parser.parse(source, "typescript")
    symbols = parser.extract_symbols(tree, source, "typescript")
    refs = extractor.extract_references(tree, source, "typescript", symbols, "src/app.ts")

    imports = [r for r in refs if r.type == "import"]
    target_names = {r.target_symbol_name for r in imports}
    # formatName should be imported
    assert "formatName" in target_names
    # UserConfig from `import type` should NOT be imported (type-only)
    assert "UserConfig" not in target_names


def test_typescript_import_resolution():
    parser = CodeParser()
    extractor = ReferenceExtractor()
    source = (FIXTURES / "sample_typescript.ts").read_text()
    tree = parser.parse(source, "typescript")
    symbols = parser.extract_symbols(tree, source, "typescript")
    refs = extractor.extract_references(tree, source, "typescript", symbols, "src/app.ts")

    imports = [r for r in refs if r.type == "import" and r.target_symbol_name == "formatName"]
    assert len(imports) == 1
    # Should resolve to .ts since the importing file is .ts
    assert imports[0].target_file_path is not None
    assert imports[0].target_file_path.endswith(".ts")


def test_typescript_call_references():
    parser = CodeParser()
    extractor = ReferenceExtractor()
    source = (FIXTURES / "sample_typescript.ts").read_text()
    tree = parser.parse(source, "typescript")
    symbols = parser.extract_symbols(tree, source, "typescript")
    refs = extractor.extract_references(tree, source, "typescript", symbols, "src/app.ts")

    calls = [r for r in refs if r.type == "call"]
    target_names = {r.target_symbol_name for r in calls}
    assert "formatName" in target_names
