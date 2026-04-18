from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI

from app.database import create_pool, close_pool, init_schema


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_pool()
    await init_schema()
    yield
    await close_pool()


app = FastAPI(title="RoseTrainer", lifespan=lifespan)

from app.webui import router as ui_router, mount_static
from app.routes.openai_compat import router as compat_router

app.include_router(ui_router)
app.include_router(compat_router)
mount_static(app)


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8030, reload=True)
