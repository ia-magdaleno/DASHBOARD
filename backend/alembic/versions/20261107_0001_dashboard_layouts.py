"""Dashboard ERP: tablas dashboard_layouts y dashboard_layout_audit

Revision ID: dash_erp_layouts_01
Revises: r360_ap_tracking
Create Date: 2026-11-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "dash_erp_layouts_01"
down_revision = "r360_ap_tracking"
branch_labels = None
depends_on = None


def _json_type():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())
    jtype = _json_type()

    if "dashboard_layouts" not in existing:
        op.create_table(
            "dashboard_layouts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("empresa_id", sa.String(64), nullable=False, index=True),
            sa.Column("sucursal_id", sa.String(64), nullable=True, index=True),
            sa.Column("user_id", sa.String(64), nullable=True, index=True),
            sa.Column("role_id", sa.String(64), nullable=True, index=True),
            sa.Column("dashboard_key", sa.String(64), nullable=False, server_default="erp_main", index=True),
            sa.Column("name", sa.String(140), nullable=False, server_default="DASHBOARD EJECUTIVO"),
            sa.Column("scope_type", sa.String(24), nullable=False, server_default="user"),
            sa.Column("scope_id", sa.String(80), nullable=True),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false"), index=True),
            sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("layout_json", jtype, nullable=False),
            sa.Column("theme_json", jtype, nullable=True),
            sa.Column("filters_json", jtype, nullable=True),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_by", sa.String(64), nullable=True),
            sa.Column("updated_by", sa.String(64), nullable=True),
            sa.Column("created_at_utc", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at_utc", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
            sa.Column("deleted_at_utc", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("idx_dash_layouts_emp_scope", "dashboard_layouts", ["empresa_id", "dashboard_key", "scope_type", "is_default"])
        op.create_index("idx_dash_layouts_emp_user", "dashboard_layouts", ["empresa_id", "user_id", "dashboard_key"])
        op.create_index("idx_dash_layouts_emp_role", "dashboard_layouts", ["empresa_id", "role_id", "dashboard_key"])
        op.create_index("idx_dash_layouts_emp_branch", "dashboard_layouts", ["empresa_id", "sucursal_id", "dashboard_key"])

    if "dashboard_layout_audit" not in existing:
        op.create_table(
            "dashboard_layout_audit",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("empresa_id", sa.String(64), nullable=False, index=True),
            sa.Column("layout_id", sa.String(36), nullable=False, index=True),
            sa.Column("user_id", sa.String(64), nullable=True, index=True),
            sa.Column("action", sa.String(40), nullable=False),
            sa.Column("prev_version", sa.Integer(), nullable=True),
            sa.Column("new_version", sa.Integer(), nullable=True),
            sa.Column("ip_address", sa.String(64), nullable=True),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("created_at_utc", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
        )
        op.create_index("idx_dash_audit_emp_layout", "dashboard_layout_audit", ["empresa_id", "layout_id", "created_at_utc"])


def downgrade() -> None:
    op.drop_table("dashboard_layout_audit")
    op.drop_table("dashboard_layouts")
