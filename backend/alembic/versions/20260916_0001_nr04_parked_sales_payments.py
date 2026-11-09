"""nr04_parked_sales_payments: extiende parked_sales con payment_details,
payment_method y status para soportar el drawer cobro (F7) con múltiples
métodos de pago (efectivo, cheque, transferencia, tarjeta).

Revision ID: 20260916_0001
Revises: 20260914_0001
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa

revision = "20260916_0001"
down_revision = "20260914_0001"
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect as sa_inspect

    bind = op.get_bind()
    inspector = sa_inspect(bind)
    existing_cols = {c["name"] for c in inspector.get_columns("parked_sales")}

    cols_to_add = []
    if "status" not in existing_cols:
        cols_to_add.append(sa.Column(
            "status",
            sa.String(),
            nullable=False,
            server_default="ACTIVE",
        ))
    if "payment_method" not in existing_cols:
        cols_to_add.append(sa.Column(
            "payment_method",
            sa.String(),
            nullable=True,
        ))
    if "payment_details" not in existing_cols:
        # JSON serializado igual que sales.payment_details:
        # cheque={banco,girador,numero,monto}
        # transferencia={referencia,banco_origen,estatus}
        # tarjeta={aprobacion,recibo,digitos,fecha_hora}
        cols_to_add.append(sa.Column(
            "payment_details",
            sa.String(),
            nullable=True,
        ))

    if cols_to_add:
        with op.batch_alter_table("parked_sales") as batch_op:
            for col in cols_to_add:
                batch_op.add_column(col)

    existing_indexes = {i["name"] for i in inspector.get_indexes("parked_sales")}
    if "idx_parked_sales_status" not in existing_indexes:
        op.create_index(
            "idx_parked_sales_status",
            "parked_sales",
            ["empresa_id", "status"],
        )


def downgrade():
    op.drop_index("idx_parked_sales_status", "parked_sales")
    with op.batch_alter_table("parked_sales") as batch_op:
        batch_op.drop_column("payment_details")
        batch_op.drop_column("payment_method")
        batch_op.drop_column("status")
