"""Recepción de Mercancía 360°.

Asistente inteligente de recepción (wizard de 5 pasos) con:
  · Bóveda de archivos (XML CFDI 4.0, PDF, carta porte, packing list, fotos, firmas).
  · Homologación de códigos XML contra el catálogo y pre-alta de productos nuevos.
  · Costeo real puesto en almacén (Landed Cost) con prorrateo por importe / peso /
    volumen / piezas.
  · Inspección física con faltantes y daños, expediente de incidencia (NC o reposición).
  · Calificación de proveedores (1 a 5 estrellas) y firmas digitales.
  · Afectación integral: inventario + Kardex, costos/precios, CxP, gasto de flete y
    asientos contables, todo en una sola transacción.
  · Expediente 360° consultable en 1 clic (13 puntos de auditoría).

Convenciones de seguridad:
  · Todo está acotado por `empresa_id` del JWT (multi-tenant).
  · El POST de confirmación es idempotente (`idempotency_key`).
  · Si algo falla, se hace rollback completo: nunca queda una recepción a medias.
"""
from __future__ import annotations

import base64
import binascii
import copy
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import crud
import models
from database import get_db
from deps import get_tenant_context, require_module_access, role_guard
import payables_tracking as _apt

router = APIRouter(prefix="/api/reception-hub", tags=["reception-hub"])

_GUARD_READ = role_guard(["gerente", "almacenista", "comprador", "contador"])
_GUARD_WRITE = role_guard(["gerente", "almacenista", "comprador"])

ORIGIN_TYPES = {"OC", "DIRECTA", "TRASPASO", "REPOSICION", "CONSIGNACION"}
PAYMENT_CONDITIONS = {"CREDITO", "CONTADO", "TRANSFERENCIA", "SIN_CARGO"}   # SIN_CARGO: traspaso / consignación / reposición
FREIGHT_CONDITIONS = {"PROVEEDOR", "CONTADO", "POR_COBRAR", "CREDITO"}
PRORATE_METHODS = {"IMPORTE", "PESO", "VOLUMEN", "CANTIDAD"}
PHYSICAL_STATES = {"SELLADA", "VIOLADA", "DANADA"}
INCIDENT_ACTIONS = {"NC", "REPOSICION"}
INCIDENT_STATUSES = {"ABIERTO", "EN_PROCESO", "NC_APLICADA", "REPOSICION_RECIBIDA", "CONCLUIDO"}
FILE_KINDS = {
    "FACTURA_XML", "FACTURA_PDF", "FLETE_XML", "FLETE_PDF", "CARTA_PORTE", "PACKING_LIST",
    "FOTO_LLEGADA", "FOTO_DANO", "FIRMA_CHOFER", "FIRMA_ALMACEN", "FIRMA_SUPERVISOR", "REPORTE_INCIDENCIA",
}
MAX_FILE_BYTES = 12 * 1024 * 1024
MAX_TOTAL_BYTES = 80 * 1024 * 1024


# ── Schemas ───────────────────────────────────────────────────────────────────

class ItemIn(BaseModel):
    line_no: int = 0
    supplier_code: str = ""
    sku: str
    description: str = ""
    sat_key: Optional[str] = None
    sat_unit: Optional[str] = None
    qty_invoiced: float
    unit_cost: float
    iva_rate: float = 0.16
    qty_ok: float = 0.0
    qty_missing: float = 0.0
    qty_damaged: float = 0.0
    damage_cause: Optional[str] = None
    lot: Optional[str] = None
    expiry: Optional[str] = None
    checked: bool = False
    unit_weight_kg: float = 0.0
    unit_volume_m3: float = 0.0
    update_price: bool = False
    new_price: Optional[float] = None
    margin_pct: Optional[float] = None
    homolog_status: str = "HOMOLOGADO"          # HOMOLOGADO | LIGADO | PREALTA
    homolog_by: Optional[str] = None
    purchase_order_item_id: Optional[str] = None
    prev_cost: Optional[float] = None


class FileIn(BaseModel):
    kind: str
    filename: str = "archivo"
    mime: str = "application/octet-stream"
    b64: str
    item_ref: Optional[str] = None


class ConfirmIn(BaseModel):
    idempotency_key: str = Field(..., min_length=6)
    origin_type: str = "OC"
    po_id: Optional[str] = None
    po_folio: Optional[str] = None
    supplier_id: Optional[str] = None
    supplier_name: str = ""
    supplier_rfc: Optional[str] = None
    warehouse_id: str
    invoice: Dict[str, Any] = {}
    payment_condition: str = "CREDITO"
    freight: Dict[str, Any] = {}
    prorate_method: str = "IMPORTE"
    items: List[ItemIn]
    physical: Dict[str, Any] = {}
    incident: Dict[str, Any] = {}
    ratings: Dict[str, Any] = {}
    extra: Dict[str, Any] = {}
    files: List[FileIn] = []


class IncidentUpdateIn(BaseModel):
    status: str
    notes: Optional[str] = None
    nc_folio: Optional[str] = None
    nc_amount: Optional[float] = None


# ── Helpers numéricos ─────────────────────────────────────────────────────────

def _d(v: Any, default: str = "0") -> Decimal:
    try:
        if v is None or v == "":
            return Decimal(default)
        return Decimal(str(v))
    except Exception:
        return Decimal(default)


def _q4(x: Any) -> Decimal:
    return _d(x).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _q2(x: Any) -> Decimal:
    return _d(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _f(x: Any) -> float:
    return float(x or 0)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Any) -> Optional[str]:
    if not dt:
        return None
    try:
        return dt.isoformat()
    except Exception:
        return str(dt)


def _next_year_folio(db: Session, empresa_id: str, prefix: str, col) -> str:
    """Folio PREFIJO-AAAA-#### único por empresa (reintenta si hay hueco/borrado)."""
    year = _now().year
    stem = f"{prefix}-{year}-"
    count = (
        db.query(func.count(col))
        .filter(col.class_.empresa_id == empresa_id, col.ilike(f"{stem}%"))
        .scalar()
        or 0
    )
    n = int(count) + 1
    while True:
        folio = f"{stem}{n:04d}"
        exists = (
            db.query(col.class_)
            .filter(col.class_.empresa_id == empresa_id, col == folio)
            .first()
        )
        if not exists:
            return folio
        n += 1


# ── Cálculo de Landed Cost (misma regla que el frontend) ──────────────────────

def compute_landed(items: List[ItemIn], freight_total: Decimal, method: str) -> Dict[str, Any]:
    """Prorratea el flete/costos adicionales SOLO entre las unidades recibidas sanas.

    Devuelve por partida: alloc (importe asignado), fpu (flete por unidad sana) y
    landed_unit (costo real puesto en almacén = costo XML + fpu).
    """
    method = method if method in PRORATE_METHODS else "IMPORTE"

    def base_of(it: ItemIn, m: str) -> Decimal:
        q = _d(it.qty_ok)
        if m == "IMPORTE":
            return q * _d(it.unit_cost)
        if m == "CANTIDAD":
            return q
        if m == "PESO":
            return q * _d(it.unit_weight_kg)
        if m == "VOLUMEN":
            return q * _d(it.unit_volume_m3)
        return Decimal("0")

    used = method
    bases = [base_of(it, used) for it in items]
    if sum(bases) <= 0 and used != "IMPORTE":
        used = "IMPORTE"  # sin peso/volumen capturado en F4 → cae a importe
        bases = [base_of(it, used) for it in items]
    base_sum = sum(bases)

    rows = []
    for it, b in zip(items, bases):
        qty_ok = _d(it.qty_ok)
        alloc = Decimal("0")
        if freight_total > 0 and base_sum > 0 and b > 0:
            alloc = freight_total * b / base_sum
        fpu = (alloc / qty_ok) if qty_ok > 0 else Decimal("0")
        landed = _d(it.unit_cost) + fpu
        rows.append({"sku": it.sku, "alloc": alloc, "fpu": fpu, "landed_unit": landed, "base": b})
    return {"method_used": used, "base_total": base_sum, "rows": rows}


# ── Utilidades de catálogo ────────────────────────────────────────────────────

def _find_product(db: Session, empresa_id: str, code: str) -> Optional[models.Product]:
    c = (code or "").strip().upper()
    if not c:
        return None
    prods = db.query(models.Product).filter(models.Product.empresa_id == empresa_id).all()
    for p in prods:
        if (p.sku or "").strip().upper() == c:
            return p
    for p in prods:
        if (p.barcode or "").strip().upper() == c or (p.sales_code or "").strip().upper() == c:
            return p
    return None


