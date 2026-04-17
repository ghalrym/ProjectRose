import re
import threading
from pathlib import Path

from roselibrary.indexing.vectorstore import VectorStore
from roselibrary.models.database import Database

_VALID_ID = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")


def is_valid_project_id(project_id: str) -> bool:
    return bool(_VALID_ID.match(project_id))


class ProjectStore:
    def __init__(self, project_id: str, data_dir: Path):
        self.project_id = project_id
        self.data_dir = data_dir
        self.db = Database(data_dir)
        self.db.init_schema()
        self.vectorstore = VectorStore(data_dir)

    def close(self):
        self.db.close()


class ProjectStoreManager:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.projects_dir = base_dir / "projects"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self._stores: dict[str, ProjectStore] = {}
        self._lock = threading.Lock()

    def get(self, project_id: str) -> ProjectStore:
        with self._lock:
            store = self._stores.get(project_id)
            if store is None:
                data_dir = self.projects_dir / project_id
                data_dir.mkdir(parents=True, exist_ok=True)
                store = ProjectStore(project_id, data_dir)
                self._stores[project_id] = store
            return store

    def close_all(self):
        with self._lock:
            for store in self._stores.values():
                store.close()
            self._stores.clear()
