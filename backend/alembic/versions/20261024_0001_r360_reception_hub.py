"""R360: Recepción de Mercancía 360° (expedientes, archivos y gastos operativos)

Revision ID: r360_reception_hub
Revises: rh04_attn_auth
Create Date: 2026-10-24

Crea reception_expedientes, reception_files y operating_expenses.
En modo local/SQLite las tablas las crea `Base.metadata.create_all()`; esta
migración es el camino para Postgres/Supabase y es idempotente (si la tabla ya
existe, no hace nada).
"""
from alembic import op
import sqlalchemy as sa


revision = "r360_reception_hub"
down_revision = "rh04_attn_auth"
branch_labels = None
depends_on = None


def _num(p=15, s=4):
    return sa.Numeric(p, s)


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())

    if "reception_expedientes" not in existing:
        op.create_table(
            "reception_expedientes",
            sa.Column("empresa_id", sa.String(), nullable=False, index=True),
            sa.Column("sucursal_id", sa.String(), nullable=False, server_default="MATRIZ", index=True),
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("folio", sa.String(), nullable=False),
            sa.Column("idempotency_key", sa.String(), nullable=False),
            sa.Column("origin_type", sa.String(), nullable=False, server_default="OC"),
            sa.Column("po_folio", sa.String(), nullable=True),
            sa.Column("purchase_order_id", sa.String(), nullable=True),
            sa.Column("purchase_receipt_id", sa.String(), nullable=True),
            sa.Column("purchase_receipt_folio", sa.String(), nullable=True),
            sa.Column("supplier_id", sa.String(), nullable=True),
            sa.Column("supplier_name", sa.String(), nullable=False, server_default=""),
            sa.Column("supplier_rfc", sa.String(), nullable=True),
            sa.Column("warehouse_id", sa.String(), nullable=False),
            sa.Column("invoice_uuid", sa.String(), nullable=True, index=True),
            sa.Column("invoice_serie", sa.String(), nullable=True),
            sa.Column("invoice_folio", sa.String(), nullable=True),
            sa.Column("invoice_date", sa.String(), nullable=True),
            sa.Column("payment_condition", sa.String(), nullable=False, server_default="CREDITO"),
            sa.Column("subtotal", _num(), nullable=False, server_default="0.0000"),
            sa.Column("tax_amount", _num(), nullable=False, server_default="0.0000"),
            sa.Column("total", _num(), nullable=False, server_default="0.0000"),
            sa.Column("payable_total", _num(), nullable=False, server_default="0.0000"),
            sa.Column("freight_condition", sa.String(), nullable=True),
            sa.Column("freight_total", _num(), nullable=False, server_default="0.0000"),
            sa.Column("freight_pct", _num(), nullable=False, server_default="0.0000"),
            sa.Column("prorate_method", sa.String(), nullable=True),
            sa.Column("physical_state", sa.String(), nullable=False, server_default="SELLADA"),
            sa.Column("status", sa.String(), nullable=False, server_default="COMPLETA"),
            sa.Column("incident_action", sa.String(), nullable=True),
            sa.Column("incident_status", sa.String(), nullable=False, server_default="NINGUNA"),
            sa.Column("disputed_amount", _num(), nullable=False, server_default="0.0000"),
            sa.Column("rating_avg", _num(6, 2), nullable=False, server_default="0.00"),
            sa.Column("accounts_payable_id", sa.String(), nullable=True),
            sa.Column("freight_expense_id", sa.String(), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=True),
            sa.Column("created_by", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("empresa_id", "folio", name="uq_reception_exp_folio"),
            sa.UniqueConstraint("empresa_id", "idempotency_key", name="uq_reception_exp_idem"),
        )
        op.create_index("idx_reception_exp_empresa_date", "reception_expedientes", ["empresa_id", "created_at"])
        op.create_index("idx_reception_exp_supplier", "reception_expedientes", ["empresa_id", "supplier_id"])

    if "reception_files" not in existing:
        op.create_table(
            "reception_files",
            sa.Column("empresa_id", sa.String(), nullable=False, index=True),
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("expediente_id", sa.String(), nullable=False, index=True),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("item_ref", sa.String(), nullable=True),
            sa.Column("filename", sa.String(), nullable=False, server_default="archivo"),
            sa.Column("mime", sa.String(), nullable=False, server_default="application/octet-stream"),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("content_b64", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("idx_reception_files_exp", "reception_files", ["empresa_id", "expediente_id"])

    if "operating_expenses" not in existing:
        op.create_table(
            "operating_expenses",
            sa.Column("empresa_id", sa.String(), nullable=False, index=True),
            sa.Column("sucursal_id", sa.String(), nullable=False, server_default="MATRIZ", index=True),
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("folio", sa.String(), nullable=False),
            sa.Column("category", sa.String(), nullable=False, server_default="FLETE_COMPRAS"),
            sa.Column("concept", sa.String(), nullable=False, server_default=""),
            sa.Column("amount", _num(), nullable=False, server_default="0.0000"),
            sa.Column("capitalized", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("supplier_name", sa.String(), nullable=True),
            sa.Column("supplier_rfc", sa.String(), nullable=True),
            sa.Column("doc_uuid", sa.String(), nullable=True),
            sa.Column("doc_folio", sa.String(), nullable=True),
            sa.Column("payment_condition", sa.String(), nullable=False, server_default="CONTADO"),
            sa.Column("status", sa.String(), nullable=False, server_default="PAGADO"),
            sa.Column("expediente_id", sa.String(), nullable=True, index=True),
            sa.Column("accounts_payable_id", sa.String(), nullable=True),
            sa.Column("detail", sa.JSON(), nullable=True),
            sa.Column("created_by", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("empresa_id", "folio", name="uq_operating_expense_folio"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    for t in ("operating_expenses", "reception_files", "reception_expedientes"):
        if t in existing:
            op.drop_table(t)
