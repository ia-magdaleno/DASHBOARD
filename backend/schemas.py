from pydantic import BaseModel, ConfigDict, model_validator
from typing import Any, List, Optional
from datetime import datetime

# --- Product Schemas ---
class ProductBase(BaseModel):
    sku: str
    description: str
    price: float
    stock: float
    unit: Optional[str] = None            # sale_unit del modelo (Pieza, Caja, Metro...)
    stock_minimo: Optional[float] = None  # umbral de alerta; None = sin alerta
    name: Optional[str] = None
    barcode: Optional[str] = None
    sales_code: Optional[str] = None
    purchase_unit: Optional[str] = None
    sale_unit: Optional[str] = None
    conversion_factor: Optional[float] = None
    average_cost: Optional[float] = None
    foto_url: Optional[str] = None
    meta_data: Optional[dict] = None

class ProductCreate(ProductBase):
    price_scales: Optional[List[Any]] = None

# NR-03: escala de precio de un producto
class ProductPriceScaleOut(BaseModel):
    scale_name: str
    price: float
    margin: float
    model_config = ConfigDict(from_attributes=True)

class Product(ProductBase):
    # NR-03: devolver las escalas de precio para resolucion en el POS
    price_scales: List[ProductPriceScaleOut] = []

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm_product(cls, orm_obj):
        """Helper: construye Product desde ORM o dict mapeando sale_unit -> unit."""
        if isinstance(orm_obj, dict):
            g = orm_obj.get
            raw_scales = g("price_scales") or (g("meta_data") or {}).get("price_scales") or []
            scales = [
                {
                    "scale_name": str(ps.get("scale_name") or ps.get("nombre") or ps.get("name") or "").strip(),
                    "price": float(ps.get("price") if ps.get("price") is not None else (ps.get("precio_activo") if ps.get("precio_activo") is not None else ps.get("precio") or 0)),
                    "margin": float(ps.get("margin") if ps.get("margin") is not None else (ps.get("margen_trabajo") if ps.get("margen_trabajo") is not None else ps.get("margen_ideal") or 0)),
                }
                for ps in raw_scales
                if isinstance(ps, dict) and (ps.get("scale_name") or ps.get("nombre") or ps.get("name")) and ps.get("activa", True) is not False
            ]
            data = {
                "sku":          g("sku"),
                "description":  g("description"),
                "price":        float(g("price") or 0),
                "stock":        float(g("stock") or 0),
                "unit":         g("sale_unit") or g("unit"),
                "name":         g("name"),
                "barcode":      g("barcode"),
                "sales_code":   g("sales_code"),
                "purchase_unit": g("purchase_unit"),
                "sale_unit":    g("sale_unit"),
                "conversion_factor": float(g("conversion_factor") or 1),
                "average_cost": float(g("average_cost") or 0),
                "foto_url":     (g("foto_url") if (isinstance(g("foto_url"), str) and ("/admin" not in g("foto_url") or g("foto_url").startswith("data:image/"))) else None) or ((g("meta_data") or {}).get("foto_url") if isinstance(g("meta_data"), dict) else None),
                "meta_data":    g("meta_data"),
                "stock_minimo": float(g("stock_minimo")) if g("stock_minimo") is not None else None,
                "price_scales": scales,
            }
        else:
            # ORM object (PostgreSQL / SQLAlchemy)
            orm_scales = [
                {"scale_name": ps.scale_name, "price": float(ps.price), "margin": float(ps.margin)}
                for ps in (orm_obj.price_scales or [])
            ]
            if not orm_scales and isinstance(orm_obj.meta_data, dict):
                raw_meta_scales = orm_obj.meta_data.get("price_scales") or []
                orm_scales = [
                    {
                        "scale_name": str(ps.get("scale_name") or ps.get("nombre") or ps.get("name") or "").strip(),
                        "price": float(ps.get("price") if ps.get("price") is not None else (ps.get("precio_activo") if ps.get("precio_activo") is not None else ps.get("precio") or 0)),
                        "margin": float(ps.get("margin") if ps.get("margin") is not None else (ps.get("margen_trabajo") if ps.get("margen_trabajo") is not None else ps.get("margen_ideal") or 0)),
                    }
                    for ps in raw_meta_scales
                    if isinstance(ps, dict) and (ps.get("scale_name") or ps.get("nombre") or ps.get("name")) and ps.get("activa", True) is not False
                ]
            raw_orm_foto = orm_obj.foto_url
            if isinstance(raw_orm_foto, str) and ("/admin" in raw_orm_foto and not raw_orm_foto.startswith("data:image/")):
                raw_orm_foto = None
            if not raw_orm_foto and isinstance(orm_obj.meta_data, dict):
                mf = orm_obj.meta_data.get("foto_url") or orm_obj.meta_data.get("image_url")
                if isinstance(mf, str) and ("/admin" not in mf or mf.startswith("data:image/")):
                    raw_orm_foto = mf
            data = {
                "sku":          orm_obj.sku,
                "description":  orm_obj.description,
                "price":        float(orm_obj.price or 0),
                "stock":        float(orm_obj.stock or 0),
                "unit":         orm_obj.sale_unit,
                "name":         orm_obj.name,
                "barcode":      orm_obj.barcode,
                "sales_code":   orm_obj.sales_code,
                "purchase_unit": orm_obj.purchase_unit,
                "sale_unit":    orm_obj.sale_unit,
                "conversion_factor": float(orm_obj.conversion_factor or 1),
                "average_cost": float(orm_obj.average_cost or 0),
                "foto_url":     raw_orm_foto,
                "meta_data":    orm_obj.meta_data,
                "stock_minimo": float(orm_obj.stock_minimo) if orm_obj.stock_minimo is not None else None,
                "price_scales": orm_scales,
            }
        return cls(**data)


