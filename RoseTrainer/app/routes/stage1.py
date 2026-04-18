from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.database import get_db
from app.training.architecture import VRAM_TABLE

router = APIRouter()
templates: Jinja2Templates | None = None


def set_templates(t: Jinja2Templates):
    global templates
    templates = t


@router.get("/models/new")
async def new_model_form(request: Request):
    return templates.TemplateResponse(request, "stage1.html", {
        "vram_table": VRAM_TABLE,
    })


@router.post("/models")
async def create_model(
    name: str = Form(...),
    size: str = Form(...),
    db=Depends(get_db),
):
    async with db.transaction():
        model_id = await db.fetchval(
            "INSERT INTO trainer_models (name, size) VALUES ($1, $2) RETURNING id",
            name.strip(), size,
        )
        for stage in range(1, 8):
            await db.execute(
                "INSERT INTO growth_stages (model_id, stage, status) VALUES ($1, $2, 'pending')",
                model_id, stage,
            )
        await db.execute(
            "UPDATE growth_stages SET status = 'complete', completed_at = now() WHERE model_id = $1 AND stage = 1",
            model_id,
        )
    return RedirectResponse(f"/trainer/models/{model_id}/stage/2", status_code=303)
