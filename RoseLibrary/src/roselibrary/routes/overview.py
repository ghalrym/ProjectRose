from collections import defaultdict

from fastapi import APIRouter, Request

from roselibrary.models.schemas import (
    OverviewFile,
    OverviewResponse,
    OverviewSymbol,
)

router = APIRouter()


@router.get("/overview", response_model=OverviewResponse)
async def overview(request: Request):
    db = request.app.state.db

    files = db.get_all_files()
    stats = db.get_summary_stats()

    # Build per-file symbol lists
    file_symbols: dict[int, list[OverviewSymbol]] = {}
    for f in files:
        symbols = db.get_symbols_by_file(f.id)
        file_symbols[f.id] = [
            OverviewSymbol(
                name=s.name,
                qualified_name=s.qualified_name,
                type=s.type,
                parameters=s.parameters,
                docstring=s.docstring,
            )
            for s in symbols
        ]

    # Build dependency graph from references
    # inbound: how many refs from other files point to symbols in this file
    # outbound: how many refs from this file point to symbols in other files
    inbound_counts: dict[str, int] = defaultdict(int)
    outbound_counts: dict[str, int] = defaultdict(int)
    depends_on: dict[str, set[str]] = defaultdict(set)
    depended_on_by: dict[str, set[str]] = defaultdict(set)

    all_refs = db.conn.execute(
        """SELECT r.target_file_path, f_source.path as source_file_path
           FROM references_ r
           JOIN symbols s ON r.source_symbol_id = s.id
           JOIN files f_source ON s.file_id = f_source.id
           WHERE r.target_file_path IS NOT NULL"""
    ).fetchall()

    for ref in all_refs:
        target_path = ref[0]
        source_path = ref[1]
        if source_path != target_path:
            inbound_counts[target_path] += 1
            outbound_counts[source_path] += 1
            depends_on[source_path].add(target_path)
            depended_on_by[target_path].add(source_path)

    # Build response sorted by inbound reference count (most depended-on first)
    overview_files = []
    for f in files:
        overview_files.append(OverviewFile(
            path=f.path,
            language=f.language,
            symbols=file_symbols.get(f.id, []),
            inbound_reference_count=inbound_counts.get(f.path, 0),
            outbound_reference_count=outbound_counts.get(f.path, 0),
            depends_on=sorted(depends_on.get(f.path, set())),
            depended_on_by=sorted(depended_on_by.get(f.path, set())),
        ))

    overview_files.sort(key=lambda f: f.inbound_reference_count, reverse=True)

    return OverviewResponse(
        total_files=stats["files_indexed"],
        total_symbols=stats["symbols_indexed"],
        total_references=stats["references_total"],
        files=overview_files,
    )