# --- Client Schemas ---
class ClientBase(BaseModel):
    client_code: Optional[str] = None
    name: str
    rfc: Optional[str] = None
    client_type: str = "Público General"
    phone: Optional[str] = None
    saldo_favor: float = 0.0
    email: Optional[str] = None
    whatsapp: Optional[str] = None
    regimen_fiscal: Optional[str] = None
    uso_cfdi: Optional[str] = None
    direccion: Optional[str] = None
    numero_ext: Optional[str] = None
    numero_int: Optional[str] = None
    colonia: Optional[str] = None
    ciudad: Optional[str] = None
    municipio: Optional[str] = None
    estado: Optional[str] = None
    cp: Optional[str] = None
    pais: Optional[str] = "México"
    limite_credito: float = 0.0
    dias_credito: int = 30
    puntos: int = 0
    resguardos: bool = False
    facebook: Optional[str] = None
    instagram: Optional[str] = None
    apartados: float = 0.0
    ultima_compra: str = "S/N"
    saldo_actual: float = 0.0
    # NR-03: escala de precio asignada al cliente
    assigned_price_scale: str = "Público General"

    @model_validator(mode="before")
    @classmethod
    def _coerce_null_client_defaults(cls, data: Any) -> Any:
        defaults = {
            "client_type": "P\u00fablico General",
            "saldo_favor": 0.0,
            "limite_credito": 0.0,
            "dias_credito": 30,
            "puntos": 0,
            "resguardos": False,
            "apartados": 0.0,
            "ultima_compra": "S/N",
            "saldo_actual": 0.0,
            "assigned_price_scale": "P\u00fablico General",
        }
        if isinstance(data, dict):
            out = dict(data)
            for k, dv in defaults.items():
                if out.get(k) is None:
                    out[k] = dv
            return out
        for k, dv in defaults.items():
            if hasattr(data, k) and getattr(data, k) is None:
                try:
                    setattr(data, k, dv)
                except Exception:
                    pass
        return data

class ClientCreate(ClientBase):
    pass

class Client(ClientBase):
    id: str
    model_config = ConfigDict(from_attributes=True)


# --- Sale Item Schemas ---
class SaleItemBase(BaseModel):
    product_sku: str
    quantity: float
    price: float
    subtotal: float
    returned_quantity: float = 0.0

class SaleItemCreate(SaleItemBase):
    pass

class SaleItem(SaleItemBase):
    id: str
    sale_id: str
    model_config = ConfigDict(from_attributes=True)