def _code_in_use_by_other(db: Session, empresa_id: str, code: str, product_id: str) -> bool:
    c = (code or "").strip().upper()
    if not c:
        return True
    for p in db.query(models.Product).filter(models.Product.empresa_id == empresa_id).all():
        if p.id == product_id:
            continue
        if c in {(p.sku or "").strip().upper(), (p.barcode or "").strip().upper(), (p.sales_code or "").strip().upper()}:
            return True
    return False


def _ensure_supplier(db: Session, empresa_id: str, sucursal_id: str, name: str,
                     rfc: Optional[str], supplier_id: Optional[str] = None) -> models.Supplier:
    sup = None
    if supplier_id:
        sup = crud.get_supplier(db, empresa_id, supplier_id)
    if not sup and rfc:
        sup = (
            db.query(models.Supplier)
            .filter(models.Supplier.empresa_id == empresa_id, func.upper(models.Supplier.rfc) == rfc.strip().upper())
            .first()
        )
    if not sup and name:
        sup = (
            db.query(models.Supplier)
            .filter(models.Supplier.empresa_id == empresa_id, func.upper(models.Supplier.name) == name.strip().upper())
            .first()
        )
    if not sup:
        if not name:
            raise HTTPException(status_code=400, detail="Proveedor no identificado: captura nombre o RFC.")
        sup = models.Supplier(
            empresa_id=empresa_id, sucursal_id=None, name=name.strip(),
            trade_name=name.strip(), rfc=(rfc or "").strip().upper() or None,
            credit_days=0, status="ACTIVE", notes="Alta automática desde Recepción de Mercancía",
        )
        db.add(sup)
        db.flush()
    return sup


def _upsert_supplier_link(meta: Dict[str, Any], sup: models.Supplier, supplier_code: str,
                          unit_cost: Decimal, folio: str) -> None:
    """Escribe/actualiza el código del proveedor en meta_data.complements_f4.suppliers
    (Tarjeta 3 de Complementos [F4]) para que la próxima factura se reconozca sola."""
    code = (supplier_code or "").strip().upper()
    if not code:
        return
    f4 = meta.get("complements_f4")
    if not isinstance(f4, dict):
        f4 = {}
    suppliers = f4.get("suppliers")
    if not isinstance(suppliers, list):
        suppliers = []
    name_up = (sup.name or "").strip().upper()
    rfc_up = (sup.rfc or "").strip().upper()
    entry = None
    for s in suppliers:
        if not isinstance(s, dict):
            continue
        same_code = str(s.get("xml_sku") or "").strip().upper() == code
        same_sup = (
            (rfc_up and str(s.get("rfc") or "").strip().upper() == rfc_up)
            or str(s.get("provider_name") or s.get("name") or "").strip().upper() == name_up
        )
        if same_code and same_sup:
            entry = s
            break
    if entry is None:
        entry = {
            "provider_name": name_up, "name": name_up, "rfc": rfc_up,
            "xml_sku": code, "currency": "MXN", "lead_days": 1, "min_qty": 1,
            "factor": 1, "is_primary": len(suppliers) == 0,
        }
        suppliers.append(entry)
    cost = float(_q4(unit_cost))
    entry["cost"] = cost
    entry["last_cost"] = cost
    entry["last_receipt"] = folio
    f4["suppliers"] = suppliers
    meta["complements_f4"] = f4


def _relink_scales(db: Session, empresa_id: str, product: models.Product, marg_net: Decimal,
                   landed_unit: Decimal, new_price: Decimal, iva: Decimal) -> None:
    """Liga el margen y el precio nuevos a TODAS las escalas de precio del producto.

    · La escala principal (PRECIO DE LISTA) toma el margen y el precio capturados.
    · Las demás escalas (CONTRATISTA, REVENTA, CRÉDITO…) conservan su propio margen y se
      recalculan sobre el costo real puesto en almacén (costo × (1+margen) × IVA).
    · Las escalas por sucursal se recalculan igual (margen base + sobreprecio de la sucursal).
    · Si el producto aún no tiene escalas, se derivan de las escalas globales del catálogo.
    """
    meta = copy.deepcopy(product.meta_data) if isinstance(product.meta_data, dict) else {}
    factor = float(Decimal("1") + _d(iva) / 100)
    landed = float(landed_unit)
    scales = meta.get("price_scales")
    if isinstance(scales, list) and scales:
        main_name = ""
        new_scales: List[Any] = []
        for idx, sc in enumerate(scales):
            if not isinstance(sc, dict):
                new_scales.append(sc)
                continue
            nm = str(sc.get("scale_name") or sc.get("nombre") or sc.get("name") or "").strip().upper()
            ofer = float(sc.get("oferta") or 0)
            if idx == 0:
                main_name = nm
                m_trab, price = float(marg_net), float(new_price)
                sc["margen_ideal"] = round(m_trab + ofer, 4)
            else:
                raw = sc.get("margen_trabajo")
                if raw is None:
                    raw = sc.get("margin")
                if raw is None:
                    raw = float(sc.get("margen_ideal") or 0) - ofer
                m_trab = float(raw)
                price = landed * (1 + m_trab / 100) * factor
            sc["margen_trabajo"] = round(m_trab, 4)
            sc["margin"] = round(m_trab, 4)
            sc["costo_con_flete"] = round(landed, 4)
            sc["precio"] = sc["price"] = sc["precio_activo"] = round(price, 2)
            new_scales.append(sc)
        meta["price_scales"] = new_scales
        bscales = meta.get("branch_price_scales")
        if isinstance(bscales, list):
            by_name = {str(s.get("scale_name") or "").strip().upper(): s for s in new_scales if isinstance(s, dict)}
            for b in bscales:
                if not isinstance(b, dict):
                    continue
                s_nm = str(b.get("scale_name") or main_name or "PRECIO DE LISTA").strip().upper()
                base_sc = by_name.get(s_nm)
                m_base = float(marg_net) if s_nm == main_name else float(
                    base_sc.get("margen_trabajo") if base_sc else (b.get("margen_ideal") or 0))
                m_fin = m_base + float(b.get("sobreprecio_suc") or 0)
                b["margen_ideal"] = round(m_base, 4)
                b["margen_final"] = round(m_fin, 4)
                b["costo_con_flete"] = round(landed, 4)
                b["precio"] = b["price"] = round(landed * (1 + m_fin / 100) * factor, 2)
            meta["branch_price_scales"] = bscales
        product.meta_data = meta
        crud._sync_product_price_scales(db, empresa_id, product, new_scales)
    else:
        from routers.products import _ensure_product_scales_applied, _get_tenant_global_scales
        gs = _get_tenant_global_scales(db, empresa_id)
        product.meta_data = meta
        _ensure_product_scales_applied(db, empresa_id, product, gs["price_scales"], gs["branch_price_scales"], force_recalc=False)


def _apply_catalog_updates(db: Session, empresa_id: str, product: models.Product, it: ItemIn,
                           landed: Dict[str, Decimal], sup: models.Supplier, folio: str, user: str) -> None:
    meta = copy.deepcopy(product.meta_data) if isinstance(product.meta_data, dict) else {}
    unit_cost = _d(it.unit_cost)
    fpu = landed["fpu"]
    landed_unit = landed["landed_unit"]
    prev_price = _f(product.price)

    meta["costo_raw"] = float(_q2(unit_cost))
    meta["costo_pieza"] = float(_q2(unit_cost))
    meta["flete_monto"] = float(_q4(fpu))
    meta["flete_pct"] = float(_q4(fpu / unit_cost * 100)) if unit_cost > 0 else 0.0
    meta["costo_con_flete"] = float(_q4(landed_unit))
    meta["costo_piso_iva"] = float(_q2(landed_unit))
    meta["last_receipt"] = {"folio": folio, "date": _now().isoformat(), "supplier": sup.name}

    new_price = _d(it.new_price) if it.update_price and it.new_price else Decimal("0")
    relink = None
    if new_price > 0:
        product.price = _q4(new_price)
        iva = _d(meta.get("iva", 16)) or Decimal("16")
        net = new_price / (Decimal("1") + iva / 100)
        util = (new_price / landed_unit - 1) * 100 if landed_unit > 0 else Decimal("0")
        marg_net = (net / landed_unit - 1) * 100 if landed_unit > 0 else Decimal("0")
        meta["precio_final_pieza"] = float(_q2(new_price))
        meta["precio_final_caja"] = float(_q2(new_price))
        meta["precio_caja"] = float(_q2(new_price))
        # El % de utilidad se maneja SIN IVA (misma regla que #producto-alta: precio = costo × (1+margen) × 1.16)
        meta["margen_final_pieza"] = float(_q2(marg_net))
        meta["margen"] = float(_q4(marg_net))
        relink = (marg_net, landed_unit, new_price, iva)
    hist = meta.get("price_history")
    hist = list(hist) if isinstance(hist, list) else []
    hist.insert(0, {
        "fecha": _now().strftime("%d/%m/%Y %H:%M"),
        "costo_anterior": float(_q4(_d(it.prev_cost if it.prev_cost is not None else product.average_cost))),
        "costo_nuevo": float(_q4(landed_unit)),
        "precio_anterior": prev_price,
        "precio_nuevo": float(_q2(new_price)) if new_price > 0 else prev_price,
        "margen": meta.get("margen_final_pieza"),
        "usuario": user,
        "motivo": f"Recepción {folio} — costo real puesto en almacén",
    })
    meta["price_history"] = hist[:30]

    if it.homolog_status in ("LIGADO", "PREALTA") or (it.supplier_code and it.homolog_by == "PROVEEDOR"):
        _upsert_supplier_link(meta, sup, it.supplier_code, unit_cost, folio)
        code = (it.supplier_code or "").strip().upper()
        if code and not (product.sales_code or "").strip():
            if not _code_in_use_by_other(db, empresa_id, code, product.id):
                product.sales_code = code
        if code and not meta.get("codigo_alterno") and (product.sales_code or "").strip().upper() == code:
            meta["codigo_alterno"] = code
    product.meta_data = meta
    if relink:
        _relink_scales(db, empresa_id, product, *relink)


