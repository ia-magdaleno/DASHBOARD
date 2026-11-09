"""CP2: cartera real (abonos) + CFDI individual por venta

Anade lo que el checkpoint 2 (Ventas, 16-oct) necesita y el esquema no tenia:

  * accounts_receivable: due_date, sale_folio, anticipo_aplicado
  * account_receivable_payments (nueva): historial de abonos de cartera
  * cfdi_documents (nueva): CFDI individual timbrado por venta
    (cfdi_batches sigue siendo el comprobante GLOBAL mensual del Contador)
  * sales.cfdi_document_id, clients.uso_cfdi

TODA la migracion es idempotente por introspeccion. Es obligatorio porque la
baseline 0001 materializa el esquema con `Base.metadata.create_all()`, o sea
que en una BD nueva (CI, dev limpio) estas tablas y columnas YA vienen creadas
por la baseline al leer models.py: si aqui hicieramos `create_table` a secas,
`alembic upgrade head` desde vacio se caeria con "table already exists".

Escenarios cubiertos:
  BD nueva (CI/dev)      -> la baseline ya lo creo todo -> esta revision no-op
  Supabase prod          -> stampeada en 0001 con el esquema viejo -> aplica
  SQLite local heredada  -> tabla vieja sin columnas -> aplica

Revision ID: 0002_cp2_cartera_cfdi
Revises: 0001_baseline
Create Date: 2026-09-08
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_cp2_cartera_cfdi"
down_revision = "0001_baseline"
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


def _add_column(table: str, column: sa.Column) -> None:
    if _has_table(table) and not _has_column(table, column.name):
        op.add_column(table, column)


def upgrade() -> None:
    # ── accounts_receivable: vencimiento, folio y anticipo ────────────────
    _add_column("accounts_receivable", sa.Column("due_date", sa.DateTime(timezone=True), nullable=True))
    _add_column("accounts_receivable", sa.Column("sale_folio", sa.String(), nullable=True))
    _add_column("accounts_receivable", sa.Column(
        "anticipo_aplicado", sa.Numeric(15, 4), nullable=False, server_default="0.0000"))

    # ── historial de abonos de cartera ────────────────────────────────────
    if not _has_table("account_receivable_payments"):
        op.create_table(
            "account_receivable_payments",
            sa.Column("empresa_id", sa.String(), nullable=False),
            sa.Column("sucursal_id", sa.String(), nullable=False, server_default="MATRIZ"),
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("ar_id", sa.String(), nullable=False),
            sa.Column("client_id", sa.String(), nullable=False),
            sa.Column("amount", sa.Numeric(15, 4), nullable=False),
            sa.Column("method", sa.String(), nullable=False, server_default="efectivo"),
            sa.Column("reference", sa.String(), nullable=True),
            sa.Column("applied_from", sa.String(), nullable=False, server_default="efectivo"),
            sa.Column("balance_after", sa.Numeric(15, 4), nullable=False, server_default="0.0000"),
            sa.Column("notes", sa.String(), nullable=True),
            sa.Column("created_by", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
            sa.Column("idempotency_key", sa.String(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("empresa_id", "idempotency_key",
                                name="uq_ar_payment_idempotency"),
        )
        op.create_index("idx_ar_payments_tenant_ar", "account_receivable_payments",
                        ["empresa_id", "ar_id"])
        op.create_index("idx_ar_payments_tenant_client", "account_receivable_payments",
                        ["empresa_id", "client_id"])

    # ── CFDI individual por venta ─────────────────────────────────────────
    if not _has_table("cfdi_documents"):
        op.create_table(
            "cfdi_documents",
            sa.Column("empresa_id", sa.String(), nullable=False),
            sa.Column("sucursal_id", sa.String(), nullable=False, server_default="MATRIZ"),
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("sale_id", sa.String(), nullable=False),
            sa.Column("tipo", sa.String(), nullable=False, server_default="I"),
            sa.Column("serie", sa.String(), nullable=True),
            sa.Column("folio", sa.String(), nullable=True),
            sa.Column("uuid_fiscal", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=False, server_default="BORRADOR"),
            sa.Column("uso_cfdi", sa.String(), nullable=True),
            sa.Column("forma_pago", sa.String(), nullable=True),
            sa.Column("metodo_pago", sa.String(), nullable=True),
            sa.Column("total", sa.Numeric(15, 4), nullable=False, server_default="0.0000"),
            sa.Column("receptor_rfc", sa.String(), nullable=True),
            sa.Column("receptor_nombre", sa.String(), nullable=True),
            sa.Column("provider", sa.String(), nullable=False, server_default="facturama"),
            sa.Column("environment", sa.String(), nullable=True),
            sa.Column("pac_id", sa.String(), nullable=True),
            sa.Column("xml", sa.Text(), nullable=True),
            sa.Column("pdf_base64", sa.Text(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("timbrado_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelado_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("motivo_cancelacion", sa.String(), nullable=True),
            sa.Column("created_by", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("empresa_id", "uuid_fiscal", name="uq_cfdi_uuid_fiscal"),
        )
        op.create_index("idx_cfdi_docs_tenant_sale", "cfdi_documents",
                        ["empresa_id", "sale_id"])
        op.create_index("idx_cfdi_docs_tenant_status", "cfdi_documents",
                        ["empresa_id", "status"])

    _add_column("sales", sa.Column("cfdi_document_id", sa.String(), nullable=True))
    _add_column("clients", sa.Column("uso_cfdi", sa.String(), nullable=True))


def downgrade() -> None:
    for table, column in (("clients", "uso_cfdi"), ("sales", "cfdi_document_id")):
        if _has_column(table, column):
            op.drop_column(table, column)
    for table in ("cfdi_documents", "account_receivable_payments"):
        if _has_table(table):
            op.drop_table(table)
    for column in ("anticipo_aplicado", "sale_folio", "due_date"):
        if _has_column("accounts_receivable", column):
            op.drop_column("accounts_receivable", column)