# --- Sale Schemas ---
class SaleBase(BaseModel):
    client_id: Optional[str] = None  # Fix A-01: null = auto-resolver cliente mostrador XAXX010101000
    total: float
    payment_method: str # e.g. "001", "002", "003", "004", "006", "008"
    amount_paid: float
    change_returned: float
    is_cfdi: bool = False
    discount: float = 0.0
    advance: float = 0.0
    is_safekept:          bool  = False
    saldo_favor_applied:  float = 0.0
    # C-03 / pago multimodal: detalles del metodo de pago. En la request llega
    # como objeto (p.ej. {"splits":[{"method":"003","amount":500}, ...]}); en la
    # response se devuelve tal cual lo guarda la BD (string JSON). Optional[Any]
    # acepta ambos sin romper la serializacion del response_model.
    payment_details:  Optional[Any] = None

class SaleCreate(SaleBase):
    items: List[SaleItemCreate]
    # Fix A3: clave opcional para idempotencia (doble click / retry de red)
    idempotency_key: Optional[str] = None
    # payment_details heredado de SaleBase (C-03)
    seller_id: Optional[str] = None    # ítem 3: employee_id del vendedor que cobró
    project_id: Optional[str] = None   # ítem 2: obra/proyecto asociado (nullable)
    # DA-7items: canal de origen (mostrador|caja|telefono|whatsapp|facebook|web)
    # y sucursal que entregará los bienes en ventas remotas.
    canal_venta: Optional[str] = None          # default: 'mostrador'
    sucursal_entrega_id: Optional[str] = None

class Sale(SaleBase):
    id: str
    folio: Optional[str] = None
    parent_sale_id: Optional[str] = None
    sucursal_id: Optional[str] = None
    created_at: datetime
    items: List[SaleItem]
    client: Client
    # T-4f: renglones que quedaron a resguardo por faltante (para leyenda POS/ticket)
    resguardos: List[dict] = []
    # NR-04: sub-facturas generadas por split de efectivo > $2,000 MXN.
    # Solo se puebla en la respuesta de la factura raíz; las sub-facturas lo traen vacío.
    nr04_sub_sales: List[dict] = []

    model_config = ConfigDict(from_attributes=True)


# --- Credit (Cuentas por Cobrar) Schemas ---
class AccountsReceivableBase(BaseModel):
    client_id: str
    sale_id: str
    original_amount: float
    current_balance: float
    status: str = "Pendiente"

class AccountsReceivable(AccountsReceivableBase):
    id: str
    created_at: datetime
    client: Client
    # CP2 — cartera real
    due_date: Optional[datetime] = None
    sale_folio: Optional[str] = None
    anticipo_aplicado: float = 0.0
    model_config = ConfigDict(from_attributes=True)

class AccountsReceivablePayment(BaseModel):
    """COMPAT — body del endpoint legacy POST /api/accounts-receivable/{id}/pay."""
    amount: float


# --- CP2: abonos de cartera con historial ---
class ARPaymentCreate(BaseModel):
    amount: float
    method: str = "efectivo"
    reference: Optional[str] = None
    # efectivo | saldo_favor | anticipo — de donde sale el dinero del abono
    applied_from: str = "efectivo"
    notes: Optional[str] = None
    idempotency_key: Optional[str] = None

class ARPayment(BaseModel):
    id: str
    ar_id: str
    client_id: str
    amount: float
    method: str
    reference: Optional[str] = None
    applied_from: str
    balance_after: float
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ARAgingRow(BaseModel):
    client_id: str
    client_name: str
    cuentas: int
    total: float
    buckets: dict

class ARAgingReport(BaseModel):
    as_of: str
    buckets: List[str]
    rows: List[ARAgingRow]
    totales: dict
    total_cartera: float
    cuentas: int


# --- Safekeeping (Resguardos) & Kardex Schemas ---
class KardexDeliveryBase(BaseModel):
    safekept_item_id: str
    quantity_delivered: float
    notes: Optional[str] = None

class KardexDeliveryCreate(KardexDeliveryBase):
    pass

class KardexDelivery(KardexDeliveryBase):
    id: str
    delivery_date: datetime
    model_config = ConfigDict(from_attributes=True)

class SafekeptItemBase(BaseModel):
    sale_id: str
    product_sku: str
    quantity_ordered: float
    quantity_delivered: float = 0.0
    status: str = "SOLICITADO"

