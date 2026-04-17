import pytest


SAMPLE_PY = """\
from .utils import helper

def greet(name):
    \"\"\"Greet someone.\"\"\"
    return helper(name)

class Service:
    def run(self):
        return greet("world")
"""

SAMPLE_PY_MODIFIED = """\
from .utils import helper

def greet(name):
    \"\"\"Greet someone.\"\"\"
    return helper(name)

class Service:
    def execute(self):
        return greet("world")
"""


@pytest.mark.asyncio
async def test_update_file_basic(client):
    response = await client.post("/update-files", json={"files": [{
        "path": "src/main.py",
        "content": SAMPLE_PY,
    }]})
    assert response.status_code == 200
    data = response.json()
    # greet (function) + Service (class) + run (method) = 3
    assert data["results"][0]["symbols_indexed"] == 3


@pytest.mark.asyncio
async def test_update_file_reindex(client):
    # Index first version
    await client.post("/update-files", json={"files": [{
        "path": "src/main.py",
        "content": SAMPLE_PY,
    }]})

    # Re-index with modified version
    response = await client.post("/update-files", json={"files": [{
        "path": "src/main.py",
        "content": SAMPLE_PY_MODIFIED,
    }]})
    assert response.status_code == 200
    data = response.json()
    assert data["results"][0]["symbols_indexed"] == 3

    # Check status shows correct counts (1 file, not 2)
    status = await client.get("/status")
    status_data = status.json()
    assert status_data["files_indexed"] == 1


@pytest.mark.asyncio
async def test_update_unsupported_extension(client):
    response = await client.post("/update-files", json={"files": [{
        "path": "readme.txt",
        "content": "Just text",
    }]})
    assert response.status_code == 200
    data = response.json()
    assert data["results"][0]["symbols_indexed"] == 0
    assert data["results"][0]["broken_references"] == []


@pytest.mark.asyncio
async def test_update_file_path_normalization(client):
    await client.post("/update-files", json={"files": [{
        "path": "src\\main.py",
        "content": SAMPLE_PY,
    }]})

    # Should find it with normalized path
    response = await client.post("/check-file", json=[
        {"path": "src/main.py", "hash": "wrong"},
    ])
    assert response.json()[0]["status"] == "stale"  # Found, not unknown


@pytest.mark.asyncio
async def test_broken_references_reported(client):
    # File A references helper from file B
    file_b = """\
def helper(x):
    return x
"""
    file_a = """\
from .file_b import helper

def use_it():
    return helper(42)
"""

    # Index both files
    await client.post("/update-files", json={"files": [{
        "path": "pkg/file_b.py",
        "content": file_b,
    }]})
    await client.post("/update-files", json={"files": [{
        "path": "pkg/file_a.py",
        "content": file_a,
    }]})

    # Now update file_b removing helper
    file_b_updated = """\
def different_func(x):
    return x * 2
"""
    response = await client.post("/update-files", json={"files": [{
        "path": "pkg/file_b.py",
        "content": file_b_updated,
    }]})
    data = response.json()
    # helper was removed, file_a references it
    broken = data["results"][0]["broken_references"]
    if broken:
        target_names = {b["target_symbol_name"] for b in broken}
        assert "helper" in target_names
        helper_broken = next(b for b in broken if b["target_symbol_name"] == "helper")
        assert "pkg/file_a.py" in helper_broken["affected_files"]


@pytest.mark.asyncio
async def test_bulk_update_multiple_files(client):
    # Bulk index two files in one request
    response = await client.post("/update-files", json={"files": [
        {"path": "src/a.py", "content": "def foo():\n    pass\n"},
        {"path": "src/b.py", "content": "def bar():\n    pass\n"},
    ]})
    assert response.status_code == 200
    data = response.json()
    assert len(data["results"]) == 2
    paths = {r["path"] for r in data["results"]}
    assert paths == {"src/a.py", "src/b.py"}
    assert all(r["symbols_indexed"] == 1 for r in data["results"])
