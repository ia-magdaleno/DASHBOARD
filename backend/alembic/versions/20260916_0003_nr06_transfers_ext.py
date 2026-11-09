"""nr06_transfers_ext: tabla transfers para el ciclo de vida completo de
traspasos físicos y virtuales entre bodegas/sucursales, con flujo de
autorización para traspasos inter-sucursal.

Los inventory_movements (TRASPASO_ENTRADA/SALIDA) siguen registrando el
movimiento real de stock. Esta tabla registra el ciclo: SOLICITADO →
AUTORIZADO → EN_TRANSITO → RECIBIDO, y permite rechazar/cancelar.

Tipos:
  VIRTUAL  — misma sucursal, entre bodegas (bodega general → bodega punto)
  FISICO   — distintas sucursales; requiere autorización de ambos admin

Revision ID: 20260916_0003
Revises: 20260916_0002
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa

revision = "20260916_0003"
down_revision = "20260916_0002"
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect as sa_inspect

    bind = op.get_bind()
    inspector = sa_inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "transfers" not in existing_tables:
        op.create_table(
            "transfers",
            sa.Column("empresa_id",          sa.String(), nullable=False, index=True),
            sa.Column("id",                  sa.String(), primary_key=True, index=True),
            sa.Column("folio",               sa.String(), nullable=True),
            # VIRTUAL (entre bodegas misma sucursal) | FISICO (inter-sucursal)
            sa.Column("tipo",                sa.String(), nullable=False, server_default="VIRTUAL"),
            # SOLICITADO | AUTORIZADO | EN_TRANSITO | RECIBIDO | RECHAZADO | CANCELADO
            sa.Column("status",              sa.String(), nullable=False, server_default="SOLICITADO"),
            sa.Column("sucursal_origen_id",  sa.String(), nullable=False),
            sa.Column("sucursal_destino_id", sa.String(), nullable=True),   # NULL = misma sucursal
            sa.Column("warehouse_origin_id", sa.String(), nullable=False),
            sa.Column("warehouse_dest_id",   sa.String(), nullable=False),
            sa.Column("requested_by",        sa.String(), nullable=False),
            sa.Column("authorized_by",       sa.String(), nullable=True),
            sa.Column("authorized_at",       sa.DateTime(timezone=True), nullable=True),
            sa.Column("received_by",         sa.String(), nullable=True),
            sa.Column("received_at",         sa.DateTime(timezone=True), nullable=True),
            sa.Column("notes",               sa.String(), nullable=True),
            sa.Column("rejection_reason",    sa.String(), nullable=True),
            sa.Column("is_synced",           sa.Boolean(), server_default="false", nullable=False),
            sa.Column("created_at",          sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at",          sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "idx_transfers_tenant_status",
            "transfers",
            ["empresa_id", "status", "tipo"],
        )
        op.create_index(
            "idx_transfers_origen",
            "transfers",
            ["empresa_id", "sucursal_origen_id", "status"],
        )

    if "transfer_items" not in existing_tables:
        op.create_table(
            "transfer_items",
            sa.Column("empresa_id",         sa.String(), nullable=False, index=True),
            sa.Column("id",                 sa.String(), primary_key=True, index=True),
            sa.Column("transfer_id",        sa.String(), nullable=False),
            sa.Column("product_id",         sa.String(), nullable=True),
            sa.Column("product_sku",        sa.String(), nullable=False),
            sa.Column("description",        sa.String(), nullable=False, server_default=""),
            sa.Column("quantity_requested", sa.Numeric(15, 4), nullable=False),
            # Se actualiza al confirmar envío / recepción
            sa.Column("quantity_sent",      sa.Numeric(15, 4), nullable=True),
            sa.Column("quantity_received",  sa.Numeric(15, 4), nullable=True),
        )
        op.create_index(
            "idx_transfer_items_transfer",
            "transfer_items",
            ["empresa_id", "transfer_id"],
        )


def downgrade():
    op.drop_index("idx_transfer_items_transfer", "transfer_items")
    op.drop_table("transfer_items")
    op.drop_index("idx_transfers_origen", "transfers")
    op.drop_index("idx_transfers_tenant_status", "transfers")
    op.drop_table("transfers")
