import re

from fastapi import APIRouter, Request

from roselibrary.models.schemas import FileCheckRequest, FileCheckResponse

router = APIRouter()


def normalize_path(path: str) -> str:
    """Normalize a file path to a consistent format."""
    path = path.replace("\\", "/")
    path = re.sub(r"/+", "/", path)
    if path.startswith("./"):
        path = path[2:]
    return path


@router.post("/check-file", response_model=list[FileCheckResponse])
async def check_file(files: list[FileCheckRequest], request: Request):
    db = request.state.db
    paths = [normalize_path(f.path) for f in files]
    existing = db.get_files_by_paths(paths)

    results = []
    for f, norm_path in zip(files, paths):
        if norm_path not in existing:
            status = "unknown"
        elif existing[norm_path].hash != f.hash:
            status = "stale"
        else:
            status = "current"
        results.append(FileCheckResponse(path=f.path, status=status))

    return results