# ── Contabilidad ──────────────────────────────────────────────────────────────

def _post_entry(db: Session, empresa_id: str, sucursal_id: str, concepto: str, ref_type: str,
                ref_id: str, user: str, lines: List[Dict[str, Any]]) -> Optional[models.AccountingEntry]:
    lines = [ln for ln in lines if _d(ln["monto"]) > 0]
    if not lines:
        return None
    debe = sum(_d(ln["monto"]) for ln in lines if ln["tipo"] == "DEBE")
    haber = sum(_d(ln["monto"]) for ln in lines if ln["tipo"] == "HABER")
    if _q2(debe) != _q2(haber):
        raise HTTPException(status_code=500, detail=f"Asiento descuadrado ({_q2(debe)} vs {_q2(haber)}) en «{concepto}».")
    entry = models.AccountingEntry(
        empresa_id=empresa_id, sucursal_id=sucursal_id, concepto=concepto,
        referencia_tipo=ref_type, referencia_id=ref_id,
        total_debe=_q4(debe), total_haber=_q4(haber), status="POSTED", created_by=user,
    )
    db.add(entry)
    db.flush()
    for ln in lines:
        db.add(models.AccountingEntryLine(
            empresa_id=empresa_id, entry_id=entry.id, cuenta_sat=ln["cuenta"], cuenta_nombre=ln["nombre"],
            tipo_movimiento=ln["tipo"], monto=_q4(_d(ln["monto"])), descripcion=ln.get("desc"),
        ))
    return entry


# ── Archivos ──────────────────────────────────────────────────────────────────

def _decode_b64(raw: str) -> bytes:
    data = raw or ""
    if "," in data and data.strip().lower().startswith("data:"):
        data = data.split(",", 1)[1]
    try:
        return base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Archivo adjunto con codificación base64 inválida.")


# ── POST /expedientes — CONFIRMAR RECEPCIÓN ───────────────────────────────────

