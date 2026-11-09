"""nr05_layaways: crea tablas layaways, layaway_items y layaway_payments
para el flujo APARTADOS F5.

Apartado = cliente abona parcialmente, mercancía se reserva hasta 6 meses.
Si vence: mercancía vuelve al inventario, dinero queda como Anticipo.

Revision ID: 20260916_0002
Revises: 20260916_0001
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa

revision = "20260916_0002"
down_revision = "20260916_0001"
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect as sa_inspect

    bind = op.get_bind()
    inspector = sa_inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "layaways" not in existing_tables:
        op.create_table(
            "layaways",
            sa.Column("empresa_id",       sa.String(), nullable=False, index=True),
            sa.Column("sucursal_id",      sa.String(), nullable=False, server_default="MATRIZ"),
            sa.Column("id",               sa.String(), primary_key=True, index=True),
            sa.Column("folio",            sa.String(), nullable=True),
            sa.Column("client_id",        sa.String(), nullable=False),
            sa.Column("client_name",      sa.String(), nullable=False),
            sa.Column("seller_id",        sa.String(), nullable=True),
            sa.Column("total_amount",     sa.Numeric(15, 4), nullable=False),
            sa.Column("amount_paid",      sa.Numeric(15, 4), nullable=False, server_default="0.0000"),
            sa.Column("amount_pending",   sa.Numeric(15, 4), nullable=False),
            # ACTIVO | VENCIDO | COMPLETADO | CANCELADO
            sa.Column("status",           sa.String(), nullable=False, server_default="ACTIVO"),
            sa.Column("fecha_vencimiento", sa.DateTime(timezone=True), nullable=False),
            sa.Column("nota",             sa.String(), nullable=True),
            sa.Column("is_synced",        sa.Boolean(), server_default="false", nullable=False),
            sa.Column("created_by",       sa.String(), nullable=True),
            sa.Column("created_at",       sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at",       sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "idx_layaways_tenant_status",
            "layaways",
            ["empresa_id", "status"],
        )
        op.create_index(
            "idx_layaways_client",
            "layaways",
            ["empresa_id", "client_id"],
        )
        op.create_index(
            "idx_layaways_vencimiento",
            "layaways",
            ["empresa_id", "fecha_vencimiento", "status"],
        )

    if "layaway_items" not in existing_tables:
        op.create_table(
            "layaway_items",
            sa.Column("empresa_id",    sa.String(), nullable=False, index=True),
            sa.Column("id",            sa.String(), primary_key=True, index=True),
            sa.Column("layaway_id",    sa.String(), nullable=False),
            sa.Column("product_id",    sa.String(), nullable=True),
            sa.Column("product_sku",   sa.String(), nullable=False),
            sa.Column("description",   sa.String(), nullable=False, server_default=""),
            sa.Column("quantity",      sa.Numeric(15, 4), nullable=False),
            sa.Column("price",         sa.Numeric(15, 4), nullable=False),
            sa.Column("subtotal",      sa.Numeric(15, 4), nullable=False),
        )
        op.create_index(
            "idx_layaway_items_layaway",
            "layaway_items",
            ["empresa_id", "layaway_id"],
        )

    if "layaway_payments" not in existing_tables:
        op.create_table(
            "layaway_payments",
            sa.Column("empresa_id",     sa.String(), nullable=False, index=True),
            sa.Column("id",             sa.String(), primary_key=True, index=True),
            sa.Column("layaway_id",     sa.String(), nullable=False),
            sa.Column("amount",         sa.Numeric(15, 4), nullable=False),
            # efectivo | cheque | transferencia | tarjeta_credito | tarjeta_debito
            sa.Column("payment_method", sa.String(), nullable=False, server_default="efectivo"),
            # JSON igual que sales.payment_details
            sa.Column("payment_details", sa.String(), nullable=True),
            sa.Column("is_synced",      sa.Boolean(), server_default="false", nullable=False),
            sa.Column("created_by",     sa.String(), nullable=True),
            sa.Column("created_at",     sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index(
            "idx_layaway_payments_layaway",
            "layaway_payments",
            ["empresa_id", "layaway_id"],
        )


def downgrade():
    op.drop_table("layaway_payments")
    op.drop_table("layaway_items")
    op.drop_index("idx_layaways_vencimiento", "layaways")
    op.drop_index("idx_layaways_client", "layaways")
    op.drop_index("idx_layaways_tenant_status", "layaways")
    op.drop_table("layaways")
