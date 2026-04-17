from pydantic import BaseModel, Field


class FileCheckRequest(BaseModel):
    path: str
    hash: str


class FileCheckResponse(BaseModel):
    path: str
    status: str  # "current", "stale", or "unknown"


class FileUpdateItem(BaseModel):
    path: str
    content: str


class BulkUpdateRequest(BaseModel):
    files: list[FileUpdateItem]


class BrokenReference(BaseModel):
    target_symbol_name: str
    affected_files: list[str]


class BulkFileResult(BaseModel):
    path: str
    symbols_indexed: int
    broken_references: list[BrokenReference]


class BulkUpdateResponse(BaseModel):
    results: list[BulkFileResult]


class UnresolvedRef(BaseModel):
    source_file: str
    source_symbol: str
    target_symbol_name: str
    type: str
    line_number: int


class StatusResponse(BaseModel):
    files_indexed: int
    symbols_indexed: int
    references_total: int
    unresolved_count: int
    unresolved_references: list[UnresolvedRef]


class SearchRequest(BaseModel):
    query: str
    limit: int = Field(default=10, gt=0)
    metadata_weight: float = Field(default=0.5, ge=0.0, le=1.0)
    code_weight: float = Field(default=0.5, ge=0.0, le=1.0)


class SearchResult(BaseModel):
    symbol_name: str
    qualified_name: str
    file_path: str
    type: str
    line_start: int
    line_end: int
    source_code: str
    score: float
    docstring: str | None = None


class FindReferencesRequest(BaseModel):
    file_path: str | None = None
    symbol_name: str
    direction: str = Field(default="both", pattern="^(inbound|outbound|both)$")


class ReferenceResult(BaseModel):
    source_file: str
    source_symbol: str
    target_symbol_name: str
    target_file_path: str | None
    type: str
    line_number: int


class OverviewSymbol(BaseModel):
    name: str
    qualified_name: str
    type: str
    parameters: str | None = None
    docstring: str | None = None


class OverviewFile(BaseModel):
    path: str
    language: str
    symbols: list[OverviewSymbol]
    inbound_reference_count: int
    outbound_reference_count: int
    depends_on: list[str]
    depended_on_by: list[str]


class OverviewResponse(BaseModel):
    total_files: int
    total_symbols: int
    total_references: int
    files: list[OverviewFile]