@router.post("/expedientes", status_code=201)
def confirm_reception(
    req: ConfirmIn,
    db: Session = Depends(get_db),
    tenant: dict = Depends(_GUARD_WRITE),
    _m=Depends(require_module_access("COMPRAS")),
):
    empresa_id = tenant["empresa"]
    sucursal_id = tenant.get("sucursal", "MATRIZ")
    user = str(tenant.get("user_id") or tenant.get("sub") or tenant.get("username") or "system")

    # Idempotencia: un doble clic o reintento de red no duplica la recepción.
    dup = (
        db.query(models.ReceptionExpediente)
        .filter(models.ReceptionExpediente.empresa_id == empresa_id,
                models.ReceptionExpediente.idempotency_key == req.idempotency_key)
        .first()
    )
    if dup:
        return {"ok": True, "duplicate": True, "id": dup.id, "folio": dup.folio}

    origin = req.origin_type if req.origin_type in ORIGIN_TYPES else "DIRECTA"
    pay_cond = req.payment_condition if req.payment_condition in PAYMENT_CONDITIONS else "CREDITO"
    method = req.prorate_method if req.prorate_method in PRORATE_METHODS else "IMPORTE"

    if not req.items:
        raise HTTPException(status_code=400, detail="La recepción no tiene partidas.")

    warehouse = (
        db.query(models.Warehouse)
        .filter(models.Warehouse.empresa_id == empresa_id, models.Warehouse.id == req.warehouse_id)
        .first()
    )
    if not warehouse:
        raise HTTPException(status_code=400, detail=f"Bodega «{req.warehouse_id}» no encontrada.")

    # Fecha de factura duplicada (mismo UUID) → bloquear doble captura de la misma factura
    inv_uuid = str((req.invoice or {}).get("uuid") or "").strip().upper() or None
    if inv_uuid:
        same = (
            db.query(models.ReceptionExpediente)
            .filter(models.ReceptionExpediente.empresa_id == empresa_id,
                    func.upper(models.ReceptionExpediente.invoice_uuid) == inv_uuid)
            .first()
        )
        if same:
            raise HTTPException(
                status_code=409,
                detail=f"La factura UUID {inv_uuid} ya fue recibida en el expediente {same.folio}.",
            )

    # Productos del catálogo (todos deben existir; la pre-alta ocurre en el Paso 2)
    products: Dict[str, models.Product] = {}
    missing_codes = []
    for it in req.items:
        p = _find_product(db, empresa_id, it.sku)
        if not p:
            missing_codes.append(it.sku)
        else:
            products[it.sku] = p
    if missing_codes:
        raise HTTPException(
            status_code=400,
            detail="Estos códigos aún no existen en el catálogo (completa su homologación/pre-alta en el Paso 2): "
                   + ", ".join(sorted(set(missing_codes))),
        )

    # Validaciones por partida
    damaged_refs = {f.item_ref for f in req.files if f.kind == "FOTO_DANO" and f.item_ref}
    sum_disputed_units = Decimal("0")
    for it in req.items:
        if it.qty_invoiced <= 0 or it.unit_cost < 0:
            raise HTTPException(status_code=400, detail=f"Partida {it.sku}: cantidad/costo inválidos.")
        if min(it.qty_ok, it.qty_missing, it.qty_damaged) < 0:
            raise HTTPException(status_code=400, detail=f"Partida {it.sku}: cantidades negativas.")
        tot = _d(it.qty_ok) + _d(it.qty_missing) + _d(it.qty_damaged)
        if abs(tot - _d(it.qty_invoiced)) > Decimal("0.0001"):
            raise HTTPException(
                status_code=400,
                detail=f"Partida {it.sku}: sano + faltante + dañado ({tot}) no coincide con lo facturado ({it.qty_invoiced}).",
            )
        sum_disputed_units += _d(it.qty_missing) + _d(it.qty_damaged)
        if _d(it.qty_damaged) > 0 and it.sku not in damaged_refs:
            raise HTTPException(status_code=400, detail=f"Partida {it.sku}: los daños exigen foto de evidencia.")

    incident = dict(req.incident or {})
    action = str(incident.get("action") or "").upper() or None
    if sum_disputed_units > 0 and action not in INCIDENT_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail="Hay faltantes o daños: elige «Solicitar Nota de Crédito» o «Cambio Físico / Reposición».",
        )
    if sum_disputed_units == 0:
        action = None

    supplier = _ensure_supplier(db, empresa_id, sucursal_id, req.supplier_name, req.supplier_rfc, req.supplier_id)

    # ── Totales ──────────────────────────────────────────────────────────────
    fr = dict(req.freight or {})
    raw_legs = fr.get("legs")
    if not isinstance(raw_legs, list) or not raw_legs:
        raw_legs = [fr]          # compatibilidad: forma anterior de un solo flete
    legs: List[Dict[str, Any]] = []
    for n, lg in enumerate(raw_legs, start=1):
        if not isinstance(lg, dict):
            continue
        cond = str(lg.get("condition") or "PROVEEDOR").upper()
        if cond not in FREIGHT_CONDITIONS:
            cond = "PROVEEDOR"
        lines = [ln for ln in (lg.get("lines") or []) if isinstance(ln, dict) and _d(ln.get("amount")) > 0]
        leg_total = sum((_d(ln.get("amount")) for ln in lines), Decimal("0"))
        legs.append({
            "n": n, "condition": cond,
            "carrier_name": str(lg.get("carrier_name") or "").strip(),
            "carrier_rfc": (str(lg.get("carrier_rfc") or "").strip().upper() or None),
            "origin": str(lg.get("origin") or "").strip(), "destination": str(lg.get("destination") or "").strip(),
            "doc_uuid": str(lg.get("doc_uuid") or "").strip().upper(), "doc_folio": str(lg.get("doc_folio") or "").strip(),
            "lines": lines, "informative_total": leg_total,
            "total": leg_total if cond != "PROVEEDOR" else Decimal("0"),   # lo que paga el proveedor no cuesta
        })
    for lg in legs:
        if lg["total"] > 0 and not lg["carrier_name"]:
            raise HTTPException(status_code=400, detail=f"Traslado {lg['n']}: captura el nombre del transportista.")
    freight_total = sum((lg["total"] for lg in legs), Decimal("0"))
    _conds = {lg["condition"] for lg in legs if lg["total"] > 0}
    fr_cond = next(iter(_conds)) if len(_conds) == 1 else ("MIXTO" if _conds else "PROVEEDOR")

    landed = compute_landed(req.items, freight_total, method)
    landed_by_sku = {r["sku"]: r for r in landed["rows"]}

    sano_sub = disp_sub = calc_total = Decimal("0")
    sano_iva = disp_iva = Decimal("0")
    for it in req.items:
        cost = _d(it.unit_cost)
        iva = _d(it.iva_rate)
        sano_sub += _d(it.qty_ok) * cost
        sano_iva += _d(it.qty_ok) * cost * iva
        disp_units = _d(it.qty_missing) + _d(it.qty_damaged)
        disp_sub += disp_units * cost
        disp_iva += disp_units * cost * iva
        calc_total += _d(it.qty_invoiced) * cost * (Decimal("1") + iva)
    disputed_total = disp_sub + disp_iva

    inv = dict(req.invoice or {})
    xml_total = _d(inv.get("total"))
    xml_sub = _d(inv.get("subtotal"))
    invoice_total = xml_total if xml_total > 0 else calc_total
    invoice_sub = xml_sub if xml_sub > 0 else (sano_sub + disp_sub)
    invoice_tax = invoice_total - invoice_sub
    payable = invoice_total - (disputed_total if action == "NC" else Decimal("0"))
    if payable < 0:
        payable = Decimal("0")
    if pay_cond == "SIN_CARGO":
        payable = Decimal("0")   # no hay factura a pagar: se valúa el inventario contra una cuenta puente

    # ── Folios ───────────────────────────────────────────────────────────────
    folio = _next_year_folio(db, empresa_id, "RCP", models.ReceptionExpediente.folio)
    rec_folio = crud._next_folio(db, empresa_id, "REC-", models.PurchaseReceipt.folio)

    # ── Expediente (cabecera) ────────────────────────────────────────────────
    phys = dict(req.physical or {})
    phys_state = str(phys.get("state") or "SELLADA").upper()
    if phys_state not in PHYSICAL_STATES:
        phys_state = "SELLADA"

    ratings = dict(req.ratings or {})
    crit = [float(ratings.get(k) or 0) for k in ("empaque", "tiempo", "documentacion", "producto")]
    crit_valid = [c for c in crit if c > 0]
    rating_avg = round(sum(crit_valid) / len(crit_valid), 2) if crit_valid else 0.0

    if sum_disputed_units > 0:
        exp_status = "NC_PENDIENTE" if action == "NC" else "INCIDENCIA"
        inc_status = str(incident.get("status") or "ABIERTO").upper()
        if inc_status not in INCIDENT_STATUSES:
            inc_status = "ABIERTO"
    else:
        exp_status, inc_status = "COMPLETA", "NINGUNA"

    freight_pct = (freight_total / invoice_sub * 100) if invoice_sub > 0 else Decimal("0")

    exp = models.ReceptionExpediente(
        empresa_id=empresa_id, sucursal_id=sucursal_id, folio=folio, idempotency_key=req.idempotency_key,
        origin_type=origin, po_folio=req.po_folio, purchase_order_id=req.po_id,
        supplier_id=supplier.id, supplier_name=supplier.name, supplier_rfc=supplier.rfc,
        warehouse_id=warehouse.id,
        invoice_uuid=inv_uuid, invoice_serie=str(inv.get("serie") or "") or None,
        invoice_folio=str(inv.get("folio") or "") or None, invoice_date=str(inv.get("fecha") or "") or None,
        payment_condition=pay_cond,
        subtotal=_q4(invoice_sub), tax_amount=_q4(invoice_tax), total=_q4(invoice_total), payable_total=_q4(payable),
        freight_condition=fr_cond, freight_total=_q4(freight_total), freight_pct=_q4(freight_pct),
        prorate_method=landed["method_used"],
        physical_state=phys_state, status=exp_status, incident_action=action, incident_status=inc_status,
        disputed_amount=_q4(disputed_total), rating_avg=Decimal(str(rating_avg)),
        created_by=user,
    )
    db.add(exp)
    db.flush()

    # ── Recepción legada (compatibilidad con OC / CxP existentes) ────────────
    receipt = models.PurchaseReceipt(
        empresa_id=empresa_id, sucursal_id=sucursal_id, folio=rec_folio,
        purchase_order_id=req.po_id, supplier_id=supplier.id, warehouse_id=warehouse.id,
        received_by=user, subtotal=_q4(sano_sub), tax_amount=_q4(sano_iva), total=_q4(sano_sub + sano_iva),
        payment_type="CREDIT" if pay_cond == "CREDITO" else "CASH",
        notes=f"Expediente 360° {folio}", idempotency_key=f"{req.idempotency_key}:rec",
    )
    db.add(receipt)
    db.flush()
    exp.purchase_receipt_id = receipt.id
    exp.purchase_receipt_folio = rec_folio

    po = None
    po_items: Dict[str, models.PurchaseOrderItem] = {}
    if req.po_id:
        po = crud.get_purchase_order(db, empresa_id, req.po_id)
        if po:
            for poi in (
                db.query(models.PurchaseOrderItem)
                .filter(models.PurchaseOrderItem.empresa_id == empresa_id,
                        models.PurchaseOrderItem.purchase_order_id == req.po_id).all()
            ):
                po_items[poi.id] = poi

    # ── Inventario, Kardex, costos y precios ─────────────────────────────────
    kardex_ref = f"COM-{folio}"
    stock_lines = []
    for it in req.items:
        product = products[it.sku]
        lrow = landed_by_sku.get(it.sku) or {"alloc": Decimal("0"), "fpu": Decimal("0"), "landed_unit": _d(it.unit_cost)}
        qty_ok = _d(it.qty_ok)
        cost = _d(it.unit_cost)

        db.add(models.PurchaseReceiptItem(
            empresa_id=empresa_id, receipt_id=receipt.id,
            purchase_order_item_id=it.purchase_order_item_id if it.purchase_order_item_id in po_items else None,
            product_id=product.id, sku=product.sku, description=(it.description or product.name or "")[:250],
            quantity_received=qty_ok, unit_cost=cost, subtotal=_q4(qty_ok * cost),
        ))

        if qty_ok > 0:
            ws = (
                db.query(models.WarehouseStock)
                .filter(models.WarehouseStock.empresa_id == empresa_id,
                        models.WarehouseStock.product_id == product.id,
                        models.WarehouseStock.warehouse_id == warehouse.id)
                .first()
            )
            if ws:
                ws.quantity = (ws.quantity or Decimal("0")) + qty_ok
            else:
                db.add(models.WarehouseStock(empresa_id=empresa_id, product_id=product.id,
                                             warehouse_id=warehouse.id, quantity=qty_ok))
            old_stock = max(_d(product.stock), Decimal("0"))
            old_cost = _d(product.average_cost)
            new_stock = old_stock + qty_ok
            if new_stock > 0:
                product.average_cost = _q4((old_stock * old_cost + qty_ok * lrow["landed_unit"]) / new_stock)
            product.stock = _d(product.stock) + qty_ok
            db.add(models.InventoryMovement(
                empresa_id=empresa_id, sucursal_id=warehouse.sucursal_id or sucursal_id,
                product_id=product.id, warehouse_id=warehouse.id, movement_type="COMPRA",
                quantity=qty_ok, unit_cost=_q4(cost), total_freight_cost=_q4(lrow["fpu"] * qty_ok),
                reference_type="RECEPCION_COMPRA", reference_id=kardex_ref,
                idempotency_key=f"{req.idempotency_key}:{product.id}",
                reason=f"Recepción {folio} · {supplier.name}"
                       + (f" · Factura {inv.get('serie') or ''}{inv.get('folio') or ''}".rstrip() if inv.get("folio") else ""),
                authorized_by_id=user,
            ))
        stock_lines.append({"sku": product.sku, "qty_ok": float(qty_ok)})

        _apply_catalog_updates(db, empresa_id, product, it, lrow, supplier, folio, user)

        # Avance de la OC
        poi = po_items.get(it.purchase_order_item_id or "")
        if not poi:
            poi = next((p for p in po_items.values() if (p.sku or "").upper() == (product.sku or "").upper()), None)
        if poi:
            poi.quantity_received = (poi.quantity_received or Decimal("0")) + qty_ok
            poi.status = "RECEIVED" if poi.quantity_received >= poi.quantity_ordered else "PARTIAL"
    if po and po.status != "CANCELLED":
        po.status = "COMPLETED" if po_items and all(p.status == "RECEIVED" for p in po_items.values()) else "PARTIAL"

    # ── Cuentas por pagar / pago inmediato ───────────────────────────────────
    ap = None
    created_aps: List[models.AccountsPayable] = []
    if pay_cond == "CREDITO" and payable > 0:
        credit_days = int(supplier.credit_days or 0)
        recv_dt = _now()
        due = recv_dt + timedelta(days=credit_days)   # vence = fecha de recepción + días de crédito (0 = al recibir)
        ap = models.AccountsPayable(
            empresa_id=empresa_id, sucursal_id=sucursal_id, supplier_id=supplier.id,
            purchase_receipt_id=receipt.id, purchase_order_id=req.po_id,
            amount=_q4(payable), amount_paid=Decimal("0"), balance=_q4(payable), due_date=due,
            # seguimiento: folio de la cuenta, folio fiscal, fechas y expediente de origen
            folio=_apt.next_cxp_folio(db, empresa_id), concept="MERCANCIA", expediente_id=exp.id,
            invoice_uuid=(inv_uuid or None), invoice_ref=(f"{inv.get('serie') or ''}{inv.get('folio') or ''}".strip() or None),
            issue_date=_apt.parse_dt(inv.get("fecha")), receipt_date=recv_dt, credit_days=credit_days,
        )
        db.add(ap)
        db.flush()
        exp.accounts_payable_id = ap.id
        created_aps.append(ap)

    # ── Asiento contable de la mercancía ─────────────────────────────────────
    if pay_cond == "SIN_CARGO":
        bridge = {
            "TRASPASO": ("115.01", "Traspasos entre Sucursales por Conciliar"),
            "CONSIGNACION": ("205.01", "Mercancía Recibida en Consignación"),
            "REPOSICION": ("107.01", "Reposición pendiente de Proveedor"),
        }.get(origin, ("499.01", "Mercancía Recibida sin Cargo"))
        _post_entry(db, empresa_id, sucursal_id, f"Recepción {folio} — {supplier.name} ({origin})", "COMPRA", exp.id, user, [
            {"tipo": "DEBE", "cuenta": "151.01", "nombre": "Inventario de Mercancías", "monto": sano_sub,
             "desc": f"Unidades sanas recibidas {folio}"},
            {"tipo": "HABER", "cuenta": bridge[0], "nombre": bridge[1], "monto": sano_sub,
             "desc": f"Contrapartida {origin} {folio}"},
        ])
    else:
        pending_repo = disputed_total if action == "REPOSICION" else Decimal("0")
        inv_debit = sano_sub
        iva_debit = payable - sano_sub - pending_repo
        if iva_debit < 0:
            inv_debit = payable - pending_repo
            iva_debit = Decimal("0")
        credit_acc = {
            "CREDITO": ("201.01", "Proveedores"),
            "CONTADO": ("102.01", "Caja"),
            "TRANSFERENCIA": ("102.02", "Bancos"),
        }[pay_cond]
        _post_entry(db, empresa_id, sucursal_id, f"Recepción {folio} — {supplier.name}", "COMPRA", exp.id, user, [
            {"tipo": "DEBE", "cuenta": "151.01", "nombre": "Inventario de Mercancías", "monto": inv_debit,
             "desc": f"Unidades sanas recibidas {folio}"},
            {"tipo": "DEBE", "cuenta": "118.01", "nombre": "IVA Acreditable Pagado", "monto": iva_debit,
             "desc": f"IVA de factura {inv.get('folio') or ''}"},
            {"tipo": "DEBE", "cuenta": "107.01", "nombre": "Reposición pendiente de Proveedor", "monto": pending_repo,
             "desc": "Mercancía facturada pendiente de reposición física"},
            {"tipo": "HABER", "cuenta": credit_acc[0], "nombre": credit_acc[1], "monto": payable,
             "desc": f"{credit_acc[1]} — factura {inv.get('folio') or inv_uuid or ''}"},
        ])

    # ── Flete / costos adicionales → Gastos Operativos (+ CxP si es a crédito) ─
    # Cada traslado (transportista) genera su propio gasto, su asiento y, si es a crédito,
    # su propia cuenta por pagar a esa fletera.
    expense = None
    legs_out: List[Dict[str, Any]] = []
    for lg in legs:
        leg_out = {
            "n": lg["n"], "condicion": lg["condition"], "transportista": lg["carrier_name"], "rfc": lg["carrier_rfc"],
            "origen": lg["origin"], "destino": lg["destination"], "doc_uuid": lg["doc_uuid"], "doc_folio": lg["doc_folio"],
            "renglones": lg["lines"], "total": float(_q2(lg["total"])), "informativo": float(_q2(lg["informative_total"])),
            "gasto_id": None, "gasto_folio": None, "cxp_id": None,
        }
        legs_out.append(leg_out)
        if lg["total"] <= 0:
            continue
        carrier_name = lg["carrier_name"] or f"Transportista {lg['n']}"
        carrier_rfc = lg["carrier_rfc"]
        expense_folio = _next_year_folio(db, empresa_id, "GTO", models.OperatingExpense.folio)
        concept_parts = [f"{str(ln.get('type') or 'FLETE').upper()} ${_q2(_d(ln.get('amount')))}" for ln in lg["lines"]]
        route = f" {lg['origin']}→{lg['destination']}" if (lg["origin"] or lg["destination"]) else ""
        leg_expense = models.OperatingExpense(
            empresa_id=empresa_id, sucursal_id=sucursal_id, folio=expense_folio, category="FLETE_COMPRAS",
            concept=f"Flete {lg['n']}/{len(legs)}{route} recepción {folio} ({', '.join(concept_parts)})"[:240],
            amount=_q4(lg["total"]), capitalized=True, supplier_name=carrier_name, supplier_rfc=carrier_rfc,
            doc_uuid=lg["doc_uuid"] or None, doc_folio=lg["doc_folio"] or None,
            payment_condition=lg["condition"], status="PENDIENTE_CXP" if lg["condition"] == "CREDITO" else "PAGADO",
            expediente_id=exp.id, created_by=user,
            detail={"lines": lg["lines"], "method": landed["method_used"], "recepcion": folio, "traslado": lg["n"],
                    "origen": lg["origin"], "destino": lg["destination"]},
        )
        db.add(leg_expense)
        db.flush()
        if expense is None:
            expense = leg_expense
            exp.freight_expense_id = leg_expense.id
        leg_out["gasto_id"], leg_out["gasto_folio"] = leg_expense.id, leg_expense.folio
        if lg["condition"] == "CREDITO":
            carrier = _ensure_supplier(db, empresa_id, sucursal_id, carrier_name, carrier_rfc)
            fap = models.AccountsPayable(
                empresa_id=empresa_id, sucursal_id=sucursal_id, supplier_id=carrier.id,
                amount=_q4(lg["total"]), amount_paid=Decimal("0"), balance=_q4(lg["total"]),
                due_date=_now() + timedelta(days=int(carrier.credit_days or 0)),
                folio=_apt.next_cxp_folio(db, empresa_id), concept="FLETE", expediente_id=exp.id,
                invoice_uuid=((lg["doc_uuid"] or "").upper() or None), invoice_ref=(lg["doc_folio"] or None),
                receipt_date=_now(), credit_days=int(carrier.credit_days or 0),
            )
            db.add(fap)
            db.flush()
            created_aps.append(fap)
            leg_expense.accounts_payable_id = fap.id
            leg_out["cxp_id"] = fap.id
            fr_credit = ("201.01", "Proveedores")
        else:
            fr_credit = ("102.01", "Caja")
        _post_entry(db, empresa_id, sucursal_id, f"Flete {expense_folio} — {carrier_name} (recepción {folio})",
                    "GASTO_FLETE", leg_expense.id, user, [
            {"tipo": "DEBE", "cuenta": "151.01", "nombre": "Inventario — Flete capitalizado (Landed Cost)",
             "monto": lg["total"], "desc": f"Flete/maniobras prorrateados {folio} (traslado {lg['n']})"},
            {"tipo": "HABER", "cuenta": fr_credit[0], "nombre": fr_credit[1], "monto": lg["total"],
             "desc": f"{carrier_name} · {leg_expense.doc_folio or leg_expense.doc_uuid or ''}"},
        ])

    # ── Archivos del expediente ──────────────────────────────────────────────
    total_bytes = 0
    saved_files = []
    for f in req.files:
        kind = f.kind.upper()
        if kind not in FILE_KINDS:
            raise HTTPException(status_code=400, detail=f"Tipo de archivo no permitido: {f.kind}")
        raw = _decode_b64(f.b64)
        if len(raw) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"«{f.filename}» excede {MAX_FILE_BYTES // (1024 * 1024)} MB.")
        total_bytes += len(raw)
        if total_bytes > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="El expediente excede el tamaño total permitido.")
        rec = models.ReceptionFile(
            empresa_id=empresa_id, expediente_id=exp.id, kind=kind, item_ref=f.item_ref,
            filename=(f.filename or "archivo")[:200], mime=(f.mime or "application/octet-stream")[:100],
            size_bytes=len(raw), content_b64=base64.b64encode(raw).decode("ascii"),
        )
        db.add(rec)
        db.flush()
        saved_files.append({"id": rec.id, "kind": kind, "filename": rec.filename, "mime": rec.mime,
                            "size": rec.size_bytes, "item_ref": rec.item_ref})

    # ── Payload 13 puntos de auditoría ───────────────────────────────────────
    cost_rows = []
    for it in req.items:
        lrow = landed_by_sku.get(it.sku) or {"alloc": Decimal("0"), "fpu": Decimal("0"), "landed_unit": _d(it.unit_cost)}
        prev = _d(it.prev_cost)
        landed_unit = lrow["landed_unit"]
        incr = float((landed_unit / prev - 1) * 100) if prev > 0 else 0.0
        cost_rows.append({
            "line_no": it.line_no, "sku": it.sku, "supplier_code": it.supplier_code, "description": it.description,
            "qty_invoiced": it.qty_invoiced, "qty_ok": it.qty_ok, "qty_missing": it.qty_missing,
            "qty_damaged": it.qty_damaged, "damage_cause": it.damage_cause, "lot": it.lot, "expiry": it.expiry,
            "unit_cost_xml": float(_q4(_d(it.unit_cost))), "freight_alloc": float(_q4(lrow["alloc"])),
            "freight_per_unit": float(_q4(lrow["fpu"])), "landed_unit_cost": float(_q4(landed_unit)),
            "prev_cost": float(prev), "cost_increase_pct": round(incr, 2), "cost_alert": incr > 10.0,
            "price_updated": bool(it.update_price and it.new_price), "new_price": it.new_price,
            "margin_pct": it.margin_pct, "homolog_status": it.homolog_status, "homolog_by": it.homolog_by,
            "weight_kg": it.unit_weight_kg, "volume_m3": it.unit_volume_m3,
        })
    extra = dict(req.extra or {})
    payload = {
        "p1_origen": {"tipo": origin, "po_id": req.po_id, "po_folio": req.po_folio,
                      "bodega_id": warehouse.id, "bodega": warehouse.name},
        "p2_proveedor": {"id": supplier.id, "nombre": supplier.name, "rfc": supplier.rfc,
                         "dias_credito": supplier.credit_days},
        "p3_factura": {**inv, "condicion_pago": pay_cond, "total_calculado": float(_q2(calc_total)),
                       "conceptos": [{"line_no": it.line_no, "codigo": it.supplier_code, "descripcion": it.description,
                                      "cantidad": it.qty_invoiced, "valor_unitario": it.unit_cost,
                                      "clave_sat": it.sat_key, "unidad_sat": it.sat_unit} for it in req.items]},
        "p4_documentos": [x for x in saved_files if x["kind"] in
                          ("FACTURA_XML", "FACTURA_PDF", "CARTA_PORTE", "PACKING_LIST", "FLETE_XML", "FLETE_PDF")],
        "p5_homologacion": extra.get("homologation") or [],
        "p6_prealtas": extra.get("prealtas") or [],
        "p7_flete": {"condicion": fr_cond, "traslados": legs_out, "total": float(_q2(freight_total)),
                     "transportista": (legs_out[0]["transportista"] if legs_out else None),
                     "rfc": (legs_out[0]["rfc"] if legs_out else None),
                     "doc_uuid": (legs_out[0]["doc_uuid"] if legs_out else None),
                     "doc_folio": (legs_out[0]["doc_folio"] if legs_out else None),
                     "renglones": [ln for lo in legs_out for ln in lo["renglones"]],
                     "gasto_id": expense.id if expense else None, "gasto_folio": expense.folio if expense else None,
                     "gastos_folios": [lo["gasto_folio"] for lo in legs_out if lo["gasto_folio"]]},
        "p8_prorrateo": {"metodo_solicitado": method, "metodo_aplicado": landed["method_used"],
                         "pct_flete_sobre_factura": float(_q4(freight_pct)),
                         "base_total": float(_q4(landed["base_total"]))},
        "p9_costeo": cost_rows,
        "p10_inspeccion": {"estado_fisico": phys_state, "notas": phys.get("notes"),
                           "fotos": [x for x in saved_files if x["kind"] in ("FOTO_LLEGADA", "FOTO_DANO")]},
        "p11_incidencia": {"accion": action, "estatus": inc_status, "notas": incident.get("notes"),
                           "monto_en_disputa": float(_q2(disputed_total)),
                           "timeline": [{"fecha": _now().isoformat(), "estatus": inc_status, "usuario": user,
                                         "nota": "Expediente de incidencia abierto al confirmar la recepción"}]
                           if sum_disputed_units > 0 else []},
        "p12_calificacion": {**{k: ratings.get(k) for k in ("empaque", "tiempo", "documentacion", "producto")},
                             "promedio": rating_avg, "comentarios": ratings.get("comments")},
        "p13_autorizacion": {
            "firmas": [x for x in saved_files if x["kind"].startswith("FIRMA_")],
            "autorizado_por": user, "confirmado_en": _now().isoformat(),
            "afectaciones": {
                "inventario_kardex": stock_lines, "recepcion_legada": rec_folio,
                "cxp_id": ap.id if ap else None, "cxp_monto": float(_q2(payable)) if ap else 0,
                "pago_inmediato": None if ap else {"condicion": pay_cond, "monto": float(_q2(payable))},
                "gasto_flete_id": expense.id if expense else None,
                "gastos_flete": [{"folio": lo["gasto_folio"], "monto": lo["total"], "transportista": lo["transportista"],
                                  "condicion": lo["condicion"], "cxp_id": lo["cxp_id"]} for lo in legs_out if lo["gasto_folio"]],
                "total_pagable": float(_q2(payable)), "monto_en_disputa": float(_q2(disputed_total)),
            },
        },
        "archivos": saved_files,
        "totales": {"subtotal_factura": float(_q2(invoice_sub)), "iva": float(_q2(invoice_tax)),
                    "total_factura": float(_q2(invoice_total)), "sano_subtotal": float(_q2(sano_sub)),
                    "disputa_subtotal": float(_q2(disp_sub))},
    }
    exp.payload = payload

    for _cxp in created_aps:   # completa fecha de emisión / UUID leídos del XML adjunto si faltaban
        _apt.hydrate_payable(db, _cxp)

    db.add(models.AuditLog(
        empresa_id=empresa_id, sucursal_id=sucursal_id, user_id=user, action=f"RECEPCION_360:{folio}",
        severity="WARNING" if sum_disputed_units > 0 else "INFO",
        details={"proveedor": supplier.name, "total": float(_q2(invoice_total)), "en_disputa": float(_q2(disputed_total))},
    ))
    db.commit()
    return {
        "ok": True, "id": exp.id, "folio": folio, "receipt_folio": rec_folio, "status": exp_status,
        "total": float(_q2(invoice_total)), "payable": float(_q2(payable)), "disputed": float(_q2(disputed_total)),
        "ap_id": ap.id if ap else None, "cxp_folio": ap.folio if ap else None,
        "expense_id": expense.id if expense else None,
        "expense_folio": ", ".join(lo["gasto_folio"] for lo in legs_out if lo["gasto_folio"]) or None,
        "expense_count": sum(1 for lo in legs_out if lo["gasto_folio"]), "files": len(saved_files),
    }


