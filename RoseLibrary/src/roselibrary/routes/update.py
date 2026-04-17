import asyncio
import hashlib
import logging
import time

from fastapi import APIRouter, Request

from roselibrary.instrumentation.observability import emit, forget_trace
from roselibrary.models.schemas import (
    BrokenReference,
    BulkFileResult,
    BulkUpdateRequest,
    BulkUpdateResponse,
    FileUpdateItem,
)
from roselibrary.routes.check import normalize_path

logger = logging.getLogger(__name__)

router = APIRouter()

EMBED_BATCH_SIZE = 64


def _flatten_symbols(symbols):
    """Yield (parent_qualified_name_or_None, symbol) for every symbol incl. children."""
    for sym in symbols:
        yield (None, sym)
        for child in sym.children:
            yield (sym.qualified_name, child)


async def _embed_in_batches(embedding_service, texts: list[str]) -> list[list[float]]:
    """Call embed() in parallel batches and concatenate the results."""
    if not texts:
        return []
    batches = [
        texts[i : i + EMBED_BATCH_SIZE]
        for i in range(0, len(texts), EMBED_BATCH_SIZE)
    ]
    results = await asyncio.gather(*(embedding_service.embed(b) for b in batches))
    flat: list[list[float]] = []
    for r in results:
        flat.extend(r)
    return flat


