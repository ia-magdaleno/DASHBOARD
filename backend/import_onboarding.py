"""Onboarding / import de datos del tenant desde Excel (XLSX) o CSV.

S-1 (Don Antonio, 06-sep-2026): cada tenant sube sus catálogos en su primer uso
para que su operación no se frene. Tipos: **productos, clientes, proveedores,
empleados**.

El núcleo (leer archivo, validar, upsert) vive aquí para que lo usen tanto el
CLI `scripts/import_tenant_data.py` como, más adelante, un endpoint multipart y
el wizard "Configuración inicial" de la UI.

Ver memoria calebsys-superadmin-y-onboarding.
"""
from __future__ import annotations

import csv
import io
import unicodedata
from decimal import Decimal, InvalidOperation

import models

# ── helpers de normalización ───────────────────────────────────────────────
def _norm_header(h) -> str:
    s = unicodedata.normalize("NFKD", str(h or "")).encode("ascii", "ignore").decode()
    return s.strip().lower().replace(" ", "_").replace("-", "_").replace(".", "")


def _s(v) -> str:
    return "" if v is None else str(v).strip()


def _dec(v, default="0") -> Decimal:
    raw = _s(v).replace(",", "").replace("$", "")
    if raw == "":
        return Decimal(default)
    try:
        return Decimal(raw)
    except (InvalidOperation, ValueError):
        raise ValueError(f"número inválido: {v!r}")


def _int(v, default=0) -> int:
    raw = _s(v)
    if raw == "":
        return default
    try:
        return int(float(raw))
    except (ValueError, TypeError):
        raise ValueError(f"entero inválido: {v!r}")


# ── especificaciones por tipo ─────────────────────────────────────────────
# alias: encabezado normalizado del Excel -> campo interno
_PRODUCT_ALIASES = {
    "sku": "sku", "clave": "sku", "codigo": "sku", "codigo_producto": "sku",
    "nombre": "nombre", "descripcion_corta": "nombre", "producto": "nombre",
    "descripcion": "descripcion", "descripcion_larga": "descripcion",
    "codigo_barras": "codigo_barras", "barras": "codigo_barras", "ean": "codigo_barras",
    "codigo_ventas": "codigo_ventas", "clave_interna": "codigo_ventas",
    "unidad_compra": "unidad_compra", "unidad_de_compra": "unidad_compra",
    "unidad_venta": "unidad_venta", "unidad": "unidad_venta", "unidad_de_venta": "unidad_venta",
    "factor_conversion": "factor_conversion", "factor": "factor_conversion",
    "costo": "costo", "costo_promedio": "costo", "costo_unitario": "costo",
    "precio": "precio", "precio_venta": "precio", "precio_publico": "precio",
    "stock_inicial": "stock_inicial", "existencia": "stock_inicial", "existencias": "stock_inicial",
    "stock": "stock_inicial", "inventario": "stock_inicial",
    "stock_minimo": "stock_minimo", "minimo": "stock_minimo", "punto_reorden": "stock_minimo",
    "bodega_sede": "bodega_sede", "bodega": "bodega_sede",
    "sucursal": "bodega_sede", "sucursal_id": "bodega_sede", "sede": "bodega_sede",
}
_CLIENT_ALIASES = {
    "codigo": "codigo", "codigo_cliente": "codigo", "clave": "codigo",
    "nombre": "nombre", "razon_social": "nombre", "cliente": "nombre",
    "rfc": "rfc",
    "tipo_cliente": "tipo_cliente", "tipo": "tipo_cliente",
    "telefono": "telefono", "tel": "telefono", "celular": "telefono",
    "whatsapp": "whatsapp", "wa": "whatsapp",
    "email": "email", "correo": "email", "correo_electronico": "email",
    "regimen_fiscal": "regimen_fiscal", "regimen": "regimen_fiscal",
    "direccion": "direccion", "domicilio": "direccion", "calle": "direccion",
    "colonia": "colonia",
    "ciudad": "ciudad", "municipio": "ciudad",
    "estado": "estado",
    "cp": "cp", "codigo_postal": "cp",
    "pais": "pais",
    "limite_credito": "limite_credito", "credito": "limite_credito",
    "dias_credito": "dias_credito", "plazo": "dias_credito",
    "escala_precio": "escala_precio", "lista_precio": "escala_precio", "escala": "escala_precio",
    "sucursal": "sucursal", "sucursal_id": "sucursal", "sede": "sucursal",
    "saldo_inicial_cxc": "saldo_inicial_cxc", "saldo_cxc": "saldo_inicial_cxc",
    "cartera": "saldo_inicial_cxc", "saldo_cartera": "saldo_inicial_cxc",
    "dias_vencimiento_cxc": "dias_vencimiento_cxc", "vencimiento": "dias_vencimiento_cxc",
}

