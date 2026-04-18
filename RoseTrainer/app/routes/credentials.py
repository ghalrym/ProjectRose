import json
from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

import asyncpg
from app.database import get_db
from app.providers import fetch_models

router = APIRouter()
templates: Jinja2Templates | None = None


def set_templates(t: Jinja2Templates):
    global templates
    templates = t


@router.get("/credentials")
async def credentials_page(request: Request, db=Depends(get_db)):
    rows = await db.fetch("SELECT * FROM provider_credentials ORDER BY provider")
    creds = []
    for r in rows:
        c = dict(r)
        if isinstance(c.get("models_json"), str):
            c["models_json"] = json.loads(c["models_json"])
        creds.append(c)
    return templates.TemplateResponse(request, "credentials.html", {"creds": creds})


@router.post("/credentials/{provider}")
async def upsert_credential(
    provider: str,
    api_key: str = Form(default=""),
    base_url: str = Form(default=""),
    db=Depends(get_db),
):
    await db.execute(
        """
        INSERT INTO provider_credentials (provider, api_key, base_url, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (provider) DO UPDATE
          SET api_key = EXCLUDED.api_key,
              base_url = EXCLUDED.base_url,
              updated_at = now()
        """,
        provider,
        api_key or None,
        base_url or None,
    )
    return RedirectResponse("/trainer/credentials", status_code=303)


@router.post("/credentials/{provider}/delete")
async def delete_credential(provider: str, db=Depends(get_db)):
    await db.execute("DELETE FROM provider_credentials WHERE provider = $1", provider)
    return RedirectResponse("/trainer/credentials", status_code=303)


@router.post("/credentials/{provider}/test")
async def test_credential(provider: str, db=Depends(get_db)):
    row = await db.fetchrow("SELECT * FROM provider_credentials WHERE provider = $1", provider)
    if not row:
        return {"ok": False, "error": "No credentials found"}
    try:
        models = await fetch_models(provider, row["api_key"], row["base_url"])
        await db.execute(
            "UPDATE provider_credentials SET models_json = $1::jsonb, updated_at = now() WHERE provider = $2",
            json.dumps(models),
            provider,
        )
        return {"ok": True, "models": models}
    except Exception as e:
        return {"ok": False, "error": str(e)}