class SafekeptItem(SafekeptItemBase):
    id: str
    created_at: datetime
    product: Product
    deliveries: List[KardexDelivery] = []
    origen: Optional[str] = None
    costo_estimado: Optional[float] = None
    eta_date: Optional[str] = None
    expira_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# --- Transfer Log Schemas ---
# Fix C2 (auditoria 2026-08-03): 'destination' como texto libre no permite
# saber a que bodega real llego el traspaso ni descontar/sumar donde
# corresponde -- ver crud.create_transfer. Se reemplaza por IDs reales de
# bodega; 'destination_warehouse_id' es obligatorio, 'source_warehouse_id'
# es opcional (si no se especifica, se usa la bodega principal del tenant).
class TransferLogBase(BaseModel):
    product_sku: str
    quantity: float
    destination_warehouse_id: str
    source_warehouse_id: Optional[str] = None

class TransferLogCreate(TransferLogBase):
    pass

class TransferLog(BaseModel):
    id: str
    product_sku: str
    quantity: float
    source_warehouse_id: Optional[str] = None
    source_warehouse_name: Optional[str] = None
    destination_warehouse_id: str
    destination_warehouse_name: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# --- Returns Schemas ---
class SaleReturnItem(BaseModel):
    product_sku: str
    quantity_returned: float
    notes: Optional[str] = None

class SaleReturnBatch(BaseModel):
    items: List[SaleReturnItem]
    total_refund_amount: float
    refund_method: str  # "Efectivo", "Saldo a Favor", "Tarjeta"


# --- Parked Sale Schemas ---
class ParkedSaleItemBase(BaseModel):
    product_sku: str
    description: str
    quantity: float
    price: float
    subtotal: float
    source_group: Optional[str] = None

class ParkedSaleItemCreate(ParkedSaleItemBase):
    pass

class ParkedSaleItem(ParkedSaleItemBase):
    id: str
    parked_sale_id: str
    model_config = ConfigDict(from_attributes=True)

class ParkedSaleCommentBase(BaseModel):
    author: str
    comment: str

class ParkedSaleCommentCreate(ParkedSaleCommentBase):
    pass

class ParkedSaleComment(ParkedSaleCommentBase):
    id: str
    parked_sale_id: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ParkedSaleBase(BaseModel):
    client_id: str # Phone number / main identifier
    client_name: str
    client_rfc: Optional[str] = None
    seller: str
    branch: str
    total: float
    is_merged: bool = False
    merged_from_ids: Optional[str] = None

class ParkedSaleCreate(ParkedSaleBase):
    items: List[ParkedSaleItemCreate]
    comment: Optional[str] = None # initial comment if any

class ParkedSale(ParkedSaleBase):
    id: str
    folio: Optional[str] = None
    created_at: datetime
    items: List[ParkedSaleItem]
    comments: List[ParkedSaleComment] = []
    model_config = ConfigDict(from_attributes=True)

class ParkedSaleMerge(BaseModel):
    # account_ids era List[int] (heredado de antes de la migracion de
    # ParkedSale.id a UUID de texto, migracion 8276e9755f9a) -- rechazaba
    # con 422 cualquier id real que mandara el frontend (hallazgo C3)
    account_ids: List[str]
    new_client_name: str
    seller: str
    branch: str

class ParkedSaleTransfer(BaseModel):
    account_ids: List[str]
    destination_branch: str

class ParkedSaleRename(BaseModel):
    client_name: str

class ParkedSaleCommentAdd(BaseModel):
    comment_text: str
    author: str

class ClientSaldoFavorUpdate(BaseModel):
    amount: float
    description: Optional[str] = None

class AnticipoCargo(BaseModel):
    amount: float
    description: Optional[str] = None
    payment_method: Optional[str] = "efectivo"


class CustomerCreditLedgerBase(BaseModel):
    client_id: str
    amount: float
    transaction_type: str
    sale_id: Optional[str] = None
    description: Optional[str] = None

class CustomerCreditLedgerCreate(CustomerCreditLedgerBase):
    pass

class CustomerCreditLedger(CustomerCreditLedgerBase):
    id: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class QuoteItemBase(BaseModel):
    product_sku: str
    description: str
    quantity: float
    price: float
    subtotal: float

class QuoteItemCreate(QuoteItemBase):
    pass

class QuoteItem(QuoteItemBase):
    id: str
    quote_id: str
    model_config = ConfigDict(from_attributes=True)

