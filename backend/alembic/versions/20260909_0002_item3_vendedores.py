"""Ítem 3: vendedores categorizados — seller_id en sales + 3 tablas nuevas

Cambios:
  * sales.seller_id (nullable String — FK lógica a employees.id)
  * Nueva tabla seller_catalog_permissions
  * Nueva tabla seller_commission_rules
  * Nueva tabla price_scale_auth_requests

Revision ID: 0004_item3_vendedores
Revises: 0003_item4_jerarquia
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_item3_vendedores"
down_revision = "0003_item4_jerarquia"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    return column in {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    # sales.seller_id
    if not _has_column("sales", "seller_id"):
        op.add_column("sales", sa.Column("seller_id", sa.String(), nullable=True))

    # seller_catalog_permissions
    if not _has_table("seller_catalog_permissions"):
        op.create_table(
            "seller_catalog_permissions",
            sa.Column("id",          sa.String(), primary_key=True),
            sa.Column("empresa_id",  sa.String(), nullable=False, index=True),
            sa.Column("employee_id", sa.String(), nullable=False, index=True),
            sa.Column("category",    sa.String(), nullable=False),
            sa.Column("can_sell",    sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_at",  sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("empresa_id", "employee_id", "category",
                                name="uq_seller_catalog_perm"),
        )

    # seller_commission_rules
    if not _has_table("seller_commission_rules"):
        op.create_table(
            "seller_commission_rules",
            sa.Column("id",          sa.String(), primary_key=True),
            sa.Column("empresa_id",  sa.String(), nullable=False, index=True),
            sa.Column("employee_id", sa.String(), nullable=False, index=True),
            sa.Column("scope",       sa.String(), nullable=False),
            sa.Column("scope_value", sa.String(), nullable=True),
            sa.Column("rate",        sa.Numeric(7, 4), nullable=False),
            sa.Column("created_at",  sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("empresa_id", "employee_id", "scope", "scope_value",
                                name="uq_seller_comm_rule"),
        )

    # price_scale_auth_requests
    if not _has_table("price_scale_auth_requests"):
        op.create_table(
            "price_scale_auth_requests",
            sa.Column("id",              sa.String(), primary_key=True),
            sa.Column("empresa_id",      sa.String(), nullable=False, index=True),
            sa.Column("session_token",   sa.String(), nullable=True, index=True),
            sa.Column("client_id",       sa.String(), nullable=True),
            sa.Column("requested_scale", sa.String(), nullable=False),
            sa.Column("current_scale",   sa.String(), nullable=True),
            sa.Column("requested_by",    sa.String(), nullable=False),
            sa.Column("status",          sa.String(), nullable=False, server_default="pending"),
            sa.Column("authorized_by",   sa.String(), nullable=True),
            sa.Column("expires_at",      sa.DateTime(timezone=True), nullable=True),
            sa.Column("notes",           sa.String(), nullable=True),
            sa.Column("created_at",      sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("idx_psar_empresa_status", "price_scale_auth_requests",
                        ["empresa_id", "status"])


def downgrade() -> None:
    if _has_table("price_scale_auth_requests"):
        op.drop_index("idx_psar_empresa_status", table_name="price_scale_auth_requests")
        op.drop_table("price_scale_auth_requests")
    if _has_table("seller_commission_rules"):
        op.drop_table("seller_commission_rules")
    if _has_table("seller_catalog_permissions"):
        op.drop_table("seller_catalog_permissions")
    if _has_column("sales", "seller_id"):
        op.drop_column("sales", "seller_id")
