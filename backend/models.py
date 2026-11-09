import uuid
from decimal import Decimal
from sqlalchemy import Column, String, Numeric, DateTime, Date, Boolean, Index, text, JSON, UniqueConstraint, ForeignKey, ForeignKeyConstraint, Integer, Float, and_, Text
from sqlalchemy import false as sa_false
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship, foreign
from sqlalchemy.sql import func
from database import Base


# =============================================================================
# FASE 5.1 — CORE BASE ENTERPRISE MODELS  (Fix Forense 4.2 / Cierre Real)
# =============================================================================


class Company(Base):
    __tablename__ = "companies"
    id         = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    name       = Column(String, nullable=False)
    rfc        = Column(String, nullable=True)
    status     = Column(String, nullable=False, server_default="ACTIVE")
    plan_name  = Column(String, nullable=False, server_default="SAAS_BASE")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"
    empresa_id       = Column(String, index=True, nullable=False)
    sucursal_id      = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id               = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    username         = Column(String, index=True, nullable=False)
    hashed_password  = Column(String, nullable=False)
    role             = Column(String, nullable=False, server_default="CAJERO")
    pin_hash         = Column(String, nullable=True)
    allowed_branches = Column(JSON, nullable=True)
    status           = Column(String, nullable=False, server_default="ACTIVE")
    created_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    @property
    def usuario_id(self):       return self.username
    @usuario_id.setter
    def usuario_id(self, v):    self.username = v

    @property
    def password_hash(self):    return self.hashed_password
    @password_hash.setter
    def password_hash(self, v): self.hashed_password = v


class AuditLog(Base):
    __tablename__ = "audit_log"
    empresa_id  = Column(String, index=True, nullable=False)
    sucursal_id = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id          = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    user_id     = Column(String, index=True, nullable=False)
    action      = Column(String, nullable=False)
    severity    = Column(String, nullable=False, server_default="INFO")  # INFO|WARNING|CRITICAL|SECURITY
    details     = Column(JSON, nullable=True)
    ip_address  = Column(String, nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ---------------------------------------------------------------------------
# CATALOGO
# ---------------------------------------------------------------------------

class Product(Base):
    __tablename__ = "products"
    empresa_id        = Column(String, index=True, nullable=False)
    sucursal_id       = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id                = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    sku               = Column(String, index=True, nullable=False)
    barcode           = Column(String, nullable=True)
    sales_code        = Column(String, nullable=True)
    name              = Column(String, nullable=False, server_default="")
    description       = Column(String, nullable=False, server_default="")
    purchase_unit     = Column(String, nullable=False, server_default="CAJA")
    sale_unit         = Column(String, nullable=False, server_default="PIEZA")
    conversion_factor = Column(Numeric(15, 4), nullable=False, server_default="1.0000")
    average_cost      = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    price             = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    stock             = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    stock_minimo      = Column(Numeric(15, 4), nullable=True)                             # M-2: umbral de alerta; NULL = sin alerta
    meta_data         = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)   # JSONB en Postgres (alineado con migracion); JSON generico en otros dialectos (SQLite local) para que create_all() no truene
    is_synced         = Column(Boolean, server_default="false", nullable=False)
    foto_url          = Column(String, nullable=True)

    sale_items   = relationship("SaleItem",          back_populates="product")
    price_scales = relationship("ProductPriceScale", back_populates="product", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_product_tenant_sku", "empresa_id", "sku", unique=True),
        UniqueConstraint("empresa_id", "id", name="uq_product_empresa_id"),
    )


class ProductPriceScale(Base):
    __tablename__ = "product_price_scales"
    empresa_id = Column(String, index=True, nullable=False)
    id         = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    product_id = Column(String, nullable=False)
    scale_name = Column(String, nullable=False)         # PUBLICO|MAYOREO|CONSTRUCTOR|GOBIERNO
    margin     = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    price      = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    product = relationship("Product", back_populates="price_scales")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "product_id"],
            ["products.empresa_id", "products.id"],
            name="fk_price_scales_product",
        ),
        UniqueConstraint("empresa_id", "product_id", "scale_name", name="uq_product_price_scale"),
    )


# ---------------------------------------------------------------------------
# KARDEX Y MULTIBODEGA
# ---------------------------------------------------------------------------

class Warehouse(Base):
    __tablename__ = "warehouses"
    empresa_id  = Column(String, index=True, nullable=False)
    sucursal_id = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id          = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String, nullable=False)
    is_transit  = Column(Boolean, server_default="false", nullable=False)

    __table_args__ = (
        UniqueConstraint("empresa_id", "id", name="uq_warehouse_empresa_id"),
    )


class WarehouseStock(Base):
    """Fuente de verdad de existencias por bodega (fix C2, auditoria
    2026-08-03). Product.stock se mantiene como total cacheado (suma de
    todas las bodegas del producto) para no romper a los consumidores que
    ya lo leen directo (frontend, search_products, etc.); warehouse_stock
    es la tabla que decide de que bodega se descuenta o a cual se traspasa.
    """
    __tablename__ = "warehouse_stock"
    empresa_id   = Column(String, index=True, nullable=False)
    id           = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    product_id   = Column(String, nullable=False)
    warehouse_id = Column(String, nullable=False)
    quantity     = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "product_id"],
            ["products.empresa_id", "products.id"],
            name="fk_warehouse_stock_product_tenant",
        ),
        ForeignKeyConstraint(
            ["empresa_id", "warehouse_id"],
            ["warehouses.empresa_id", "warehouses.id"],
            name="fk_warehouse_stock_warehouse_tenant",
        ),
        UniqueConstraint("empresa_id", "product_id", "warehouse_id", name="uq_warehouse_stock_product_warehouse"),
    )


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"
    empresa_id         = Column(String, index=True, nullable=False)
    sucursal_id        = Column(String, index=True, nullable=False)
    id                 = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    product_id         = Column(String, nullable=False)
    warehouse_id       = Column(String, nullable=False)
    movement_type      = Column(String, nullable=False)  # COMPRA|VENTA|MERMA|AJUSTE|TRASPASO_*
    quantity           = Column(Numeric(15, 4), nullable=False)
    unit_cost          = Column(Numeric(15, 4), nullable=False)
    total_freight_cost = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    reference_type     = Column(String, nullable=False)  # TICKET_VENTA|FACTURA_COMPRA|TRASPASO
    reference_id       = Column(String, nullable=False)
    idempotency_key    = Column(String, nullable=False)  # Obligatorio — protege duplicados
    reason             = Column(String, nullable=True)
    authorized_by_id   = Column(String, nullable=True)
    created_at         = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "product_id"],
            ["products.empresa_id", "products.id"],
            name="fk_inventory_product_tenant",
        ),
        ForeignKeyConstraint(
            ["empresa_id", "warehouse_id"],
            ["warehouses.empresa_id", "warehouses.id"],
            name="fk_inventory_warehouse_tenant",
        ),
        UniqueConstraint("empresa_id", "idempotency_key", name="uq_inventory_movement_idempotency"),
    )


# ---------------------------------------------------------------------------
# RESGUARDOS (SAFEKEEPING) Y ENTREGAS DE KARDEX
#
# Restaurados 2026-08-10: crud.py/schemas.py/main.py ya referenciaban
# models.SafekeptItem/models.KardexDelivery desde el fix C1 (2026-08-03,
# ver hallazgo C3 en el docstring de crud.create_sale) pero la clase ORM
# nunca se recreo tras el refactor -- causaba 500 en /api/kardex ("no such
# table"/AttributeError segun dialecto). Columnas alineadas con lo que la
# migracion 8276e9755f9a ya asumia (ALTER sobre estas tablas: id/FKs a
# String, empresa_id/sucursal_id/is_synced agregados) para no reabrir ese
# hallazgo -- ver migracion nueva que crea las tablas con este mismo
# esquema para entornos que solo corren `alembic upgrade head` (no
# bootstrap_db.py/create_all).
# ---------------------------------------------------------------------------

class SafekeptItem(Base):
    __tablename__ = "safekept_items"
    empresa_id          = Column(String, index=True, nullable=False)
    sucursal_id         = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id                  = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    sale_id             = Column(String, nullable=False)
    product_sku         = Column(String, nullable=False)
    quantity_ordered    = Column(Numeric(15, 4), nullable=False)
    quantity_delivered  = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    # Estados (D.1): SOLICITADO -> ETA_CONFIRMADA -> EN_INVENTARIO -> ENTREGADO
    #                cualquiera -> POR_VENCER -> (ETA_CONFIRMADA | AJUSTADO)
    # Legado tolerado: 'Pendiente' (== SOLICITADO) y 'Entregado' (== ENTREGADO).
    status              = Column(String, nullable=False, server_default="SOLICITADO")
    # T-4b: de dónde nace el resguardo. sin_stock = venta sin existencia;
    # pago_sin_entrega = pagó y no se llevó; apartado = apartado explícito.
    origen              = Column(String, nullable=False, server_default="sin_stock")
    # Costo diferido del renglón no entregado (average_cost * cantidad al
    # momento de la venta). El CMV/salida de inventario se reconoce al
    # entregar, no al vender (ver crud.create_sale / create_kardex_delivery).
    costo_estimado      = Column(Numeric(15, 4), nullable=True)
    eta_date            = Column(String, nullable=True)   # 'YYYY-MM-DD' — la fija Compras/Admin
    expira_at           = Column(DateTime(timezone=True), nullable=True)  # límite de resguardo (N-05)
    is_synced           = Column(Boolean, server_default="false", nullable=False)
    created_at          = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    deliveries = relationship("KardexDelivery", back_populates="safekept_item", cascade="all, delete-orphan")
    # viewonly: product_sku no es FK real (legacy, ver SaleItem.product_sku);
    # se resuelve por el mismo indice unico tenant+sku que ya usa Product.
    product = relationship(
        Product,
        primaryjoin=lambda: and_(
            foreign(SafekeptItem.empresa_id) == Product.empresa_id,
            foreign(SafekeptItem.product_sku) == Product.sku,
        ),
        viewonly=True,
        uselist=False,
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "sale_id"],
            ["sales.empresa_id", "sales.id"],
            name="fk_safekept_items_sale_tenant",
        ),
        UniqueConstraint("empresa_id", "id", name="uq_safekept_item_empresa_id"),
    )


class KardexDelivery(Base):
    __tablename__ = "kardex_deliveries"
    empresa_id          = Column(String, index=True, nullable=False)
    sucursal_id         = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id                  = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    safekept_item_id    = Column(String, nullable=False)
    quantity_delivered  = Column(Numeric(15, 4), nullable=False)
    notes               = Column(String, nullable=True)
    is_synced           = Column(Boolean, server_default="false", nullable=False)
    delivery_date       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    safekept_item = relationship("SafekeptItem", back_populates="deliveries")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "safekept_item_id"],
            ["safekept_items.empresa_id", "safekept_items.id"],
            name="fk_kardex_delivery_safekept_tenant",
        ),
    )


# ---------------------------------------------------------------------------
# FINANZAS Y CRM
# ---------------------------------------------------------------------------

# NOTA (auditoria 2026-08-03, fix C1): 'Customer'/'customers' no se usa en
# ningun lugar de main.py/crud.py fuera de esta definicion — el CRM real de
# clientes es la clase Client/tabla 'clients' mas abajo. Sale.client_id y
# AccountsReceivable.client_id apuntaban por error a 'customers' (siempre
# vacia) en vez de a 'clients'; se corrigio en este mismo commit. Se deja
# Customer sin tocar (no rompe nada dejarla) pero es candidata a eliminarse
# en una limpieza futura — no se borra aqui para no ampliar el alcance de
# este fix.
class Customer(Base):
    __tablename__ = "customers"
    empresa_id           = Column(String, index=True, nullable=False)
    id                   = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    rfc                  = Column(String, nullable=True)
    commercial_name      = Column(String, nullable=False)
    credit_limit         = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    current_debt         = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    assigned_price_scale = Column(String, nullable=False, server_default="PUBLICO")

    __table_args__ = (
        UniqueConstraint("empresa_id", "id", name="uq_customer_empresa_id"),
    )