# ── Lecturas ──────────────────────────────────────────────────────────────────

def _file_counts(db: Session, empresa_id: str, ids: List[str]) -> Dict[str, Dict[str, int]]:
    out: Dict[str, Dict[str, int]] = {i: {} for i in ids}
    if not ids:
        return out
    rows = (
        db.query(models.ReceptionFile.expediente_id, models.ReceptionFile.kind, func.count(models.ReceptionFile.id))
        .filter(models.ReceptionFile.empresa_id == empresa_id, models.ReceptionFile.expediente_id.in_(ids))
        .group_by(models.ReceptionFile.expediente_id, models.ReceptionFile.kind)
        .all()
    )
    for eid, kind, n in rows:
        out[eid][kind] = int(n)
    return out


def _row(e: models.ReceptionExpediente, counts: Dict[str, int], ap: Optional[models.AccountsPayable]) -> Dict[str, Any]:
    evid = sum(counts.get(k, 0) for k in ("FOTO_LLEGADA", "FOTO_DANO", "FIRMA_CHOFER", "FIRMA_ALMACEN", "FIRMA_SUPERVISOR"))
    return {
        "id": e.id, "folio": e.folio, "origin_type": e.origin_type, "po_folio": e.po_folio,
        "supplier_id": e.supplier_id, "supplier_name": e.supplier_name, "supplier_rfc": e.supplier_rfc,
        "invoice_uuid": e.invoice_uuid, "invoice_serie": e.invoice_serie, "invoice_folio": e.invoice_folio,
        "invoice_date": e.invoice_date, "payment_condition": e.payment_condition,
        "subtotal": _f(e.subtotal), "tax_amount": _f(e.tax_amount), "total": _f(e.total),
        "payable_total": _f(e.payable_total), "freight_total": _f(e.freight_total), "freight_pct": _f(e.freight_pct),
        "freight_condition": e.freight_condition, "prorate_method": e.prorate_method,
        "physical_state": e.physical_state, "status": e.status, "incident_action": e.incident_action,
        "incident_status": e.incident_status, "disputed_amount": _f(e.disputed_amount),
        "rating_avg": _f(e.rating_avg), "receipt_folio": e.purchase_receipt_folio,
        "created_at": _iso(e.created_at), "created_by": e.created_by,
        "ap": ({"id": ap.id, "folio": ap.folio, "status": ap.status, "amount": _f(ap.amount),
                "balance": _f(ap.balance), "due_date": _iso(ap.due_date)} if ap else None),
        "files": counts, "evidence_count": evid,
        "has_invoice_xml": counts.get("FACTURA_XML", 0) > 0, "has_invoice_pdf": counts.get("FACTURA_PDF", 0) > 0,
        "has_freight_doc": (counts.get("FLETE_XML", 0) + counts.get("FLETE_PDF", 0)) > 0,
    }


