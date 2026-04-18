import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.database import get_db

router = APIRouter()
templates: Jinja2Templates | None = None


def set_templates(t: Jinja2Templates):
    global templates
    templates = t


@router.get("/models/{model_id}/stage/7")
async def stage7_page(request: Request, model_id: int, db=Depends(get_db)):
    model = await db.fetchrow("SELECT * FROM trainer_models WHERE id = $1", model_id)
    versions = await db.fetch(
        "SELECT * FROM model_versions WHERE model_id = $1 ORDER BY created_at DESC",
        model_id,
    )
    return templates.TemplateResponse(request, "stage7.html", {
        "model": dict(model),
        "versions": [dict(v) for v in versions],
    })


@router.post("/models/{model_id}/stage/7/deploy")
async def deploy_model(
    model_id: int,
    from_version: str = Form(...),
    db=Depends(get_db),
):
    model_row = await db.fetchrow("SELECT * FROM trainer_models WHERE id = $1", model_id)
    src_ver = await db.fetchrow(
        "SELECT * FROM model_versions WHERE model_id = $1 AND version = $2",
        model_id, from_version,
    )
    if not src_ver:
        return RedirectResponse(f"/trainer/models/{model_id}/stage/7?error=not_found", status_code=303)

    deployed_version = "v1.000"
    src_path = Path(src_ver["checkpoint_path"]).parent
    dst_path = src_path.parent / deployed_version

    # Copy checkpoint directory
    if src_path.exists():
        shutil.copytree(src_path, dst_path, dirs_exist_ok=True)

    checkpoint = str(dst_path / "model.pt")
    tokenizer = str(dst_path / "tokenizer")

    await db.execute(
        """
        INSERT INTO model_versions (model_id, version, checkpoint_path, tokenizer_path, is_deployed)
        VALUES ($1, $2, $3, $4, TRUE)
        ON CONFLICT (model_id, version) DO UPDATE
          SET is_deployed = TRUE
        """,
        model_id, deployed_version, checkpoint, tokenizer,
    )
    await db.execute(
        "UPDATE trainer_models SET current_version = $1, updated_at = now() WHERE id = $2",
        deployed_version, model_id,
    )
    await db.execute(
        "UPDATE growth_stages SET status = 'complete', completed_at = now() WHERE model_id = $1 AND stage = 7",
        model_id,
    )
    return RedirectResponse(f"/trainer/models/{model_id}/stage/7", status_code=303)
