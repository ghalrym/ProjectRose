from fastapi import APIRouter, Request

router = APIRouter()


@router.post("/clear")
async def clear(request: Request):
    db = request.state.db
    vectorstore = request.state.vectorstore

    # Get all symbol IDs for vector cleanup
    symbol_ids = [
        row[0]
        for row in db.conn.execute("SELECT id FROM symbols").fetchall()
    ]
    if symbol_ids:
        vectorstore.remove_symbol_embeddings(symbol_ids)

    # Clear all tables
    db.conn.executescript("""
        DELETE FROM references_;
        DELETE FROM symbols;
        DELETE FROM files;
    """)
    db.conn.commit()

    return {"status": "cleared"}
