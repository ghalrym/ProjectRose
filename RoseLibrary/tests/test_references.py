from pathlib import Path

from roselibrary.parsing.parser import CodeParser
from roselibrary.parsing.references import ReferenceExtractor

FIXTURES = Path(__file__).parent / "fixtures"


def _get_refs(source, language, file_path):
    parser = CodeParser()
    extractor = ReferenceExtractor()
    tree = parser.parse(source, language)
    symbols = parser.extract_symbols(tree, source, language)
    # Flatten children into the list for enclosing symbol lookup
    all_symbols = []
    for s in symbols:
        all_symbols.append(s)
        all_symbols.extend(s.children)
    return extractor.extract_references(tree, source, language, symbols, file_path)


def test_python_import_extraction():
    source = (FIXTURES / "sample_python.py").read_text()
    refs = _get_refs(source, "python", "pkg/sample_python.py")
    imports = [r for r in refs if r.type == "import"]
    assert len(imports) >= 2
    target_names = {r.target_symbol_name for r in imports}
    assert "helper_func" in target_names
    assert "another" in target_names  # Original name, not alias


def test_python_aliased_import():
    source = (FIXTURES / "sample_python.py").read_text()
    refs = _get_refs(source, "python", "pkg/sample_python.py")
    imports = [r for r in refs if r.type == "import"]
    # The aliased import should reference the original name
    alias_import = next(r for r in imports if r.target_symbol_name == "another")
    assert alias_import.target_file_path is not None
    assert alias_import.target_file_path.endswith("utils.py")


def test_python_call_detection():
    source = (FIXTURES / "sample_python.py").read_text()
    refs = _get_refs(source, "python", "pkg/sample_python.py")
    calls = [r for r in refs if r.type == "call"]
    target_names = {r.target_symbol_name for r in calls}
    assert "helper_func" in target_names
    assert "another" in target_names  # aliased_helper resolves to original


def test_python_call_resolution():
    source = (FIXTURES / "sample_python.py").read_text()
    refs = _get_refs(source, "python", "pkg/sample_python.py")
    calls = [r for r in refs if r.type == "call" and r.target_symbol_name == "helper_func"]
    assert len(calls) >= 1
    for call in calls:
        assert call.target_file_path is not None
        assert "utils.py" in call.target_file_path


def test_python_assignment_detection():
    source = (FIXTURES / "sample_python.py").read_text()
    refs = _get_refs(source, "python", "pkg/sample_python.py")
    assignments = [r for r in refs if r.type == "assignment"]
    # fn = helper_func should be detected
    assert len(assignments) >= 1
    target_names = {r.target_symbol_name for r in assignments}
    assert "helper_func" in target_names


def test_python_third_party_import():
    source = "import os\nimport json\n"
    refs = _get_refs(source, "python", "main.py")
    imports = [r for r in refs if r.type == "import"]
    for imp in imports:
        assert imp.target_file_path is None  # Third-party


def test_js_import_extraction():
    source = (FIXTURES / "sample_javascript.js").read_text()
    refs = _get_refs(source, "javascript", "src/sample.js")
    imports = [r for r in refs if r.type == "import"]
    target_names = {r.target_symbol_name for r in imports}
    assert "formatName" in target_names
    assert "validateEmail" in target_names  # Original name
    assert "default" in target_names  # Default import for Utils


def test_js_aliased_import():
    source = (FIXTURES / "sample_javascript.js").read_text()
    refs = _get_refs(source, "javascript", "src/sample.js")
    imports = [r for r in refs if r.type == "import"]
    # validate is alias for validateEmail
    validate_import = next(r for r in imports if r.target_symbol_name == "validateEmail")
    assert validate_import.target_file_path is not None
    assert "helpers" in validate_import.target_file_path


def test_js_call_detection():
    source = (FIXTURES / "sample_javascript.js").read_text()
    refs = _get_refs(source, "javascript", "src/sample.js")
    calls = [r for r in refs if r.type == "call"]
    target_names = {r.target_symbol_name for r in calls}
    assert "formatName" in target_names
    assert "validateEmail" in target_names  # Resolves alias to original


def test_js_member_call():
    source = (FIXTURES / "sample_javascript.js").read_text()
    refs = _get_refs(source, "javascript", "src/sample.js")
    calls = [r for r in refs if r.type == "call"]
    member_calls = {r.target_symbol_name for r in calls if r.target_file_path and "utils" in r.target_file_path}
    assert "remove" in member_calls or "get" in member_calls


def test_js_third_party():
    source = "import React from 'react';\n"
    refs = _get_refs(source, "javascript", "src/app.js")
    imports = [r for r in refs if r.type == "import"]
    assert len(imports) == 1
    assert imports[0].target_file_path is None


def test_enclosing_symbol_tracking():
    source = (FIXTURES / "sample_python.py").read_text()
    refs = _get_refs(source, "python", "pkg/sample.py")
    # Calls inside top_level_function should have source_symbol_name set
    helper_calls = [r for r in refs if r.type == "call" and r.target_symbol_name == "helper_func"]
    sources = {r.source_symbol_name for r in helper_calls}
    # At least one should be from top_level_function and one from method_two (via assignment)
    assert "top_level_function" in sources or "MyClass.method_two" in sources
