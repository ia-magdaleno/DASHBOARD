# CALEBSYS POS — imagen para despliegue en servidor/Docker
# Modo de datos: DEPLOYMENT_MODE=cloud -> conecta directo a PostgreSQL (Neon),
# sin depender de SQLite local (ver backend/database.py y backend/alembic/env.py).

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

ENV DEPLOYMENT_MODE=cloud \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

WORKDIR /app/backend

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://127.0.0.1:8000/ || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
