import type {
  HealthResponse,
  FileHashEntry,
  FileCheckResult,
  FileUpdateItem,
  BulkUpdateResponse,
  IndexStatus,
  SearchRequest,
  SearchResult,
  FindReferencesRequest,
  ReferenceResult,
  AmbiguousSymbolError,
  RepositoryOverview
} from '../../shared/roseLibraryTypes'

export class RoseLibraryError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown
  ) {
    super(message)
    this.name = 'RoseLibraryError'
  }
}

export class AmbiguousSymbolException extends RoseLibraryError {
  public candidates: AmbiguousSymbolError['candidates']

  constructor(detail: AmbiguousSymbolError, status: number) {
    super(detail.message, status, detail)
    this.name = 'AmbiguousSymbolException'
    this.candidates = detail.candidates
  }
}

export class RoseLibraryClient {
  private baseUrl: string

  constructor(baseUrl = 'http://127.0.0.1:8000') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' }
    }

    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }

    let res: Response
    try {
      res = await fetch(url, options)
    } catch (err) {
      throw new RoseLibraryError(
        `Failed to connect to RoseLibrary at ${this.baseUrl}`,
        0,
        err
      )
    }

    if (!res.ok) {
      const responseBody = await res.json().catch(() => null)

      // Handle ambiguous symbol 422
      if (res.status === 422 && responseBody?.detail?.candidates) {
        throw new AmbiguousSymbolException(responseBody.detail, res.status)
      }

      throw new RoseLibraryError(
        `RoseLibrary ${method} ${path} returned ${res.status}`,
        res.status,
        responseBody
      )
    }

    return res.json() as Promise<T>
  }

  /** Health check — verify the server is running. */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/')
  }

  /**
   * Batch file hash check.
   * Send file paths and their SHA-256 hashes to determine which
   * files need to be re-indexed.
   */
  async checkFiles(files: FileHashEntry[]): Promise<FileCheckResult[]> {
    return this.request<FileCheckResult[]>('POST', '/check-file', files)
  }

  /**
   * Index one or more files in a single bulk request.
   * Parses each file, batches embeddings across all files into a few Ollama
   * calls, and commits in one SQLite transaction. Returns per-file results
   * with symbol counts and any broken references.
   */
  async updateFiles(files: FileUpdateItem[]): Promise<BulkUpdateResponse> {
    return this.request<BulkUpdateResponse>('POST', '/update-files', { files })
  }

  /**
   * Index health status.
   * Returns summary statistics and all unresolved references.
   */
  async status(): Promise<IndexStatus> {
    return this.request<IndexStatus>('GET', '/status')
  }

  /**
   * Natural language code search.
   * Returns matching symbols ranked by relevance with full source code.
   */
  async search(params: SearchRequest): Promise<SearchResult[]> {
    return this.request<SearchResult[]>('POST', '/search', params)
  }

  /**
   * Find all references to or from a symbol.
   * Throws AmbiguousSymbolException if the symbol name matches
   * multiple definitions and file_path is not provided.
   */
  async findReferences(params: FindReferencesRequest): Promise<ReferenceResult[]> {
    return this.request<ReferenceResult[]>('POST', '/findReferences', params)
  }

  /**
   * Repository overview — structured map of files, symbols, and
   * dependencies, ranked by importance (inbound reference count).
   */
  async overview(): Promise<RepositoryOverview> {
    return this.request<RepositoryOverview>('GET', '/overview')
  }
}