class CashShift(Base):
    __tablename__ = "cash_shifts"
    empresa_id       = Column(String, index=True, nullable=False)
    sucursal_id      = Column(String, index=True, nullable=False)
    id               = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    opened_by_id     = Column(String, nullable=False)
    closed_by_id     = Column(String, nullable=True)
    opening_amount   = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    expected_amount  = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    reported_amount  = Column(Numeric(15, 4), nullable=True)
    difference       = Column(Numeric(15, 4), nullable=True)
    status           = Column(String, nullable=False, server_default="OPEN")  # OPEN|CLOSED|DISCREPANCY
    authorized_by_id = Column(String, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ---------------------------------------------------------------------------
# VENTAS (LEGACY COMPATIBLE)
# ---------------------------------------------------------------------------

class Sale(Base):
    __tablename__ = "sales"
    empresa_id      = Column(String, index=True, nullable=False)
    sucursal_id     = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id              = Column(String, primary_key=True, index=True, unique=True, default=lambda: str(uuid.uuid4()))
    client_id       = Column(String, nullable=False)
    total           = Column(Numeric(15, 4), nullable=False)
    payment_method  = Column(String, nullable=False)
    amount_paid     = Column(Numeric(15, 4), nullable=False)
    change_returned = Column(Numeric(15, 4), nullable=False)
    is_cfdi         = Column(Boolean, server_default="false", nullable=False)
    discount        = Column(Numeric(15, 4), server_default="0.0000", nullable=False)
    advance         = Column(Numeric(15, 4), server_default="0.0000", nullable=False)
    is_safekept     = Column(Boolean, server_default="false", nullable=False)
    status          = Column(String, server_default="completed", nullable=False)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Fix A3 (auditoria 2026-08-03): checkout directo (/api/sales) no tenia
    # ninguna proteccion de idempotencia -- a diferencia de /api/sync/offline-sales
    # (que reutiliza un id UUID generado en el cliente como PK, ver
    # main.sync_offline_sales), aqui el id de Sale siempre se genera en el
    # servidor (default=uuid4 arriba), asi que un doble-submit real (doble
    # click, reintento de red, service worker reintentando) crea DOS ventas
    # distintas con DOS ids distintos: nada las detecta como duplicadas.
    # idempotency_key es opcional (nullable) para no romper llamadas viejas
    # sin frontend actualizado, pero cuando el cliente SI lo manda, el
    # UNIQUE constraint de abajo hace que un reintento con la misma key
    # tronce IntegrityError en vez de crear una segunda venta -- el
    # endpoint la atrapa y devuelve la venta original (ver main.create_sale).
    idempotency_key  = Column(String, nullable=True)
    # C-03: detalles del metodo de pago (JSON serializado):
    # cheque={banco,girador,numero,monto}, transferencia={referencia,banco_origen,estatus},
    # tarjeta_credito/debito={aprobacion,recibo,digitos,fecha_hora}
    payment_details  = Column(String, nullable=True)  # JSON string; String sin limite = TEXT
    # CP2: CFDI individual timbrado sobre esta venta (ver models.CfdiDocument).
    # `is_cfdi` de arriba dice "esta venta causa IVA / lleva comprobante";
    # esto dice "ya se timbro, y este es el comprobante".
    cfdi_document_id = Column(String, nullable=True)
    seller_id        = Column(String, nullable=True)   # FK employees.id — ítem 3
    project_id       = Column(String, nullable=True)   # FK projects.id  — ítem 2
    # NR-04 (Art. 29-A CFF): folio secuencial legible ("315") y enlace al padre
    # en sub-facturas de split efectivo ("315-A", "315-B", …).
    folio            = Column(String, nullable=True, index=True)
    parent_sale_id   = Column(String, nullable=True)
    # DA-7items: canal de origen y sucursal de entrega (ventas remotas / caja).
    # canal_venta: mostrador | caja | telefono | whatsapp | facebook | web
    # sucursal_entrega_id: rama que entrega (distinta de la que vende en ventas remotas).
    canal_venta         = Column(String, nullable=False, server_default="mostrador")
    sucursal_entrega_id = Column(String, nullable=True)
    # E-06a: saldo_favor del cliente aplicado como pago parcial/total en esta venta.
    saldo_favor_applied = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    items  = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")
    client = relationship("Client")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "client_id"],
            ["clients.empresa_id", "clients.id"],
            name="fk_sales_client_tenant",
        ),
        Index(
            "idx_sales_tenant_date_completed",
            "empresa_id", "sucursal_id", "created_at",
            postgresql_where=text("status = 'completed'"),
        ),
        UniqueConstraint("empresa_id", "id", name="uq_sale_empresa_id"),
        # Postgres trata cada NULL como distinto en un UNIQUE, asi que ventas
        # sin idempotency_key (clientes viejos) nunca chocan entre si -- solo
        # se bloquea el reintento real con la MISMA key no-nula.
        UniqueConstraint("empresa_id", "idempotency_key", name="uq_sale_idempotency"),
        # NR-04: búsqueda de folio por empresa
        Index("idx_sales_folio_empresa", "empresa_id", "folio"),
        # DA-7items: filtros por canal de venta por empresa
        Index("idx_sales_canal_venta", "empresa_id", "canal_venta"),
    )


class SaleItem(Base):
    __tablename__ = "sale_items"
    empresa_id        = Column(String, index=True, nullable=False)
    sucursal_id       = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id                = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    sale_id           = Column(String, nullable=False)
    product_sku       = Column(String, nullable=False)   # Preservado para busqueda legacy
    product_id        = Column(String, nullable=True)    # Nullable para líneas de servicio NR-04
    quantity          = Column(Numeric(15, 4), nullable=False)
    price             = Column(Numeric(15, 4), nullable=False)
    subtotal          = Column(Numeric(15, 4), nullable=False)
    returned_quantity = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    is_synced = Column(Boolean, server_default="false", nullable=False)

    sale    = relationship("Sale",    back_populates="items")
    product = relationship("Product", back_populates="sale_items")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "sale_id"],
            ["sales.empresa_id", "sales.id"],
            name="fk_sale_items_sale_tenant",
        ),
        ForeignKeyConstraint(
            ["empresa_id", "product_id"],
            ["products.empresa_id", "products.id"],
            name="fk_sale_items_product_tenant",
        ),
    )


# ── NR-01: cabecera de devolución cross-sucursal ────────────────────────────
class SaleReturn(Base):
    """Registra la cabecera de cada devolución (cross-branch o misma sucursal).
    Los movimientos de inventario siguen en InventoryMovement; el asiento en AccountingEntry.
    """
    __tablename__ = "sale_returns"
    empresa_id          = Column(String, index=True, nullable=False)
    id                  = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    sale_id             = Column(String, nullable=False, index=True)
    sucursal_origen     = Column(String, nullable=False)     # sucursal donde se hizo la venta
    sucursal_restock    = Column(String, nullable=False)     # sucursal donde regresa el producto
    estado              = Column(String, nullable=False, server_default="PENDIENTE")  # PENDIENTE | APROBADA | RECHAZADA
    authorized_by       = Column(String, nullable=True)      # user_id del gerente/admin que aprueba
    authorized_at       = Column(String, nullable=True)
    notes               = Column(String, nullable=True)
    idempotency_key     = Column(String, nullable=True, unique=True)
    created_by          = Column(String, nullable=True)
    created_at          = Column(String, nullable=True)
    accounting_entry_id = Column(String, nullable=True)

    __table_args__ = (
        Index("idx_sale_returns_empresa_sale", "empresa_id", "sale_id"),
    )


class AccountsReceivable(Base):
    __tablename__ = "accounts_receivable"
    empresa_id      = Column(String, index=True, nullable=False)
    sucursal_id     = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id              = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    client_id       = Column(String, nullable=False)
    sale_id         = Column(String, nullable=True)   # NULL para saldos de apertura
    original_amount = Column(Numeric(15, 4), nullable=False)
    current_balance = Column(Numeric(15, 4), nullable=False)
    status          = Column(String, nullable=False, server_default="Pendiente")  # Pendiente|Liquidado
    amount_due      = Column(Numeric(15, 4), nullable=True)
    is_paid         = Column(Boolean, server_default="false", nullable=False)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # ── CP2 · cartera real ────────────────────────────────────────────────
    # Fecha de vencimiento del credito = fecha de venta + client.dias_credito.
    # Es lo que alimenta el reporte de antiguedad de saldos y la columna
    # "Dias Vencido" que la pantalla de Cuentas por Cobrar ya pintaba contra
    # un campo que el backend nunca mandaba.
    due_date          = Column(DateTime(timezone=True), nullable=True)
    # Folio legible de la venta origen (para no obligar al front a un join).
    sale_folio        = Column(String, nullable=True)
    # Anticipo entregado en el momento de la venta. Se refleja ademas como el
    # primer AccountReceivablePayment (applied_from='anticipo') para que el
    # historial cuente la historia completa desde el renglon uno.
    anticipo_aplicado = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    # DA-7items: vendedor que generó la venta — copiado de Sale.seller_id al
    # crear la CxC para evitar el JOIN en cada cálculo de comisión por recaudo.
    seller_id         = Column(String, nullable=True)

    client   = relationship("Client")
    payments = relationship(
        "AccountReceivablePayment",
        back_populates="account",
        cascade="all, delete-orphan",
        order_by="AccountReceivablePayment.created_at",
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "client_id"],
            ["clients.empresa_id", "clients.id"],
            name="fk_cxc_client_tenant",
        ),
        ForeignKeyConstraint(
            ["empresa_id", "sale_id"],
            ["sales.empresa_id", "sales.id"],
            name="fk_cxc_sale_tenant",
        ),
        # PostgreSQL exige un unique que cubra exactamente las columnas
        # referenciadas por la FK compuesta de account_receivable_payments
        # (empresa_id, ar_id). SQLite no lo valida (ver D-2 del plan).
        UniqueConstraint("empresa_id", "id", name="uq_cxc_empresa_id"),
        Index("idx_cxc_tenant_status_due", "empresa_id", "status", "due_date"),
    )


class AccountReceivablePayment(Base):
    """Abono a una cuenta por cobrar — historial completo de la cartera.

    Antes de CP2 `crud.pay_account_receivable` solo restaba de
    `current_balance`: no quedaba rastro de cuanto se abono, cuando, por que
    medio ni quien lo recibio, asi que la cartera no era auditable ni se podia
    reconstruir un estado de cuenta.

    `applied_from` distingue el origen del dinero, que cambia el asiento
    contable que genera el abono:
      efectivo    — el cliente paga en caja      → Debe 102.01 Caja
      saldo_favor — se aplica su saldo a favor   → Debe 205.01 Anticipos
      anticipo    — enganche de la venta misma   → Debe 102.01 Caja
    """
    __tablename__ = "account_receivable_payments"

    empresa_id   = Column(String, index=True, nullable=False)
    sucursal_id  = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id           = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    ar_id        = Column(String, nullable=False, index=True)
    client_id    = Column(String, nullable=False, index=True)

    amount       = Column(Numeric(15, 4), nullable=False)
    # Forma de pago del abono (catalogo del tenant: efectivo, transferencia,
    # tarjeta, cheque...). Texto libre validado contra catalog.formas_pago.
    method       = Column(String, nullable=False, server_default="efectivo")
    reference    = Column(String, nullable=True)   # folio de transferencia / autorizacion
    applied_from = Column(String, nullable=False, server_default="efectivo")  # efectivo|saldo_favor|anticipo

    # Saldo de la cuenta DESPUES de aplicar este abono — congelado al momento
    # del pago para que el estado de cuenta sea reproducible aunque despues
    # se corrija algo aguas arriba.
    balance_after = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    notes        = Column(String, nullable=True)
    created_by   = Column(String, nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Mismo patron que Sale.idempotency_key (fix A3): un doble-click o el
    # reintento del service worker no debe cobrar dos veces. NULL no choca
    # contra NULL en Postgres, asi que los abonos sin key nunca colisionan.
    idempotency_key = Column(String, nullable=True)

    account = relationship("AccountsReceivable", back_populates="payments")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "ar_id"],
            ["accounts_receivable.empresa_id", "accounts_receivable.id"],
            name="fk_ar_payment_account_tenant",
        ),
        ForeignKeyConstraint(
            ["empresa_id", "client_id"],
            ["clients.empresa_id", "clients.id"],
            name="fk_ar_payment_client_tenant",
        ),
        UniqueConstraint("empresa_id", "idempotency_key", name="uq_ar_payment_idempotency"),
        Index("idx_ar_payments_tenant_ar", "empresa_id", "ar_id"),
        Index("idx_ar_payments_tenant_client", "empresa_id", "client_id"),
    )


