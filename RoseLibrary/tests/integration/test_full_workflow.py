import hashlib
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent.parent / "fixtures" / "workflow"


@pytest.mark.asyncio
async def test_python_full_workflow(client):
    utils_content = (FIXTURES / "utils.py").read_text()
    main_content = (FIXTURES / "main.py").read_text()

    utils_hash = hashlib.sha256(utils_content.encode("utf-8")).hexdigest()
    main_hash = hashlib.sha256(main_content.encode("utf-8")).hexdigest()

    # 1. Check files — both should be unknown
    response = await client.post("/check-file", json=[
        {"path": "pkg/utils.py", "hash": utils_hash},
        {"path": "pkg/main.py", "hash": main_hash},
    ])
    assert response.status_code == 200
    statuses = {r["path"]: r["status"] for r in response.json()}
    assert statuses["pkg/utils.py"] == "unknown"
    assert statuses["pkg/main.py"] == "unknown"

    # 2. Index utils.py
    response = await client.post("/update-files", json={"files": [{
        "path": "pkg/utils.py",
        "content": utils_content,
    }]})
    assert response.status_code == 200
    data = response.json()
    assert data["results"][0]["symbols_indexed"] == 2  # add + multiply

    # 3. Index main.py
    response = await client.post("/update-files", json={"files": [{
        "path": "pkg/main.py",
        "content": main_content,
    }]})
    assert response.status_code == 200
    data = response.json()
    assert data["results"][0]["symbols_indexed"] == 1  # calculate_total

    # 4. Check files — both should be current
    response = await client.post("/check-file", json=[
        {"path": "pkg/utils.py", "hash": utils_hash},
        {"path": "pkg/main.py", "hash": main_hash},
    ])
    statuses = {r["path"]: r["status"] for r in response.json()}
    assert statuses["pkg/utils.py"] == "current"
    assert statuses["pkg/main.py"] == "current"

    # 5. Check status
    response = await client.get("/status")
    data = response.json()
    assert data["files_indexed"] == 2
    assert data["symbols_indexed"] == 3  # add, multiply, calculate_total

    # 6. Find references to 'add' (inbound)
    response = await client.post("/findReferences", json={
        "file_path": "pkg/utils.py",
        "symbol_name": "add",
        "direction": "inbound",
    })
    assert response.status_code == 200
    results = response.json()
    # main.py imports and calls add
    source_files = {r["source_file"] for r in results}
    assert "pkg/main.py" in source_files

    # 7. Search for "addition"
    response = await client.post("/search", json={"query": "add numbers"})
    assert response.status_code == 200
    results = response.json()
    assert len(results) > 0

    # 8. Re-index utils.py with modifications
    modified_utils = utils_content.replace(
        "def add(a, b):", "def add(a, b, c=0):"
    )
    response = await client.post("/update-files", json={"files": [{
        "path": "pkg/utils.py",
        "content": modified_utils,
    }]})
    assert response.status_code == 200

    # 9. Check old hash is stale
    response = await client.post("/check-file", json=[
        {"path": "pkg/utils.py", "hash": utils_hash},
    ])
    assert response.json()[0]["status"] == "stale"


@pytest.mark.asyncio
async def test_javascript_workflow(client):
    helpers_content = (FIXTURES / "helpers.js").read_text()
    app_content = (FIXTURES / "app.js").read_text()

    # 1. Index helpers.js
    response = await client.post("/update-files", json={"files": [{
        "path": "src/helpers.js",
        "content": helpers_content,
    }]})
    assert response.status_code == 200
    data = response.json()
    # formatName (function) + Validator (class) + validateEmail (method) + validatePhone (method) = 4
    assert data["results"][0]["symbols_indexed"] == 4

    # 2. Index app.js
    response = await client.post("/update-files", json={"files": [{
        "path": "src/app.js",
        "content": app_content,
    }]})
    assert response.status_code == 200

    # 3. Check status
    response = await client.get("/status")
    data = response.json()
    assert data["files_indexed"] == 2

    # 4. Find references to formatName
    response = await client.post("/findReferences", json={
        "file_path": "src/helpers.js",
        "symbol_name": "formatName",
        "direction": "inbound",
    })
    assert response.status_code == 200
    results = response.json()
    source_files = {r["source_file"] for r in results}
    assert "src/app.js" in source_files

    # 5. Search for "validate email"
    response = await client.post("/search", json={"query": "validate email"})
    assert response.status_code == 200
    results = response.json()
    assert len(results) > 0