# plantilla: (campo, encabezado_bonito, ejemplo, obligatorio)
_PRODUCT_TEMPLATE = [
    ("sku", "sku", "T-001", True),
    ("nombre", "nombre", "Tornillo 1/4 x 2\"", True),
    ("descripcion", "descripcion", "Tornillo cabeza plana", False),
    ("codigo_barras", "codigo_barras", "7501234567890", False),
    ("codigo_ventas", "codigo_ventas", "M-045", False),
    ("unidad_compra", "unidad_compra", "CAJA", False),
    ("unidad_venta", "unidad_venta", "PIEZA", False),
    ("factor_conversion", "factor_conversion", "100", False),
    ("costo", "costo", "1.20", False),
    ("precio", "precio", "3.50", False),
    ("stock_inicial", "stock_inicial", "500", False),
    ("stock_minimo", "stock_minimo", "50", False),
    ("bodega_sede", "bodega_sede", "BDG-MAG-001", False),
]
_CLIENT_TEMPLATE = [
    ("codigo", "codigo", "CLI-001", False),
    ("nombre", "nombre", "Ferretería El Clavo", True),
    ("rfc", "rfc", "XAXX010101000", False),
    ("tipo_cliente", "tipo_cliente", "Público General", False),
    ("whatsapp", "whatsapp", "+526151572255", True),
    ("telefono", "telefono", "6151572255", False),
    ("email", "email", "contacto@elclavo.mx", False),
    ("regimen_fiscal", "regimen_fiscal", "612", False),
    ("direccion", "direccion", "Av. Juárez 123", False),
    ("colonia", "colonia", "Centro", False),
    ("ciudad", "ciudad", "Magdaleno", False),
    ("estado", "estado", "Durango", False),
    ("cp", "cp", "34000", False),
    ("pais", "pais", "México", False),
    ("limite_credito", "limite_credito", "0", False),
    ("dias_credito", "dias_credito", "30", False),
    ("escala_precio", "escala_precio", "Público General", False),
    ("sucursal", "sucursal", "MAG-001", False),
    ("saldo_inicial_cxc", "saldo_inicial_cxc", "5000.00", False),
    ("dias_vencimiento_cxc", "dias_vencimiento_cxc", "30", False),
]