@router.post("/update-files", response_model=BulkUpdateResponse)
async def update_files(body: BulkUpdateRequest, request: Request):
    db = request.app.state.db
    parser = request.app.state.parser
    ref_extractor = request.app.state.ref_extractor
    embedding_service = request.app.state.embedding_service
    vectorstore = request.app.state.vectorstore

    t0 = time.perf_counter()
    trace_id = getattr(request.state, "trace_id", None)

    # ── Phase 1 — parse every file in memory, remember old symbol names for broken-ref detection ──
    parsed = []  # list of dicts per file
    for item in body.files:
        path = normalize_path(item.path)
        language = parser.detect_language(path)
        if language is None:
            parsed.append({
                "item": item,
                "path": path,
                "language": None,
                "symbols": [],
                "refs": [],
                "old_symbol_names": set(),
                "file_hash": None,
                "flat_symbols": [],
                "meta_texts": [],
                "code_texts": [],
                "meta_chunk_counts": [],
                "code_chunk_counts": [],
            })
            continue

        file_hash = hashlib.sha256(item.content.encode("utf-8")).hexdigest()
        tree = parser.parse(item.content, language)
        symbols = parser.extract_symbols(tree, item.content, language)
        refs = ref_extractor.extract_references(
            tree, item.content, language, symbols, path
        )

        existing = db.get_file(path)
        old_symbol_names: set[str] = set()
        if existing:
            old_symbol_names = {
                s.name for s in db.get_symbols_by_file(existing.id)
            }

        flat_symbols = list(_flatten_symbols(symbols))

        meta_texts: list[str] = []
        code_texts: list[str] = []
        meta_chunk_counts: list[int] = []
        code_chunk_counts: list[int] = []
        for _, sym in flat_symbols:
            meta = embedding_service.prepare_metadata_text(
                name=sym.name,
                qualified_name=sym.qualified_name,
                symbol_type=sym.type,
                parameters=sym.parameters,
                docstring=sym.docstring,
            )
            code = embedding_service.prepare_code_text(sym.source_code)
            m_chunks = embedding_service.chunk_text(meta)
            c_chunks = embedding_service.chunk_text(code)
            meta_chunk_counts.append(len(m_chunks))
            code_chunk_counts.append(len(c_chunks))
            meta_texts.extend(m_chunks)
            code_texts.extend(c_chunks)

        parsed.append({
            "item": item,
            "path": path,
            "language": language,
            "file_hash": file_hash,
            "symbols": symbols,
            "refs": refs,
            "old_symbol_names": old_symbol_names,
            "flat_symbols": flat_symbols,
            "meta_texts": meta_texts,
            "code_texts": code_texts,
            "meta_chunk_counts": meta_chunk_counts,
            "code_chunk_counts": code_chunk_counts,
        })

    # ── Phase 2 — batch-embed everything across all files in parallel ──
    global_meta_texts: list[str] = []
    global_code_texts: list[str] = []
    meta_offsets: list[tuple[int, int]] = []  # per-file (start, end) in global_meta_texts
    code_offsets: list[tuple[int, int]] = []
    for p in parsed:
        m_start = len(global_meta_texts)
        c_start = len(global_code_texts)
        global_meta_texts.extend(p["meta_texts"])
        global_code_texts.extend(p["code_texts"])
        meta_offsets.append((m_start, len(global_meta_texts)))
        code_offsets.append((c_start, len(global_code_texts)))

    try:
        meta_embeddings, code_embeddings = await asyncio.gather(
            _embed_in_batches(embedding_service, global_meta_texts),
            _embed_in_batches(embedding_service, global_code_texts),
        )
    except Exception:
        logger.exception("Embedding service failure during bulk update")
        raise

    # Slice embeddings back to each file
    for p, (m_lo, m_hi), (c_lo, c_hi) in zip(parsed, meta_offsets, code_offsets):
        p["meta_embeddings"] = meta_embeddings[m_lo:m_hi]
        p["code_embeddings"] = code_embeddings[c_lo:c_hi]

    # ── Phase 3 — single SQLite transaction for all files ──
    # Collect (symbol_id, meta_chunks_with_vecs, code_chunks_with_vecs) for vectorstore phase.
    vector_writes: list[tuple[int, list[tuple[str, list[float]]], list[tuple[str, list[float]]]]] = []
    results: list[BulkFileResult] = []

    with db.conn:
        for p in parsed:
            if p["language"] is None:
                results.append(BulkFileResult(
                    path=p["item"].path,
                    symbols_indexed=0,
                    broken_references=[],
                ))
                continue

            path = p["path"]
            existing = db.get_file(path)
            if existing:
                old_ids = [s.id for s in db.get_symbols_by_file(existing.id)]
                vectorstore.remove_symbol_embeddings(old_ids)
                db.delete_file_data(existing.id, commit=False)

            file_id = db.upsert_file(path, p["file_hash"], p["language"], commit=False)

            symbol_id_map: dict[str, int] = {}
            parent_id_by_qname: dict[str, int] = {}
            symbol_count = 0
            meta_cursor = 0
            code_cursor = 0

            for idx, (parent_qname, sym) in enumerate(p["flat_symbols"]):
                parent_id = parent_id_by_qname.get(parent_qname) if parent_qname else None
                sym_id = db.insert_symbol(
                    file_id=file_id,
                    name=sym.name,
                    qualified_name=sym.qualified_name,
                    type=sym.type,
                    line_start=sym.line_start,
                    line_end=sym.line_end,
                    source_code=sym.source_code,
                    parameters=sym.parameters,
                    docstring=sym.docstring,
                    parent_symbol_id=parent_id,
                    commit=False,
                )
                symbol_id_map[sym.qualified_name] = sym_id
                if parent_qname is None:
                    parent_id_by_qname[sym.qualified_name] = sym_id
                symbol_count += 1

                m_count = p["meta_chunk_counts"][idx]
                c_count = p["code_chunk_counts"][idx]
                meta_pairs = list(zip(
                    p["meta_texts"][meta_cursor:meta_cursor + m_count],
                    p["meta_embeddings"][meta_cursor:meta_cursor + m_count],
                ))
                code_pairs = list(zip(
                    p["code_texts"][code_cursor:code_cursor + c_count],
                    p["code_embeddings"][code_cursor:code_cursor + c_count],
                ))
                meta_cursor += m_count
                code_cursor += c_count
                vector_writes.append((sym_id, meta_pairs, code_pairs))

            # References — look up source_id from the map, including child-of-parent lookups
            for ref in p["refs"]:
                source_id = symbol_id_map.get(ref.source_symbol_name)
                if source_id is None:
                    continue
                db.insert_reference(
                    source_symbol_id=source_id,
                    target_symbol_name=ref.target_symbol_name,
                    target_file_path=ref.target_file_path,
                    type=ref.type,
                    line_number=ref.line_number,
                    commit=False,
                )

            # Broken-reference detection — any symbol that disappeared and is still referenced
            # from other files.
            new_symbol_names = {sym.name for _, sym in p["flat_symbols"]}
            removed = p["old_symbol_names"] - new_symbol_names
            broken: list[BrokenReference] = []
            for removed_name in removed:
                target_refs = db.get_references_by_target_name(removed_name)
                affected_files = set()
                for ref_row, _source_name, source_path in target_refs:
                    if ref_row.target_file_path == path and source_path != path:
                        affected_files.add(source_path)
                if affected_files:
                    broken.append(BrokenReference(
                        target_symbol_name=removed_name,
                        affected_files=sorted(affected_files),
                    ))

            results.append(BulkFileResult(
                path=p["item"].path,
                symbols_indexed=symbol_count,
                broken_references=broken,
            ))

    # ── Phase 4 — write vectors (outside the SQLite transaction; Chroma handles its own durability) ──
    for sym_id, meta_pairs, code_pairs in vector_writes:
        try:
            vectorstore.add_symbol_embeddings(sym_id, meta_pairs, code_pairs)
        except Exception:
            logger.warning("Failed to write embeddings for symbol %s", sym_id)

    # ── Observability ──
    duration_ms = (time.perf_counter() - t0) * 1000
    if trace_id:
        total_symbols = sum(r.symbols_indexed for r in results)
        emit(
            "request",
            {
                "endpoint": "/update-files",
                "method": "POST",
                "status_code": 200,
                "query": {
                    "files_count": len(body.files),
                    "total_bytes": sum(len(f.content or "") for f in body.files),
                },
                "response_summary": {
                    "files_processed": len(results),
                    "total_symbols_indexed": total_symbols,
                    "broken_reference_files": sum(
                        1 for r in results if r.broken_references
                    ),
                },
            },
            trace_id,
            duration_ms=duration_ms,
        )
        forget_trace(trace_id)
        request.state.observability_emitted = True

    return BulkUpdateResponse(results=results)
