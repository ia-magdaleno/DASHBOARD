"""cat_whatsapp_sales_code: whatsapp en employees y suppliers; sales_code en products.

Revision ID: 20260917_0001
Revises: 20260916_0005
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = "20260917_0001"
down_revision = "20260916_0005"
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect as sa_inspect

    bind = op.get_bind()
    inspector = sa_inspect(bind)

    products_cols = {c["name"] for c in inspector.get_columns("products")}
    if "sales_code" not in products_cols:
        op.add_column("products", sa.Column("sales_code", sa.String(), nullable=True))

    employees_cols = {c["name"] for c in inspector.get_columns("employees")}
    if "whatsapp" not in employees_cols:
        op.add_column("employees", sa.Column("whatsapp", sa.String(), nullable=True))

    suppliers_cols = {c["name"] for c in inspector.get_columns("suppliers")}
    if "whatsapp" not in suppliers_cols:
        op.add_column("suppliers", sa.Column("whatsapp", sa.String(), nullable=True))


def downgrade():
    op.drop_column("suppliers", "whatsapp")
    op.drop_column("employees", "whatsapp")
    op.drop_column("products", "sales_code")
