"""item1: points_redemptions + seed loyalty config in AdminConfig

Revision ID: 0006_item1_loyalty
Revises: 0005_item2_proyectos
Create Date: 2026-09-09
"""

from alembic import op
import sqlalchemy as sa

revision = "0006_item1_loyalty"
down_revision = "0005_item2_proyectos"
branch_labels = None
depends_on = None

_LOYALTY_CONFIG_KEY     = "loyalty.config"
_LOYALTY_REDEMPTION_KEY = "loyalty.redemption"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def upgrade():
    # ── points_redemptions ────────────────────────────────────────────────────
    if not _has_table("points_redemptions"):
        op.create_table(
            "points_redemptions",
            sa.Column("id",               sa.String,  primary_key=True),
            sa.Column("empresa_id",       sa.String,  nullable=False),
            sa.Column("client_id",        sa.String,  nullable=False),
            sa.Column("redemption_mode",  sa.String,  nullable=False),
            sa.Column("puntos_canjeados", sa.Integer, nullable=False),
            sa.Column("valor_aplicado",   sa.Numeric(15, 4), nullable=True),
            sa.Column("sale_id",          sa.String,  nullable=True),
            sa.Column("notas",            sa.String,  nullable=True),
            sa.Column("registrado_por",   sa.String,  nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("idx_points_redemptions_client", "points_redemptions", ["empresa_id", "client_id"])

    # ── Seed AdminConfig con defaults del programa de lealtad (idempotente) ──
    conn = op.get_bind()

    conn.execute(sa.text("""
        INSERT INTO admin_config (empresa_id, config_key, config_val)
        SELECT empresa_id, :key, :val
        FROM (SELECT DISTINCT empresa_id FROM admin_config) subq
        WHERE NOT EXISTS (
            SELECT 1 FROM admin_config ac2
            WHERE ac2.empresa_id = subq.empresa_id AND ac2.config_key = :key
        )
    """), {"key": _LOYALTY_CONFIG_KEY, "val": '{"mode":"percent","rate":1.0}'})

    conn.execute(sa.text("""
        INSERT INTO admin_config (empresa_id, config_key, config_val)
        SELECT empresa_id, :key, :val
        FROM (SELECT DISTINCT empresa_id FROM admin_config) subq
        WHERE NOT EXISTS (
            SELECT 1 FROM admin_config ac2
            WHERE ac2.empresa_id = subq.empresa_id AND ac2.config_key = :key
        )
    """), {"key": _LOYALTY_REDEMPTION_KEY,
           "val": '{"modes":["pago_parcial","sorteo","regalo"],"valor_punto":1.0}'})


def downgrade():
    if _has_table("points_redemptions"):
        op.drop_index("idx_points_redemptions_client", table_name="points_redemptions")
        op.drop_table("points_redemptions")