class QuoteBase(BaseModel):
    client_id: str
    client_name: str
    total: float

class QuoteCreate(QuoteBase):
    items: List[QuoteItemCreate]

class Quote(QuoteBase):
    id: str
    folio: Optional[str] = None
    status: str
    created_at: datetime
    items: List[QuoteItem] = []
    model_config = ConfigDict(from_attributes=True)

# --- NEW SAAS SCHEMAS ---

class CashSessionCreate(BaseModel):
    fondo_inicial: float

class CashSession(BaseModel):
    id: str
    user_id: str
    fondo_inicial: float
    total_ventas_efectivo: float
    total_retiros: float
    total_depositos: float
    fondo_final_calculado: float
    fondo_final_real: Optional[float]
    diferencia: Optional[float]
    status: str
    opened_at: datetime
    closed_at: Optional[datetime]
    model_config = ConfigDict(from_attributes=True)

class CashMovementCreate(BaseModel):
    type: str
    amount: float
    reason: str

class CashMovement(CashMovementCreate):
    id: str
    session_id: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class MissingProductRequestCreate(BaseModel):
    sku_or_name: str
    quantity: float

class MissingProductRequest(MissingProductRequestCreate):
    id: str
    requested_by: str
    status: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ReturnLogCreate(BaseModel):
    sale_id: str
    product_sku: str
    quantity: float
    amount_refunded: float
    reason: str

class ReturnLog(ReturnLogCreate):
    id: str
    authorized_by: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

# --- Employee Schemas ---
class EmployeeCreateRequest(BaseModel):
    full_name: str
    display_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    employee_code: Optional[str] = None
    area: str
    position: str
    employment_type: Optional[str] = None
    hire_date: str
    status: str
    sucursal_id: str
    assigned_warehouse_id: Optional[str] = None
    assigned_warehouse_name: Optional[str] = None
    
    can_login: bool = False
    usuario_id: Optional[str] = None
    temporary_password: Optional[str] = None
    temporary_password_confirm: Optional[str] = None
    role: Optional[str] = None
    
    can_clock_in: bool = True
    pin: Optional[str] = None
    pin_confirm: Optional[str] = None

class EmployeeUpdateRequest(BaseModel):
    employee_code: Optional[str] = None
    full_name: Optional[str] = None
    display_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    area: Optional[str] = None
    position: Optional[str] = None
    employment_type: Optional[str] = None
    hire_date: Optional[str] = None
    status: Optional[str] = None
    sucursal_id: Optional[str] = None
    assigned_warehouse_id: Optional[str] = None
    assigned_warehouse_name: Optional[str] = None
    assigned_cash_register_id: Optional[str] = None
    commission_factor: Optional[float] = None
    can_clock_in: Optional[bool] = None
    role: Optional[str] = None  # sincroniza con el User enlazado, si tiene login

class EmployeeUpdatePinRequest(BaseModel):
    pin: str
    pin_confirm: str

class EmployeeCreateResponse(BaseModel):
    ok: bool
    employee_id: str
    user_id: Optional[str] = None
    usuario_id: Optional[str] = None
    can_login: bool
    can_clock_in: bool
    message: str

class EmployeeResponse(BaseModel):
    id: str
    employee_code: Optional[str] = None
    full_name: str
    display_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    photo_url: Optional[str] = None
    area: Optional[str] = None
    position: Optional[str] = None
    employment_type: Optional[str] = None
    hire_date: Optional[str] = None
    status: str
    sucursal_id: str
    assigned_warehouse_name: Optional[str] = None
    can_login: bool
    can_clock_in: bool
    usuario_id: Optional[str] = None
    commission_factor: Optional[float] = None
    commission_balance: Optional[float] = None
    tips_balance: Optional[float] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class EmployeeListResponse(BaseModel):
    ok: bool
    employees: List[EmployeeResponse]


# =============================================================================
# MÓDULO ALMACÉN — Schemas (Fase 2)
# =============================================================================

# --- Bodegas ---
class WarehouseCreate(BaseModel):
    name: str
    is_transit: bool = False

class WarehouseResponse(BaseModel):
    id: str
    empresa_id: str
    sucursal_id: str
    name: str
    is_transit: bool
    model_config = ConfigDict(from_attributes=True)

