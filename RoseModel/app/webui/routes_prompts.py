"""Prompt management routes: Agent (L1), Skill categories (L2), Knowledge (L3)."""
from __future__ import annotations

import os

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app import categories, knowledge
from app.webui import templates

router = APIRouter(prefix="/prompts")

AGENT_MD_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "prompts", "agent.md")
)


# ---------- Level 1: agent.md ----------


@router.get("/agent", response_class=HTMLResponse)
async def agent_page(request: Request):
    content = ""
    if os.path.isfile(AGENT_MD_PATH):
        with open(AGENT_MD_PATH, "r", encoding="utf-8") as f:
            content = f.read()
    return templates.TemplateResponse(
        request, "agent.html", {"content": content}
    )


@router.post("/agent")
async def agent_save(content: str = Form("")):
    os.makedirs(os.path.dirname(AGENT_MD_PATH), exist_ok=True)
    with open(AGENT_MD_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    return RedirectResponse(url="/admin/prompts/agent?saved=1", status_code=303)


# ---------- Level 2: skill categories ----------


@router.get("/skills", response_class=HTMLResponse)
async def skills_index(request: Request):
    return templates.TemplateResponse(
        request,
        "skills_index.html",
        {"categories": categories.list_categories()},
    )


@router.post("/skills/new")
async def skills_create(name: str = Form(...), description: str = Form("")):
    try:
        slug = categories.create_category(name, description)
    except FileExistsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedirectResponse(url=f"/admin/prompts/skills/{slug}", status_code=303)


@router.get("/skills/{slug}", response_class=HTMLResponse)
async def skills_category(request: Request, slug: str):
    meta = categories.read_meta(slug)
    if not meta:
        raise HTTPException(status_code=404, detail="Category not found")
    files = categories.list_files(slug)
    return templates.TemplateResponse(
        request,
        "skills_category.html",
        {"slug": slug, "meta": meta, "files": files},
    )


@router.post("/skills/{slug}/meta")
async def skills_update_meta(
    slug: str, name: str = Form(...), description: str = Form("")
):
    try:
        categories.update_category(slug, name, description)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Category not found")
    return RedirectResponse(url=f"/admin/prompts/skills/{slug}?saved=1", status_code=303)


@router.post("/skills/{slug}/delete")
async def skills_delete_category(slug: str):
    categories.delete_category(slug)
    return RedirectResponse(url="/admin/prompts/skills", status_code=303)


@router.post("/skills/{slug}/files/new")
async def skills_create_file(slug: str, filename: str = Form(...)):
    if not filename.endswith(".md"):
        filename += ".md"
    try:
        categories.write_file(slug, filename, "# " + filename[:-3] + "\n\n")
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedirectResponse(
        url=f"/admin/prompts/skills/{slug}/files/{filename}", status_code=303
    )


@router.get("/skills/{slug}/files/{filename}", response_class=HTMLResponse)
async def skills_edit_file(request: Request, slug: str, filename: str):
    try:
        content = categories.read_file(slug, filename)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    return templates.TemplateResponse(
        request,
        "skill_file.html",
        {
            "slug": slug,
            "filename": filename,
            "content": content,
        },
    )


@router.post("/skills/{slug}/files/{filename}")
async def skills_save_file(slug: str, filename: str, content: str = Form("")):
    try:
        categories.write_file(slug, filename, content)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedirectResponse(
        url=f"/admin/prompts/skills/{slug}/files/{filename}?saved=1", status_code=303
    )


@router.post("/skills/{slug}/files/{filename}/delete")
async def skills_delete_file(slug: str, filename: str):
    try:
        categories.delete_file(slug, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedirectResponse(url=f"/admin/prompts/skills/{slug}", status_code=303)


# ---------- Level 3: knowledge ----------


@router.get("/knowledge", response_class=HTMLResponse)
async def knowledge_index(request: Request):
    return templates.TemplateResponse(
        request,
        "knowledge_index.html",
        {"files": knowledge.list_knowledge_files()},
    )


@router.post("/knowledge/new")
async def knowledge_create(
    filename: str = Form(...),
    category: str = Form("general"),
):
    if not filename.endswith(".md"):
        filename += ".md"
    template = (
        f"---\ncategory: {category or 'general'}\n---\n\n"
        f"# {filename[:-3]}\n\n"
    )
    try:
        knowledge.write_knowledge_file(filename, template)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedirectResponse(
        url=f"/admin/prompts/knowledge/{filename}", status_code=303
    )


@router.get("/knowledge/{filename}", response_class=HTMLResponse)
async def knowledge_edit(request: Request, filename: str):
    try:
        content = knowledge.read_knowledge_file(filename)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    return templates.TemplateResponse(
        request,
        "knowledge_file.html",
        {"filename": filename, "content": content},
    )


@router.post("/knowledge/{filename}")
async def knowledge_save(filename: str, content: str = Form("")):
    try:
        knowledge.write_knowledge_file(filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedirectResponse(
        url=f"/admin/prompts/knowledge/{filename}?saved=1", status_code=303
    )


@router.post("/knowledge/{filename}/delete")
async def knowledge_delete(filename: str):
    try:
        knowledge.delete_knowledge_file(filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RedirectResponse(url="/admin/prompts/knowledge", status_code=303)