@router.get("/summary")
def reception_summary(
    db: Session = Depends(get_db), tenant: dict = Depends(_GUARD_READ),
    _m=Depends(require_module_access("COMPRAS")),
):
    empresa_id = tenant["empresa"]
    E = models.ReceptionExpediente
    now = _now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = db.query(E).filter(E.empresa_id == empresa_id).all()

    def in_month(e) -> bool:
        ca = e.created_at
        if not ca:
            return False
        if ca.tzinfo is None:
            ca = ca.replace(tzinfo=timezone.utc)
        return ca >= month_start

    month = [e for e in rows if in_month(e)]
    m_sub = sum(_d(e.subtotal) for e in month)
    m_fr = sum(_d(e.freight_total) for e in month)
    pending = [e for e in rows if e.status in ("INCIDENCIA", "NC_PENDIENTE")]
    rated = [e for e in rows if _f(e.rating_avg) > 0]

    by_sup: Dict[str, Dict[str, Any]] = {}
    for e in rated:
        s = by_sup.setdefault(e.supplier_id or e.supplier_name, {"supplier": e.supplier_name, "sum": 0.0, "n": 0})
        s["sum"] += _f(e.rating_avg)
        s["n"] += 1
    ranking = sorted(
        [{"supplier": v["supplier"], "avg": round(v["sum"] / v["n"], 2), "receptions": v["n"]} for v in by_sup.values()],
        key=lambda x: -x["avg"],
    )
    return {
        "month": {"count": len(month), "amount": float(_q2(sum(_d(e.total) for e in month)))},
        "freight": {"avg_pct": float(_q2(m_fr / m_sub * 100)) if m_sub > 0 else 0.0, "amount": float(_q2(m_fr))},
        "incidents": {"count": len(pending), "amount": float(_q2(sum(_d(e.disputed_amount) for e in pending)))},
        "rating": {"avg": round(sum(_f(e.rating_avg) for e in rated) / len(rated), 2) if rated else 0.0,
                   "count": len(rated), "ranking": ranking[:8]},
        "total_receptions": len(rows),
    }


