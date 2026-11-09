"""RH-04: attendance_authorizations (autorizacion de salida temprana < 4h)

Revision ID: rh04_attn_auth
Revises: 20260917_0001
Create Date: 2026-09-02

NOTA (17-sep-2026): down_revision original era 761b7aa53fa9, una revision
de una rama distinta (isael-dev/feat/RH-04-reloj-confirmacion-4h) que
quedo huerfana cuando el historial de Alembic se squasheo a 0001_baseline
en otra linea de trabajo -- Alembic tronaba con KeyError al no encontrar
esa revision en el arbol. Relinkeado a la punta actual de la cadena
(20260917_0001). Seguro: esta migracion es autocontenida (crea una tabla
nueva con guard de idempotencia), no depende de nada de la cadena vieja.

Don Antonio (02-09-2026): entre entrada y salida deben pasar >= 4h. Si es
menor, la salida NO se registra: se crea una fila aqui con status
'pendiente' y el Admin/Gerente la aprueba (la salida se inserta entonces
en attendance_events con la hora de aprobacion).

En modo local/SQLite el backend crea la tabla en caliente via
_reloj_ensure_auth_table(); esta migracion es el path para Postgres/Supabase.
"""
from alembic import op
import sqlalchemy as sa


revision = "rh04_attn_auth"
down_revision = "20260917_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "attendance_authorizations" in insp.get_table_names():
        # SQLite local ya la creo en caliente
        return

    op.create_table(
        "attendance_authorizations",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        # users.id es UUID (string), igual que attendance_events.user_id
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("empresa_id", sa.String(length=64), nullable=False),
        sa.Column("sucursal_id", sa.String(length=64), nullable=True),
        sa.Column("event_date", sa.String(length=10), nullable=False),
        sa.Column("entrada_ts", sa.String(length=40), nullable=False),
        sa.Column("intento_ts", sa.String(length=40), nullable=False),
        sa.Column("horas_transcurridas", sa.Float, nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pendiente"),
        sa.Column("resolved_by", sa.String(length=64), nullable=True),
        sa.Column("resolved_at", sa.String(length=40), nullable=True),
        sa.Column("salida_event_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_attn_auth_pendientes",
        "attendance_authorizations",
        ["status", "event_date"],
    )
    op.create_index(
        "ix_attn_auth_user_date",
        "attendance_authorizations",
        ["user_id", "event_date"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "attendance_authorizations" not in insp.get_table_names():
        return
    for ix in ("ix_attn_auth_pendientes", "ix_attn_auth_user_date"):
        try:
            op.drop_index(ix, table_name="attendance_authorizations")
        except Exception:
            pass
    op.drop_table("attendance_authorizations")
