"""sale_folio_nr04: folio y parent_sale_id en sales; product_id nullable en sale_items

Revision ID: 20260912_0001
Revises: 20260911_0001
Create Date: 2026-09-12
"""
from alembic import op
import sqlalchemy as sa

revision = "20260912_0001"
down_revision = "20260911_0001"
branch_labels = None
depends_on = None


def upgrade():
    # folio: número secuencial legible (ej. "315"). Sub-facturas NR-04: "315-A".
    # parent_sale_id: FK a la factura raíz en splits NR-04.
    #
    # Guard IF NOT EXISTS: la baseline (0001_baseline) materializa el esquema
    # completo via Base.metadata.create_all(), por lo que en una BD nueva estas
    # columnas ya existen cuando esta revisión corre. Las adiciones son
    # idempotentes; el índice se crea solo si no existe.
    from sqlalchemy import inspect as sa_inspect

    bind = op.get_bind()
    inspector = sa_inspect(bind)

    existing_sales_cols = {c["name"] for c in inspector.get_columns("sales")}
    cols_to_add = []
    if "folio" not in existing_sales_cols:
        cols_to_add.append(sa.Column("folio", sa.String(), nullable=True))
    if "parent_sale_id" not in existing_sales_cols:
        cols_to_add.append(sa.Column("parent_sale_id", sa.String(), nullable=True))

    if cols_to_add:
        with op.batch_alter_table("sales") as batch_op:
            for col in cols_to_add:
                batch_op.add_column(col)

    existing_indexes = {i["name"] for i in inspector.get_indexes("sales")}
    if "idx_sales_folio_empresa" not in existing_indexes:
        op.create_index("idx_sales_folio_empresa", "sales", ["empresa_id", "folio"])

    # product_id pasa a nullable para líneas de servicio virtual (excedente NR-04).
    # La FK sigue activa; PostgreSQL no valida FK cuando el valor es NULL.
    with op.batch_alter_table("sale_items") as batch_op:
        batch_op.alter_column("product_id", existing_type=sa.String(), nullable=True)


def downgrade():
    op.drop_index("idx_sales_folio_empresa", table_name="sales")
    with op.batch_alter_table("sales") as batch_op:
        batch_op.drop_column("parent_sale_id")
        batch_op.drop_column("folio")
    with op.batch_alter_table("sale_items") as batch_op:
        batch_op.alter_column("product_id", existing_type=sa.String(), nullable=False)