@router.get("/expedientes")
def list_expedientes(
    q: str = "", status: str = "", limit: int = Query(200, le=500), skip: int = 0,
    db: Session = Depends(get_db), tenant: dict = Depends(_GUARD_READ),
    _m=Depends(require_module_access("COMPRAS")),
):
    empresa_id = tenant["empresa"]
    E = models.ReceptionExpediente
    qry = db.query(E).filter(E.empresa_id == empresa_id)
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        qry = qry.filter(or_(E.folio.ilike(like), E.supplier_name.ilike(like), E.invoice_uuid.ilike(like),
                             E.invoice_folio.ilike(like), E.po_folio.ilike(like), E.purchase_receipt_folio.ilike(like)))
    st = (status or "").strip().upper()
    if st == "COMPLETA":
        qry = qry.filter(E.status.in_(["COMPLETA", "RESUELTA"]))
    elif st in ("INCIDENCIA", "NC_PENDIENTE", "RESUELTA"):
        qry = qry.filter(E.status == st)
    items = qry.order_by(E.created_at.desc()).offset(skip).limit(limit).all()
    counts = _file_counts(db, empresa_id, [e.id for e in items])
    ap_ids = [e.accounts_payable_id for e in items if e.accounts_payable_id]
    aps = {}
    if ap_ids:
        aps = {a.id: a for a in db.query(models.AccountsPayable)
               .filter(models.AccountsPayable.empresa_id == empresa_id, models.AccountsPayable.id.in_(ap_ids)).all()}
    return [_row(e, counts.get(e.id, {}), aps.get(e.accounts_payable_id)) for e in items]


@router.get("/expedientes/{exp_id}")
def get_expediente(
    exp_id: str, db: Session = Depends(get_db), tenant: dict = Depends(_GUARD_READ),
    _m=Depends(require_module_access("COMPRAS")),
):
    empresa_id = tenant["empresa"]
    e = _get_exp(db, empresa_id, exp_id)
    counts = _file_counts(db, empresa_id, [e.id]).get(e.id, {})
    ap = None
    if e.accounts_payable_id:
        ap = (db.query(models.AccountsPayable)
              .filter(models.AccountsPayable.empresa_id == empresa_id,
                      models.AccountsPayable.id == e.accounts_payable_id).first())
    files = (
        db.query(models.ReceptionFile.id, models.ReceptionFile.kind, models.ReceptionFile.item_ref,
                 models.ReceptionFile.filename, models.ReceptionFile.mime, models.ReceptionFile.size_bytes)
        .filter(models.ReceptionFile.empresa_id == empresa_id, models.ReceptionFile.expediente_id == e.id)
        .order_by(models.ReceptionFile.created_at.asc()).all()
    )
    expense = None
    if e.freight_expense_id:
        x = (db.query(models.OperatingExpense)
             .filter(models.OperatingExpense.empresa_id == empresa_id,
                     models.OperatingExpense.id == e.freight_expense_id).first())
        if x:
            expense = {"id": x.id, "folio": x.folio, "amount": _f(x.amount), "status": x.status,
                       "payment_condition": x.payment_condition, "supplier_name": x.supplier_name,
                       "doc_uuid": x.doc_uuid, "doc_folio": x.doc_folio, "capitalized": bool(x.capitalized),
                       "accounts_payable_id": x.accounts_payable_id}
    return {
        **_row(e, counts, ap), "payload": e.payload or {},
        "files_list": [{"id": f.id, "kind": f.kind, "item_ref": f.item_ref, "filename": f.filename,
                        "mime": f.mime, "size": f.size_bytes} for f in files],
        "expense": expense,
        "expenses": [{"id": x.id, "folio": x.folio, "amount": _f(x.amount), "status": x.status,
                      "payment_condition": x.payment_condition, "supplier_name": x.supplier_name,
                      "doc_uuid": x.doc_uuid, "doc_folio": x.doc_folio, "accounts_payable_id": x.accounts_payable_id}
                     for x in db.query(models.OperatingExpense)
                     .filter(models.OperatingExpense.empresa_id == empresa_id,
                             models.OperatingExpense.expediente_id == e.id)
                     .order_by(models.OperatingExpense.folio.asc()).all()],
    }


