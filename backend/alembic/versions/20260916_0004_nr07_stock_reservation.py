"""nr07_stock_reservation: tabla stock_reservations con TTL para pre-reserva
de inventario (C-04). Permite que el POS reserve unidades al iniciar un
apartado o una venta en proceso, liberándolas si el cliente abandona.

reference_type indica quién creó la reserva:
  LAYAWAY     — apartado F5 (nr05)
  POS_SESSION — venta en proceso todavía sin confirmar
  PRESALE     — cotización convertida a venta (F8)

Revision ID: 20260916_0004
Revises: 20260916_0003
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa

revision = "20260916_0004"
down_revision = "20260916_0003"
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect as sa_inspect

    bind = op.get_bind()
    inspector = sa_inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "stock_reservations" not in existing_tables:
        op.create_table(
            "stock_reservations",
            sa.Column("empresa_id",     sa.String(), nullable=False, index=True),
            sa.Column("sucursal_id",    sa.String(), nullable=False, server_default="MATRIZ"),
            sa.Column("id",             sa.String(), primary_key=True, index=True),
            sa.Column("product_id",     sa.String(), nullable=False),
            sa.Column("warehouse_id",   sa.String(), nullable=False),
            sa.Column("quantity",       sa.Numeric(15, 4), nullable=False),
            # LAYAWAY | POS_SESSION | PRESALE
            sa.Column("reference_type", sa.String(), nullable=False),
            sa.Column("reference_id",   sa.String(), nullable=False),
            sa.Column("expires_at",     sa.DateTime(timezone=True), nullable=False),
            # ACTIVE | EXPIRED | CONSUMED | RELEASED
            sa.Column("status",         sa.String(), nullable=False, server_default="ACTIVE"),
            sa.Column("created_by",     sa.String(), nullable=True),
            sa.Column("created_at",     sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index(
            "idx_stock_res_product",
            "stock_reservations",
            ["empresa_id", "product_id", "warehouse_id", "status"],
        )
        op.create_index(
            "idx_stock_res_reference",
            "stock_reservations",
            ["empresa_id", "reference_type", "reference_id"],
        )
        op.create_index(
            "idx_stock_res_expires",
            "stock_reservations",
            ["expires_at", "status"],
        )


def downgrade():
    op.drop_index("idx_stock_res_expires", "stock_reservations")
    op.drop_index("idx_stock_res_reference", "stock_reservations")
    op.drop_index("idx_stock_res_product", "stock_reservations")
    op.drop_table("stock_reservations")
