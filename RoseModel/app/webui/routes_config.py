"""Config routes: named provider+model combinations, and role→config assignment.

Both are rendered on one page (/admin/configs) with JS tabs. /admin/roles
redirects there so old bookmarks still work.
"""
from __future__ import annotations

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app import config
from app.webui import templates

router = APIRouter()


# ---------- Configs ----------


@router.get("/configs", response_class=HTMLResponse)
async def configs_page(request: Request):
    cfg = config.load()
    return templates.TemplateResponse(
        request,
        "configs_index.html",
        {
            "configs": config.list_configs(),
            "provider_types": config.PROVIDER_TYPES,
            "roles": config.ROLES,
            "role_assignments": cfg["roles"],
        },
    )


@router.post("/configs/new")
async def configs_create(
    name: str = Form(...),
    provider_type: str = Form(...),
    model: str = Form(""),
    base_url: str = Form(""),
    api_key: str = Form(""),
):
    fields = {"model": model, "base_url": base_url, "api_key": api_key}
    try:
        config.create_config(name.strip(), provider_type, fields)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedirectResponse(url=f"/admin/configs/{name.strip()}", status_code=303)


@router.get("/configs/{name}", response_class=HTMLResponse)
async def configs_edit_page(request: Request, name: str):
    entry = config.get_config(name)
    if entry is None:
        raise HTTPException(status_code=404, detail="Config not found")
    return templates.TemplateResponse(
        request,
        "config_edit.html",
        {
            "name": name,
            "entry": entry,
            "provider_types": config.PROVIDER_TYPES,
        },
    )


@router.post("/configs/{name}")
async def configs_update(
    name: str,
    provider_type: str = Form(...),
    model: str = Form(""),
    base_url: str = Form(""),
    api_key: str = Form(""),
):
    fields = {"model": model, "base_url": base_url, "api_key": api_key}
    try:
        config.update_config(name, provider_type, fields)
    except KeyError:
        raise HTTPException(status_code=404, detail="Config not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedirectResponse(url=f"/admin/configs/{name}?saved=1", status_code=303)


@router.post("/configs/{name}/delete")
async def configs_delete(name: str):
    try:
        config.delete_config(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedirectResponse(url="/admin/configs", status_code=303)


# ---------- Roles ----------


@router.get("/roles", response_class=HTMLResponse)
async def roles_page(request: Request):
    return RedirectResponse(url="/admin/configs?tab=roles", status_code=302)


@router.post("/roles")
async def roles_save(request: Request):
    form = await request.form()
    cfg = config.load()
    for role in config.ROLES:
        assigned = form.get(f"role_{role}")
        if assigned and assigned in cfg["configs"]:
            cfg["roles"][role] = assigned
    config.save(cfg)
    return RedirectResponse(url="/admin/configs?tab=roles&saved=1", status_code=303)
