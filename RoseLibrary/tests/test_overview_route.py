import pytest


@pytest.mark.asyncio
async def test_overview_empty(client):
    response = await client.get("/overview")
    assert response.status_code == 200
    data = response.json()
    assert data["total_files"] == 0
    assert data["total_symbols"] == 0
    assert data["total_references"] == 0
    assert data["files"] == []


@pytest.mark.asyncio
async def test_overview_with_files(client):
    await client.post("/update-files", json={"files": [{
        "path": "utils.py",
        "content": "def add(a, b):\n    \"\"\"Add two numbers.\"\"\"\n    return a + b\n\ndef multiply(a, b):\n    return a * b\n",
    }]})
    await client.post("/update-files", json={"files": [{
        "path": "main.py",
        "content": "from .utils import add\n\ndef run():\n    return add(1, 2)\n",
    }]})

    response = await client.get("/overview")
    assert response.status_code == 200
    data = response.json()
    assert data["total_files"] == 2
    assert data["total_symbols"] >= 3  # add, multiply, run

    # Find files in response
    files_by_path = {f["path"]: f for f in data["files"]}
    assert "utils.py" in files_by_path
    assert "main.py" in files_by_path

    # utils.py should have symbols
    utils = files_by_path["utils.py"]
    symbol_names = {s["name"] for s in utils["symbols"]}
    assert "add" in symbol_names
    assert "multiply" in symbol_names


@pytest.mark.asyncio
async def test_overview_dependency_graph(client):
    await client.post("/update-files", json={"files": [{
        "path": "pkg/base.py",
        "content": "def helper():\n    pass\n",
    }]})
    await client.post("/update-files", json={"files": [{
        "path": "pkg/a.py",
        "content": "from .base import helper\n\ndef use_a():\n    return helper()\n",
    }]})
    await client.post("/update-files", json={"files": [{
        "path": "pkg/b.py",
        "content": "from .base import helper\n\ndef use_b():\n    return helper()\n",
    }]})

    response = await client.get("/overview")
    data = response.json()
    files_by_path = {f["path"]: f for f in data["files"]}

    base = files_by_path["pkg/base.py"]
    # base.py should be depended on by a.py and b.py
    assert "pkg/a.py" in base["depended_on_by"]
    assert "pkg/b.py" in base["depended_on_by"]
    assert base["inbound_reference_count"] >= 2

    a = files_by_path["pkg/a.py"]
    assert "pkg/base.py" in a["depends_on"]
    assert a["outbound_reference_count"] >= 1


@pytest.mark.asyncio
async def test_overview_sorted_by_importance(client):
    # base.py is the most important (depended on by 2 files)
    await client.post("/update-files", json={"files": [{
        "path": "pkg/base.py",
        "content": "def core():\n    pass\n",
    }]})
    await client.post("/update-files", json={"files": [{
        "path": "pkg/a.py",
        "content": "from .base import core\n\ndef a():\n    return core()\n",
    }]})
    await client.post("/update-files", json={"files": [{
        "path": "pkg/b.py",
        "content": "from .base import core\n\ndef b():\n    return core()\n",
    }]})

    response = await client.get("/overview")
    data = response.json()
    # First file should be the most depended-on
    assert data["files"][0]["path"] == "pkg/base.py"