# --- Stock por bodega ---
class WarehouseStockItem(BaseModel):
    warehouse_id: str
    warehouse_name: str
    product_id: str
    product_sku: str
    product_name: str
    quantity: float

# --- Entradas de mercancía (recepción de compras) ---
class PurchaseReceiptItem(BaseModel):
    product_sku: str
    quantity: float
    unit_cost: float                         # costo unitario de esta entrada
    notes: Optional[str] = None

class PurchaseReceiptResponse(BaseModel):
    ok: bool
    entry_ids: List[str]                     # IDs de InventoryMovement generados
    accounting_entry_id: Optional[str]      # ID del asiento contable

# --- Devoluciones de venta ---
class SaleReturnCreate(BaseModel):
    sale_id: str
    items: List[SaleReturnItem]
    restock_warehouse_id: Optional[str] = None   # bodega donde regresa el producto
    authorized_by: Optional[str] = None
    idempotency_key: Optional[str] = None
    notes: Optional[str] = None                  # NR-01: motivo de la devolución

class SaleReturnResponse(BaseModel):
    ok: bool
    sale_id: str
    items_returned: int
    total_restocked: float
    accounting_entry_id: Optional[str] = None

# ── NR-01: cross-branch return schemas ──────────────────────────────────────
class CrossReturnResponse(BaseModel):
    ok: bool
    return_id: str
    estado: str                                  # PENDIENTE | APROBADA
    items_returned: int = 0
    total_restocked: float = 0.0
    accounting_entry_id: Optional[str] = None
    message: Optional[str] = None
    already_existed: bool = False

class CrossReturnApproveResponse(BaseModel):
    ok: bool
    return_id: str
    estado: str
    items_returned: int
    total_restocked: float
    accounting_entry_id: Optional[str] = None

# ── M-2: low-stock alert schemas ────────────────────────────────────────────
class LowStockAlert(BaseModel):
    sku: str
    name: str
    sucursal_id: str
    stock: float
    stock_minimo: float
    deficit: float

class ProductStockMinimoUpdate(BaseModel):
    stock_minimo: Optional[float] = None         # None = desactivar alerta

# --- Ajustes de inventario ---
class InventoryAdjustItem(BaseModel):
    product_sku: str
    quantity_delta: float        # positivo = entrada, negativo = merma/salida
    reason: str                  # MERMA | AJUSTE_FISICO | DONACION | OTRO

class InventoryAdjustCreate(BaseModel):
    warehouse_id: str
    items: List[InventoryAdjustItem]
    authorized_by: str
    notes: Optional[str] = None
    idempotency_key: Optional[str] = None

class InventoryAdjustResponse(BaseModel):
    ok: bool
    movement_ids: List[str]

# --- Kardex con filtros ---
class KardexEntry(BaseModel):
    id: str
    timestamp: str
    product_sku: str
    product_name: Optional[str] = None
    warehouse_id: str
    warehouse_name: Optional[str] = None
    movement_type: str
    quantity: float
    unit_cost: float
    reference_type: str
    reference_id: str
    reason: Optional[str] = None

class KardexResponse(BaseModel):
    total: int
    items: List[KardexEntry]

# --- Traslado entre bodegas (versión enriquecida) ---
class WarehouseTransferCreate(BaseModel):
    product_sku: str
    quantity: float
    source_warehouse_id: str
    destination_warehouse_id: str
    notes: Optional[str] = None
    authorized_by: Optional[str] = None
    idempotency_key: Optional[str] = None

class WarehouseTransferResponse(BaseModel):
    ok: bool
    source_movement_id: str
    destination_movement_id: str


# ─── Módulo Administración — Usuarios ─────────────────────────────────────
class UserAdminResponse(BaseModel):
    id: str
    username: str
    role: str
    sucursal_id: str
    status: str
    created_at: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str = "CAJERO"
    sucursal_id: str = "MATRIZ"

class UserUpdateRequest(BaseModel):
    role: Optional[str] = None
    status: Optional[str] = None
    sucursal_id: Optional[str] = None

# ─── Módulo Administración — Auditoría ────────────────────────────────────
class AuditLogEntry(BaseModel):
    id: str
    user_id: str
    action: str
    severity: str
    details: Optional[dict] = None
    ip_address: Optional[str] = None
    created_at: Optional[str] = None