_SUPPLIER_ALIASES = {
    "nombre": "nombre", "nombre_comercial": "nombre", "proveedor": "nombre",
    "razon_social": "razon_social", "denominacion": "razon_social",
    "rfc": "rfc",
    "contacto": "contacto", "nombre_contacto": "contacto", "atencion": "contacto",
    "whatsapp": "whatsapp", "wa": "whatsapp",
    "telefono": "telefono", "tel": "telefono", "celular": "telefono",
    "email": "email", "correo": "email", "correo_electronico": "email",
    "dias_credito": "dias_credito", "plazo": "dias_credito", "credito_dias": "dias_credito",
    "limite_credito": "limite_credito", "credito": "limite_credito",
    "cuenta_bancaria": "cuenta_bancaria", "clabe": "cuenta_bancaria", "cuenta": "cuenta_bancaria",
    "notas": "notas", "observaciones": "notas",
    "sucursal": "sucursal", "sucursal_id": "sucursal", "sede": "sucursal",
    "saldo_inicial_cxp": "saldo_inicial_cxp", "saldo_cxp": "saldo_inicial_cxp",
    "adeudo": "saldo_inicial_cxp", "saldo_proveedor": "saldo_inicial_cxp",
    "dias_vencimiento_cxp": "dias_vencimiento_cxp", "vencimiento_pago": "dias_vencimiento_cxp",
}
_EMPLOYEE_ALIASES = {
    "codigo": "codigo", "codigo_empleado": "codigo", "num_empleado": "codigo", "no_empleado": "codigo",
    "nombre": "nombre", "nombre_completo": "nombre", "empleado": "nombre",
    "nombre_corto": "nombre_corto", "apodo": "nombre_corto", "display": "nombre_corto",
    "whatsapp": "whatsapp", "wa": "whatsapp",
    "telefono": "telefono", "tel": "telefono", "celular": "telefono",
    "email": "email", "correo": "email", "correo_electronico": "email",
    "area": "area", "departamento": "area",
    "puesto": "puesto", "cargo": "puesto", "position": "puesto",
    "tipo_empleo": "tipo_empleo", "tipo_contrato": "tipo_empleo", "contrato": "tipo_empleo",
    "fecha_ingreso": "fecha_ingreso", "ingreso": "fecha_ingreso", "alta": "fecha_ingreso",
}

_SUPPLIER_TEMPLATE = [
    ("nombre", "nombre", "Aceros del Norte", True),
    ("razon_social", "razon_social", "Aceros del Norte SA de CV", False),
    ("rfc", "rfc", "ANO120304AB1", False),
    ("contacto", "contacto", "Lic. Pérez", False),
    ("whatsapp", "whatsapp", "+526153334444", True),
    ("telefono", "telefono", "6153334444", False),
    ("email", "email", "ventas@acerosnorte.mx", False),
    ("dias_credito", "dias_credito", "30", False),
    ("limite_credito", "limite_credito", "100000", False),
    ("cuenta_bancaria", "cuenta_bancaria", "012180001234567890", False),
    ("notas", "notas", "Entrega los martes", False),
    ("sucursal", "sucursal", "", False),
    ("saldo_inicial_cxp", "saldo_inicial_cxp", "8000.00", False),
    ("dias_vencimiento_cxp", "dias_vencimiento_cxp", "30", False),
]
_EMPLOYEE_TEMPLATE = [
    ("codigo", "codigo", "EMP-001", False),
    ("nombre", "nombre", "Juan Pérez López", True),
    ("nombre_corto", "nombre_corto", "Juan P.", False),
    ("whatsapp", "whatsapp", "+526155556666", True),
    ("telefono", "telefono", "6155556666", False),
    ("email", "email", "juan@empresa.mx", False),
    ("area", "area", "Ventas", False),
    ("puesto", "puesto", "Vendedor de mostrador", False),
    ("tipo_empleo", "tipo_empleo", "Planta", False),
    ("fecha_ingreso", "fecha_ingreso", "2025-03-01", False),
]

_APERTURA_ALIASES = {
    "cuenta_sat": "cuenta_sat", "cuenta": "cuenta_sat", "codigo": "cuenta_sat",
    "codigo_sat": "cuenta_sat", "codigo_cuenta": "cuenta_sat",
    "descripcion": "descripcion", "nombre": "descripcion", "nombre_cuenta": "descripcion",
    "saldo_debe": "saldo_debe", "debe": "saldo_debe", "cargo": "saldo_debe",
    "saldo_haber": "saldo_haber", "haber": "saldo_haber", "abono": "saldo_haber",
    "sucursal": "sucursal", "sucursal_id": "sucursal", "sede": "sucursal",
}
_APERTURA_TEMPLATE = [
    ("cuenta_sat",   "cuenta_sat",   "102.01",    True),
    ("descripcion",  "descripcion",  "Caja",      True),
    ("saldo_debe",   "saldo_debe",   "10000.00",  False),
    ("saldo_haber",  "saldo_haber",  "0.00",      False),
    ("sucursal",     "sucursal",     "MAG-001",   False),
]

