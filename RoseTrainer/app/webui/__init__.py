import json
from pathlib import Path
from fastapi import FastAPI, APIRouter, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.database import get_db

_templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
_templates.env.filters["tojson"] = lambda v: json.dumps(v)
router = APIRouter(prefix="/trainer")


def get_templates() -> Jinja2Templates:
    return _templates


def mount_static(app: FastAPI):
    static_dir = Path(__file__).parent / "static"
    static_dir.mkdir(exist_ok=True)
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@router.get("/")
async def home(request: Request, db=Depends(get_db)):
    models = await db.fetch("SELECT * FROM trainer_models ORDER BY created_at DESC")
    model_list = []
    for m in models:
        stages = await db.fetch(
            "SELECT stage, status FROM growth_stages WHERE model_id = $1 ORDER BY stage",
            m["id"],
        )
        model_list.append({"model": dict(m), "stages": [dict(s) for s in stages]})
    return _templates.TemplateResponse(request, "home.html", {"models": model_list})


# Wire templates into route modules after defining templates
from app.routes import stage1, stage2, stage3, stage4, stage5, stage6, stage7, credentials

for mod in [stage1, stage2, stage3, stage4, stage5, stage6, stage7, credentials]:
    mod.set_templates(_templates)

router.include_router(stage1.router)
router.include_router(stage2.router)
router.include_router(stage3.router)
router.include_router(stage4.router)
router.include_router(stage5.router)
router.include_router(stage6.router)
router.include_router(stage7.router)
router.include_router(credentials.router)
