import pytest


FILE_A = """\
from .file_b import helper

def use_helper():
    return helper(42)
"""

FILE_B = """\
def helper(x):
    \"\"\"A helper function.\"\"\"
    return x * 2
"""

FILE_C = """\
from .file_b import helper

def also_uses_helper():
    return helper(99)
"""


async def _index_files(client):
    await client.post("/update-files", json={"files": [{
        "path": "pkg/file_b.py",
        "content": FILE_B,
    }]})
    await client.post("/update-files", json={"files": [{
        "path": "pkg/file_a.py",
        "content": FILE_A,
    }]})
    await client.post("/update-files", json={"files": [{
        "path": "pkg/file_c.py",
        "content": FILE_C,
    }]})


@pytest.mark.asyncio
async def test_find_references_with_file_path(client):
    await _index_files(client)

    response = await client.post("/findReferences", json={
        "file_path": "pkg/file_b.py",
        "symbol_name": "helper",
        "direction": "inbound",
    })
    assert response.status_code == 200
    results = response.json()
    # file_a and file_c both reference helper
    source_files = {r["source_file"] for r in results}
    assert "pkg/file_a.py" in source_files
    assert "pkg/file_c.py" in source_files


@pytest.mark.asyncio
async def test_find_references_outbound(client):
    await _index_files(client)

    response = await client.post("/findReferences", json={
        "file_path": "pkg/file_a.py",
        "symbol_name": "use_helper",
        "direction": "outbound",
    })
    assert response.status_code == 200
    results = response.json()
    target_names = {r["target_symbol_name"] for r in results}
    assert "helper" in target_names


@pytest.mark.asyncio
async def test_find_references_both(client):
    await _index_files(client)

    response = await client.post("/findReferences", json={
        "file_path": "pkg/file_b.py",
        "symbol_name": "helper",
        "direction": "both",
    })
    assert response.status_code == 200
    results = response.json()
    assert len(results) >= 2  # At least inbound refs from file_a and file_c


@pytest.mark.asyncio
async def test_find_references_unambiguous_name(client):
    await _index_files(client)

    # helper is unique across files (only in file_b)
    response = await client.post("/findReferences", json={
        "symbol_name": "helper",
        "direction": "inbound",
    })
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_find_references_ambiguous_name(client):
    # Create two files with same function name
    await client.post("/update-files", json={"files": [{
        "path": "a.py",
        "content": "def process():\n    pass\n",
    }]})
    await client.post("/update-files", json={"files": [{
        "path": "b.py",
        "content": "def process():\n    pass\n",
    }]})

    response = await client.post("/findReferences", json={
        "symbol_name": "process",
    })
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["message"] == "Ambiguous symbol name"
    assert len(detail["candidates"]) == 2


@pytest.mark.asyncio
async def test_find_references_not_found(client):
    response = await client.post("/findReferences", json={
        "symbol_name": "nonexistent",
    })
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_find_references_file_not_found(client):
    response = await client.post("/findReferences", json={
        "file_path": "missing.py",
        "symbol_name": "foo",
    })
    assert response.status_code == 404