# ---------------------------------------------------------------------------
# CLIENT  —  tabla real "clients" (POS / cartera activa)
#
# Histórico: en un sprint anterior se creó el alias "Client = Customer" como
# hotfix.  Ese alias apuntaba a la tabla 'customers', cuyo schema NO coincide
# con ClientCreate (faltaban client_code, saldo_favor, puntos, etc.), por lo
# que POST /api/clients devolvida 500 con:
#   TypeError: 'client_code' is an invalid keyword argument for Customer
#
# Solución: restaurar la clase ORM real mapeada a la tabla 'clients'.
# update_core_models.py define su propio Client pero NO es importado por
# main.py ni crud.py, así que no hay conflicto de mapper.
# ---------------------------------------------------------------------------
class Client(Base):
    __tablename__ = "clients"
    # Tenant
    empresa_id     = Column(String, index=True, nullable=False)
    sucursal_id    = Column(String, index=True, nullable=False, default="MATRIZ")
    # PK
    id             = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    # Identidad
    name           = Column(String, nullable=False, index=True)
    rfc            = Column(String, nullable=True)
    client_type    = Column(String, nullable=False, server_default="P\u00fablico General")
    client_code    = Column(String, nullable=True)
    # Contacto
    phone          = Column(String, nullable=True, index=True)
    whatsapp       = Column(String, nullable=True)
    email          = Column(String, nullable=True)
    facebook       = Column(String, nullable=True)
    instagram      = Column(String, nullable=True)
    # Fiscal
    regimen_fiscal = Column(String, nullable=True)
    # Uso CFDI habitual del cliente (G01 adquisicion de mercancias, G03 gastos
    # en general, S01 sin efectos fiscales...). Es solo el DEFAULT que propone
    # el POS: el uso real se decide por operacion al timbrar, no es fijo del
    # cliente. seed.py ya venia cargando este dato sin columna donde ponerlo.
    uso_cfdi       = Column(String, nullable=True)
    # Dirección
    direccion      = Column(String, nullable=True)
    numero_ext     = Column(String, nullable=True)
    numero_int     = Column(String, nullable=True)
    colonia        = Column(String, nullable=True)
    ciudad         = Column(String, nullable=True)
    municipio      = Column(String, nullable=True)
    estado         = Column(String, nullable=True)
    cp             = Column(String, nullable=True)
    pais           = Column(String, nullable=True)
    # Crédito y saldos
    limite_credito = Column(Numeric(15, 4), nullable=False, server_default="0.0")
    dias_credito   = Column(Integer,        nullable=False, server_default="30")
    saldo_favor    = Column(Numeric(15, 4), nullable=False, server_default="0.0")
    saldo_actual   = Column(Numeric(15, 4), nullable=False, server_default="0.0")
    # Programa de lealtad
    puntos         = Column(Integer,  nullable=False, server_default="0")
    resguardos     = Column(Boolean,  nullable=False, server_default="false")
    apartados      = Column(Numeric(15, 4), nullable=False, server_default="0.0")
    ultima_compra  = Column(String,   nullable=False, server_default="S/N")
    # Escala de precio asignada (NR-03)
    # Valores: "Público General" | "Contratista" | "Distribuidor" | "Gobierno"
    # Debe coincidir con ProductPriceScale.scale_name del catálogo del tenant.
    assigned_price_scale = Column(String, nullable=False, server_default="Público General")

    # Sync
    is_synced      = Column(Boolean, server_default="false", nullable=False)

    __table_args__ = (
        UniqueConstraint("empresa_id", "id", name="uq_client_empresa_id"),
    )

# ---------------------------------------------------------------------------
# CUENTAS EN LA NUBE (APARTADOS/COTIZACIONES) Y SALDO A FAVOR
#
# Restaurados 2026-08-10 (hallazgo C3, auditoria 2026-08-03): crud.py/
# schemas.py/main.py ya referenciaban models.ParkedSale/ParkedSaleItem/
# ParkedSaleComment/CustomerCreditLedger/Quote/QuoteItem desde antes del
# refactor a UUID (Fase 5.1) pero las clases ORM nunca se recrearon con el
# esquema nuevo -- causaba 500 en /api/parked-sales, /api/quotes y
# /api/clients/{id}/ledger ("no such table"/AttributeError segun dialecto).
# Columnas alineadas con las ALTER de la migracion 8276e9755f9a (que ya
# convertia parked_sales/parked_sale_items/parked_sale_comments/quotes/
# quote_items/customer_credit_ledger de id INTEGER a id String) para no
# reabrir ese hallazgo -- igual que SafekeptItem/KardexDelivery arriba.
#
# Bug real encontrado y corregido en el mismo commit (crud.py):
# create_parked_sale/create_quote generaban el folio con
# f"A-{db_sale.id:06d}"/f"C-{db_quote.id:06d}" -- eso asume id entero
# autoincremental (heredado de antes de la migracion a UUID) y truena con
# ValueError contra un id String real. Igual merge/transfer/split de
# ParkedSale hacian int(x) sobre merged_from_ids, que ahora guarda UUIDs de
# texto (str(s.id)), no enteros. Se corrigio crud.py para foliar con un
# contador por tenant (COUNT+1) y dejar merged_from_ids/los ids de cuentas
# como texto de principio a fin (sin int()).
# ---------------------------------------------------------------------------

class ParkedSale(Base):
    __tablename__ = "parked_sales"
    empresa_id      = Column(String, index=True, nullable=False)
    sucursal_id     = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id              = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    folio           = Column(String, nullable=True)
    client_id       = Column(String, nullable=False)   # telefono / identificador principal
    client_name     = Column(String, nullable=False)
    client_rfc      = Column(String, nullable=True)
    seller          = Column(String, nullable=False)
    branch          = Column(String, nullable=False)
    total           = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    is_merged       = Column(Boolean, server_default="false", nullable=False)
    merged_from_ids = Column(String, nullable=True)   # ids de texto separados por coma
    # Cobro F7: datos del drawer cuando se convierte en venta (nr04_parked_sales_payments)
    status          = Column(String, nullable=False, server_default="ACTIVE")
    payment_method  = Column(String, nullable=True)
    payment_details = Column(String, nullable=True)   # JSON (mismo esquema que sales.payment_details)
    is_synced       = Column(Boolean, server_default="false", nullable=False)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    items    = relationship("ParkedSaleItem", back_populates="sale", cascade="all, delete-orphan")
    comments = relationship("ParkedSaleComment", back_populates="sale", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("empresa_id", "id", name="uq_parked_sale_empresa_id"),
        Index("idx_parked_sales_status", "empresa_id", "status"),
    )


class ParkedSaleItem(Base):
    __tablename__ = "parked_sale_items"
    empresa_id     = Column(String, index=True, nullable=False)
    sucursal_id    = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id             = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    parked_sale_id = Column(String, nullable=False)
    product_sku    = Column(String, nullable=False)
    description    = Column(String, nullable=False, server_default="")
    quantity       = Column(Numeric(15, 4), nullable=False)
    price          = Column(Numeric(15, 4), nullable=False)
    subtotal       = Column(Numeric(15, 4), nullable=False)
    source_group   = Column(String, nullable=True)
    is_synced      = Column(Boolean, server_default="false", nullable=False)

    sale = relationship("ParkedSale", back_populates="items")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "parked_sale_id"],
            ["parked_sales.empresa_id", "parked_sales.id"],
            name="fk_parked_sale_items_sale_tenant",
        ),
    )


class ParkedSaleComment(Base):
    __tablename__ = "parked_sale_comments"
    empresa_id     = Column(String, index=True, nullable=False)
    sucursal_id    = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id             = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    parked_sale_id = Column(String, nullable=False)
    author         = Column(String, nullable=False)
    comment        = Column(String, nullable=False)
    is_synced      = Column(Boolean, server_default="false", nullable=False)
    created_at     = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    sale = relationship("ParkedSale", back_populates="comments")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "parked_sale_id"],
            ["parked_sales.empresa_id", "parked_sales.id"],
            name="fk_parked_sale_comments_sale_tenant",
        ),
    )


class CustomerCreditLedger(Base):
    __tablename__ = "customer_credit_ledger"
    empresa_id       = Column(String, index=True, nullable=False)
    sucursal_id      = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id               = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    client_id        = Column(String, nullable=False)
    amount           = Column(Numeric(15, 4), nullable=False)
    transaction_type = Column(String, nullable=False)   # CREDIT|DEBIT
    sale_id          = Column(String, nullable=True)
    description      = Column(String, nullable=True)
    is_synced        = Column(Boolean, server_default="false", nullable=False)
    created_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "client_id"],
            ["clients.empresa_id", "clients.id"],
            name="fk_customer_credit_ledger_client_tenant",
        ),
    )


class Quote(Base):
    __tablename__ = "quotes"
    empresa_id  = Column(String, index=True, nullable=False)
    sucursal_id = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id          = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    folio       = Column(String, nullable=True)
    client_id   = Column(String, nullable=False)
    client_name = Column(String, nullable=False)
    total       = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    status      = Column(String, nullable=False, server_default="PENDIENTE")   # PENDIENTE|CERRADA
    is_synced   = Column(Boolean, server_default="false", nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    items = relationship("QuoteItem", back_populates="quote", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("empresa_id", "id", name="uq_quote_empresa_id"),
    )


class QuoteItem(Base):
    __tablename__ = "quote_items"
    empresa_id  = Column(String, index=True, nullable=False)
    sucursal_id = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id          = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    quote_id    = Column(String, nullable=False)
    product_sku = Column(String, nullable=False)
    description = Column(String, nullable=False, server_default="")
    quantity    = Column(Numeric(15, 4), nullable=False)
    price       = Column(Numeric(15, 4), nullable=False)
    subtotal    = Column(Numeric(15, 4), nullable=False)
    is_synced   = Column(Boolean, server_default="false", nullable=False)

    quote = relationship("Quote", back_populates="items")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "quote_id"],
            ["quotes.empresa_id", "quotes.id"],
            name="fk_quote_items_quote_tenant",
        ),
    )


# ---------------------------------------------------------------------------
# RECURSOS HUMANOS
# ---------------------------------------------------------------------------

class Employee(Base):
    __tablename__ = "employees"
    id                        = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    empresa_id                = Column(String, index=True, nullable=False)
    sucursal_id               = Column(String, index=True, nullable=False)
    
    user_id                   = Column(String, nullable=True)
    usuario_id                = Column(String, nullable=True)
    
    employee_code             = Column(String, nullable=True)
    full_name                 = Column(String, nullable=False)
    display_name              = Column(String, nullable=True)
    phone                     = Column(String, nullable=True)
    whatsapp                  = Column(String, nullable=True)
    email                     = Column(String, nullable=True)
    photo_url                 = Column(String, nullable=True)
    
    area                      = Column(String, nullable=True)
    position                  = Column(String, nullable=True)
    employment_type           = Column(String, nullable=True)
    hire_date                 = Column(String, nullable=True)
    status                    = Column(String, nullable=False, server_default="active")
    
    assigned_warehouse_id     = Column(String, nullable=True)
    assigned_warehouse_name   = Column(String, nullable=True)
    assigned_cash_register_id = Column(String, nullable=True)
    
    commission_factor         = Column(Numeric(15, 4), nullable=True, server_default="0.0000")
    commission_balance        = Column(Numeric(15, 4), nullable=True, server_default="0.0000")
    tips_balance              = Column(Numeric(15, 4), nullable=True, server_default="0.0000")
    
    can_login                 = Column(Boolean, nullable=False, server_default="false")
    can_clock_in              = Column(Boolean, nullable=False, server_default="true")
    pin_hash                  = Column(String, nullable=True)
    
    created_at                = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at                = Column(DateTime(timezone=True), nullable=True)
    is_deleted                = Column(Boolean, nullable=False, server_default="false")
    deleted_at                = Column(DateTime(timezone=True), nullable=True)
    deleted_by                = Column(String, nullable=True)

    __table_args__ = (
        Index("ix_employees_tenant_status", "empresa_id", "sucursal_id", "status"),
        Index("ix_employees_user_id", "user_id"),
        Index("ix_employees_usuario_id", "empresa_id", "usuario_id"),
        Index("ix_employees_code", "empresa_id", "sucursal_id", "employee_code"),
        Index("ix_employees_clock", "empresa_id", "sucursal_id", "can_clock_in", "status"),
        Index("ix_employees_active", "is_deleted"),
    )


