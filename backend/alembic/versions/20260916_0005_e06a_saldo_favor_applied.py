"""e06a_saldo_favor_applied: columna saldo_favor_applied en sales para registrar
cuánto del saldo_favor del cliente se aplicó como pago parcial/total en la venta.

Revision ID: 20260916_0005
Revises: 20260916_0004
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa

revision = "20260916_0005"
down_revision = "20260916_0004"
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect as sa_inspect

    bind = op.get_bind()
    inspector = sa_inspect(bind)
    existing_cols = {c["name"] for c in inspector.get_columns("sales")}

    if "saldo_favor_applied" not in existing_cols:
        op.add_column(
            "sales",
            sa.Column(
                "saldo_favor_applied",
                sa.Numeric(15, 4),
                nullable=False,
                server_default="0.0000",
            ),
        )


def downgrade():
    from sqlalchemy import inspect as sa_inspect

    bind = op.get_bind()
    inspector = sa_inspect(bind)
    existing_cols = {c["name"] for c in inspector.get_columns("sales")}

    if "saldo_favor_applied" in existing_cols:
        op.drop_column("sales", "saldo_favor_applied")
