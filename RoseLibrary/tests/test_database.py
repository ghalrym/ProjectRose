from roselibrary.models.database import Database


def test_schema_creation(tmp_path):
    db = Database(tmp_path)
    db.init_schema()
    tables = db.conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    table_names = sorted(r[0] for r in tables)
    assert "files" in table_names
    assert "symbols" in table_names
    assert "references_" in table_names
    db.close()


def test_file_upsert_and_retrieval(tmp_path):
    db = Database(tmp_path)
    db.init_schema()
    file_id = db.upsert_file("src/main.py", "abc123", "python")
    assert file_id > 0

    row = db.get_file("src/main.py")
    assert row is not None
    assert row.path == "src/main.py"
    assert row.hash == "abc123"
    assert row.language == "python"

    # Upsert same path with new hash
    file_id2 = db.upsert_file("src/main.py", "def456", "python")
    assert file_id2 == file_id
    row = db.get_file("src/main.py")
    assert row.hash == "def456"
    db.close()


def test_file_not_found(tmp_path):
    db = Database(tmp_path)
    db.init_schema()
    assert db.get_file("nonexistent.py") is None
    db.close()


def test_get_files_by_paths(tmp_path):
    db = Database(tmp_path)
    db.init_schema()
    db.upsert_file("a.py", "h1", "python")
    db.upsert_file("b.py", "h2", "python")
    db.upsert_file("c.py", "h3", "python")

    result = db.get_files_by_paths(["a.py", "c.py", "missing.py"])
    assert len(result) == 2
    assert "a.py" in result
    assert "c.py" in result
    assert "missing.py" not in result

    # Empty list
    assert db.get_files_by_paths([]) == {}
    db.close()


def test_cascade_delete(tmp_path):
    db = Database(tmp_path)
    db.init_schema()
    file_id = db.upsert_file("test.py", "hash1", "python")
    sym_id = db.insert_symbol(
        file_id, "my_func", "my_func", "function", 1, 10, "def my_func(): pass"
    )
    db.insert_reference(sym_id, "other_func", "other.py", "call", 5)

    # Verify data exists
    assert len(db.get_symbols_by_file(file_id)) == 1
    assert len(db.get_references_by_source_symbol(sym_id)) == 1

    # Delete file — should cascade
    db.delete_file_data(file_id)
    assert db.get_file("test.py") is None
    assert len(db.get_symbols_by_file(file_id)) == 0
    assert len(db.get_references_by_source_symbol(sym_id)) == 0
    db.close()


def test_symbol_with_parent(tmp_path):
    db = Database(tmp_path)
    db.init_schema()
    file_id = db.upsert_file("test.py", "hash1", "python")
    class_id = db.insert_symbol(
        file_id, "MyClass", "MyClass", "class", 1, 20,
        "class MyClass:\n    pass"
    )
    method_id = db.insert_symbol(
        file_id, "my_method", "MyClass.my_method", "method", 2, 10,
        "def my_method(self): pass",
        parameters="self",
        docstring="A method",
        parent_symbol_id=class_id,
    )

    symbols = db.get_symbols_by_file(file_id)
    assert len(symbols) == 2

    method = next(s for s in symbols if s.name == "my_method")
    assert method.qualified_name == "MyClass.my_method"
    assert method.parent_symbol_id == class_id
    assert method.parameters == "self"
    assert method.docstring == "A method"
    db.close()


def test_find_symbols_by_name(tmp_path):
    db = Database(tmp_path)
    db.init_schema()
    f1 = db.upsert_file("a.py", "h1", "python")
    f2 = db.upsert_file("b.py", "h2", "python")
    db.insert_symbol(f1, "process", "process", "function", 1, 5, "def process(): pass")
    db.insert_symbol(f2, "process", "process", "function", 1, 5, "def process(): pass")
    db.insert_symbol(f1, "unique_fn", "unique_fn", "function", 6, 10, "def unique_fn(): pass")

    results = db.find_symbols_by_name("process")
    assert len(results) == 2
    paths = {fp for _, fp in results}
    assert paths == {"a.py", "b.py"}

    results = db.find_symbols_by_name("unique_fn")
    assert len(results) == 1

    results = db.find_symbols_by_name("nonexistent")
    assert len(results) == 0
    db.close()


def test_references_by_target(tmp_path):
    db = Database(tmp_path)
    db.init_schema()
    f1 = db.upsert_file("caller.py", "h1", "python")
    sym1 = db.insert_symbol(f1, "do_stuff", "do_stuff", "function", 1, 10, "def do_stuff(): pass")
    db.insert_reference(sym1, "helper", "utils.py", "call", 5)
    db.insert_reference(sym1, "helper", "utils.py", "import", 1)

    results = db.get_references_by_target_name("helper")
    assert len(results) == 2
    types = {ref.type for ref, _, _ in results}
    assert types == {"call", "import"}

    for ref, source_name, source_path in results:
        assert source_name == "do_stuff"
        assert source_path == "caller.py"
    db.close()


def test_unresolved_references(tmp_path):
    db = Database(tmp_path)
    db.init_schema()
    f1 = db.upsert_file("main.py", "h1", "python")
    f2 = db.upsert_file("utils.py", "h2", "python")

    sym1 = db.insert_symbol(f1, "run", "run", "function", 1, 10, "def run(): pass")
    db.insert_symbol(f2, "helper", "helper", "function", 1, 5, "def helper(): pass")

    # Resolved reference (target exists)
    db.insert_reference(sym1, "helper", "utils.py", "call", 5)
    # Unresolved reference (target_file_path is None)
    db.insert_reference(sym1, "missing_func", None, "call", 7)
    # Unresolved reference (target file exists but symbol doesn't)
    db.insert_reference(sym1, "nonexistent", "utils.py", "call", 9)

    unresolved = db.get_all_unresolved_references()
    assert len(unresolved) == 2
    target_names = {ref.target_symbol_name for ref, _, _ in unresolved}
    assert target_names == {"missing_func", "nonexistent"}
    db.close()


def test_summary_stats(tmp_path):
    db = Database(tmp_path)
    db.init_schema()

    # Empty
    stats = db.get_summary_stats()
    assert stats["files_indexed"] == 0
    assert stats["symbols_indexed"] == 0
    assert stats["references_total"] == 0
    assert stats["unresolved_count"] == 0

    # Add data
    f1 = db.upsert_file("main.py", "h1", "python")
    sym1 = db.insert_symbol(f1, "run", "run", "function", 1, 10, "def run(): pass")
    db.insert_reference(sym1, "missing", None, "call", 5)

    stats = db.get_summary_stats()
    assert stats["files_indexed"] == 1
    assert stats["symbols_indexed"] == 1
    assert stats["references_total"] == 1
    assert stats["unresolved_count"] == 1
    db.close()
