"""don_antonio_7items: canal_venta/sucursal_entrega en sales; seller_id en CxC;
seller_commission_ledger; adhesion_contracts; comodato_items.

Revision ID: 20260914_0001
Revises: 20260912_0001
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa

revision = "20260914_0001"
down_revision = "20260912_0001"
branch_labels = None
depends_on = None


def upgrade():
    # Guard IF NOT EXISTS para toda esta revisión: la baseline (0001_baseline)
    # materializa el esquema completo via Base.metadata.create_all(), por lo
    # que columnas y tablas ya pueden existir cuando esta revisión corre.
    from sqlalchemy import inspect as sa_inspect

    bind = op.get_bind()
    inspector = sa_inspect(bind)
    existing_tables = set(inspector.get_table_names())

    # ── 1. sales: canal de venta y sucursal de entrega (items 3, 4, 5) ─────
    existing_sales_cols = {c["name"] for c in inspector.get_columns("sales")}
    sales_cols_to_add = []
    if "canal_venta" not in existing_sales_cols:
        sales_cols_to_add.append(sa.Column(
            "canal_venta",
            sa.String(),
            nullable=False,
            server_default="mostrador",
        ))
    if "sucursal_entrega_id" not in existing_sales_cols:
        sales_cols_to_add.append(sa.Column(
            "sucursal_entrega_id",
            sa.String(),
            nullable=True,
        ))
    if sales_cols_to_add:
        with op.batch_alter_table("sales") as batch_op:
            for col in sales_cols_to_add:
                batch_op.add_column(col)

    existing_sales_indexes = {i["name"] for i in inspector.get_indexes("sales")}
    if "idx_sales_canal_venta" not in existing_sales_indexes:
        op.create_index(
            "idx_sales_canal_venta",
            "sales",
            ["empresa_id", "canal_venta"],
        )

    # ── 2. accounts_receivable: seller_id para ligar cobro → vendedor ───────
    existing_ar_cols = {c["name"] for c in inspector.get_columns("accounts_receivable")}
    if "seller_id" not in existing_ar_cols:
        with op.batch_alter_table("accounts_receivable") as batch_op:
            batch_op.add_column(sa.Column("seller_id", sa.String(), nullable=True))

    # ── 3. seller_commission_ledger (item 2: comisiones sobre recaudo) ───────
    if "seller_commission_ledger" not in existing_tables:
        op.create_table(
            "seller_commission_ledger",
            sa.Column("id",           sa.String(), primary_key=True),
            sa.Column("empresa_id",   sa.String(), nullable=False, index=True),
            sa.Column("employee_id",  sa.String(), nullable=False, index=True),
            sa.Column("entry_type",   sa.String(), nullable=False),
            sa.Column("amount",       sa.Numeric(15, 4), nullable=False),
            sa.Column("sale_id",      sa.String(), nullable=True),
            sa.Column("ar_payment_id", sa.String(), nullable=True),
            sa.Column("base_amount",  sa.Numeric(15, 4), nullable=True),
            sa.Column("rate_applied", sa.Numeric(7, 4), nullable=True),
            sa.Column("descripcion",  sa.String(), nullable=True),
            sa.Column("registrado_por", sa.String(), nullable=True),
            sa.Column("created_at",   sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index(
            "idx_scl_employee",
            "seller_commission_ledger",
            ["empresa_id", "employee_id", "entry_type"],
        )

    # ── 4. adhesion_contracts (item 6) ───────────────────────────────────────
    if "adhesion_contracts" not in existing_tables:
        op.create_table(
            "adhesion_contracts",
            sa.Column("id",            sa.String(), primary_key=True),
            sa.Column("empresa_id",    sa.String(), nullable=False, index=True),
            sa.Column("sucursal_id",   sa.String(), nullable=False, server_default="MATRIZ"),
            sa.Column("client_id",     sa.String(), nullable=True),
            sa.Column("sale_id",       sa.String(), nullable=True),
            sa.Column("tipo",          sa.String(), nullable=False, server_default="venta"),
            sa.Column("version",       sa.String(), nullable=True),
            sa.Column("contenido",     sa.Text(), nullable=True),
            sa.Column("firmado_cliente", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("firma_fecha",   sa.DateTime(timezone=True), nullable=True),
            sa.Column("firma_medio",   sa.String(), nullable=True),
            sa.Column("status",        sa.String(), nullable=False, server_default="borrador"),
            sa.Column("notas",         sa.String(), nullable=True),
            sa.Column("created_by",    sa.String(), nullable=True),
            sa.Column("created_at",    sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at",    sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "idx_adhesion_tenant_client",
            "adhesion_contracts",
            ["empresa_id", "client_id"],
        )

    # ── 5. comodato_items (item 7) ────────────────────────────────────────────
    if "comodato_items" not in existing_tables:
        op.create_table(
            "comodato_items",
            sa.Column("id",             sa.String(), primary_key=True),
            sa.Column("empresa_id",     sa.String(), nullable=False, index=True),
            sa.Column("sucursal_id",    sa.String(), nullable=False, server_default="MATRIZ"),
            sa.Column("tipo",           sa.String(), nullable=False),
            sa.Column("product_id",     sa.String(), nullable=True),
            sa.Column("descripcion",    sa.String(), nullable=False),
            sa.Column("cantidad",       sa.Numeric(15, 4), nullable=False, server_default="1"),
            sa.Column("client_id",      sa.String(), nullable=True),
            sa.Column("sale_id",        sa.String(), nullable=True),
            sa.Column("adhesion_contract_id", sa.String(), nullable=True),
            sa.Column("folio",          sa.String(), nullable=True),
            sa.Column("fecha_entrega",  sa.DateTime(timezone=True), nullable=True),
            sa.Column("fecha_devolucion_pactada", sa.DateTime(timezone=True), nullable=True),
            sa.Column("fecha_devolucion_real",    sa.DateTime(timezone=True), nullable=True),
            sa.Column("condicion_entrega",  sa.String(), nullable=True),
            sa.Column("condicion_retorno",  sa.String(), nullable=True),
            sa.Column("valor_garantia",     sa.Numeric(15, 4), nullable=True),
            sa.Column("precio_venta_pactado", sa.Numeric(15, 4), nullable=True),
            sa.Column("status",         sa.String(), nullable=False, server_default="activo"),
            sa.Column("notas",          sa.String(), nullable=True),
            sa.Column("created_by",     sa.String(), nullable=True),
            sa.Column("created_at",     sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at",     sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "idx_comodato_tenant_status",
            "comodato_items",
            ["empresa_id", "status", "tipo"],
        )
        op.create_index(
            "idx_comodato_client",
            "comodato_items",
            ["empresa_id", "client_id"],
        )


def downgrade():
    op.drop_table("comodato_items")
    op.drop_table("adhesion_contracts")
    op.drop_index("idx_scl_employee", "seller_commission_ledger")
    op.drop_table("seller_commission_ledger")
    with op.batch_alter_table("accounts_receivable") as batch_op:
        batch_op.drop_column("seller_id")
    op.drop_index("idx_sales_canal_venta", "sales")
    with op.batch_alter_table("sales") as batch_op:
        batch_op.drop_column("sucursal_entrega_id")
        batch_op.drop_column("canal_venta")