SPECS = {
    "productos":   {"aliases": _PRODUCT_ALIASES,   "template": _PRODUCT_TEMPLATE,   "required": ["sku", "nombre"]},
    "clientes":    {"aliases": _CLIENT_ALIASES,    "template": _CLIENT_TEMPLATE,    "required": ["nombre"]},
    "proveedores": {"aliases": _SUPPLIER_ALIASES,  "template": _SUPPLIER_TEMPLATE,  "required": ["nombre"]},
    "empleados":   {"aliases": _EMPLOYEE_ALIASES,  "template": _EMPLOYEE_TEMPLATE,  "required": ["nombre"]},
    "apertura":    {"aliases": _APERTURA_ALIASES,  "template": _APERTURA_TEMPLATE,  "required": ["cuenta_sat", "descripcion"]},
}


def _bool_si(v, default=True) -> bool:
    raw = _s(v).lower()
    if raw == "":
        return default
    return raw in ("si", "sí", "s", "1", "true", "x", "yes", "y")


# ── lectura de archivo ────────────────────────────────────────────────────
def read_rows(source, *, filename: str = "", sheet: str | None = None) -> list[dict]:
    """`source` = ruta str, bytes, o file-like. Devuelve lista de dicts con
    llaves = encabezados normalizados. Detecta .csv vs .xlsx por `filename` o
    por el contenido."""
    is_csv = filename.lower().endswith(".csv")
    if isinstance(source, str) and not is_csv:
        is_csv = source.lower().endswith(".csv")

    if is_csv:
        if isinstance(source, str):
            with open(source, "r", encoding="utf-8-sig", newline="") as f:
                rd = list(csv.reader(f))
        else:
            data = source if isinstance(source, (bytes, bytearray)) else source.read()
            rd = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
        if not rd:
            return []
        headers = [_norm_header(h) for h in rd[0]]
        return [dict(zip(headers, r)) for r in rd[1:] if any(_s(c) for c in r)]

    import openpyxl
    if isinstance(source, (bytes, bytearray)):
        wb = openpyxl.load_workbook(io.BytesIO(source), read_only=True, data_only=True)
    else:
        wb = openpyxl.load_workbook(source, read_only=True, data_only=True)
    ws = wb[sheet] if sheet else wb.active
    rows_it = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_it)
    except StopIteration:
        return []
    headers = [_norm_header(h) for h in header_row]
    out = []
    for r in rows_it:
        if not any(_s(c) for c in r):
            continue
        out.append(dict(zip(headers, r)))
    return out


def _remap(row: dict, aliases: dict) -> dict:
    """Aplica el mapa de alias: {encabezado_excel_normalizado: campo_interno}."""
    out = {}
    for k, v in row.items():
        field = aliases.get(k)
        if field and (field not in out or _s(out[field]) == ""):
            out[field] = v
    return out


def plantilla_bytes(tipo: str) -> bytes:
    """Genera un XLSX en memoria: fila de encabezados + una fila de ejemplo."""
    if tipo not in SPECS:
        raise ValueError(f"tipo no soportado: {tipo}")
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = tipo
    tpl = SPECS[tipo]["template"]
    ws.append([("* " if req else "") + head for (_f, head, _ex, req) in tpl])
    ws.append([ex for (_f, _h, ex, _r) in tpl])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── carga ────────────────────────────────────────────────────────────────
