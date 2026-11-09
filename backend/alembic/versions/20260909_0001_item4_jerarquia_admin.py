"""Item 4: jerarquía admin_general/admin_sucursal + permisos temporales

Cambios:
  * Nueva tabla temp_permission_grants
  * Seed AdminConfig key 'roles.sucursal_blocked_modules' para todos los tenants
    que aún no la tengan (idempotente)

Revision ID: 0003_item4_jerarquia
Revises: 0002_cp2_cartera_cfdi
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_item4_jerarquia"
down_revision = "0002_cp2_cartera_cfdi"
branch_labels = None
depends_on = None

_DEFAULT_BLOCKED = ["RRHH", "COMPRAS", "CONFIGURACION"]


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def upgrade() -> None:
    if not _has_table("temp_permission_grants"):
        op.create_table(
            "temp_permission_grants",
            sa.Column("id",          sa.String(), primary_key=True),
            sa.Column("empresa_id",  sa.String(), nullable=False, index=True),
            sa.Column("user_id",     sa.String(), nullable=False, index=True),
            sa.Column("module",      sa.String(), nullable=False),
            sa.Column("sucursal_id", sa.String(), nullable=True),
            sa.Column("granted_by",  sa.String(), nullable=False),
            sa.Column("valid_from",  sa.DateTime(timezone=True), nullable=False),
            sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked",     sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("created_at",  sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index(
            "idx_temp_grants_user_module",
            "temp_permission_grants",
            ["empresa_id", "user_id", "module"],
        )

    # Seed: insertar roles.sucursal_blocked_modules en admin_config para cada
    # tenant que aún no lo tenga. Usa INSERT ... ON CONFLICT DO NOTHING para
    # ser idempotente en re-ejecuciones.
    conn = op.get_bind()
    existing_tenants = conn.execute(
        sa.text("SELECT DISTINCT empresa_id FROM admin_config")
    ).fetchall()

    for (eid,) in existing_tenants:
        conn.execute(
            sa.text(
                "INSERT INTO admin_config (empresa_id, config_key, config_val) "
                "VALUES (:eid, 'roles.sucursal_blocked_modules', CAST(:val AS jsonb)) "
                "ON CONFLICT DO NOTHING"
            ),
            {"eid": eid, "val": '["RRHH","COMPRAS","CONFIGURACION"]'},
        )


def downgrade() -> None:
    if _has_table("temp_permission_grants"):
        op.drop_index("idx_temp_grants_user_module", table_name="temp_permission_grants")
        op.drop_table("temp_permission_grants")
    # No revertimos el seed de admin_config (dato de configuración, no estructura)