# ─── Módulo Administración — Empresa ──────────────────────────────────────
class EmpresaInfo(BaseModel):
    empresa_id: str
    total_users: int
    total_sucursales: int
    plan: str = "Fase 2 — MVP"

# ─── Módulo Administración — Sucursales ───────────────────────────────────
class BranchCreate(BaseModel):
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_main: bool = False

class BranchUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None   # ACTIVE | INACTIVE
    is_main: Optional[bool] = None


# =============================================================================
# MÓDULO COMPRAS — SCHEMAS
# =============================================================================

# ── Proveedores ───────────────────────────────────────────────────────────────
class SupplierCreate(BaseModel):
    name: str
    trade_name: Optional[str] = None
    rfc: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    credit_days: int = 0
    credit_limit: float = 0.0
    bank_account: Optional[str] = None
    notes: Optional[str] = None
    sucursal_id: Optional[str] = None  # None = proveedor global

class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    trade_name: Optional[str] = None
    rfc: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    credit_days: Optional[int] = None
    credit_limit: Optional[float] = None
    bank_account: Optional[str] = None
    status: Optional[str] = None   # ACTIVE | INACTIVE
    notes: Optional[str] = None

# ── Órdenes de Compra ─────────────────────────────────────────────────────────
class PurchaseOrderItemCreate(BaseModel):
    product_id: Optional[str] = None
    sku: str
    description: str = ""
    quantity_ordered: float
    unit_cost: float

class PurchaseOrderCreate(BaseModel):
    supplier_id: str
    expected_date: Optional[str] = None
    notes: Optional[str] = None
    items: List[PurchaseOrderItemCreate] = []

# ── Recepción ─────────────────────────────────────────────────────────────────
class PurchaseReceiptItemCreate(BaseModel):
    product_id: str
    purchase_order_item_id: Optional[str] = None
    sku: str
    description: str = ""
    quantity_received: float
    unit_cost: float

class PurchaseReceiptCreate(BaseModel):
    supplier_id: str
    warehouse_id: str
    purchase_order_id: Optional[str] = None
    payment_type: str = "CREDIT"   # CASH | CREDIT
    notes: Optional[str] = None
    idempotency_key: Optional[str] = None
    items: List[PurchaseReceiptItemCreate]

# ── CxP / Abono ───────────────────────────────────────────────────────────────
class SupplierPaymentCreate(BaseModel):
    amount: float
    payment_method: str = "CASH"   # CASH | TRANSFER | CHECK
    reference: Optional[str] = None
    notes: Optional[str] = None

# ─── Módulo Caja y Cortes ─────────────────────────────────────────────────────
class CashShiftOpen(BaseModel):
    opening_amount: float = 0.0       # Fondo inicial en caja

class CashShiftClose(BaseModel):
    reported_amount: float             # Lo que el cajero dice que hay (corte ciego)

class CashShiftAuthorize(BaseModel):
    authorize: bool = True             # Admin acepta la diferencia

class CashShiftOut(BaseModel):
    id: str
    empresa_id: str
    sucursal_id: str
    opened_by_id: str
    closed_by_id: Optional[str] = None
    opening_amount: float
    expected_amount: Optional[float] = None
    reported_amount: Optional[float] = None
    difference: Optional[float] = None
    status: str
    authorized_by_id: Optional[str] = None
    created_at: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

# ─── Ítem 4: Permisos temporales de módulo (admin_sucursal) ──────────────────
class TempPermissionGrantCreate(BaseModel):
    user_id: str
    module: str
    sucursal_id: Optional[str] = None
    valid_from: str   # ISO datetime
    valid_until: str  # ISO datetime

class TempPermissionGrantOut(BaseModel):
    id: str
    empresa_id: str
    user_id: str
    module: str
    sucursal_id: Optional[str] = None
    granted_by: str
    valid_from: str
    valid_until: str
    revoked: bool
    created_at: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

# ─── Ítem 3: Vendedores categorizados ────────────────────────────────────────
class SellerCatalogPermissionCreate(BaseModel):
    employee_id: str
    category: str
    can_sell: bool = True

class SellerCatalogPermissionOut(BaseModel):
    id: str
    empresa_id: str
    employee_id: str
    category: str
    can_sell: bool
    model_config = ConfigDict(from_attributes=True)

