from fastapi import APIRouter, Request

from roselibrary.models.schemas import StatusResponse, UnresolvedRef

router = APIRouter()


@router.get("/status", response_model=StatusResponse)
async def status(request: Request):
    db = request.app.state.db
    stats = db.get_summary_stats()
    unresolved_refs = db.get_all_unresolved_references()

    return StatusResponse(
        files_indexed=stats["files_indexed"],
        symbols_indexed=stats["symbols_indexed"],
        references_total=stats["references_total"],
        unresolved_count=stats["unresolved_count"],
        unresolved_references=[
            UnresolvedRef(
                source_file=source_path,
                source_symbol=source_name,
                target_symbol_name=ref.target_symbol_name,
                type=ref.type,
                line_number=ref.line_number,
            )
            for ref, source_name, source_path in unresolved_refs
        ],
    )
