from fastapi import APIRouter, HTTPException, Request

from roselibrary.models.schemas import FindReferencesRequest, ReferenceResult
from roselibrary.routes.check import normalize_path

router = APIRouter()


@router.post("/findReferences", response_model=list[ReferenceResult])
async def find_references(body: FindReferencesRequest, request: Request):
    db = request.state.db

    # Resolve the target symbol
    if body.file_path:
        path = normalize_path(body.file_path)
        file_row = db.get_file(path)
        if not file_row:
            raise HTTPException(404, detail=f"File not found: {path}")

        symbols = db.get_symbols_by_file(file_row.id)
        matches = [s for s in symbols if s.name == body.symbol_name]
        if not matches:
            raise HTTPException(
                404,
                detail=f"Symbol '{body.symbol_name}' not found in {path}",
            )
        symbol = matches[0]
        symbol_file_path = path
    else:
        candidates = db.find_symbols_by_name(body.symbol_name)
        if len(candidates) == 0:
            raise HTTPException(
                404, detail=f"Symbol '{body.symbol_name}' not found"
            )
        if len(candidates) > 1:
            raise HTTPException(422, detail={
                "message": "Ambiguous symbol name",
                "candidates": [
                    {"qualified_name": s.qualified_name, "file_path": fp}
                    for s, fp in candidates
                ],
            })
        symbol, symbol_file_path = candidates[0]

    results: list[ReferenceResult] = []

    # Outbound: references FROM this symbol
    if body.direction in ("outbound", "both"):
        outbound_refs = db.get_references_by_source_symbol(symbol.id)
        for ref in outbound_refs:
            results.append(ReferenceResult(
                source_file=symbol_file_path,
                source_symbol=symbol.qualified_name,
                target_symbol_name=ref.target_symbol_name,
                target_file_path=ref.target_file_path,
                type=ref.type,
                line_number=ref.line_number,
            ))

    # Inbound: references TO this symbol
    if body.direction in ("inbound", "both"):
        inbound_refs = db.get_references_by_target_name(symbol.name)
        for ref, source_name, source_path in inbound_refs:
            # Filter to refs that actually target this symbol's file
            if ref.target_file_path == symbol_file_path:
                results.append(ReferenceResult(
                    source_file=source_path,
                    source_symbol=source_name,
                    target_symbol_name=ref.target_symbol_name,
                    target_file_path=ref.target_file_path,
                    type=ref.type,
                    line_number=ref.line_number,
                ))

    # Deduplicate (in case of overlap between inbound/outbound)
    seen = set()
    unique_results = []
    for r in results:
        key = (r.source_file, r.source_symbol, r.target_symbol_name,
               r.target_file_path, r.type, r.line_number)
        if key not in seen:
            seen.add(key)
            unique_results.append(r)

    return unique_results