def _ensure_warehouse(db, empresa_id: str, sucursal_id: str) -> str:
    wid = "WH-" + sucursal_id
    w = db.query(models.Warehouse).filter(
        models.Warehouse.empresa_id == empresa_id, models.Warehouse.id == wid).first()
    if not w:
        db.add(models.Warehouse(empresa_id=empresa_id, id=wid,
                                sucursal_id=sucursal_id, name="Bodega principal"))
        db.flush()
    return wid


def _build_producto(db, empresa_id, r, default_suc):
    sku = _s(r.get("sku"))
    if not sku:
        raise ValueError("falta sku")
    nombre = _s(r.get("nombre"))
    if not nombre:
        raise ValueError("falta nombre")
    suc = _s(r.get("bodega_sede")) or default_suc
    row = db.query(models.Product).filter(
        models.Product.empresa_id == empresa_id, models.Product.sku == sku).first()
    is_new = row is None
    if is_new:
        row = models.Product(empresa_id=empresa_id, sku=sku)
        db.add(row)
    row.sucursal_id       = suc
    row.name              = nombre
    row.description       = _s(r.get("descripcion"))
    row.barcode           = _s(r.get("codigo_barras")) or None
    row.sales_code        = _s(r.get("codigo_ventas")) or None
    if _s(r.get("unidad_compra")): row.purchase_unit = _s(r.get("unidad_compra"))
    if _s(r.get("unidad_venta")):  row.sale_unit     = _s(r.get("unidad_venta"))
    if _s(r.get("factor_conversion")): row.conversion_factor = _dec(r.get("factor_conversion"), "1")
    row.average_cost      = _dec(r.get("costo"))
    row.price             = _dec(r.get("precio"))
    stock_ini             = _dec(r.get("stock_inicial"))
    row.stock             = stock_ini
    row.stock_minimo      = _dec(r.get("stock_minimo")) if _s(r.get("stock_minimo")) else None
    db.flush()
    if stock_ini != 0:
        wid = _ensure_warehouse(db, empresa_id, suc)
        ws = db.query(models.WarehouseStock).filter(
            models.WarehouseStock.empresa_id == empresa_id,
            models.WarehouseStock.product_id == row.id,
            models.WarehouseStock.warehouse_id == wid).first()
        if ws:
            ws.quantity = stock_ini
        else:
            db.add(models.WarehouseStock(empresa_id=empresa_id, product_id=row.id,
                                         warehouse_id=wid, quantity=stock_ini))
    return "creado" if is_new else "actualizado"