# ---------------------------------------------------------------------------
# CONTABILIDAD INTERNA — Libro diario (partida doble, Catálogo SAT Anexo 24)
#
# Diseño (2026-08-12, Fase 2):
#   El sistema registra el 100% de las transacciones económicas en
#   accounting_entries/accounting_entry_lines — este es el libro interno
#   real del negocio.  Lo que se reporta al SAT (CFDI global mensual) es
#   una decisión editorial del módulo Contador (Fase 5), que opera sobre
#   cfdi_batches.  El sistema NUNCA iguala total_ventas_sistema con
#   total_declarado_SAT — esa reconciliación la hace el Contador.
#
# Catálogo SAT (Anexo 24 RMF) — cuentas usadas automáticamente:
#   102.01  Caja
#   105.01  Clientes (CxC)
#   151.01  Inventario de mercancías
#   216.01  IVA trasladado por enterar
#   401.01  Ventas
#   501.01  Costo de lo vendido
#
# Flujo automático por venta (generate_sale_entry en crud.py):
#   Efectivo:  Debe 102.01 Caja / Haber 401.01 Ventas [+ 216.01 si IVA]
#   Crédito:   Debe 105.01 Clientes / Haber 401.01 Ventas [+ 216.01 si IVA]
#   Costo:     Debe 501.01 CVV / Haber 151.01 Inventario
#   La suma de Debe == suma de Haber siempre (constraint verificado en crud).
#
# Para Colombia (LMCont-IQ): mismo patrón, adaptar códigos de cuenta al
# Catálogo Único de Cuentas DIAN (PUC) en vez de SAT Anexo 24.
# ---------------------------------------------------------------------------

class AccountingEntry(Base):
    """Encabezado de un asiento contable.

    Cada evento económico (venta, devolución, ajuste, compra) genera
    exactamente un AccountingEntry con N líneas en AccountingEntryLine.
    El asiento es inmutable una vez cerrado (status='POSTED'); solo el
    Contador puede anularlo creando un asiento de contrapartida.
    """
    __tablename__ = "accounting_entries"

    empresa_id      = Column(String, index=True, nullable=False)
    sucursal_id     = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id              = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))

    fecha           = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    concepto        = Column(String, nullable=False)               # "Venta #V-000123 — Efectivo"

    # Documento origen que generó el asiento
    referencia_tipo = Column(String, nullable=False)               # VENTA|DEVOLUCION|AJUSTE|COMPRA
    referencia_id   = Column(String, nullable=False)               # sale.id, purchase.id, etc.

    # Totales de cuadre (debe == haber, verificado en crud.generate_sale_entry)
    total_debe      = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    total_haber     = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    # Estados: DRAFT → POSTED (inmutable) → VOIDED (anulado con contrapartida)
    status          = Column(String, nullable=False, server_default="POSTED")

    # Vínculo a CFDI batch si este asiento entró en una declaración mensual
    cfdi_batch_id   = Column(String, nullable=True)

    created_by      = Column(String, nullable=True)                # user_id del cajero/sistema
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    lines = relationship("AccountingEntryLine", back_populates="entry", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_accounting_entries_tenant_fecha", "empresa_id", "fecha"),
        Index("idx_accounting_entries_referencia", "empresa_id", "referencia_tipo", "referencia_id"),
        UniqueConstraint("empresa_id", "id", name="uq_accounting_entry_empresa_id"),
    )


class AccountingEntryLine(Base):
    """Una línea de partida doble dentro de un asiento.

    Cada AccountingEntry tiene mínimo 2 líneas (un cargo y un abono).
    La suma de monto donde tipo_movimiento='DEBE' debe igualar la suma
    donde tipo_movimiento='HABER' — el crud lo verifica antes de insertar.
    """
    __tablename__ = "accounting_entry_lines"

    empresa_id      = Column(String, index=True, nullable=False)
    id              = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    entry_id        = Column(String, nullable=False)

    # Código del Catálogo SAT Anexo 24 (ej: "102.01", "401.01")
    # Para Colombia: código PUC DIAN (ej: "110505", "413595")
    cuenta_sat      = Column(String, nullable=False)
    cuenta_nombre   = Column(String, nullable=False)               # "Caja", "Ventas", etc.

    tipo_movimiento = Column(String, nullable=False)               # DEBE | HABER
    monto           = Column(Numeric(15, 4), nullable=False)

    descripcion     = Column(String, nullable=True)                # "Pago efectivo venta #V-000123"

    # Relacion inversa requerida por AccountingEntry.lines (back_populates="entry")
    entry = relationship("AccountingEntry", back_populates="lines")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "entry_id"],
            ["accounting_entries.empresa_id", "accounting_entries.id"],
            name="fk_entry_lines_entry_tenant",
        ),
        Index("idx_entry_lines_entry", "empresa_id", "entry_id"),
        Index("idx_entry_lines_cuenta", "empresa_id", "cuenta_sat"),
    )


class CfdiBatch(Base):
    """Comprobante global mensual bajo control editorial del Contador.

    El sistema acumula ventas de mostrador (sin CFDI individual) durante
    el mes.  Al cierre, el Contador revisa, ajusta el monto_declarado y
    emite el CFDI global.  El sistema NO fuerza que monto_declarado ==
    total real del mes — esa decisión pertenece al Contador.

    Referencia normativa (México):
      Art. 29-A CFF — comprobantes de operaciones con el público en general
      Regla 2.7.1.24 RMF — periodicidad: diaria, semanal o mensual
    """
    __tablename__ = "cfdi_batches"

    empresa_id        = Column(String, index=True, nullable=False)
    sucursal_id       = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id                = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))

    periodo           = Column(String, nullable=False)             # "2026-08" (YYYY-MM)
    fecha_emision     = Column(DateTime(timezone=True), nullable=True)

    # Totales del sistema vs declarado — pueden diferir; el Contador decide
    total_sistema     = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    monto_declarado   = Column(Numeric(15, 4), nullable=True)      # nulo hasta que el Contador confirme

    cfdi_uuid         = Column(String, nullable=True)              # UUID del CFDI timbrado
    cfdi_xml_path     = Column(String, nullable=True)              # ruta al XML firmado
    cfdi_pdf_path     = Column(String, nullable=True)

    # BORRADOR → REVISIÓN (Contador edita) → TIMBRADO → CANCELADO
    estado            = Column(String, nullable=False, server_default="BORRADOR")

    notas_contador    = Column(String, nullable=True)              # campo libre para el Contador
    created_by        = Column(String, nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at        = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("empresa_id", "sucursal_id", "periodo", name="uq_cfdi_batch_periodo"),
        Index("idx_cfdi_batches_tenant_periodo", "empresa_id", "periodo"),
    )


class CfdiDocument(Base):
    """CFDI 4.0 individual timbrado sobre UNA venta (CP2 · Fase 2 S5).

    No sustituye a `cfdi_batches`: son dos cosas distintas y coexisten.
      cfdi_batches   — comprobante GLOBAL mensual del publico en general,
                       bajo control editorial del Contador.
      cfdi_documents — la factura nominativa que pide un cliente con RFC
                       sobre su ticket concreto.

    El timbrado lo hace un PAC externo (hoy Facturama, API Multiemisor
    "api-lite"). Aqui se guarda el resultado, no el proceso: `pac_id` es el
    identificador del comprobante del lado del PAC (con el se bajan XML/PDF y
    se cancela) y `uuid_fiscal` es el folio fiscal del SAT.

    Estados: BORRADOR -> TIMBRADO -> CANCELADO, o ERROR si el PAC rechazo.
    Un CFDI en ERROR se puede reintentar; uno TIMBRADO ya no se re-timbra.
    """
    __tablename__ = "cfdi_documents"

    empresa_id   = Column(String, index=True, nullable=False)
    sucursal_id  = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id           = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    sale_id      = Column(String, nullable=False, index=True)

    # I=Ingreso, E=Egreso (nota de credito), P=Pago. El POS emite "I".
    tipo         = Column(String, nullable=False, server_default="I")
    serie        = Column(String, nullable=True)
    folio        = Column(String, nullable=True)
    uuid_fiscal  = Column(String, nullable=True)    # folio fiscal del SAT
    status       = Column(String, nullable=False, server_default="BORRADOR")

    # Datos fiscales de la operacion (catalogos SAT)
    uso_cfdi     = Column(String, nullable=True)    # G01, G03, S01...
    forma_pago   = Column(String, nullable=True)    # 01 efectivo, 03 transferencia...
    metodo_pago  = Column(String, nullable=True)    # PUE | PPD
    total        = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    # Receptor congelado al momento de timbrar: si el cliente cambia de razon
    # social despues, el CFDI emitido debe seguir mostrando lo que se timbro.
    receptor_rfc    = Column(String, nullable=True)
    receptor_nombre = Column(String, nullable=True)

    provider     = Column(String, nullable=False, server_default="facturama")
    environment  = Column(String, nullable=True)    # sandbox | production | mock
    pac_id       = Column(String, nullable=True)    # Id del comprobante en el PAC

    xml          = Column(String, nullable=True)    # String sin limite = TEXT
    pdf_base64   = Column(String, nullable=True)
    error        = Column(String, nullable=True)

    timbrado_at        = Column(DateTime(timezone=True), nullable=True)
    cancelado_at       = Column(DateTime(timezone=True), nullable=True)
    motivo_cancelacion = Column(String, nullable=True)

    created_by   = Column(String, nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "sale_id"],
            ["sales.empresa_id", "sales.id"],
            name="fk_cfdi_doc_sale_tenant",
        ),
        # El folio fiscal es unico por tenant. NULL no choca contra NULL en
        # Postgres, asi que los borradores sin timbrar no colisionan.
        UniqueConstraint("empresa_id", "uuid_fiscal", name="uq_cfdi_uuid_fiscal"),
        Index("idx_cfdi_docs_tenant_sale", "empresa_id", "sale_id"),
        Index("idx_cfdi_docs_tenant_status", "empresa_id", "status"),
    )

# =============================================================================
# FASE 2 — MÓDULO ADMINISTRACIÓN (Alcance Definitivo Fase2.md)
# Branch / Sucursal, AdminConfig (params + folios + catálogos)
# =============================================================================

class Branch(Base):
    """Sucursal física de una empresa tenant.

    Una empresa puede tener N sucursales (hoy Antonio opera 2).
    El campo empresa_id + id forman la clave compuesta que usan los
    demás modelos como (empresa_id, sucursal_id).
    """
    __tablename__ = "branches"

    empresa_id  = Column(String, index=True, nullable=False)
    id          = Column(String, primary_key=True, index=True,
                         default=lambda: str(uuid.uuid4()))
    name        = Column(String, nullable=False)
    address     = Column(String, nullable=True)
    phone       = Column(String, nullable=True)
    email       = Column(String, nullable=True)
    status      = Column(String, nullable=False, server_default="ACTIVE")
    is_main     = Column(Boolean, nullable=False, server_default="false")
    created_at  = Column(DateTime(timezone=True), server_default=func.now(),
                         nullable=False)

    __table_args__ = (
        Index("idx_branches_empresa", "empresa_id"),
    )


class AdminConfig(Base):
    """Configuración de empresa: parámetros generales, folios y catálogos.

    Un registro por (empresa_id, config_key).  Valores JSON para máxima
    flexibilidad sin migraciones adicionales.

    Grupos de claves predefinidos:
      params.*     — moneda, zona horaria, formato fecha, logo_url
      folio.*      — serie + número actual para cada tipo de documento
      catalog.*    — listas de catálogos maestros (formas_pago, unidades,
                     impuestos, bancos)
    """
    __tablename__ = "admin_config"

    empresa_id  = Column(String, primary_key=True, index=True, nullable=False)
    config_key  = Column(String, primary_key=True, nullable=False)
    config_val  = Column(JSON, nullable=False, server_default='null')
    updated_by  = Column(String, nullable=True)
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(),
                         nullable=False, onupdate=func.now())

    __table_args__ = (
        # (empresa_id, config_key) ya es PK compuesta arriba — la unicidad la
        # da esa PK. Un UniqueConstraint sobre las mismas columnas era pura
        # redundancia (índice extra idéntico) y además `alembic check` no lo
        # reflejaba de vuelta -> falso positivo de "constraint agregada".
        Index("idx_admin_config_empresa", "empresa_id"),
    )


class Contractor(Base):
    """Ítem 2: contratista/intermediario que recomienda clientes a Don Antonio.
    Entidad independiente: no necesita ser cliente registrado en el sistema.
    Recibe comisiones calculadas por proyecto según commission_rate negociado."""
    __tablename__ = "contractors"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id  = Column(String, index=True, nullable=False)
    nombre      = Column(String, nullable=False)
    rfc         = Column(String, nullable=True)
    phone       = Column(String, nullable=True)
    email       = Column(String, nullable=True)
    notas       = Column(String, nullable=True)
    status      = Column(String, nullable=False, server_default="activo")  # activo | inactivo
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_contractors_empresa", "empresa_id"),
    )


