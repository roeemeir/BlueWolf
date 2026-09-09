FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BLUEWOLF_RUNTIME_HOST=0.0.0.0 \
    BLUEWOLF_RUNTIME_PORT=8080 \
    BLUEWOLF_RUNTIME_STALE_SECONDS=15 \
    BLUEWOLF_RUNTIME_EXPIRE_SECONDS=60

WORKDIR /opt/bluewolf
COPY core /opt/bluewolf/core

WORKDIR /opt/bluewolf/core
RUN python -m pip install --upgrade pip \
    && python -m pip install '.[service,influx]'

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2).read()"

# RuntimeSnapshotStore is process-local in the current milestone, therefore the
# service must remain a single worker until the persistence layer is introduced.
CMD ["bluewolf-runtime"]
