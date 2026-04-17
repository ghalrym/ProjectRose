import pytest


@pytest.mark.asyncio
async def test_status_empty(client):
    response = await client.get("/status")
    assert response.status_code == 200
    data = response.json()
    assert data["files_indexed"] == 0
    assert data["symbols_indexed"] == 0
    assert data["references_total"] == 0
    assert data["unresolved_count"] == 0
    assert data["unresolved_references"] == []


@pytest.mark.asyncio
async def test_status_after_indexing(client):
    source = """\
def hello():
    return "world"

class Greeter:
    def greet(self):
        return hello()
"""
    await client.post("/update-files", json={"files": [{
        "path": "main.py",
        "content": source,
    }]})

    response = await client.get("/status")
    data = response.json()
    assert data["files_indexed"] == 1
    assert data["symbols_indexed"] == 3  # hello, Greeter, greet
    assert data["references_total"] >= 1  # at least the call to hello()