class Project(Base):
    """Ítem 2: obra o proyecto de construcción/remodelación.
    Vincula un cliente comprador con el contratista que lo recomendó.
    Todas las ventas marcadas con este project_id acumulan comisión al contratista.
    commission_rate es configurable por obra (% sobre total de compras del proyecto)."""
    __tablename__ = "projects"

    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id      = Column(String, index=True, nullable=False)
    nombre          = Column(String, nullable=False)
    client_id       = Column(String, nullable=True)       # cliente que compra para la obra
    contractor_id   = Column(String, nullable=True)       # FK contractors.id
    commission_rate = Column(Numeric(7, 4), nullable=False, server_default="0.0000")
    status          = Column(String, nullable=False, server_default="activo")  # activo | cerrado
    notas           = Column(String, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    closed_at       = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_projects_empresa_status", "empresa_id", "status"),
        Index("idx_projects_contractor", "empresa_id", "contractor_id"),
    )


class ProjectCommissionLedger(Base):
    """Ítem 2: registro de comisiones generadas y entregadas al contratista por proyecto.
    amount_generated: se suma automáticamente al cerrar cada venta con project_id.
    amount_paid:      el admin registra manualmente los pagos al contratista."""
    __tablename__ = "project_commission_ledger"

    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id      = Column(String, index=True, nullable=False)
    project_id      = Column(String, index=True, nullable=False)
    entry_type      = Column(String, nullable=False)   # generated | paid
    amount          = Column(Numeric(15, 4), nullable=False)
    sale_id         = Column(String, nullable=True)    # referencia si entry_type=generated
    descripcion     = Column(String, nullable=True)
    registrado_por  = Column(String, nullable=True)    # user_id o "system"
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_pcl_project", "empresa_id", "project_id", "entry_type"),
    )


class SellerCatalogPermission(Base):
    """Ítem 3: categorías de producto que un empleado (vendedor) puede vender.
    Si un empleado no tiene filas aquí puede vender todo. Si tiene filas,
    solo puede vender las categorías con can_sell=True."""
    __tablename__ = "seller_catalog_permissions"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id  = Column(String, index=True, nullable=False)
    employee_id = Column(String, index=True, nullable=False)
    category    = Column(String, nullable=False)
    can_sell    = Column(Boolean, nullable=False, server_default="true")
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("empresa_id", "employee_id", "category",
                         name="uq_seller_catalog_perm"),
    )


class SellerCommissionRule(Base):
    """Ítem 3: tasa de comisión por vendedor. Scope jerárquico:
      default      → tasa base del vendedor (scope_value = None)
      category     → por categoría de producto (scope_value = nombre categoría)
      price_scale  → por escala de precio del cliente (scope_value = nombre escala)
    El motor aplica la regla más específica que coincida."""
    __tablename__ = "seller_commission_rules"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id  = Column(String, index=True, nullable=False)
    employee_id = Column(String, index=True, nullable=False)
    scope       = Column(String, nullable=False)          # default | category | price_scale
    scope_value = Column(String, nullable=True)           # None para default
    rate        = Column(Numeric(7, 4), nullable=False)   # porcentaje, ej. 5.0000
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("empresa_id", "employee_id", "scope", "scope_value",
                         name="uq_seller_comm_rule"),
    )


class PriceScaleAuthRequest(Base):
    """Ítem 3: solicitud de cambio de escala de precio en una venta puntual.
    El vendedor la crea; el ADMIN recibe notificación y aprueba/rechaza.
    La aprobación es válida solo hasta expires_at (mismo día, configurado
    como valid_until por el admin al aprobar)."""
    __tablename__ = "price_scale_auth_requests"

    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id      = Column(String, index=True, nullable=False)
    session_token   = Column(String, index=True, nullable=True)  # token de sesión POS
    client_id       = Column(String, nullable=True)
    requested_scale = Column(String, nullable=False)
    current_scale   = Column(String, nullable=True)
    requested_by    = Column(String, nullable=False)   # employee_id
    status          = Column(String, nullable=False, server_default="pending")
                                                       # pending|approved|rejected
    authorized_by   = Column(String, nullable=True)
    expires_at      = Column(DateTime(timezone=True), nullable=True)
    notes           = Column(String, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_psar_empresa_status", "empresa_id", "status"),
    )


class TempPermissionGrant(Base):
    """Permiso temporal que el ADMIN_GENERAL otorga a un ADMIN_SUCURSAL
    para acceder a un módulo bloqueado durante un rango de fechas definido.

    El backend verifica esta tabla en cada request de módulo restringido cuando
    el rol del usuario es admin_sucursal.
    """
    __tablename__ = "temp_permission_grants"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id   = Column(String, index=True, nullable=False)
    user_id      = Column(String, index=True, nullable=False)   # FK a users.id
    module       = Column(String, nullable=False)               # RRHH | COMPRAS | CONFIGURACION | ...
    sucursal_id  = Column(String, nullable=True)                # None = aplica en cualquier sucursal
    granted_by   = Column(String, nullable=False)               # user_id del ADMIN_GENERAL
    valid_from   = Column(DateTime(timezone=True), nullable=False)
    valid_until  = Column(DateTime(timezone=True), nullable=False)
    revoked      = Column(Boolean, nullable=False, server_default="false")
    created_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_temp_grants_user_module", "empresa_id", "user_id", "module"),
    )


class PointsRedemption(Base):
    """Ítem 1.b: registro de cada canje de puntos de un cliente.
    La configuración del programa (loyalty.config y loyalty.redemption) vive
    en AdminConfig para no requerir migraciones al cambiar las reglas.

    redemption_mode: el modo elegido (pago_parcial | sorteo | regalo | etc.)
    puntos_canjeados: puntos descontados de Client.puntos
    valor_aplicado:   MXN aplicados como descuento (si aplica)
    sale_id:          venta en la que se aplicó (null si es sorteo/regalo)
    """
    __tablename__ = "points_redemptions"

    id               = Column(String,  primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id       = Column(String,  index=True,  nullable=False)
    client_id        = Column(String,  nullable=False)
    redemption_mode  = Column(String,  nullable=False)
    puntos_canjeados = Column(Integer, nullable=False)
    valor_aplicado   = Column(Numeric(15, 4), nullable=True)
    sale_id          = Column(String,  nullable=True)
    notas            = Column(String,  nullable=True)
    registrado_por   = Column(String,  nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_points_redemptions_client", "empresa_id", "client_id"),
    )


class Notification(Base):
    """Notificaciones dirigidas por EVENTO discreto (enfoque híbrido, D.3).

    Las alertas derivables de estado (devoluciones PENDIENTE, stock bajo) se
    siguen calculando on-poll en /api/notifications. Esta tabla es sólo para
    eventos puntuales que no se pueden recomputar: N-01 (resguardo solicitado),
    mercancía recibida para un resguardo, N-05 (por vencer), etc.

    `roles_dest` es una lista JSON de nombres de rol (case-insensitive). Un
    usuario ve la fila si su rol está en la lista y `leida` es False.
    """
    __tablename__ = "notifications"

    id          = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    empresa_id  = Column(String, index=True, nullable=False)
    sucursal_id = Column(String, index=True, nullable=True)
    tipo        = Column(String, nullable=False)        # resguardo_solicitado | resguardo_en_inventario | resguardo_por_vencer | ...
    severidad   = Column(String, nullable=False, server_default="INFO")  # INFO | WARNING | CRITICAL
    titulo      = Column(String, nullable=False)
    cuerpo      = Column(String, nullable=True)
    roles_dest  = Column(JSON, nullable=False, server_default='[]')
    ref_tipo    = Column(String, nullable=True)         # 'safekept' | 'sale' | ...
    ref_id      = Column(String, nullable=True)
    meta        = Column(JSON, nullable=True)
    # server_default como texto 'false' se guarda literal y SQLAlchemy lo lee
    # como True en SQLite; text("0") rompe en PostgreSQL (DatatypeMismatch).
    # sa_false() renderiza 0 en SQLite y false en PostgreSQL -> compatible con ambos.
    leida       = Column(Boolean, nullable=False, default=False, server_default=sa_false())
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_notifications_empresa_leida", "empresa_id", "leida"),
    )


# =============================================================================
# FASE 2 — MÓDULO COMPRAS
# Flujo: Proveedor → OC → Recepción → Stock + CxP → Abono proveedor
# Diseño: MVP_ROLES_FUNCIONES_MODULOS.md §6.4
# =============================================================================

class Supplier(Base):
    """Proveedor de mercancía o servicio.

    Un proveedor pertenece a una empresa (multi-tenant).  La sucursal_id
    es opcional: si es None, el proveedor es global para todas las
    sucursales; si está seteada, aplica solo a esa sucursal.
    """
    __tablename__ = "suppliers"

    empresa_id   = Column(String, index=True, nullable=False)
    sucursal_id  = Column(String, index=True, nullable=True)  # None = global
    id           = Column(String, primary_key=True, index=True,
                          default=lambda: str(uuid.uuid4()))

    # Datos fiscales y comerciales
    name         = Column(String, nullable=False)              # Nombre comercial
    trade_name   = Column(String, nullable=True)               # Razón social / denominación
    rfc          = Column(String, nullable=True)               # RFC (México)

    # Contacto
    contact_name = Column(String, nullable=True)
    phone        = Column(String, nullable=True)
    whatsapp     = Column(String, nullable=True)
    email        = Column(String, nullable=True)

    # Crédito
    credit_days  = Column(Integer, nullable=False, server_default="0")
    credit_limit = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    # Cuenta bancaria para transferencias
    bank_account = Column(String, nullable=True)               # CLABE o número de cuenta

    # Estado
    status       = Column(String, nullable=False, server_default="ACTIVE")  # ACTIVE|INACTIVE
    notes        = Column(String, nullable=True)

    created_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at   = Column(DateTime(timezone=True), nullable=True)

    # Relaciones
    purchase_orders   = relationship("PurchaseOrder",   back_populates="supplier")
    purchase_receipts = relationship("PurchaseReceipt", back_populates="supplier")
    accounts_payable  = relationship("AccountsPayable", back_populates="supplier")

    __table_args__ = (
        Index("idx_suppliers_empresa", "empresa_id"),
        UniqueConstraint("empresa_id", "id", name="uq_supplier_empresa_id"),
    )


class PurchaseOrder(Base):
    """Orden de Compra (OC).

    Ciclo de vida: DRAFT → SENT → PARTIAL → COMPLETED | CANCELLED
    Solo el admin puede aprobar (DRAFT→SENT) y cancelar.
    El almacenista puede crear y editar en DRAFT.
    La recepción de mercancía avanza el estado a PARTIAL o COMPLETED.
    """
    __tablename__ = "purchase_orders"

    empresa_id   = Column(String, index=True, nullable=False)
    sucursal_id  = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id           = Column(String, primary_key=True, index=True,
                          default=lambda: str(uuid.uuid4()))

    # Folio autoincremental por empresa (ej. OC-2026-0001)
    folio        = Column(String, nullable=False)

    supplier_id  = Column(String, nullable=False)

    issue_date    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expected_date = Column(DateTime(timezone=True), nullable=True)

    # DRAFT | SENT | PARTIAL | COMPLETED | CANCELLED
    status       = Column(String, nullable=False, server_default="DRAFT")

    # Totales (recalculados al modificar ítems)
    subtotal     = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    tax_amount   = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    total        = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    notes        = Column(String, nullable=True)
    authorized_by = Column(String, nullable=True)  # User.id del admin que aprueba

    created_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at   = Column(DateTime(timezone=True), nullable=True)

    # Relaciones
    supplier     = relationship("Supplier",           back_populates="purchase_orders")
    items        = relationship("PurchaseOrderItem",  back_populates="purchase_order",
                                cascade="all, delete-orphan")
    receipts     = relationship(
        "PurchaseReceipt",
        back_populates="purchase_order",
        primaryjoin=(
            "and_(PurchaseOrder.empresa_id == foreign(PurchaseReceipt.empresa_id),"
            " PurchaseOrder.id == foreign(PurchaseReceipt.purchase_order_id))"
        ),
        viewonly=True,
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "supplier_id"],
            ["suppliers.empresa_id", "suppliers.id"],
            name="fk_po_supplier_tenant",
        ),
        UniqueConstraint("empresa_id", "folio", name="uq_po_folio_empresa"),
        # PostgreSQL exige un unique sobre las columnas referenciadas por una FK
        # compuesta (purchase_order_items -> empresa_id, id). SQLite no lo valida.
        UniqueConstraint("empresa_id", "id", name="uq_po_empresa_id"),
        Index("idx_po_empresa_status", "empresa_id", "status"),
    )


