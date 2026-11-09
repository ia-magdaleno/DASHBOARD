#!/bin/sh
set -e

if [ "$DEPLOYMENT_MODE" = "cloud" ]; then
    echo "[entrypoint] DEPLOYMENT_MODE=cloud -> preparando esquema contra PostgreSQL (Supabase)..."
    python bootstrap_db.py
else
    echo "[entrypoint] DEPLOYMENT_MODE=$DEPLOYMENT_MODE -> se omiten migraciones Alembic (modo local/SQLite)."
fi

# Seed opcional al arrancar. Para plataformas sin Shell (Render Free): setear
# SEED_ON_BOOT=1 en el entorno, redesplegar una vez, y luego quitar la variable.
# Los scripts son idempotentes (get_or_create), así que dejarla activa no
# duplica datos, solo alenta el arranque. Un fallo del seed NO tumba uvicorn.
if [ "$SEED_ON_BOOT" = "1" ]; then
    echo "[entrypoint] SEED_ON_BOOT=1 -> sembrando (idempotente)..."
    if [ -n "$SUPERADMIN_USER" ] && [ -n "$SUPERADMIN_PASSWORD" ]; then
        python scripts/create_superadmin.py || echo "[entrypoint] create_superadmin.py falló (ignorado)"
    else
        echo "[entrypoint] (sin SUPERADMIN_USER/PASSWORD -> se omite create_superadmin.py)"
    fi
    python scripts/seed_mag001.py || echo "[entrypoint] seed_mag001.py falló (ignorado)"
fi

echo "[entrypoint] Iniciando uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port 8000
