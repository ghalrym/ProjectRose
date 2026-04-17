FROM python:3.13-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml ./
RUN uv sync --no-install-project --no-dev

COPY src/ src/
COPY static/ static/
RUN uv sync --no-dev

ENV ROSE_HOST=0.0.0.0
ENV ROSE_PORT=8020
ENV ROSE_DATA_DIR=/data

EXPOSE 8020

CMD ["uv", "run", "roseobservability"]