def _build_cliente(db, empresa_id, r, default_suc):
    nombre = _s(r.get("nombre"))
    if not nombre:
        raise ValueError("falta nombre")
    codigo = _s(r.get("codigo"))
    rfc = _s(r.get("rfc")).upper() or None
    q = db.query(models.Client).filter(models.Client.empresa_id == empresa_id)
    row = None
    if codigo:
        row = q.filter(models.Client.client_code == codigo).first()
    # RFC genérico (XAXX010101000 = público en general) NO sirve como clave:
    # lo comparten miles de clientes de mostrador.
    if row is None and rfc and rfc not in ("XAXX010101000", "XEXX010101000"):
        row = q.filter(models.Client.rfc == rfc).first()
    is_new = row is None
    if is_new:
        row = models.Client(empresa_id=empresa_id)
        db.add(row)
    row.sucursal_id          = _s(r.get("sucursal")) or default_suc
    row.client_code          = codigo or row.client_code
    row.name                 = nombre
    row.rfc                  = rfc
    if _s(r.get("tipo_cliente")): row.client_type = _s(r.get("tipo_cliente"))
    row.phone                = _s(r.get("telefono")) or None
    row.whatsapp             = _s(r.get("whatsapp")) or None
    row.email                = _s(r.get("email")) or None
    row.regimen_fiscal       = _s(r.get("regimen_fiscal")) or None
    row.direccion            = _s(r.get("direccion")) or None
    row.colonia              = _s(r.get("colonia")) or None
    row.ciudad               = _s(r.get("ciudad")) or None
    row.estado               = _s(r.get("estado")) or None
    row.cp                   = _s(r.get("cp")) or None
    row.pais                 = _s(r.get("pais")) or "México"
    if _s(r.get("limite_credito")): row.limite_credito = _dec(r.get("limite_credito"))
    if _s(r.get("dias_credito")):   row.dias_credito   = _int(r.get("dias_credito"), 30)
    if _s(r.get("escala_precio")):  row.assigned_price_scale = _s(r.get("escala_precio"))
    db.flush()

    saldo_cxc = _dec(r.get("saldo_inicial_cxc"), "0")
    if saldo_cxc > 0:
        ya_existe = db.query(models.AccountsReceivable).filter(
            models.AccountsReceivable.empresa_id == empresa_id,
            models.AccountsReceivable.client_id == row.id,
            models.AccountsReceivable.sale_id == None,  # noqa: E711
        ).first()
        if not ya_existe:
            import datetime
            dias_venc = _int(r.get("dias_vencimiento_cxc"), 30)
            vencimiento = datetime.datetime.utcnow() + datetime.timedelta(days=dias_venc)
            db.add(models.AccountsReceivable(
                empresa_id=empresa_id,
                sucursal_id=row.sucursal_id,
                client_id=row.id,
                sale_id=None,
                original_amount=saldo_cxc,
                current_balance=saldo_cxc,
                status="Pendiente",
                is_paid=False,
                due_date=vencimiento,
                sale_folio="APERTURA",
                anticipo_aplicado=Decimal("0"),
            ))
            db.flush()

    return "creado" if is_new else "actualizado"


def _build_proveedor(db, empresa_id, r, default_suc):
    nombre = _s(r.get("nombre"))
    if not nombre:
        raise ValueError("falta nombre")
    rfc = _s(r.get("rfc")).upper() or None
    q = db.query(models.Supplier).filter(models.Supplier.empresa_id == empresa_id)
    row = None
    if rfc:
        row = q.filter(models.Supplier.rfc == rfc).first()
    if row is None:
        row = q.filter(models.Supplier.name == nombre).first()
    is_new = row is None
    if is_new:
        row = models.Supplier(empresa_id=empresa_id)
        db.add(row)
    suc = _s(r.get("sucursal"))
    row.sucursal_id  = suc or None          # None = proveedor global
    row.name         = nombre
    row.trade_name   = _s(r.get("razon_social")) or None
    row.rfc          = rfc
    row.contact_name = _s(r.get("contacto")) or None
    row.whatsapp     = _s(r.get("whatsapp")) or None
    row.phone        = _s(r.get("telefono")) or None
    row.email        = _s(r.get("email")) or None
    if _s(r.get("dias_credito")):   row.credit_days  = _int(r.get("dias_credito"), 0)
    if _s(r.get("limite_credito")): row.credit_limit = _dec(r.get("limite_credito"))
    row.bank_account = _s(r.get("cuenta_bancaria")) or None
    row.notes        = _s(r.get("notas")) or None
    db.flush()

    saldo_cxp = _dec(r.get("saldo_inicial_cxp"), "0")
    if saldo_cxp > 0:
        ya_existe = db.query(models.AccountsPayable).filter(
            models.AccountsPayable.empresa_id == empresa_id,
            models.AccountsPayable.supplier_id == row.id,
            models.AccountsPayable.purchase_receipt_id == None,  # noqa: E711
        ).first()
        if not ya_existe:
            import datetime
            dias_venc = _int(r.get("dias_vencimiento_cxp"), 30)
            vencimiento = datetime.datetime.utcnow() + datetime.timedelta(days=dias_venc)
            db.add(models.AccountsPayable(
                empresa_id=empresa_id,
                sucursal_id=suc or default_suc,
                supplier_id=row.id,
                purchase_receipt_id=None,
                purchase_order_id=None,
                amount=saldo_cxp,
                amount_paid=Decimal("0"),
                balance=saldo_cxp,
                due_date=vencimiento,
                status="PENDING",
            ))
            db.flush()

    return "creado" if is_new else "actualizado"


