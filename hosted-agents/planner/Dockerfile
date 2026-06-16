# syntax=docker/dockerfile:1
FROM python:3.12-slim

# uv: fast, deterministic dependency installs (replaces pip).
# Pin a concrete tag here for reproducible builds once a known-good version is chosen.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Dedicated non-root runtime user with a real home dir.
# Hosted agents persist $HOME across sessions, so the runtime user must own it.
RUN useradd --create-home --uid 10001 appuser

WORKDIR /app/user_agent

ENV UV_COMPILE_BYTECODE=1 \
  UV_LINK_MODE=copy \
  UV_SYSTEM_PYTHON=1

# Install dependencies first to maximize layer caching.
COPY requirements.txt ./
RUN uv pip install --system -r requirements.txt

# Copy application code and hand ownership to the non-root user.
COPY . ./
RUN chown -R appuser:appuser /app

USER appuser
EXPOSE 8088
CMD ["python", "main.py"]