class SellerCommissionRuleCreate(BaseModel):
    employee_id: str
    scope: str          # default | category | price_scale
    scope_value: Optional[str] = None
    rate: float

class SellerCommissionRuleOut(BaseModel):
    id: str
    empresa_id: str
    employee_id: str
    scope: str
    scope_value: Optional[str] = None
    rate: float
    model_config = ConfigDict(from_attributes=True)

class PriceScaleAuthRequestCreate(BaseModel):
    client_id: Optional[str] = None
    requested_scale: str
    current_scale: Optional[str] = None
    session_token: Optional[str] = None
    notes: Optional[str] = None

class PriceScaleAuthRequestResolve(BaseModel):
    status: str         # approved | rejected
    expires_at: Optional[str] = None  # ISO datetime; requerido si status=approved
    notes: Optional[str] = None

class PriceScaleAuthRequestOut(BaseModel):
    id: str
    empresa_id: str
    client_id: Optional[str] = None
    requested_scale: str
    current_scale: Optional[str] = None
    requested_by: str
    status: str
    authorized_by: Optional[str] = None
    expires_at: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# ── Ítem 2: Contratistas y Proyectos ─────────────────────────────────────────

class ContractorCreate(BaseModel):
    nombre: str
    rfc: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notas: Optional[str] = None

class ContractorOut(ContractorCreate):
    id: str
    empresa_id: str
    status: str
    created_at: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class ContractorUpdate(BaseModel):
    nombre: Optional[str] = None
    rfc: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notas: Optional[str] = None
    status: Optional[str] = None


class ProjectCreate(BaseModel):
    nombre: str
    client_id: Optional[str] = None
    contractor_id: Optional[str] = None
    commission_rate: float = 0.0
    notas: Optional[str] = None

class ProjectOut(ProjectCreate):
    id: str
    empresa_id: str
    status: str
    created_at: Optional[str] = None
    closed_at: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class ProjectUpdate(BaseModel):
    nombre: Optional[str] = None
    client_id: Optional[str] = None
    contractor_id: Optional[str] = None
    commission_rate: Optional[float] = None
    notas: Optional[str] = None
    status: Optional[str] = None


class ProjectCommissionLedgerCreate(BaseModel):
    entry_type: str        # generated | paid
    amount: float
    sale_id: Optional[str] = None
    descripcion: Optional[str] = None

class ProjectCommissionLedgerOut(ProjectCommissionLedgerCreate):
    id: str
    empresa_id: str
    project_id: str
    registrado_por: Optional[str] = None
    created_at: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# ── Ítem 1: Fidelización de puntos ───────────────────────────────────────────

class PointsRedemptionCreate(BaseModel):
    client_id: str
    redemption_mode: str        # pago_parcial | sorteo | regalo | etc.
    puntos_canjeados: int
    sale_id: Optional[str] = None
    notas: Optional[str] = None

class PointsRedemptionOut(PointsRedemptionCreate):
    id: str
    empresa_id: str
    valor_aplicado: Optional[float] = None
    registrado_por: Optional[str] = None
    created_at: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# ── Apartados (Layaways) — E-02 ───────────────────────────────────────────────

class LayawayItemCreate(BaseModel):
    product_id:  Optional[str] = None
    product_sku: str
    description: str = ""
    quantity:    float
    price:       float

class LayawayCreate(BaseModel):
    client_id:   str
    client_name: str
    items:       List[LayawayItemCreate]
    initial_payment: float           # abono inicial (obligatorio, mín. config)
    payment_method:  str = "efectivo"
    payment_details: Optional[Any] = None
    nota:        Optional[str] = None

class LayawayPaymentCreate(BaseModel):
    amount:          float
    payment_method:  str = "efectivo"
    payment_details: Optional[Any] = None

class LayawayOut(BaseModel):
    id:               str
    empresa_id:       str
    folio:            Optional[str] = None
    client_id:        str
    client_name:      str
    total_amount:     float
    amount_paid:      float
    amount_pending:   float
    status:           str
    fecha_vencimiento: str
    nota:             Optional[str] = None
    created_at:       Optional[str] = None
    items:            List[Any] = []
    payments:         List[Any] = []
    model_config = ConfigDict(from_attributes=True)
