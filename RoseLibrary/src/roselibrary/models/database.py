import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path



@dataclass
class FileRow:
    id: int
    path: str
    hash: str
    language: str
    indexed_at: str


@dataclass
class SymbolRow:
    id: int
    file_id: int
    name: str
    qualified_name: str
    type: str
    line_start: int
    line_end: int
    source_code: str
    parameters: str | None
    docstring: str | None
    parent_symbol_id: int | None


@dataclass
class RefRow:
    id: int
    source_symbol_id: int
    target_symbol_name: str
    target_file_path: str | None
    type: str
    line_number: int


class Database:
    def __init__(self, data_dir: Path):
        data_dir.mkdir(parents=True, exist_ok=True)
        db_path = data_dir / "roselibrary.db"
        self.conn = sqlite3.connect(str(db_path))
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.row_factory = sqlite3.Row

    def init_schema(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                hash TEXT NOT NULL,
                language TEXT NOT NULL,
                indexed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS symbols (
                id INTEGER PRIMARY KEY,
                file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                qualified_name TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('function', 'class', 'method')),
                line_start INTEGER NOT NULL,
                line_end INTEGER NOT NULL,
                source_code TEXT NOT NULL,
                parameters TEXT,
                docstring TEXT,
                parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS references_ (
                id INTEGER PRIMARY KEY,
                source_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
                target_symbol_name TEXT NOT NULL,
                target_file_path TEXT,
                type TEXT NOT NULL CHECK(type IN ('import', 'call', 'assignment', 'destructure')),
                line_number INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
            CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
            CREATE INDEX IF NOT EXISTS idx_refs_target ON references_(target_symbol_name);
            CREATE INDEX IF NOT EXISTS idx_refs_source ON references_(source_symbol_id);
        """)
        self.conn.commit()

    def upsert_file(self, path: str, hash: str, language: str, commit: bool = True) -> int:
        now = datetime.now(timezone.utc).isoformat()
        cur = self.conn.execute(
            """INSERT INTO files (path, hash, language, indexed_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(path) DO UPDATE SET hash=?, language=?, indexed_at=?
               RETURNING id""",
            (path, hash, language, now, hash, language, now),
        )
        file_id = cur.fetchone()[0]
        if commit:
            self.conn.commit()
        return file_id

    def get_file(self, path: str) -> FileRow | None:
        row = self.conn.execute(
            "SELECT * FROM files WHERE path = ?", (path,)
        ).fetchone()
        return FileRow(**dict(row)) if row else None

    def get_files_by_paths(self, paths: list[str]) -> dict[str, FileRow]:
        if not paths:
            return {}
        placeholders = ",".join("?" for _ in paths)
        rows = self.conn.execute(
            f"SELECT * FROM files WHERE path IN ({placeholders})", paths
        ).fetchall()
        return {row["path"]: FileRow(**dict(row)) for row in rows}

    def get_all_files(self) -> list[FileRow]:
        rows = self.conn.execute("SELECT * FROM files ORDER BY path").fetchall()
        return [FileRow(**dict(r)) for r in rows]

    def delete_file_data(self, file_id: int, commit: bool = True):
        self.conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
        if commit:
            self.conn.commit()

    def insert_symbol(
        self,
        file_id: int,
        name: str,
        qualified_name: str,
        type: str,
        line_start: int,
        line_end: int,
        source_code: str,
        parameters: str | None = None,
        docstring: str | None = None,
        parent_symbol_id: int | None = None,
        commit: bool = True,
    ) -> int:
        cur = self.conn.execute(
            """INSERT INTO symbols
               (file_id, name, qualified_name, type, line_start, line_end,
                source_code, parameters, docstring, parent_symbol_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id""",
            (file_id, name, qualified_name, type, line_start, line_end,
             source_code, parameters, docstring, parent_symbol_id),
        )
        symbol_id = cur.fetchone()[0]
        if commit:
            self.conn.commit()
        return symbol_id

    def insert_reference(
        self,
        source_symbol_id: int,
        target_symbol_name: str,
        target_file_path: str | None,
        type: str,
        line_number: int,
        commit: bool = True,
    ) -> int:
        cur = self.conn.execute(
            """INSERT INTO references_
               (source_symbol_id, target_symbol_name, target_file_path, type, line_number)
               VALUES (?, ?, ?, ?, ?)
               RETURNING id""",
            (source_symbol_id, target_symbol_name, target_file_path, type, line_number),
        )
        ref_id = cur.fetchone()[0]
        if commit:
            self.conn.commit()
        return ref_id

    def get_symbols_by_file(self, file_id: int) -> list[SymbolRow]:
        rows = self.conn.execute(
            "SELECT * FROM symbols WHERE file_id = ?", (file_id,)
        ).fetchall()
        return [SymbolRow(**dict(r)) for r in rows]

    def get_symbol_by_id(self, symbol_id: int) -> SymbolRow | None:
        row = self.conn.execute(
            "SELECT * FROM symbols WHERE id = ?", (symbol_id,)
        ).fetchone()
        return SymbolRow(**dict(row)) if row else None

    def find_symbols_by_name(self, name: str) -> list[tuple[SymbolRow, str]]:
        rows = self.conn.execute(
            """SELECT s.*, f.path as file_path
               FROM symbols s JOIN files f ON s.file_id = f.id
               WHERE s.name = ?""",
            (name,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            file_path = d.pop("file_path")
            result.append((SymbolRow(**d), file_path))
        return result

    def get_references_by_target_name(self, target_name: str) -> list[tuple[RefRow, str, str]]:
        rows = self.conn.execute(
            """SELECT r.*, s.name as source_symbol_name, f.path as source_file_path
               FROM references_ r
               JOIN symbols s ON r.source_symbol_id = s.id
               JOIN files f ON s.file_id = f.id
               WHERE r.target_symbol_name = ?""",
            (target_name,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            source_symbol_name = d.pop("source_symbol_name")
            source_file_path = d.pop("source_file_path")
            result.append((RefRow(**d), source_symbol_name, source_file_path))
        return result

    def get_references_by_source_symbol(self, source_symbol_id: int) -> list[RefRow]:
        rows = self.conn.execute(
            "SELECT * FROM references_ WHERE source_symbol_id = ?",
            (source_symbol_id,),
        ).fetchall()
        return [RefRow(**dict(r)) for r in rows]

    def get_all_unresolved_references(self) -> list[tuple[RefRow, str, str]]:
        rows = self.conn.execute(
            """SELECT r.*, s.name as source_symbol_name, f.path as source_file_path
               FROM references_ r
               JOIN symbols s ON r.source_symbol_id = s.id
               JOIN files f ON s.file_id = f.id
               WHERE r.target_file_path IS NULL
                  OR NOT EXISTS (
                      SELECT 1 FROM symbols s2
                      JOIN files f2 ON s2.file_id = f2.id
                      WHERE s2.name = r.target_symbol_name
                        AND f2.path = r.target_file_path
                  )""",
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            source_symbol_name = d.pop("source_symbol_name")
            source_file_path = d.pop("source_file_path")
            result.append((RefRow(**d), source_symbol_name, source_file_path))
        return result

    def get_symbol_ids_by_file(self, file_id: int) -> list[int]:
        rows = self.conn.execute(
            "SELECT id FROM symbols WHERE file_id = ?", (file_id,)
        ).fetchall()
        return [r[0] for r in rows]

    def get_summary_stats(self) -> dict:
        files = self.conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        symbols = self.conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0]
        references = self.conn.execute("SELECT COUNT(*) FROM references_").fetchone()[0]
        unresolved = len(self.get_all_unresolved_references())
        return {
            "files_indexed": files,
            "symbols_indexed": symbols,
            "references_total": references,
            "unresolved_count": unresolved,
        }

    def close(self):
        self.conn.close()
