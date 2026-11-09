"""saldos_apertura: sale_id nullable en CxC para saldos de apertura

Revision ID: 20260911_0001
Revises: 20260909_0007_gps_routes
Create Date: 2026-09-11
"""
from alembic import op
import sqlalchemy as sa

revision = "20260911_0001"
down_revision = "0007_gps_routes"
branch_labels = None
depends_on = None


def upgrade():
    # Permite registrar saldos de apertura de cartera sin una venta origen.
    # La FK sigue activa (NULL no se valida contra la tabla referenciada).
    with op.batch_alter_table("accounts_receivable") as batch_op:
        batch_op.alter_column("sale_id", existing_type=sa.String(), nullable=True)


def downgrade():
    # Antes de bajar: asegurarse de que no existan filas con sale_id IS NULL.
    with op.batch_alter_table("accounts_receivable") as batch_op:
        batch_op.alter_column("sale_id", existing_type=sa.String(), nullable=False)