@router.get("/price-scales")
def reception_price_scales(
    db: Session = Depends(get_db), tenant: dict = Depends(_GUARD_READ),
    _m=Depends(require_module_access("COMPRAS")),
):
    """Escalas de precio del catálogo (PRECIO DE LISTA, CONTRATISTA…): el margen por defecto de un
    producto nuevo y los precios de cada escala se derivan de ellas, igual que en Alta de Producto."""
    from routers.products import _get_tenant_global_scales
    gs = _get_tenant_global_scales(db, tenant["empresa"])
    return {"price_scales": [
        {"name": s["name"], "margen_ideal": s["margen_ideal"], "oferta": s["oferta"], "comision": s["comision"],
         "margen_trabajo": round(s["margen_ideal"] - s["oferta"], 4), "active": s["active"], "locked": s["locked"]}
        for s in gs["price_scales"]
    ]}


def _get_exp(db: Session, empresa_id: str, exp_id: str) -> models.ReceptionExpediente:
    e = (db.query(models.ReceptionExpediente)
         .filter(models.ReceptionExpediente.empresa_id == empresa_id, models.ReceptionExpediente.id == exp_id).first())
    if not e:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")
    return e


@router.get("/files/{file_id}")
def get_reception_file(
    file_id: str, download: bool = False,
    db: Session = Depends(get_db), tenant: dict = Depends(_GUARD_READ),
    _m=Depends(require_module_access("COMPRAS")),
):
    f = (db.query(models.ReceptionFile)
         .filter(models.ReceptionFile.empresa_id == tenant["empresa"], models.ReceptionFile.id == file_id).first())
    if not f:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    headers = {"Content-Disposition": f'{"attachment" if download else "inline"}; filename="{f.filename}"',
               "Cache-Control": "private, max-age=300"}
    return Response(content=base64.b64decode(f.content_b64), media_type=f.mime or "application/octet-stream",
                    headers=headers)


# ── Seguimiento de la incidencia / reclamo al proveedor ──────────────────────

@router.patch("/expedientes/{exp_id}/incident")
def update_incident(
    exp_id: str, body: IncidentUpdateIn,
    db: Session = Depends(get_db), tenant: dict = Depends(_GUARD_WRITE),
    _m=Depends(require_module_access("COMPRAS")),
):
    empresa_id = tenant["empresa"]
    sucursal_id = tenant.get("sucursal", "MATRIZ")
    user = str(tenant.get("user_id") or tenant.get("sub") or tenant.get("username") or "system")
    e = _get_exp(db, empresa_id, exp_id)
    status = (body.status or "").upper()
    if status not in INCIDENT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Estatus inválido. Usa: {', '.join(sorted(INCIDENT_STATUSES))}")
    if e.incident_status == "NINGUNA" or not e.incident_action:
        raise HTTPException(status_code=400, detail="Este expediente no tiene incidencia abierta.")
    if e.incident_action == "NC" and status == "REPOSICION_RECIBIDA":
        raise HTTPException(status_code=400, detail="Este reclamo es por Nota de Crédito, no por reposición física.")
    if e.incident_action == "REPOSICION" and status == "NC_APLICADA":
        raise HTTPException(status_code=400, detail="Este reclamo es por reposición física, no por Nota de Crédito.")

    payload = copy.deepcopy(e.payload or {})
    inc = payload.setdefault("p11_incidencia", {})
    timeline = inc.setdefault("timeline", [])
    note = (body.notes or "").strip()
    if status == "NC_APLICADA":
        inc["nc_folio"] = (body.nc_folio or "").strip() or inc.get("nc_folio")
        inc["nc_monto"] = body.nc_amount if body.nc_amount is not None else inc.get("monto_en_disputa")
        note = note or f"Nota de crédito {inc.get('nc_folio') or ''} aplicada por ${inc.get('nc_monto') or 0}"

    if status == "REPOSICION_RECIBIDA" and not inc.get("reposicion_recibida"):
        wh = (db.query(models.Warehouse)
              .filter(models.Warehouse.empresa_id == empresa_id, models.Warehouse.id == e.warehouse_id).first())
        if not wh:
            raise HTTPException(status_code=400, detail="La bodega del expediente ya no existe.")
        disp_sub = Decimal("0")
        disp_iva = Decimal("0")
        for row in (payload.get("p9_costeo") or []):
            units = _d(row.get("qty_missing")) + _d(row.get("qty_damaged"))
            if units <= 0:
                continue
            product = _find_product(db, empresa_id, row.get("sku"))
            if not product:
                continue
            cost = _d(row.get("unit_cost_xml"))
            ws = (db.query(models.WarehouseStock)
                  .filter(models.WarehouseStock.empresa_id == empresa_id,
                          models.WarehouseStock.product_id == product.id,
                          models.WarehouseStock.warehouse_id == wh.id).first())
            if ws:
                ws.quantity = (ws.quantity or Decimal("0")) + units
            else:
                db.add(models.WarehouseStock(empresa_id=empresa_id, product_id=product.id,
                                             warehouse_id=wh.id, quantity=units))
            old_stock = max(_d(product.stock), Decimal("0"))
            new_stock = old_stock + units
            if new_stock > 0:
                product.average_cost = _q4((old_stock * _d(product.average_cost) + units * cost) / new_stock)
            product.stock = _d(product.stock) + units
            db.add(models.InventoryMovement(
                empresa_id=empresa_id, sucursal_id=wh.sucursal_id or sucursal_id, product_id=product.id,
                warehouse_id=wh.id, movement_type="COMPRA", quantity=units, unit_cost=_q4(cost),
                reference_type="RECEPCION_COMPRA", reference_id=f"COM-{e.folio}-REP",
                idempotency_key=f"{e.idempotency_key}:rep:{product.id}",
                reason=f"Reposición física recibida · {e.folio} · {e.supplier_name}", authorized_by_id=user,
            ))
            disp_sub += units * cost
            disp_iva += units * cost * _d(row.get("iva_rate"), "0.16")
        pend = _d(e.disputed_amount)
        iva_credit = pend - disp_sub
        _post_entry(db, empresa_id, sucursal_id, f"Reposición recibida {e.folio} — {e.supplier_name}",
                    "COMPRA", e.id, user, [
            {"tipo": "DEBE", "cuenta": "151.01", "nombre": "Inventario de Mercancías", "monto": disp_sub,
             "desc": "Reposición física recibida"},
            {"tipo": "DEBE", "cuenta": "118.01", "nombre": "IVA Acreditable Pagado", "monto": iva_credit if iva_credit > 0 else Decimal("0"),
             "desc": "IVA de mercancía repuesta"},
            {"tipo": "HABER", "cuenta": "107.01", "nombre": "Reposición pendiente de Proveedor",
             "monto": disp_sub + (iva_credit if iva_credit > 0 else Decimal("0")), "desc": "Cierre de reposición"},
        ])
        inc["reposicion_recibida"] = True
        note = note or "Reposición física recibida y sumada al inventario"

    timeline.append({"fecha": _now().isoformat(), "estatus": status, "usuario": user, "nota": note})
    inc["estatus"] = status
    if note:
        inc["ultima_nota"] = note
    e.payload = payload
    e.incident_status = status
    e.status = "RESUELTA" if status in ("NC_APLICADA", "REPOSICION_RECIBIDA", "CONCLUIDO") else (
        "NC_PENDIENTE" if e.incident_action == "NC" else "INCIDENCIA")
    e.updated_at = _now()
    db.add(models.AuditLog(empresa_id=empresa_id, sucursal_id=sucursal_id, user_id=user,
                           action=f"RECEPCION_INCIDENCIA:{e.folio}:{status}", severity="INFO",
                           details={"nota": note}))
    db.commit()
    return {"ok": True, "status": e.status, "incident_status": e.incident_status}
