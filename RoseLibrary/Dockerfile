FROM python:3.13-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY src/ src/
RUN uv sync --frozen --no-dev

ENV ROSE_HOST=0.0.0.0
ENV ROSE_PORT=8000
ENV ROSE_DATA_DIR=/data
ENV ROSE_OLLAMA_BASE_URL=http://host.docker.internal:11434

EXPOSE 8000

CMD ["uv", "run", "roselibrary"]
