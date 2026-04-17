import pytest


SAMPLE_PY = """\
def calculate_shipping(order, rate):
    \"\"\"Calculate the total shipping cost based on weight and destination.\"\"\"
    return order.weight * rate

def process_payment(amount):
    \"\"\"Process a credit card payment.\"\"\"
    return amount * 1.03
"""


@pytest.mark.asyncio
async def test_search_empty_index(client):
    response = await client.post("/search", json={"query": "shipping cost"})
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_search_returns_results(client):
    await client.post("/update-files", json={"files": [{
        "path": "orders.py",
        "content": SAMPLE_PY,
    }]})

    response = await client.post("/search", json={"query": "shipping cost"})
    assert response.status_code == 200
    results = response.json()
    assert len(results) > 0

    # Each result should have all expected fields
    for r in results:
        assert "symbol_name" in r
        assert "qualified_name" in r
        assert "file_path" in r
        assert "type" in r
        assert "line_start" in r
        assert "line_end" in r
        assert "source_code" in r
        assert "score" in r


@pytest.mark.asyncio
async def test_search_limit(client):
    await client.post("/update-files", json={"files": [{
        "path": "orders.py",
        "content": SAMPLE_PY,
    }]})

    response = await client.post("/search", json={
        "query": "function",
        "limit": 1,
    })
    assert response.status_code == 200
    results = response.json()
    assert len(results) <= 1


@pytest.mark.asyncio
async def test_search_with_weights(client):
    await client.post("/update-files", json={"files": [{
        "path": "orders.py",
        "content": SAMPLE_PY,
    }]})

    # Both weight configurations should return valid results
    r1 = await client.post("/search", json={
        "query": "shipping",
        "metadata_weight": 0.9,
        "code_weight": 0.1,
    })
    assert r1.status_code == 200

    r2 = await client.post("/search", json={
        "query": "shipping",
        "metadata_weight": 0.1,
        "code_weight": 0.9,
    })
    assert r2.status_code == 200
