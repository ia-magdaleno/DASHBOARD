"""GPS routes: tables routes, route_stops, gps_pings (App Terminal + App Móvil D5)

Revision ID: 0007_gps_routes
Revises: 0006_item1_loyalty
Create Date: 2026-09-09
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_gps_routes"
down_revision = "0006_item1_loyalty"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def upgrade() -> None:
    if not _has_table("routes"):
        op.create_table(
            "routes",
            sa.Column("empresa_id",            sa.String(),   nullable=False),
            sa.Column("id",                    sa.String(),   nullable=False),
            sa.Column("sucursal_id",           sa.String(),   nullable=False),
            sa.Column("assigned_user",         sa.String(),   nullable=False),
            sa.Column("route_date",            sa.Date(),     nullable=False),
            sa.Column("status",                sa.String(),   nullable=False, server_default="planned"),
            sa.Column("deviation_threshold_m", sa.Numeric(9, 2), nullable=False, server_default="150"),
            sa.Column("created_at",            sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("created_by",            sa.String(),   nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("empresa_id", "id", name="uq_route_empresa_id"),
        )
        op.create_index("idx_routes_empresa_date", "routes", ["empresa_id", "route_date"])
        op.create_index("idx_routes_empresa_user", "routes", ["empresa_id", "assigned_user"])

    if not _has_table("route_stops"):
        op.create_table(
            "route_stops",
            sa.Column("empresa_id", sa.String(),  nullable=False),
            sa.Column("id",         sa.String(),  nullable=False),
            sa.Column("route_id",   sa.String(),  nullable=False),
            sa.Column("seq",        sa.Integer(), nullable=False),
            sa.Column("label",      sa.String(),  nullable=True),
            sa.Column("address",    sa.String(),  nullable=True),
            sa.Column("lat",        sa.Numeric(9, 6), nullable=False),
            sa.Column("lng",        sa.Numeric(9, 6), nullable=False),
            sa.Column("client_id",  sa.String(),  nullable=True),
            sa.Column("sale_id",    sa.String(),  nullable=True),
            sa.Column("status",     sa.String(),  nullable=False, server_default="pending"),
            sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.ForeignKeyConstraint(
                ["empresa_id", "route_id"],
                ["routes.empresa_id", "routes.id"],
                name="fk_rs_route_tenant",
            ),
        )
        op.create_index("idx_route_stops_route", "route_stops", ["empresa_id", "route_id"])

    if not _has_table("gps_pings"):
        op.create_table(
            "gps_pings",
            sa.Column("empresa_id",  sa.String(),  nullable=False),
            sa.Column("id",          sa.String(),  nullable=False),
            sa.Column("route_id",    sa.String(),  nullable=False),
            sa.Column("user_id",     sa.String(),  nullable=False),
            sa.Column("lat",         sa.Numeric(9, 6), nullable=False),
            sa.Column("lng",         sa.Numeric(9, 6), nullable=False),
            sa.Column("accuracy_m",  sa.Numeric(8, 2), nullable=True),
            sa.Column("speed_kmh",   sa.Numeric(6, 2), nullable=True),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deviation_m", sa.Numeric(9, 2), nullable=True),
            sa.Column("is_deviated", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.PrimaryKeyConstraint("id"),
            sa.ForeignKeyConstraint(
                ["empresa_id", "route_id"],
                ["routes.empresa_id", "routes.id"],
                name="fk_gps_route_tenant",
            ),
        )
        op.create_index("idx_gps_pings_route",    "gps_pings", ["empresa_id", "route_id"])
        op.create_index("idx_gps_pings_user",     "gps_pings", ["empresa_id", "user_id"])
        op.create_index("idx_gps_pings_recorded", "gps_pings", ["empresa_id", "recorded_at"])


def downgrade() -> None:
    if _has_table("gps_pings"):
        op.drop_table("gps_pings")
    if _has_table("route_stops"):
        op.drop_table("route_stops")
    if _has_table("routes"):
        op.drop_table("routes")
