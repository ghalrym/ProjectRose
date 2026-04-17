import hashlib

import pytest


SAMPLE_PY = """\
def hello():
    return "world"
"""
SAMPLE_HASH = hashlib.sha256(SAMPLE_PY.encode("utf-8")).hexdigest()


@pytest.mark.asyncio
async def test_check_file_all_unknown(client):
    response = await client.post("/check-file", json=[
        {"path": "src/main.py", "hash": "abc123"},
    ])
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["status"] == "unknown"


@pytest.mark.asyncio
async def test_check_file_after_indexing(client):
    # First index a file
    await client.post("/update-files", json={"files": [{
        "path": "src/main.py",
        "content": SAMPLE_PY,
    }]})

    # Check with correct hash
    response = await client.post("/check-file", json=[
        {"path": "src/main.py", "hash": SAMPLE_HASH},
    ])
    assert response.status_code == 200
    assert response.json()[0]["status"] == "current"

    # Check with wrong hash
    response = await client.post("/check-file", json=[
        {"path": "src/main.py", "hash": "wrong_hash"},
    ])
    assert response.status_code == 200
    assert response.json()[0]["status"] == "stale"


@pytest.mark.asyncio
async def test_check_file_mixed_batch(client):
    await client.post("/update-files", json={"files": [{
        "path": "a.py",
        "content": SAMPLE_PY,
    }]})

    response = await client.post("/check-file", json=[
        {"path": "a.py", "hash": SAMPLE_HASH},
        {"path": "b.py", "hash": "anything"},
        {"path": "a.py", "hash": "wrong"},
    ])
    assert response.status_code == 200
    data = response.json()
    assert data[0]["status"] == "current"
    assert data[1]["status"] == "unknown"
    assert data[2]["status"] == "stale"
