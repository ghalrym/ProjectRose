import logging
import time

from fastapi import APIRouter, HTTPException, Request

from roselibrary.instrumentation.observability import emit, forget_trace
from roselibrary.models.schemas import SearchRequest, SearchResult

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/search", response_model=list[SearchResult])
async def search(body: SearchRequest, request: Request):
    db = request.app.state.db
    embedding_service = request.app.state.embedding_service
    vectorstore = request.app.state.vectorstore

    t0 = time.perf_counter()
    trace_id = getattr(request.state, "trace_id", None)
    status_code = 200
    search_results: list[SearchResult] = []

    try:
        # Embed the query
        try:
            query_embeddings = await embedding_service.embed([body.query])
        except Exception:
            logger.error("Failed to connect to embedding service")
            status_code = 503
            raise HTTPException(503, detail="Embedding service unavailable")
        query_vec = query_embeddings[0]

        # Search both collections with weighted scoring
        results = vectorstore.search_combined(
            metadata_embedding=query_vec,
            code_embedding=query_vec,
            metadata_weight=body.metadata_weight,
            code_weight=body.code_weight,
            limit=body.limit,
        )

        # Fetch full symbol data for each result
        for symbol_id, score in results:
            symbol = db.get_symbol_by_id(symbol_id)
            if symbol is None:
                continue

            row = db.conn.execute(
                "SELECT path FROM files WHERE id = ?", (symbol.file_id,)
            ).fetchone()
            file_path = row[0] if row else "unknown"

            search_results.append(SearchResult(
                symbol_name=symbol.name,
                qualified_name=symbol.qualified_name,
                file_path=file_path,
                type=symbol.type,
                line_start=symbol.line_start,
                line_end=symbol.line_end,
                source_code=symbol.source_code,
                score=round(score, 4),
                docstring=symbol.docstring,
            ))

        return search_results
    finally:
        duration_ms = (time.perf_counter() - t0) * 1000
        if trace_id:
            top = [
                {"path": r.file_path, "score": r.score}
                for r in search_results[:3]
            ]
            emit(
                "request",
                {
                    "endpoint": "/search",
                    "method": "POST",
                    "status_code": status_code,
                    "query": {
                        "query": body.query,
                        "metadata_weight": body.metadata_weight,
                        "code_weight": body.code_weight,
                        "limit": body.limit,
                    },
                    "response_summary": {
                        "results_count": len(search_results),
                        "top": top,
                    },
                },
                trace_id,
                duration_ms=duration_ms,
            )
            forget_trace(trace_id)
            request.state.observability_emitted = True
