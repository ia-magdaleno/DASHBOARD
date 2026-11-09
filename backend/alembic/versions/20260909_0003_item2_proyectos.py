"""item2: contractors, projects, commission ledger, sales.project_id

Revision ID: 0005_item2_proyectos
Revises: 0004_item3_vendedores
Create Date: 2026-09-09
"""

from alembic import op
import sqlalchemy as sa

revision = "0005_item2_proyectos"
down_revision = "0004_item3_vendedores"
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


def upgrade():
    # ── contractors ──────────────────────────────────────────────────────────
    if not _has_table("contractors"):
        op.create_table(
            "contractors",
            sa.Column("id",         sa.String, primary_key=True),
            sa.Column("empresa_id", sa.String, nullable=False),
            sa.Column("nombre",     sa.String, nullable=False),
            sa.Column("rfc",        sa.String, nullable=True),
            sa.Column("phone",      sa.String, nullable=True),
            sa.Column("email",      sa.String, nullable=True),
            sa.Column("notas",      sa.String, nullable=True),
            sa.Column("status",     sa.String, nullable=False, server_default="activo"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("idx_contractors_empresa", "contractors", ["empresa_id"])

    # ── projects ─────────────────────────────────────────────────────────────
    if not _has_table("projects"):
        op.create_table(
            "projects",
            sa.Column("id",              sa.String,  primary_key=True),
            sa.Column("empresa_id",      sa.String,  nullable=False),
            sa.Column("nombre",          sa.String,  nullable=False),
            sa.Column("client_id",       sa.String,  nullable=True),
            sa.Column("contractor_id",   sa.String,  nullable=True),
            sa.Column("commission_rate", sa.Numeric(7, 4), nullable=False, server_default="0.0000"),
            sa.Column("status",          sa.String,  nullable=False, server_default="activo"),
            sa.Column("notas",           sa.String,  nullable=True),
            sa.Column("created_at",      sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("closed_at",       sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("idx_projects_empresa_status", "projects", ["empresa_id", "status"])
        op.create_index("idx_projects_contractor",     "projects", ["empresa_id", "contractor_id"])

    # ── project_commission_ledger ─────────────────────────────────────────────
    if not _has_table("project_commission_ledger"):
        op.create_table(
            "project_commission_ledger",
            sa.Column("id",             sa.String,  primary_key=True),
            sa.Column("empresa_id",     sa.String,  nullable=False),
            sa.Column("project_id",     sa.String,  nullable=False),
            sa.Column("entry_type",     sa.String,  nullable=False),
            sa.Column("amount",         sa.Numeric(15, 4), nullable=False),
            sa.Column("sale_id",        sa.String,  nullable=True),
            sa.Column("descripcion",    sa.String,  nullable=True),
            sa.Column("registrado_por", sa.String,  nullable=True),
            sa.Column("created_at",     sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("idx_pcl_project", "project_commission_ledger", ["empresa_id", "project_id", "entry_type"])

    # ── sales.project_id ─────────────────────────────────────────────────────
    if not _has_column("sales", "project_id"):
        op.add_column("sales", sa.Column("project_id", sa.String, nullable=True))


def downgrade():
    if _has_column("sales", "project_id"):
        op.drop_column("sales", "project_id")

    if _has_table("project_commission_ledger"):
        op.drop_index("idx_pcl_project", table_name="project_commission_ledger")
        op.drop_table("project_commission_ledger")

    if _has_table("projects"):
        op.drop_index("idx_projects_contractor",     table_name="projects")
        op.drop_index("idx_projects_empresa_status", table_name="projects")
        op.drop_table("projects")

    if _has_table("contractors"):
        op.drop_index("idx_contractors_empresa", table_name="contractors")
        op.drop_table("contractors")