class PurchaseOrderItem(Base):
    """Línea de un ítem dentro de una OC.

    quantity_received se actualiza con cada PurchaseReceiptItem asociado.
    status: PENDING | PARTIAL | RECEIVED
    """
    __tablename__ = "purchase_order_items"

    empresa_id        = Column(String, index=True, nullable=False)
    id                = Column(String, primary_key=True, index=True,
                               default=lambda: str(uuid.uuid4()))
    purchase_order_id = Column(String, nullable=False)

    # Producto vinculado (puede ser None si el producto no existe aún en catálogo)
    product_id        = Column(String, nullable=True)
    sku               = Column(String, nullable=False)
    description       = Column(String, nullable=False, server_default="")

    quantity_ordered  = Column(Numeric(15, 4), nullable=False)
    quantity_received = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    unit_cost         = Column(Numeric(15, 4), nullable=False)
    subtotal          = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    # PENDING | PARTIAL | RECEIVED
    status            = Column(String, nullable=False, server_default="PENDING")

    # Relaciones
    purchase_order    = relationship("PurchaseOrder", back_populates="items")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "purchase_order_id"],
            ["purchase_orders.empresa_id", "purchase_orders.id"],
            name="fk_poi_purchase_order_tenant",
        ),
        Index("idx_poi_purchase_order", "empresa_id", "purchase_order_id"),
    )


class PurchaseReceipt(Base):
    """Documento de recepción de mercancía (contra OC o entrada directa).

    Cuando se guarda:
      1. Actualiza WarehouseStock (por bodega)
      2. Actualiza PurchaseOrderItem.quantity_received (si hay OC)
      3. Avanza PurchaseOrder.status → PARTIAL o COMPLETED
      4. Genera InventoryMovement(COMPRA) por cada ítem
      5. Crea AccountsPayable si payment_type=CREDIT
      6. Asiento contable: DEBE 151.01 / HABER 201.01 (Inventario / CxP Proveedores)
    """
    __tablename__ = "purchase_receipts"

    empresa_id        = Column(String, index=True, nullable=False)
    sucursal_id       = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id                = Column(String, primary_key=True, index=True,
                               default=lambda: str(uuid.uuid4()))

    folio             = Column(String, nullable=False)  # REC-2026-0001

    # OC vinculada (nullable → permite entradas directas sin OC)
    purchase_order_id = Column(String, nullable=True)
    supplier_id       = Column(String, nullable=False)
    warehouse_id      = Column(String, nullable=False)  # Bodega de destino

    received_by       = Column(String, nullable=False)  # User.id del almacenista
    receipt_date      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    subtotal          = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    tax_amount        = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    total             = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    # CASH | CREDIT  → CREDIT genera AccountsPayable automáticamente
    payment_type      = Column(String, nullable=False, server_default="CREDIT")

    notes             = Column(String, nullable=True)
    idempotency_key   = Column(String, nullable=False)  # Protege duplicados de recepción

    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relaciones
    supplier          = relationship("Supplier",             back_populates="purchase_receipts")
    purchase_order    = relationship(
        "PurchaseOrder",
        back_populates="receipts",
        primaryjoin=(
            "and_(foreign(PurchaseReceipt.empresa_id) == PurchaseOrder.empresa_id,"
            " foreign(PurchaseReceipt.purchase_order_id) == PurchaseOrder.id)"
        ),
        viewonly=True,
    )
    items             = relationship("PurchaseReceiptItem",  back_populates="receipt",
                                     cascade="all, delete-orphan")
    accounts_payable  = relationship(
        "AccountsPayable",
        back_populates="purchase_receipt",
        primaryjoin=(
            "and_(PurchaseReceipt.empresa_id == foreign(AccountsPayable.empresa_id),"
            " PurchaseReceipt.id == foreign(AccountsPayable.purchase_receipt_id))"
        ),
        uselist=False,
        viewonly=True,
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "supplier_id"],
            ["suppliers.empresa_id", "suppliers.id"],
            name="fk_pr_supplier_tenant",
        ),
        ForeignKeyConstraint(
            ["empresa_id", "warehouse_id"],
            ["warehouses.empresa_id", "warehouses.id"],
            name="fk_pr_warehouse_tenant",
        ),
        UniqueConstraint("empresa_id", "folio",            name="uq_receipt_folio_empresa"),
        UniqueConstraint("empresa_id", "idempotency_key",  name="uq_receipt_idempotency"),
        # PostgreSQL exige un unique sobre las columnas referenciadas por una FK
        # compuesta (purchase_receipt_items -> empresa_id, id). SQLite no lo valida.
        UniqueConstraint("empresa_id", "id",               name="uq_receipt_empresa_id"),
        Index("idx_pr_empresa_supplier",   "empresa_id", "supplier_id"),
        Index("idx_pr_empresa_date",       "empresa_id", "receipt_date"),
    )


class PurchaseReceiptItem(Base):
    """Línea de ítem dentro de una recepción de mercancía.

    Al guardar el receipt, el CRUD itera estos ítems para actualizar
    WarehouseStock, acumular en PurchaseOrderItem y generar movimientos.
    """
    __tablename__ = "purchase_receipt_items"

    empresa_id              = Column(String, index=True, nullable=False)
    id                      = Column(String, primary_key=True, index=True,
                                     default=lambda: str(uuid.uuid4()))
    receipt_id              = Column(String, nullable=False)

    # Vinculado al ítem de la OC (nullable para entradas directas sin OC)
    purchase_order_item_id  = Column(String, nullable=True)

    product_id              = Column(String, nullable=False)  # Debe existir en catálogo
    sku                     = Column(String, nullable=False)
    description             = Column(String, nullable=False, server_default="")

    quantity_received        = Column(Numeric(15, 4), nullable=False)
    unit_cost               = Column(Numeric(15, 4), nullable=False)
    subtotal                = Column(Numeric(15, 4), nullable=False, server_default="0.0000")

    # Relaciones
    receipt = relationship("PurchaseReceipt", back_populates="items")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "receipt_id"],
            ["purchase_receipts.empresa_id", "purchase_receipts.id"],
            name="fk_pri_receipt_tenant",
        ),
        ForeignKeyConstraint(
            ["empresa_id", "product_id"],
            ["products.empresa_id", "products.id"],
            name="fk_pri_product_tenant",
        ),
        Index("idx_pri_receipt", "empresa_id", "receipt_id"),
    )


class AccountsPayable(Base):
    """Cuenta por pagar a proveedor.

    Se genera automáticamente al crear un PurchaseReceipt con
    payment_type=CREDIT.  Puede recibir abonos parciales o totales
    vía SupplierPayment.

    Ciclo: PENDING → PARTIAL → PAID | OVERDUE
    """
    __tablename__ = "accounts_payable"

    empresa_id          = Column(String, index=True, nullable=False)
    sucursal_id         = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id                  = Column(String, primary_key=True, index=True,
                                 default=lambda: str(uuid.uuid4()))

    supplier_id         = Column(String, nullable=False)
    purchase_receipt_id = Column(String, nullable=True)   # FK a la recepción que la originó
    purchase_order_id   = Column(String, nullable=True)   # FK a la OC (para trazabilidad)

    amount              = Column(Numeric(15, 4), nullable=False)
    amount_paid         = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    balance             = Column(Numeric(15, 4), nullable=False)  # amount - amount_paid

    due_date            = Column(DateTime(timezone=True), nullable=True)

    # PENDING | PARTIAL | PAID | OVERDUE
    status              = Column(String, nullable=False, server_default="PENDING")

    created_at          = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at          = Column(DateTime(timezone=True), nullable=True)

    # Datos de seguimiento (CxP alimentada desde Recepción de Mercancía 360°)
    folio               = Column(String, nullable=True, index=True)   # CXP-2026-0001 (folio de la cuenta de seguimiento)
    invoice_uuid        = Column(String, nullable=True, index=True)   # Folio fiscal (UUID del CFDI)
    invoice_ref         = Column(String, nullable=True)               # Serie-Folio de la factura / folio del documento
    issue_date          = Column(DateTime(timezone=True), nullable=True)   # Fecha de emisión de la factura
    receipt_date        = Column(DateTime(timezone=True), nullable=True)   # Fecha de recepción de la mercancía
    expediente_id       = Column(String, nullable=True, index=True)   # Expediente 360° que la originó
    concept             = Column(String, nullable=True)               # MERCANCIA | FLETE | MANUAL
    credit_days         = Column(Integer, nullable=True)

    # Relaciones
    supplier         = relationship("Supplier",         back_populates="accounts_payable")
    purchase_receipt = relationship(
        "PurchaseReceipt",
        back_populates="accounts_payable",
        primaryjoin=(
            "and_(foreign(AccountsPayable.empresa_id) == PurchaseReceipt.empresa_id,"
            " foreign(AccountsPayable.purchase_receipt_id) == PurchaseReceipt.id)"
        ),
        foreign_keys="[AccountsPayable.empresa_id, AccountsPayable.purchase_receipt_id]",
        viewonly=True,
    )
    payments         = relationship("SupplierPayment",  back_populates="accounts_payable",
                                    cascade="all, delete-orphan")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "supplier_id"],
            ["suppliers.empresa_id", "suppliers.id"],
            name="fk_ap_supplier_tenant",
        ),
        Index("idx_ap_empresa_status",   "empresa_id", "status"),
        Index("idx_ap_empresa_due_date", "empresa_id", "due_date"),
        UniqueConstraint("empresa_id", "id", name="uq_ap_empresa_id"),
    )


class SupplierPayment(Base):
    """Abono a una CxP de proveedor.

    Genera asiento contable: DEBE 201.01 (CxP Proveedores) / HABER 102.01 (Caja).
    Si el balance de AccountsPayable llega a 0, status → PAID automáticamente.
    """
    __tablename__ = "supplier_payments"

    empresa_id          = Column(String, index=True, nullable=False)
    id                  = Column(String, primary_key=True, index=True,
                                 default=lambda: str(uuid.uuid4()))
    accounts_payable_id = Column(String, nullable=False)

    amount              = Column(Numeric(15, 4), nullable=False)
    payment_date        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # CASH | TRANSFER | CHECK
    payment_method      = Column(String, nullable=False, server_default="CASH")
    reference           = Column(String, nullable=True)  # N° de transferencia / cheque

    registered_by       = Column(String, nullable=False)  # User.id
    notes               = Column(String, nullable=True)

    created_at          = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relaciones
    accounts_payable = relationship("AccountsPayable", back_populates="payments")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "accounts_payable_id"],
            ["accounts_payable.empresa_id", "accounts_payable.id"],
            name="fk_sp_accounts_payable_tenant",
        ),
        Index("idx_sp_ap", "empresa_id", "accounts_payable_id"),
    )


# =============================================================================
# FASE 0-2 — APP TERMINAL + APP MÓVIL GPS (D5 vendedor_calle / repartidor)
# Spec: docs/SPEC_APP_TERMINAL_GPS.md
# =============================================================================

class Route(Base):
    """Ruta de reparto/venta asignada a un usuario móvil para un día."""
    __tablename__ = "routes"

    empresa_id             = Column(String, index=True, nullable=False)
    id                     = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    sucursal_id            = Column(String, nullable=False)
    assigned_user          = Column(String, nullable=False)
    route_date             = Column(Date, nullable=False)
    status                 = Column(String, nullable=False, server_default="planned")
    deviation_threshold_m  = Column(Numeric(9, 2), nullable=False, server_default="150")
    created_at             = Column(DateTime(timezone=True), server_default=func.now())
    created_by             = Column(String, nullable=True)

    stops    = relationship("RouteStop", back_populates="route",
                            cascade="all, delete-orphan",
                            order_by="RouteStop.seq")
    pings    = relationship("GpsPing",  back_populates="route",
                            cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_routes_empresa_date",   "empresa_id", "route_date"),
        Index("idx_routes_empresa_user",   "empresa_id", "assigned_user"),
        UniqueConstraint("empresa_id", "id", name="uq_route_empresa_id"),
    )


