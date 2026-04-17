import httpx

from app.models import Tool


async def execute_tool_call(
    tool_name: str,
    params: dict,
    tools: list[Tool],
) -> dict:
    """Execute a tool call by POSTing to the tool's callback URL.

    Returns a dict with keys: success, content, error.
    """
    tool = None
    for t in tools:
        if t.name == tool_name:
            tool = t
            break

    if tool is None:
        return {
            "success": False,
            "content": None,
            "error": f"Unknown tool: {tool_name}",
        }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            response = await client.post(tool.callback_url, json=params)
            response.raise_for_status()
            result = response.json()

            return {
                "success": result.get("success", False),
                "content": result.get("content"),
                "error": result.get("error"),
            }
    except httpx.HTTPStatusError as e:
        return {
            "success": False,
            "content": None,
            "error": f"HTTP {e.response.status_code} from {tool.callback_url}",
        }
    except Exception as e:
        return {
            "success": False,
            "content": None,
            "error": str(e),
        }
