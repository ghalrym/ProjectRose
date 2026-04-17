import pytest


@pytest.mark.asyncio
async def test_clear_empty_index(client):
    response = await client.post("/clear")
    assert response.status_code == 200
    assert response.json() == {"status": "cleared"}


@pytest.mark.asyncio
async def test_clear_removes_all_data(client):
    # Index some files
    await client.post("/update-files", json={"files": [{
        "path": "a.py",
        "content": "def foo():\n    pass\n",
    }]})
    await client.post("/update-files", json={"files": [{
        "path": "b.py",
        "content": "def bar():\n    pass\n",
    }]})

    # Verify data exists
    status = await client.get("/status")
    assert status.json()["files_indexed"] == 2

    # Clear
    response = await client.post("/clear")
    assert response.status_code == 200

    # Verify everything is gone
    status = await client.get("/status")
    data = status.json()
    assert data["files_indexed"] == 0
    assert data["symbols_indexed"] == 0
    assert data["references_total"] == 0

    # Check-file should report unknown
    check = await client.post("/check-file", json=[
        {"path": "a.py", "hash": "anything"},
    ])
    assert check.json()[0]["status"] == "unknown"

    # Search should return empty
    search = await client.post("/search", json={"query": "foo"})
    assert search.json() == []