class RouteStop(Base):
    """Parada dentro de una ruta."""
    __tablename__ = "route_stops"

    empresa_id  = Column(String, index=True, nullable=False)
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    route_id    = Column(String, nullable=False)
    seq         = Column(Integer, nullable=False)
    label       = Column(String, nullable=True)
    address     = Column(String, nullable=True)
    lat         = Column(Numeric(9, 6), nullable=False)
    lng         = Column(Numeric(9, 6), nullable=False)
    client_id   = Column(String, nullable=True)
    sale_id     = Column(String, nullable=True)
    status      = Column(String, nullable=False, server_default="pending")
    arrived_at  = Column(DateTime(timezone=True), nullable=True)

    route = relationship("Route", back_populates="stops")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "route_id"],
            ["routes.empresa_id", "routes.id"],
            name="fk_rs_route_tenant",
        ),
        Index("idx_route_stops_route", "empresa_id", "route_id"),
    )


class GpsPing(Base):
    """Ping GPS recibido de un repartidor/vendedor de calle."""
    __tablename__ = "gps_pings"

    empresa_id   = Column(String, index=True, nullable=False)
    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    route_id     = Column(String, nullable=False)
    user_id      = Column(String, nullable=False)
    lat          = Column(Numeric(9, 6), nullable=False)
    lng          = Column(Numeric(9, 6), nullable=False)
    accuracy_m   = Column(Numeric(8, 2), nullable=True)
    speed_kmh    = Column(Numeric(6, 2), nullable=True)
    recorded_at  = Column(DateTime(timezone=True), nullable=False)
    deviation_m  = Column(Numeric(9, 2), nullable=True)
    is_deviated  = Column(Boolean, nullable=False, default=False, server_default=sa_false())

    route = relationship("Route", back_populates="pings")

    __table_args__ = (
        ForeignKeyConstraint(
            ["empresa_id", "route_id"],
            ["routes.empresa_id", "routes.id"],
            name="fk_gps_route_tenant",
        ),
        Index("idx_gps_pings_route",    "empresa_id", "route_id"),
        Index("idx_gps_pings_user",     "empresa_id", "user_id"),
        Index("idx_gps_pings_recorded", "empresa_id", "recorded_at"),
    )


# =============================================================================
# DA-7items — Comisiones sobre recaudo, Comodato / Consignación, Contrato adhesión
# =============================================================================

class SellerCommissionLedger(Base):
    """Comisión generada al vendedor por cobro recibido (PPD/recaudo).

    entry_type:
      generated — comisión calculada al registrar un abono CxC.
      paid       — el admin registra la liquidación al vendedor.
      reversed   — reversión por devolución o anulación del cobro.
    """
    __tablename__ = "seller_commission_ledger"

    id            = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id    = Column(String, index=True, nullable=False)
    employee_id   = Column(String, index=True, nullable=False)
    entry_type    = Column(String, nullable=False)             # generated | paid | reversed
    amount        = Column(Numeric(15, 4), nullable=False)
    sale_id       = Column(String, nullable=True)
    ar_payment_id = Column(String, nullable=True)             # AccountReceivablePayment.id
    base_amount   = Column(Numeric(15, 4), nullable=True)     # monto del abono base
    rate_applied  = Column(Numeric(7, 4), nullable=True)      # tasa % usada
    descripcion   = Column(String, nullable=True)
    registrado_por = Column(String, nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_scl_employee", "empresa_id", "employee_id", "entry_type"),
    )


# Canales de venta válidos (referencia documental; validación en el backend).
# mostrador  — venta presencial en el mostrador de la sucursal
# caja       — venta completamente procesada en terminal POS / caja; sin comisión
# telefono   — pedido por llamada telefónica
# whatsapp   — pedido por WhatsApp (canal M-RS, Twilio)
# facebook   — pedido vía Facebook / Messenger
# web        — pedido desde tienda en línea o página web
CANALES_VENTA_VALIDOS = ("mostrador", "caja", "telefono", "whatsapp", "facebook", "web")

# Roles que NUNCA generan comisión por ventas, sin importar canal.
ROLES_SIN_COMISION = {"cajero"}


class AdhesionContract(Base):
    """Contrato de adhesión ligado a cliente y/o venta.

    Un tenant puede definir una plantilla maestra (client_id = NULL, sale_id = NULL)
    que el admin del tenant carga en AdminConfig (clave 'adhesion.template').
    Cuando se activa para un cliente concreto se crea una fila hija con
    client_id / sale_id rellenos y firmado_cliente = True cuando el cliente acepta.

    tipo: venta | credito | comodato | servicio
    firma_medio: digital | fisica | whatsapp | email
    status: borrador | vigente | vencido | cancelado
    """
    __tablename__ = "adhesion_contracts"

    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id      = Column(String, index=True, nullable=False)
    sucursal_id     = Column(String, nullable=False, server_default="MATRIZ")
    client_id       = Column(String, nullable=True)
    sale_id         = Column(String, nullable=True)
    tipo            = Column(String, nullable=False, server_default="venta")
    version         = Column(String, nullable=True)
    contenido       = Column(Text, nullable=True)
    firmado_cliente = Column(Boolean, nullable=False, server_default=sa_false())
    firma_fecha     = Column(DateTime(timezone=True), nullable=True)
    firma_medio     = Column(String, nullable=True)
    status          = Column(String, nullable=False, server_default="borrador")
    notas           = Column(String, nullable=True)
    created_by      = Column(String, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at      = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_adhesion_tenant_client", "empresa_id", "client_id"),
    )


class ComodatoItem(Base):
    """Producto entregado en comodato, préstamo o consignación.

    tipo: comodato | prestamo | consignacion
      comodato     — el cliente usa el bien, lo devuelve igual; no paga uso.
      prestamo     — similar al comodato pero con fecha límite estricta / garantía.
      consignacion — el cliente puede vender el bien; si vende, paga; si no, devuelve.

    status: activo | devuelto | vendido | perdido | vencido
    """
    __tablename__ = "comodato_items"

    id                        = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id                = Column(String, index=True, nullable=False)
    sucursal_id               = Column(String, nullable=False, server_default="MATRIZ")
    tipo                      = Column(String, nullable=False)    # comodato | prestamo | consignacion
    product_id                = Column(String, nullable=True)
    descripcion               = Column(String, nullable=False)
    cantidad                  = Column(Numeric(15, 4), nullable=False, server_default="1")
    client_id                 = Column(String, nullable=True)
    sale_id                   = Column(String, nullable=True)
    adhesion_contract_id      = Column(String, nullable=True)
    folio                     = Column(String, nullable=True, index=True)
    fecha_entrega             = Column(DateTime(timezone=True), nullable=True)
    fecha_devolucion_pactada  = Column(DateTime(timezone=True), nullable=True)
    fecha_devolucion_real     = Column(DateTime(timezone=True), nullable=True)
    condicion_entrega         = Column(String, nullable=True)
    condicion_retorno         = Column(String, nullable=True)
    valor_garantia            = Column(Numeric(15, 4), nullable=True)
    precio_venta_pactado      = Column(Numeric(15, 4), nullable=True)  # solo consignación
    status                    = Column(String, nullable=False, server_default="activo")
    notas                     = Column(String, nullable=True)
    created_by                = Column(String, nullable=True)
    created_at                = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at                = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_comodato_tenant_status", "empresa_id", "status", "tipo"),
        Index("idx_comodato_client",        "empresa_id", "client_id"),
    )


# ── APARTADOS (LAYAWAYS) — F5 ─────────────────────────────────────────────────

class Layaway(Base):
    """Apartado: cliente abona parcialmente, mercancía reservada hasta 6 meses.
    Ciclo: ACTIVO → COMPLETADO (pago total) | CANCELADO | VENCIDO (cron).
    Al vencer: stock vuelve al inventario, saldo abonado pasa a Anticipo del cliente.
    """
    __tablename__ = "layaways"

    empresa_id        = Column(String, nullable=False, index=True)
    sucursal_id       = Column(String, nullable=False, server_default="MATRIZ")
    id                = Column(String, primary_key=True, index=True,
                               default=lambda: str(uuid.uuid4()))
    folio             = Column(String, nullable=True)
    client_id         = Column(String, nullable=False)
    client_name       = Column(String, nullable=False)
    seller_id         = Column(String, nullable=True)
    total_amount      = Column(Numeric(15, 4), nullable=False)
    amount_paid       = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    amount_pending    = Column(Numeric(15, 4), nullable=False)
    # ACTIVO | VENCIDO | COMPLETADO | CANCELADO
    status            = Column(String, nullable=False, server_default="ACTIVO")
    fecha_vencimiento = Column(DateTime(timezone=True), nullable=False)
    nota              = Column(String, nullable=True)
    is_synced         = Column(Boolean, server_default="false", nullable=False)
    created_by        = Column(String, nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at        = Column(DateTime(timezone=True), nullable=True)

    items    = relationship("LayawayItem",    back_populates="layaway",
                            cascade="all, delete-orphan")
    payments = relationship("LayawayPayment", back_populates="layaway",
                            cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_layaways_tenant_status",  "empresa_id", "status"),
        Index("idx_layaways_client",         "empresa_id", "client_id"),
        Index("idx_layaways_vencimiento",    "empresa_id", "fecha_vencimiento", "status"),
    )


class LayawayItem(Base):
    """Línea de producto reservada dentro de un apartado."""
    __tablename__ = "layaway_items"

    empresa_id  = Column(String, nullable=False, index=True)
    id          = Column(String, primary_key=True, index=True,
                         default=lambda: str(uuid.uuid4()))
    layaway_id  = Column(String, ForeignKey("layaways.id"), nullable=False)
    product_id  = Column(String, nullable=True)
    product_sku = Column(String, nullable=False)
    description = Column(String, nullable=False, server_default="")
    quantity    = Column(Numeric(15, 4), nullable=False)
    price       = Column(Numeric(15, 4), nullable=False)
    subtotal    = Column(Numeric(15, 4), nullable=False)

    layaway = relationship("Layaway", back_populates="items")

    __table_args__ = (
        Index("idx_layaway_items_layaway", "empresa_id", "layaway_id"),
    )


class LayawayPayment(Base):
    """Abono aplicado a un apartado."""
    __tablename__ = "layaway_payments"

    empresa_id      = Column(String, nullable=False, index=True)
    id              = Column(String, primary_key=True, index=True,
                             default=lambda: str(uuid.uuid4()))
    layaway_id      = Column(String, ForeignKey("layaways.id"), nullable=False)
    amount          = Column(Numeric(15, 4), nullable=False)
    # efectivo | cheque | transferencia | tarjeta_credito | tarjeta_debito
    payment_method  = Column(String, nullable=False, server_default="efectivo")
    payment_details = Column(String, nullable=True)   # JSON (mismo esquema que sales.payment_details)
    is_synced       = Column(Boolean, server_default="false", nullable=False)
    created_by      = Column(String, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    layaway = relationship("Layaway", back_populates="payments")

    __table_args__ = (
        Index("idx_layaway_payments_layaway", "empresa_id", "layaway_id"),
    )


# ---------------------------------------------------------------------------
# PRE-RESERVAS DE INVENTARIO (C-04 / nr07_stock_reservation)
# ---------------------------------------------------------------------------

class StockReservation(Base):
    """Reserva temporal de stock con TTL.
    status: ACTIVE | EXPIRED | CONSUMED | RELEASED
    reference_type: LAYAWAY | POS_SESSION | PRESALE
    """
    __tablename__ = "stock_reservations"
    empresa_id     = Column(String, nullable=False, index=True)
    sucursal_id    = Column(String, nullable=False, server_default="MATRIZ")
    id             = Column(String, primary_key=True, index=True,
                            default=lambda: str(uuid.uuid4()))
    product_id     = Column(String, nullable=False)
    warehouse_id   = Column(String, nullable=False)
    quantity       = Column(Numeric(15, 4), nullable=False)
    reference_type = Column(String, nullable=False)
    reference_id   = Column(String, nullable=False)
    expires_at     = Column(DateTime(timezone=True), nullable=False)
    status         = Column(String, nullable=False, server_default="ACTIVE")
    created_by     = Column(String, nullable=True)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_stock_res_product",
              "empresa_id", "product_id", "warehouse_id", "status"),
        Index("idx_stock_res_reference",
              "empresa_id", "reference_type", "reference_id"),
        Index("idx_stock_res_expires", "expires_at", "status"),
    )