def _build_empleado(db, empresa_id, r, default_suc):
    nombre = _s(r.get("nombre"))
    if not nombre:
        raise ValueError("falta nombre")
    codigo = _s(r.get("codigo"))
    q = db.query(models.Employee).filter(
        models.Employee.empresa_id == empresa_id,
        models.Employee.is_deleted == False)  # noqa: E712
    row = None
    if codigo:
        row = q.filter(models.Employee.employee_code == codigo).first()
    if row is None:
        row = q.filter(models.Employee.full_name == nombre).first()
    is_new = row is None
    if is_new:
        row = models.Employee(empresa_id=empresa_id, can_login=False, is_deleted=False)
        db.add(row)
    row.sucursal_id     = default_suc
    row.employee_code   = codigo or row.employee_code
    row.full_name       = nombre
    row.display_name    = _s(r.get("nombre_corto")) or None
    row.whatsapp        = _s(r.get("whatsapp")) or None
    row.phone           = _s(r.get("telefono")) or None
    row.email           = _s(r.get("email")) or None
    row.area            = _s(r.get("area")) or None
    row.position        = _s(r.get("puesto")) or None
    row.employment_type = _s(r.get("tipo_empleo")) or None
    row.hire_date       = _s(r.get("fecha_ingreso")) or None
    row.status          = "active"
    db.flush()
    return "creado" if is_new else "actualizado"


_BUILDERS = {
    "productos": _build_producto, "clientes": _build_cliente,
    "proveedores": _build_proveedor, "empleados": _build_empleado,
    # "apertura" se maneja en importar() directamente (un asiento para todas las filas)
}


