"""R360: datos de seguimiento de Cuentas por Pagar (folio CxP, folio fiscal, fechas, expediente)

Revision ID: r360_ap_tracking
Revises: r360_reception_hub
Create Date: 2026-10-24

Añade a accounts_payable: folio, invoice_uuid, invoice_ref, issue_date, receipt_date,
expediente_id, concept y credit_days. En SQLite local las agrega `payables_tracking.ensure_ap_columns()`
al arrancar; esta migración es el camino para Postgres/Supabase y es idempotente.
"""
from alembic import op
import sqlalchemy as sa


revision = "r360_ap_tracking"
down_revision = "r360_reception_hub"
branch_labels = None
depends_on = None

_COLS = [
    ("folio", sa.String()),
    ("invoice_uuid", sa.String()),
    ("invoice_ref", sa.String()),
    ("issue_date", sa.DateTime(timezone=True)),
    ("receipt_date", sa.DateTime(timezone=True)),
    ("expediente_id", sa.String()),
    ("concept", sa.String()),
    ("credit_days", sa.Integer()),
]


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "accounts_payable" not in insp.get_table_names():
        return
    have = {c["name"] for c in insp.get_columns("accounts_payable")}
    for name, typ in _COLS:
        if name not in have:
            op.add_column("accounts_payable", sa.Column(name, typ, nullable=True))
    idx = {i["name"] for i in insp.get_indexes("accounts_payable")}
    for col in ("folio", "invoice_uuid", "expediente_id"):
        if f"ix_accounts_payable_{col}" not in idx:
            op.create_index(f"ix_accounts_payable_{col}", "accounts_payable", [col])


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "accounts_payable" not in insp.get_table_names():
        return
    have = {c["name"] for c in insp.get_columns("accounts_payable")}
    for col in ("folio", "invoice_uuid", "expediente_id"):
        try:
            op.drop_index(f"ix_accounts_payable_{col}", table_name="accounts_payable")
        except Exception:
            pass
    for name, _ in reversed(_COLS):
        if name in have:
            op.drop_column("accounts_payable", name)
