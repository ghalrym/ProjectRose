import pytest

from roselibrary import __version__


@pytest.mark.asyncio
async def test_health_endpoint(client):
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "RoseLibrary"
    assert data["version"] == __version__