# ---------------------------------------------------------------------------
# TRASPASOS CON CICLO DE VIDA (nr06_transfers_ext)
# Los movimientos de stock reales siguen en inventory_movements.
# Esta tabla registra el ciclo: SOLICITADO → AUTORIZADO → EN_TRANSITO → RECIBIDO.
# ---------------------------------------------------------------------------

class Transfer(Base):
    """tipo: VIRTUAL | FISICO
    status: SOLICITADO | AUTORIZADO | EN_TRANSITO | RECIBIDO | RECHAZADO | CANCELADO
    """
    __tablename__ = "transfers"
    empresa_id          = Column(String, nullable=False, index=True)
    id                  = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    folio               = Column(String, nullable=True)
    tipo                = Column(String, nullable=False, server_default="VIRTUAL")
    status              = Column(String, nullable=False, server_default="SOLICITADO")
    sucursal_origen_id  = Column(String, nullable=False)
    sucursal_destino_id = Column(String, nullable=True)
    warehouse_origin_id = Column(String, nullable=False)
    warehouse_dest_id   = Column(String, nullable=False)
    requested_by        = Column(String, nullable=False)
    authorized_by       = Column(String, nullable=True)
    authorized_at       = Column(DateTime(timezone=True), nullable=True)
    received_by         = Column(String, nullable=True)
    received_at         = Column(DateTime(timezone=True), nullable=True)
    notes               = Column(String, nullable=True)
    rejection_reason    = Column(String, nullable=True)
    is_synced           = Column(Boolean, server_default="false", nullable=False)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), nullable=True)

    items = relationship("TransferItem", back_populates="transfer", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_transfers_tenant_status", "empresa_id", "status", "tipo"),
        Index("idx_transfers_origen", "empresa_id", "sucursal_origen_id", "status"),
    )


class TransferItem(Base):
    __tablename__ = "transfer_items"
    empresa_id         = Column(String, nullable=False, index=True)
    id                 = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    transfer_id        = Column(String, ForeignKey("transfers.id"), nullable=False)
    product_id         = Column(String, nullable=True)
    product_sku        = Column(String, nullable=False)
    description        = Column(String, nullable=False, server_default="")
    quantity_requested = Column(Numeric(15, 4), nullable=False)
    quantity_sent      = Column(Numeric(15, 4), nullable=True)
    quantity_received  = Column(Numeric(15, 4), nullable=True)

    transfer = relationship("Transfer", back_populates="items")

    __table_args__ = (
        Index("idx_transfer_items_transfer", "empresa_id", "transfer_id"),
    )


# ---------------------------------------------------------------------------
# AUTORIZACIONES DE SALIDA TEMPRANA (rh04_attn_auth)
# En SQLite local se crea en caliente via _reloj_ensure_auth_table().
# En Postgres/Supabase la crea la migración rh04_attn_auth.
# ---------------------------------------------------------------------------

class AttendanceAuthorization(Base):
    """Solicitud de autorización cuando la salida es < 4h desde la entrada.
    status: pendiente | aprobado | rechazado
    """
    __tablename__ = "attendance_authorizations"
    id                  = Column(Integer, primary_key=True, autoincrement=True)
    user_id             = Column(String(64), nullable=False)
    empresa_id          = Column(String(64), nullable=False)
    sucursal_id         = Column(String(64), nullable=True)
    event_date          = Column(String(10), nullable=False)
    entrada_ts          = Column(String(40), nullable=False)
    intento_ts          = Column(String(40), nullable=False)
    horas_transcurridas = Column(Float, nullable=False)
    status              = Column(String(16), nullable=False, server_default="pendiente")
    resolved_by         = Column(String(64), nullable=True)
    resolved_at         = Column(String(40), nullable=True)
    salida_event_id     = Column(String(64), nullable=True)
    created_at          = Column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_attn_auth_pendientes", "status", "event_date"),
        Index("ix_attn_auth_user_date", "user_id", "event_date"),
    )


# =============================================================================
# RECEPCIÓN DE MERCANCÍA 360° (Asistente de Recepción, Landed Cost, Evidencias,
# Incidencias, Calificación de proveedores y Gastos de flete)
# En SQLite local las tablas se crean con create_all(); en Postgres/Supabase se
# crean con la migración alembic r360_reception_hub.
# =============================================================================

class ReceptionExpediente(Base):
    """Expediente único 360° de una recepción de mercancía.

    Resume en columnas lo que se consulta/filtra en el dashboard y guarda en
    `payload` (JSON) los 13 puntos de auditoría completos. Los archivos pesados
    (XML, PDF, fotos, firmas) viven en ReceptionFile.
    """
    __tablename__ = "reception_expedientes"

    empresa_id        = Column(String, index=True, nullable=False)
    sucursal_id       = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id                = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    folio             = Column(String, nullable=False)                 # RCP-2026-0001
    idempotency_key   = Column(String, nullable=False)

    origin_type       = Column(String, nullable=False, server_default="OC")   # OC|DIRECTA|TRASPASO|REPOSICION|CONSIGNACION
    po_folio          = Column(String, nullable=True)
    purchase_order_id = Column(String, nullable=True)
    purchase_receipt_id = Column(String, nullable=True)
    purchase_receipt_folio = Column(String, nullable=True)

    supplier_id       = Column(String, nullable=True)
    supplier_name     = Column(String, nullable=False, server_default="")
    supplier_rfc      = Column(String, nullable=True)
    warehouse_id      = Column(String, nullable=False)

    invoice_uuid      = Column(String, nullable=True, index=True)
    invoice_serie     = Column(String, nullable=True)
    invoice_folio     = Column(String, nullable=True)
    invoice_date      = Column(String, nullable=True)
    payment_condition = Column(String, nullable=False, server_default="CREDITO")  # CREDITO|CONTADO|TRANSFERENCIA

    subtotal          = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    tax_amount        = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    total             = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    payable_total     = Column(Numeric(15, 4), nullable=False, server_default="0.0000")   # lo que realmente se debe/pagó

    freight_condition = Column(String, nullable=True)
    freight_total     = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    freight_pct       = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    prorate_method    = Column(String, nullable=True)

    physical_state    = Column(String, nullable=False, server_default="SELLADA")       # SELLADA|VIOLADA|DANADA
    status            = Column(String, nullable=False, server_default="COMPLETA")      # COMPLETA|INCIDENCIA|NC_PENDIENTE|RESUELTA
    incident_action   = Column(String, nullable=True)                                   # NC|REPOSICION
    incident_status   = Column(String, nullable=False, server_default="NINGUNA")        # NINGUNA|ABIERTO|EN_PROCESO|NC_APLICADA|REPOSICION_RECIBIDA|CONCLUIDO
    disputed_amount   = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    rating_avg        = Column(Numeric(6, 2), nullable=False, server_default="0.00")

    accounts_payable_id = Column(String, nullable=True)
    freight_expense_id  = Column(String, nullable=True)

    payload           = Column(JSON, nullable=True)
    created_by        = Column(String, nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at        = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("empresa_id", "folio", name="uq_reception_exp_folio"),
        UniqueConstraint("empresa_id", "idempotency_key", name="uq_reception_exp_idem"),
        Index("idx_reception_exp_empresa_date", "empresa_id", "created_at"),
        Index("idx_reception_exp_supplier", "empresa_id", "supplier_id"),
    )


class ReceptionFile(Base):
    """Archivo del expediente (XML/PDF de factura y flete, carta porte, fotos, firmas)."""
    __tablename__ = "reception_files"

    empresa_id     = Column(String, index=True, nullable=False)
    id             = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    expediente_id  = Column(String, index=True, nullable=False)
    kind           = Column(String, nullable=False)     # FACTURA_XML|FACTURA_PDF|FLETE_XML|FLETE_PDF|CARTA_PORTE|PACKING_LIST|FOTO_LLEGADA|FOTO_DANO|FIRMA_CHOFER|FIRMA_ALMACEN|FIRMA_SUPERVISOR|REPORTE_INCIDENCIA
    item_ref       = Column(String, nullable=True)      # SKU cuando la evidencia es de un producto
    filename       = Column(String, nullable=False, server_default="archivo")
    mime           = Column(String, nullable=False, server_default="application/octet-stream")
    size_bytes     = Column(Integer, nullable=False, server_default="0")
    content_b64    = Column(Text, nullable=False)
    created_at     = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_reception_files_exp", "empresa_id", "expediente_id"),
    )


class OperatingExpense(Base):
    """Gasto operativo. Alimentado automáticamente por el flete / maniobras de una recepción."""
    __tablename__ = "operating_expenses"

    empresa_id        = Column(String, index=True, nullable=False)
    sucursal_id       = Column(String, index=True, nullable=False, server_default="MATRIZ")
    id                = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    folio             = Column(String, nullable=False)                 # GTO-2026-0001
    category          = Column(String, nullable=False, server_default="FLETE_COMPRAS")
    concept           = Column(String, nullable=False, server_default="")
    amount            = Column(Numeric(15, 4), nullable=False, server_default="0.0000")
    capitalized       = Column(Boolean, nullable=False, server_default="1")   # True => capitalizado al costo de inventario (Landed Cost)
    supplier_name     = Column(String, nullable=True)
    supplier_rfc      = Column(String, nullable=True)
    doc_uuid          = Column(String, nullable=True)
    doc_folio         = Column(String, nullable=True)
    payment_condition = Column(String, nullable=False, server_default="CONTADO")   # CONTADO|POR_COBRAR|CREDITO
    status            = Column(String, nullable=False, server_default="PAGADO")    # PAGADO|PENDIENTE_CXP
    expediente_id     = Column(String, nullable=True, index=True)
    accounts_payable_id = Column(String, nullable=True)
    detail            = Column(JSON, nullable=True)
    created_by        = Column(String, nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("empresa_id", "folio", name="uq_operating_expense_folio"),
    )



class DashboardLayout(Base):
    """Persistencia de layouts configurables del Dashboard ERP (multi-tenant, jerárquico)."""
    __tablename__ = "dashboard_layouts"

    id             = Column(String(36), primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    empresa_id     = Column(String(64), index=True, nullable=False)
    sucursal_id    = Column(String(64), index=True, nullable=True)
    user_id        = Column(String(64), index=True, nullable=True)
    role_id        = Column(String(64), index=True, nullable=True)
    dashboard_key  = Column(String(64), index=True, nullable=False, default="erp_main", server_default="erp_main")
    name           = Column(String(140), nullable=False, default="DASHBOARD EJECUTIVO", server_default="DASHBOARD EJECUTIVO")
    scope_type     = Column(String(24), nullable=False, default="user", server_default="user")  # system|company|branch|role|user
    scope_id       = Column(String(80), nullable=True)
    is_default     = Column(Boolean, index=True, nullable=False, default=False, server_default="0")
    is_locked      = Column(Boolean, nullable=False, default=False, server_default="0")
    layout_json    = Column(JSON, nullable=False)
    theme_json     = Column(JSON, nullable=True)
    filters_json   = Column(JSON, nullable=True)
    version        = Column(Integer, nullable=False, default=1, server_default="1")
    created_by     = Column(String(64), nullable=True)
    updated_by     = Column(String(64), nullable=True)
    created_at_utc = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at_utc = Column(DateTime(timezone=True), index=True, server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at_utc = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_dash_layouts_emp_scope", "empresa_id", "dashboard_key", "scope_type", "is_default"),
        Index("idx_dash_layouts_emp_user", "empresa_id", "user_id", "dashboard_key"),
        Index("idx_dash_layouts_emp_role", "empresa_id", "role_id", "dashboard_key"),
        Index("idx_dash_layouts_emp_branch", "empresa_id", "sucursal_id", "dashboard_key"),
    )


class DashboardLayoutAudit(Base):
    """Bitácora de auditoría de cambios en layouts del Dashboard ERP."""
    __tablename__ = "dashboard_layout_audit"

    id             = Column(String(36), primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    empresa_id     = Column(String(64), index=True, nullable=False)
    layout_id      = Column(String(36), index=True, nullable=False)
    user_id        = Column(String(64), index=True, nullable=True)
    action         = Column(String(40), nullable=False)
    prev_version   = Column(Integer, nullable=True)
    new_version    = Column(Integer, nullable=True)
    ip_address     = Column(String(64), nullable=True)
    summary        = Column(Text, nullable=True)
    created_at_utc = Column(DateTime(timezone=True), index=True, server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_dash_audit_emp_layout", "empresa_id", "layout_id", "created_at_utc"),
    )