def _importar_apertura(db, empresa_id: str, rows: list[dict], *,
                       dry_run: bool, default_sucursal: str) -> dict:
    """Crea un único asiento contable de apertura con todas las líneas del archivo.

    Las filas del Excel/CSV representan líneas de partida doble:
      - saldo_debe  > 0  →  línea DEBE (activo/gasto)
      - saldo_haber > 0  →  línea HABER (pasivo/capital/ingreso)

    El asiento queda POSTED solo si debe == haber (cuadre exacto).
    """
    import uuid as _uuid
    import datetime

    aliases = _APERTURA_ALIASES
    errores = []
    lineas_validas: list[dict] = []

    for i, raw in enumerate(rows, start=2):
        r = _remap(raw, aliases)
        cuenta = _s(r.get("cuenta_sat"))
        desc   = _s(r.get("descripcion"))
        if not cuenta:
            errores.append({"fila": i, "motivo": "falta cuenta_sat", "dato": desc})
            continue
        if not desc:
            errores.append({"fila": i, "motivo": "falta descripcion", "dato": cuenta})
            continue
        try:
            debe  = _dec(r.get("saldo_debe"),  "0")
            haber = _dec(r.get("saldo_haber"), "0")
        except ValueError as e:
            errores.append({"fila": i, "motivo": str(e), "dato": cuenta})
            continue
        if debe == 0 and haber == 0:
            errores.append({"fila": i, "motivo": "debe y haber son cero", "dato": cuenta})
            continue
        if debe != 0 and haber != 0:
            errores.append({"fila": i, "motivo": "no puede tener debe Y haber en la misma línea", "dato": cuenta})
            continue
        lineas_validas.append({
            "cuenta_sat": cuenta,
            "descripcion": desc,
            "debe": debe,
            "haber": haber,
            "sucursal": _s(r.get("sucursal")) or default_sucursal,
        })

    if errores:
        return {
            "ok": False,
            "tipo": "apertura", "empresa_id": empresa_id, "dry_run": dry_run,
            "total": len(rows), "creados": 0, "actualizados": 0,
            "errores": errores,
        }

    total_debe  = sum(l["debe"]  for l in lineas_validas)
    total_haber = sum(l["haber"] for l in lineas_validas)
    if total_debe != total_haber:
        diff = total_debe - total_haber
        return {
            "ok": False,
            "tipo": "apertura", "empresa_id": empresa_id, "dry_run": dry_run,
            "total": len(rows), "creados": 0, "actualizados": 0,
            "errores": [{"fila": 0, "motivo": f"asiento descuadrado: DEBE {total_debe} ≠ HABER {total_haber} (diferencia {diff})", "dato": ""}],
        }

    if not dry_run:
        entry_id = str(_uuid.uuid4())
        suc_entry = lineas_validas[0]["sucursal"] if lineas_validas else default_sucursal
        entry = models.AccountingEntry(
            id=entry_id,
            empresa_id=empresa_id,
            sucursal_id=suc_entry,
            fecha=datetime.datetime.utcnow(),
            concepto="Saldo de apertura",
            referencia_tipo="APERTURA",
            referencia_id="APERTURA",
            total_debe=total_debe,
            total_haber=total_haber,
            status="POSTED",
        )
        db.add(entry)
        db.flush()

        for linea in lineas_validas:
            if linea["debe"] != 0:
                db.add(models.AccountingEntryLine(
                    empresa_id=empresa_id,
                    entry_id=entry_id,
                    cuenta_sat=linea["cuenta_sat"],
                    cuenta_nombre=linea["descripcion"],
                    tipo_movimiento="DEBE",
                    monto=linea["debe"],
                    descripcion="Apertura",
                ))
            else:
                db.add(models.AccountingEntryLine(
                    empresa_id=empresa_id,
                    entry_id=entry_id,
                    cuenta_sat=linea["cuenta_sat"],
                    cuenta_nombre=linea["descripcion"],
                    tipo_movimiento="HABER",
                    monto=linea["haber"],
                    descripcion="Apertura",
                ))
        db.commit()

    return {
        "ok": True,
        "tipo": "apertura", "empresa_id": empresa_id, "dry_run": dry_run,
        "total": len(rows), "creados": len(lineas_validas), "actualizados": 0,
        "errores": [],
        "total_debe": float(total_debe), "total_haber": float(total_haber),
    }


def importar(db, empresa_id: str, tipo: str, rows: list[dict], *,
            dry_run: bool = True, default_sucursal: str = "MATRIZ") -> dict:
    if tipo not in SPECS:
        raise ValueError(f"tipo no soportado: {tipo}")
    emp = db.query(models.Company).filter(models.Company.id == empresa_id).first()
    if not emp:
        raise ValueError(f"el tenant {empresa_id} no existe")

    if tipo == "apertura":
        return _importar_apertura(db, empresa_id, rows, dry_run=dry_run,
                                  default_sucursal=default_sucursal)

    aliases = SPECS[tipo]["aliases"]
    builder = _BUILDERS[tipo]
    creados = actualizados = 0
    errores = []

    for i, raw in enumerate(rows, start=2):   # fila 1 = encabezados
        r = _remap(raw, aliases)
        sp = db.begin_nested()
        try:
            res = builder(db, empresa_id, r, default_sucursal)
            if dry_run:
                sp.rollback()
            else:
                sp.commit()
            if res == "creado":
                creados += 1
            else:
                actualizados += 1
        except Exception as e:
            sp.rollback()
            errores.append({"fila": i, "motivo": str(e),
                            "dato": _s(r.get("sku") or r.get("codigo") or r.get("nombre"))})

    if dry_run:
        db.rollback()
    else:
        db.commit()

    return {
        "ok": len(errores) == 0,
        "tipo": tipo, "empresa_id": empresa_id, "dry_run": dry_run,
        "total": len(rows), "creados": creados, "actualizados": actualizados,
        "errores": errores,
    }
