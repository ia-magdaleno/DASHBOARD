"""Módulo Productos — endpoints extraídos de main.py (strangler fig) + Stock y Operaciones [F3] conectado al POS."""
from datetime import datetime
from decimal import Decimal
import re
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

import crud
import models
import schemas
from database import get_db
from deps import get_empresa_id, get_tenant_context, role_guard

router = APIRouter(tags=["productos"])


def _resolve_tenant_branches_and_warehouses(db: Session, empresa_id: str) -> List[Dict[str, Any]]:
    """Devuelve las sucursales y bodegas reales del sistema para el tenant."""
    branches = (
        db.query(models.Branch)
        .filter(models.Branch.empresa_id == empresa_id)
        .order_by(models.Branch.is_main.desc(), models.Branch.name)
        .all()
    )
    warehouses = (
        db.query(models.Warehouse)
        .filter(models.Warehouse.empresa_id == empresa_id)
        .order_by(models.Warehouse.name)
        .all()
    )

    wh_by_sucursal: Dict[str, models.Warehouse] = {}
    for w in warehouses:
        suc_key = (w.sucursal_id or "MATRIZ").strip().upper()
        if suc_key not in wh_by_sucursal:
            wh_by_sucursal[suc_key] = w

    result: List[Dict[str, Any]] = []
    seen_keys = set()

    for b in branches:
        if b.status == "INACTIVE":
            continue
        suc_id = (b.id or b.name or "MATRIZ").strip().upper()
        wh = wh_by_sucursal.get(suc_id)
        if not wh:
            wh = models.Warehouse(
                id=f"WH-{suc_id[:8]}-{str(uuid.uuid4())[:4].upper()}",
                empresa_id=empresa_id,
                sucursal_id=suc_id,
                name=f"Bodega Principal {b.name or suc_id}",
                is_transit=False,
            )
            db.add(wh)
            db.flush()
            wh_by_sucursal[suc_id] = wh

        seen_keys.add(suc_id)
        display_name = (
            f"MATRIZ ({b.name})" if (b.is_main or suc_id == "MATRIZ") and b.name and b.name.upper() != "MATRIZ"
            else ("MATRIZ (Sede Principal)" if (b.is_main or suc_id == "MATRIZ") else f"{suc_id} ({b.name})" if b.name and b.name.upper() != suc_id else suc_id)
        )
        result.append({
            "key": suc_id,
            "sucursal_id": suc_id,
            "branch_name": b.name or suc_id,
            "nombre": display_name,
            "warehouse_id": wh.id,
            "warehouse_name": wh.name,
            "is_main": bool(b.is_main or suc_id == "MATRIZ"),
        })

    for w in warehouses:
        suc_id = (w.sucursal_id or "MATRIZ").strip().upper()
        if suc_id not in seen_keys:
            seen_keys.add(suc_id)
            is_main = suc_id == "MATRIZ"
            result.append({
                "key": suc_id,
                "sucursal_id": suc_id,
                "branch_name": suc_id,
                "nombre": "MATRIZ (Sede Principal)" if is_main else f"{suc_id} ({w.name})",
                "warehouse_id": w.id,
                "warehouse_name": w.name,
                "is_main": is_main,
            })

    if not result:
        wh = crud._get_or_create_default_warehouse(db, empresa_id, "MATRIZ")
        result.append({
            "key": "MATRIZ",
            "sucursal_id": "MATRIZ",
            "branch_name": "MATRIZ",
            "nombre": "MATRIZ (Sede Principal)",
            "warehouse_id": wh.id,
            "warehouse_name": wh.name,
            "is_main": True,
        })

    return result


def _ensure_product_warehouse_stock_synced(
    db: Session,
    empresa_id: str,
    product: models.Product,
    branch_defs: List[Dict[str, Any]],
) -> Dict[str, models.WarehouseStock]:
    """Garantiza que cada sucursal tenga su fila en warehouse_stock y que la suma
    coincida con product.stock (sincronizando productos recién creados).
    """
    existing_rows = (
        db.query(models.WarehouseStock)
        .filter(models.WarehouseStock.empresa_id == empresa_id)
        .filter(models.WarehouseStock.product_id == product.id)
        .all()
    )
    by_wh_id: Dict[str, models.WarehouseStock] = {r.warehouse_id: r for r in existing_rows}
    dirty = False

    for b in branch_defs:
        wh_id = b["warehouse_id"]
        if wh_id not in by_wh_id:
            ws = models.WarehouseStock(
                empresa_id=empresa_id,
                product_id=product.id,
                warehouse_id=wh_id,
                quantity=Decimal("0"),
            )
            db.add(ws)
            by_wh_id[wh_id] = ws
            dirty = True

    total_ws = sum((Decimal(str(r.quantity or 0)) for r in by_wh_id.values()), Decimal("0"))
    prod_stock = Decimal(str(product.stock or 0))
    meta = product.meta_data if isinstance(product.meta_data, dict) else {}
    if prod_stock <= 0 and meta.get("stock_almacen"):
        try:
            alt_s = Decimal(str(meta.get("stock_almacen") or 0))
            if alt_s > 0:
                prod_stock = alt_s
                product.stock = prod_stock
                db.add(product)
                dirty = True
        except Exception:
            pass

    if total_ws == Decimal("0") and prod_stock > Decimal("0") and branch_defs:
        main_b = next((b for b in branch_defs if b["is_main"]), branch_defs[0])
        main_ws = by_wh_id[main_b["warehouse_id"]]
        main_ws.quantity = prod_stock
        db.add(main_ws)
        dirty = True
    elif total_ws != prod_stock and total_ws > Decimal("0"):
        product.stock = total_ws
        db.add(product)
        dirty = True

    # Si el producto tiene stock > 0 pero aún no tiene ningún movimiento en inventory_movements
    # ni ventas registradas, sembrar su movimiento de Inventario Inicial real para que el Kardex cuadre.
    mov_count = (
        db.query(models.InventoryMovement)
        .filter(models.InventoryMovement.empresa_id == empresa_id)
        .filter(models.InventoryMovement.product_id == product.id)
        .count()
    )
    if mov_count == 0 and float(product.stock or 0) > 0:
        for b in branch_defs:
            ws = by_wh_id.get(b["warehouse_id"])
            q_val = Decimal(str(ws.quantity or 0)) if ws else Decimal("0")
            if q_val > Decimal("0"):
                idk = f"INI:{empresa_id}:{product.id}:{b['warehouse_id']}"
                db.add(models.InventoryMovement(
                    empresa_id=empresa_id,
                    sucursal_id=b["sucursal_id"],
                    product_id=product.id,
                    warehouse_id=b["warehouse_id"],
                    movement_type="COMPRA",
                    quantity=q_val,
                    unit_cost=Decimal(str(product.average_cost or 0)),
                    reference_type="INVENTARIO_INICIAL",
                    reference_id=f"INI-{product.sku}",
                    idempotency_key=idk,
                    reason=f"Existencia inicial en sistema — {b['nombre']}",
                    authorized_by_id="SISTEMA",
                ))
                dirty = True

    if dirty:
        db.commit()

    return by_wh_id


def _format_short_es_date(dt: Optional[datetime]) -> str:
    if not dt:
        dt = datetime.now()
    months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
    m_lbl = months[dt.month - 1] if 1 <= dt.month <= 12 else "Oct"
    return f"{dt.day:02d}/{m_lbl} {dt.hour:02d}:{dt.minute:02d}"


DEFAULT_TENANT_PRICE_SCALES: List[Dict[str, Any]] = [
    {"id": "esc-1", "name": "PRECIO DE LISTA",     "margen_ideal": 50.00, "oferta": 0.00, "comision": 0.00, "active": True, "locked": True},
    {"id": "esc-3", "name": "CONTRATISTA",         "margen_ideal": 35.00, "oferta": 0.00, "comision": 1.50, "active": True, "locked": False},
    {"id": "esc-4", "name": "REVENTA",             "margen_ideal": 20.00, "oferta": 0.00, "comision": 1.00, "active": True, "locked": False},
    {"id": "esc-5", "name": "CREDITO",             "margen_ideal": 70.00, "oferta": 0.00, "comision": 0.00, "active": True, "locked": False},
    {"id": "esc-6", "name": "CREDITOS ESPECIALES", "margen_ideal": 90.00, "oferta": 0.00, "comision": 0.00, "active": True, "locked": False},
]


def _get_tenant_global_scales(
    db: Session,
    empresa_id: str,
    branch_defs: Optional[List[Dict[str, Any]]] = None,
    override_price_scales: Optional[List[Dict[str, Any]]] = None,
    override_branch_scales: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    if branch_defs is None:
        branch_defs = _resolve_tenant_branches_and_warehouses(db, empresa_id)

    cfg_rows = (
        db.query(models.AdminConfig)
        .filter(models.AdminConfig.empresa_id == empresa_id)
        .filter(models.AdminConfig.config_key.in_(["catalog.price_scales", "catalog.branch_price_scales"]))
        .all()
    )
    cfg_map = {r.config_key: r.config_val for r in cfg_rows}

    raw_scales = override_price_scales if isinstance(override_price_scales, list) and override_price_scales else cfg_map.get("catalog.price_scales")
    if not isinstance(raw_scales, list) or not raw_scales:
        raw_scales = [dict(s) for s in DEFAULT_TENANT_PRICE_SCALES]

    norm_scales: List[Dict[str, Any]] = []
    for idx, s in enumerate(raw_scales):
        if not isinstance(s, dict):
            continue
        nm = str(s.get("name") or s.get("scale_name") or s.get("nombre") or f"ESCALA {idx + 1}").strip().upper()
        if not nm:
            continue
        m_ideal = float(s.get("margen_ideal") if s.get("margen_ideal") is not None else 20.0)
        ofer = float(s.get("oferta") if s.get("oferta") is not None else 0.0)
        com = float(s.get("comision") if s.get("comision") is not None else 0.0)
        act = s.get("active") is not False and s.get("activa") is not False
        norm_scales.append({
            "id": str(s.get("id") or f"esc-{idx + 1}"),
            "name": nm,
            "scale_name": nm,
            "margen_ideal": m_ideal,
            "oferta": ofer,
            "comision": com,
            "active": act,
            "locked": bool(s.get("locked") or nm == "PRECIO DE LISTA"),
        })

    if not norm_scales:
        norm_scales = [dict(s) for s in DEFAULT_TENANT_PRICE_SCALES]

    sc_margin_map = {
        sc["name"].upper(): float(sc["margen_ideal"] - sc["oferta"])
        for sc in norm_scales
    }

    raw_bscales = override_branch_scales if isinstance(override_branch_scales, list) and override_branch_scales else cfg_map.get("catalog.branch_price_scales")
    main_branch_keys = {"MATRIZ"}
    for b_idx, b in enumerate(branch_defs or []):
        b_id = str(b.get("sucursal_id") or b.get("key") or "MATRIZ").strip().upper()
        b_nm = str(b.get("branch_name") or b.get("key") or b_id).strip().upper()
        if bool(b.get("is_main") or b_id == "MATRIZ" or b_nm == "MATRIZ" or b_idx == 0):
            main_branch_keys.add(b_id)
            main_branch_keys.add(b_nm)

    norm_bscales: List[Dict[str, Any]] = []
    if isinstance(raw_bscales, list) and raw_bscales:
        for idx, bs in enumerate(raw_bscales):
            if not isinstance(bs, dict):
                continue
            b_id = str(bs.get("branch_id") or bs.get("branch") or "MATRIZ").strip().upper()
            b_nm = str(bs.get("branch_name") or bs.get("branch") or b_id).strip().upper()
            if b_id in main_branch_keys or b_nm in main_branch_keys:
                continue
            s_nm = str(bs.get("scale_name") or bs.get("name") or "PRECIO DE LISTA").strip().upper()
            if s_nm not in sc_margin_map:
                continue
            m_base = float(bs.get("margen_ideal")) if bs.get("margen_ideal") is not None else sc_margin_map.get(s_nm, 25.0)
            m_aj = float(bs.get("sobreprecio_suc") if bs.get("sobreprecio_suc") is not None else 0.0)
            m_ofer = float(bs.get("oferta") if bs.get("oferta") is not None else 0.0)
            com = float(bs.get("comision") if bs.get("comision") is not None else 0.0)
            act = bs.get("active") is not False and bs.get("activa") is not False
            norm_bscales.append({
                "id": str(bs.get("id") or f"besc-{idx + 1}"),
                "branch_id": b_id,
                "branch_name": b_nm,
                "scale_name": s_nm,
                "margen_ideal": m_base,
                "sobreprecio_suc": m_aj,
                "oferta": m_ofer,
                "comision": com,
                "active": act,
            })

    # Asegurar que todas las sucursales secundarias registradas cuenten con las escalas generales activas por defecto
    seq = len(norm_bscales) + 1
    for b_idx, b in enumerate(branch_defs or []):
        b_id = str(b.get("sucursal_id") or b.get("key") or "MATRIZ").strip().upper()
        b_nm = str(b.get("branch_name") or b.get("key") or b_id).strip().upper()
        is_main_br = bool(b.get("is_main") or b_id == "MATRIZ" or b_nm == "MATRIZ" or b_idx == 0)
        if is_main_br:
            continue
        default_aj = 0.0
        existing_for_branch = [
            x for x in norm_bscales
            if x["branch_id"].upper() in (b_id, b_nm) or x["branch_name"].upper() in (b_id, b_nm)
        ]
        branch_aj = existing_for_branch[0]["sobreprecio_suc"] if existing_for_branch else default_aj
        for sc in norm_scales:
            if not sc["active"]:
                continue
            sc_nm = sc["name"]
            already = next(
                (
                    x for x in existing_for_branch
                    if x["scale_name"].upper() == sc_nm
                ),
                None,
            )
            if not already:
                norm_bscales.append({
                    "id": f"besc-{seq}",
                    "branch_id": b_id,
                    "branch_name": b_nm,
                    "scale_name": sc_nm,
                    "margen_ideal": float(sc["margen_ideal"] - sc["oferta"]),
                    "sobreprecio_suc": float(branch_aj),
                    "oferta": 0.0,
                    "comision": float(sc["comision"]),
                    "active": True,
                })
                seq += 1

    return {
        "price_scales": norm_scales,
        "branch_price_scales": norm_bscales,
    }


def _ensure_product_scales_applied(
    db: Session,
    empresa_id: str,
    p: models.Product,
    global_scales: List[Dict[str, Any]],
    global_branch_scales: List[Dict[str, Any]],
    force_recalc: bool = False,
) -> bool:
    """Inicializa las escalas de precios únicamente cuando el producto no tiene escalas guardadas.
    Los productos ya dados de alta conservan intactos sus precios y márgenes propios sin ser afectados
    por cambios posteriores en el catálogo global de configuración.
    """
    p_meta = dict(p.meta_data) if isinstance(p.meta_data, dict) else {}
    existing_scales = p_meta.get("price_scales") if isinstance(p_meta.get("price_scales"), list) else []
    existing_bscales = p_meta.get("branch_price_scales") if isinstance(p_meta.get("branch_price_scales"), list) else []

    # Si el producto ya cuenta con escalas guardadas y no se solicitó recalcular explícitamente,
    # respetar íntegramente los precios y escalas propios del producto.
    if not force_recalc and len(existing_scales) > 0:
        return False

    iva_pct = float(p_meta.get("iva", 16.0) if p_meta.get("iva") is not None else 16.0)
    factor_iva = 1.0 + (iva_pct / 100.0)

    first_gsc = global_scales[0] if global_scales else {"margen_ideal": 30.0, "oferta": 0.0}
    list_work_margin = float(first_gsc.get("margen_ideal", 30.0)) - float(first_gsc.get("oferta", 0.0))
    if list_work_margin <= 0:
        list_work_margin = 30.0

    costo_ref = float(
        p_meta.get("costo_pieza_con_flete")
        or p_meta.get("costo_con_flete")
        or p.average_cost
        or 0.0
    )
    base_price = float(p.price or 0.0)
    if costo_ref <= 0 and base_price > 0:
        costo_ref = (base_price / factor_iva) / (1.0 + (list_work_margin / 100.0))

    ex_sc_by_name = {
        str(s.get("scale_name") or s.get("nombre") or s.get("name") or "").strip().upper(): s
        for s in existing_scales if isinstance(s, dict)
    }

    saved_main_margin = float(p_meta.get("margen")) if p_meta.get("margen") is not None else None
    new_scales: List[Dict[str, Any]] = []
    for idx, gsc in enumerate(global_scales):
        nm = str(gsc.get("name") or gsc.get("scale_name") or f"ESCALA {idx + 1}").strip().upper()
        prev = ex_sc_by_name.get(nm) if not force_recalc else None
        if prev and not force_recalc:
            m_ideal = float(prev.get("margen_ideal") if prev.get("margen_ideal") is not None else gsc.get("margen_ideal", 20.0))
            ofer = float(prev.get("oferta") if prev.get("oferta") is not None else gsc.get("oferta", 0.0))
            m_trab = float(prev.get("margen_trabajo") if prev.get("margen_trabajo") is not None else (m_ideal - ofer))
            com = float(prev.get("comision") if prev.get("comision") is not None else gsc.get("comision", 0.0))
            act = prev.get("activa") is not False and prev.get("active") is not False
            prev_p = float(prev.get("precio") or prev.get("price") or 0.0)
            calc_p = prev_p if prev_p > 0 else (round(costo_ref * (1.0 + (m_trab / 100.0)) * factor_iva, 2) if costo_ref > 0 else (base_price if idx == 0 else 0.0))
        elif idx == 0 and not force_recalc and saved_main_margin is not None and saved_main_margin > 0:
            ofer = float(gsc.get("oferta", 0.0))
            m_trab = saved_main_margin
            m_ideal = m_trab + ofer
            com = float(gsc.get("comision", 0.0))
            act = gsc.get("active") is not False
            calc_p = base_price if base_price > 0 else (round(costo_ref * (1.0 + (m_trab / 100.0)) * factor_iva, 2) if costo_ref > 0 else 0.0)
        else:
            m_ideal = float(gsc.get("margen_ideal", 20.0))
            ofer = float(gsc.get("oferta", 0.0))
            m_trab = m_ideal - ofer
            com = float(gsc.get("comision", 0.0))
            act = gsc.get("active") is not False
            calc_p = round(costo_ref * (1.0 + (m_trab / 100.0)) * factor_iva, 2) if costo_ref > 0 else (base_price if idx == 0 else 0.0)
        new_scales.append({
            "id": str((prev and prev.get("id")) or gsc.get("id") or f"esc-{idx + 1}"),
            "scale_name": nm,
            "nombre": nm,
            "margen_ideal": round(m_ideal, 4),
            "oferta": round(ofer, 4),
            "margen_trabajo": round(m_trab, 4),
            "comision": round(com, 4),
            "activa": act,
            "locked": bool(gsc.get("locked") or nm == "PRECIO DE LISTA"),
            "costo_con_flete": round(costo_ref, 4),
            "precio": calc_p,
            "precio_activo": calc_p,
            "price": calc_p,
            "margin": round(m_trab, 4),
        })

    new_sc_by_name = {s["scale_name"].upper(): s for s in new_scales}

    ex_bs_by_key = {
        (
            str(b.get("branch_id") or b.get("branch") or "").strip().upper(),
            str(b.get("branch_name") or b.get("branch") or "").strip().upper(),
            str(b.get("scale_name") or "").strip().upper(),
        ): b
        for b in existing_bscales if isinstance(b, dict)
    }
    new_bscales: List[Dict[str, Any]] = []
    for idx, gbs in enumerate(global_branch_scales):
        b_id = str(gbs.get("branch_id") or "MATRIZ").strip().upper()
        b_nm = str(gbs.get("branch_name") or b_id).strip().upper()
        s_nm = str(gbs.get("scale_name") or "PRECIO DE LISTA").strip().upper()
        prev_b = None
        if not force_recalc:
            for (k_id, k_nm, k_sc), val in ex_bs_by_key.items():
                if k_sc == s_nm and (k_id in (b_id, b_nm) or k_nm in (b_id, b_nm)):
                    prev_b = val
                    break
        matched_sc = new_sc_by_name.get(s_nm)
        if prev_b and not force_recalc:
            m_base = float(prev_b.get("margen_ideal") if prev_b.get("margen_ideal") is not None else (matched_sc["margen_trabajo"] if matched_sc else gbs.get("margen_ideal", 25.0)))
            m_aj = float(prev_b.get("sobreprecio_suc") if prev_b.get("sobreprecio_suc") is not None else gbs.get("sobreprecio_suc", 0.0))
            m_fin = float(prev_b.get("margen_final") if prev_b.get("margen_final") is not None else (m_base + m_aj))
            com = float(prev_b.get("comision") if prev_b.get("comision") is not None else gbs.get("comision", 0.0))
            act = prev_b.get("activa") is not False and prev_b.get("active") is not False
            prev_bp = float(prev_b.get("precio") or prev_b.get("price") or 0.0)
            calc_bp = prev_bp if prev_bp > 0 else (round(costo_ref * (1.0 + (m_fin / 100.0)) * factor_iva, 2) if costo_ref > 0 else (float(matched_sc["precio"]) if matched_sc else 0.0))
        else:
            m_base = float(gbs.get("margen_ideal") if gbs.get("margen_ideal") is not None else (matched_sc["margen_trabajo"] if matched_sc else 25.0))
            m_aj = float(gbs.get("sobreprecio_suc", 0.0))
            m_fin = m_base + m_aj
            com = float(gbs.get("comision", 0.0))
            act = gbs.get("active") is not False
            calc_bp = round(costo_ref * (1.0 + (m_fin / 100.0)) * factor_iva, 2) if costo_ref > 0 else (float(matched_sc["precio"]) if matched_sc else 0.0)
        new_bscales.append({
            "id": str((prev_b and prev_b.get("id")) or gbs.get("id") or f"besc-{idx + 1}"),
            "branch_id": b_id,
            "branch_name": b_nm,
            "scale_name": s_nm,
            "margen_ideal": round(m_base, 4),
            "sobreprecio_suc": round(m_aj, 4),
            "margen_final": round(m_fin, 4),
            "comision": round(com, 4),
            "activa": act,
            "costo_con_flete": round(costo_ref, 4),
            "precio": calc_bp,
            "price": calc_bp,
        })

    changed = (
        force_recalc
        or existing_scales != new_scales
        or existing_bscales != new_bscales
    )
    if not changed:
        return False

    p_meta["price_scales"] = new_scales
    p_meta["branch_price_scales"] = new_bscales
    if new_scales and new_scales[0]["precio"] > 0 and float(p.price or 0) <= 0:
        p.price = Decimal(str(new_scales[0]["precio"]))
        p_meta["margen"] = new_scales[0]["margen_trabajo"]
        p_meta["precio_pieza"] = new_scales[0]["precio"]
    p.meta_data = p_meta
    db.add(p)
    crud._sync_product_price_scales(db, empresa_id, p, new_scales)
    return True


def _build_f3_payload_for_product(
    db: Session,
    empresa_id: str,
    sku: Optional[str] = None,
) -> Dict[str, Any]:
    all_prods = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id)
        .order_by(models.Product.sku.asc())
        .all()
    )
    branch_defs = _resolve_tenant_branches_and_warehouses(db, empresa_id)
    wh_id_to_branch = {b["warehouse_id"]: b for b in branch_defs}
    suc_to_branch = {b["key"]: b for b in branch_defs}
    global_sc_bundle = _get_tenant_global_scales(db, empresa_id, branch_defs=branch_defs)

    any_scale_dirty = False
    all_products_summary = []
    for p in all_prods:
        if _ensure_product_scales_applied(
            db,
            empresa_id,
            p,
            global_sc_bundle["price_scales"],
            global_sc_bundle["branch_price_scales"],
            force_recalc=False,
        ):
            any_scale_dirty = True
        p_meta = p.meta_data if isinstance(p.meta_data, dict) else {}
        raw_foto = p.foto_url or p_meta.get("foto_url") or p_meta.get("image_url") or None
        if isinstance(raw_foto, str) and ("/admin" in raw_foto and not raw_foto.startswith("data:image/")):
            raw_foto = p_meta.get("foto_url") if isinstance(p_meta.get("foto_url"), str) and "/admin" not in p_meta.get("foto_url", "") else None
        all_products_summary.append({
            "id": p.id,
            "sku": p.sku,
            "barcode": p.barcode or p.sku,
            "sales_code": p.sales_code or "",
            "name": p.name or p.description or p.sku,
            "description": p.description or p.name or p.sku,
            "price": float(p.price or 0),
            "average_cost": float(p.average_cost or 0),
            "stock": float(p.stock or 0),
            "stock_minimo": float(p.stock_minimo) if p.stock_minimo is not None else 0,
            "purchase_unit": p.purchase_unit or "PIEZA",
            "sale_unit": p.sale_unit or "PIEZA",
            "conversion_factor": float(p.conversion_factor or 1),
            "familia": p_meta.get("familia") or "GENERAL",
            "departamento": p_meta.get("departamento") or "GENERAL",
            "marca": p_meta.get("marca") or p_meta.get("brand") or "GENÉRICO",
            "sat_id": p_meta.get("sat_id") or "01010101",
            "sat_unidad": p_meta.get("sat_unidad") or "H87",
            "sat_unidad_empaque": p_meta.get("sat_unidad_empaque") or p_meta.get("sat_unidad") or "H87",
            "foto_url": raw_foto,
            "price_scales": p_meta.get("price_scales") or [],
            "branch_price_scales": p_meta.get("branch_price_scales") or [],
            "meta_data": p_meta,
        })
    if any_scale_dirty:
        db.commit()

    target_sku = (sku or "").strip().upper()
    target_product: Optional[models.Product] = None
    matched_by: Optional[str] = None
    if target_sku:
        for p in all_prods:
            if (p.sku or "").strip().upper() == target_sku:
                target_product = p
                matched_by = "SKU"
                break
        if not target_product:
            for p in all_prods:
                if (p.barcode or "").strip().upper() == target_sku:
                    target_product = p
                    matched_by = "CÓDIGO DE BARRAS"
                    break
        if not target_product:
            for p in all_prods:
                if (p.sales_code or "").strip().upper() == target_sku:
                    target_product = p
                    matched_by = "CÓDIGO ALTERNO"
                    break

    # Si no se especificó ningún código, seleccionar el primer producto real (priorizando VAR-3/8 o el último creado)
    if not target_product and not target_sku and all_prods:
        target_product = next(
            (p for p in all_prods if (p.sku or "").strip().upper() == "VAR-3/8"),
            all_prods[-1],
        )
        matched_by = "DEFAULT"

    if not target_product:
        # Producto nuevo aún no guardado en DB: devolver sucursales reales en 0 y kardex vacío
        return {
            "found": False,
            "is_unsaved": True,
            "matched_by": None,
            "sku": target_sku or "NUEVO",
            "costoPromedio": 0.0,
            "product": None,
            "branches": branch_defs,
            "products_list": all_products_summary,
            "all_products": all_products_summary,
            "warehouses": [
                {
                    "key": b["key"],
                    "sucursal_id": b["sucursal_id"],
                    "warehouse_id": b["warehouse_id"],
                    "nombre": b["nombre"],
                    "min": 5,
                    "max": 100,
                    "fisico": 0.0,
                }
                for b in branch_defs
            ],
            "comprometido": 0.0,
            "kardex": [],
        }

    ws_by_wh = _ensure_product_warehouse_stock_synced(db, empresa_id, target_product, branch_defs)
    p_meta = target_product.meta_data if isinstance(target_product.meta_data, dict) else {}
    min_global = float(target_product.stock_minimo) if target_product.stock_minimo is not None else float(p_meta.get("stock_min") or 10)
    max_global = float(p_meta.get("stock_max") or max(100.0, float(target_product.stock or 0) * 1.5))

    # Consultar resguardos/comprometidos reales en POS (SafekeptItem abiertos)
    safekept_rows = (
        db.query(models.SafekeptItem)
        .filter(models.SafekeptItem.empresa_id == empresa_id)
        .filter(models.SafekeptItem.product_sku == target_product.sku)
        .filter(models.SafekeptItem.status.in_(crud.SAFEKEPT_ABIERTOS))
        .all()
    )
    comprometido_qty = sum(
        max(0.0, float(s.quantity_ordered or 0) - float(s.quantity_delivered or 0))
        for s in safekept_rows
    )

    # Mapear ventas reales del POS (Sale + SaleItem + Client) para este producto
    sale_rows = (
        db.query(models.SaleItem, models.Sale, models.Client)
        .join(models.Sale, (models.SaleItem.sale_id == models.Sale.id) & (models.SaleItem.empresa_id == models.Sale.empresa_id))
        .outerjoin(models.Client, (models.Sale.client_id == models.Client.id) & (models.Sale.empresa_id == models.Client.empresa_id))
        .filter(models.SaleItem.empresa_id == empresa_id)
        .filter(
            (models.SaleItem.product_id == target_product.id) |
            (models.SaleItem.product_sku == target_product.sku)
        )
        .order_by(models.Sale.created_at.asc())
        .all()
    )

    sales_by_id: Dict[str, Dict[str, Any]] = {}
    sales_by_folio: Dict[str, Dict[str, Any]] = {}
    for si, s, cli in sale_rows:
        f_num = str(s.folio or s.id[:8]).strip().upper()
        is_cfdi = bool(s.is_cfdi or s.cfdi_document_id)
        client_name = (cli.name if cli and cli.name else "PÚBLICO EN GENERAL").upper()
        suc_key = (s.sucursal_id or "MATRIZ").strip().upper()
        folio_display = f"FAC-{f_num}" if is_cfdi else f"NV-{f_num}"
        s_dict = {
            "sale_id": s.id,
            "folio_num": f_num,
            "folio": folio_display,
            "is_cfdi": is_cfdi,
            "client_name": client_name,
            "sucursal_id": suc_key,
            "price": float(si.price or target_product.price or 0),
            "quantity": float(si.quantity or 0),
            "returned_quantity": float(si.returned_quantity or 0),
            "seller": (s.seller_id or "CAJERO POS").upper(),
            "created_at": s.created_at,
            "payment_method": s.payment_method or "efectivo",
        }
        sales_by_id[s.id] = s_dict
        sales_by_folio[folio_display.upper()] = s_dict
        sales_by_folio[f"NV-{f_num}".upper()] = s_dict
        sales_by_folio[f"FAC-{f_num}".upper()] = s_dict
        sales_by_folio[f_num] = s_dict

    # Consultar todos los movimientos de inventario reales de este producto
    mov_rows = (
        db.query(models.InventoryMovement)
        .filter(models.InventoryMovement.empresa_id == empresa_id)
        .filter(models.InventoryMovement.product_id == target_product.id)
        .order_by(models.InventoryMovement.created_at.asc(), models.InventoryMovement.id.asc())
        .all()
    )

    # Construir Kardex cronológico calculando el saldo corrido real
    kardex_asc: List[Dict[str, Any]] = []
    running_saldo = 0.0
    avg_cost = float(target_product.average_cost or 0)
    sale_price = float(target_product.price or 0)
    recorded_sale_ids = set()

    for idx, mv in enumerate(mov_rows):
        b_info = wh_id_to_branch.get(mv.warehouse_id) or suc_to_branch.get((mv.sucursal_id or "MATRIZ").upper()) or branch_defs[0]
        suc_key = b_info["key"]
        m_type = (mv.movement_type or "").upper().strip()
        ref_type = (mv.reference_type or "").upper().strip()
        ref_id = (mv.reference_id or "").strip()
        qty = abs(float(mv.quantity or 0))
        u_cost = float(mv.unit_cost or avg_cost or 0)
        reason_txt = (mv.reason or "").strip()

        tipo_io = "ENTRADA"
        concepto_key = "COMPRA"
        doc_label = "COMPRA / RECEPCIÓN"
        folio_str = ref_id or f"MOV-{idx + 1:04d}"
        concepto_txt = reason_txt or "Movimiento de Inventario"
        entrada_val = 0.0
        salida_val = 0.0
        unit_display = u_cost
        total_mov = 0.0
        user_str = (mv.authorized_by_id or "ADMIN").upper()

        sale_info = sales_by_id.get(ref_id) or sales_by_folio.get(ref_id.upper())
        if sale_info:
            if sale_info["sale_id"] in recorded_sale_ids and m_type == "VENTA":
                continue
            recorded_sale_ids.add(sale_info["sale_id"])

        if m_type == "VENTA" or ref_type in ("FACTURA_CFDI", "NOTA_VENTA", "TICKET_VENTA") and m_type not in ("DEVOLUCION", "NOTA_CREDITO", "TRASPASO_ENTRADA", "TRASPASO_SALIDA"):
            tipo_io = "SALIDA"
            is_fac = (sale_info and sale_info["is_cfdi"]) or ref_type == "FACTURA_CFDI" or folio_str.upper().startswith("FAC")
            concepto_key = "FACTURA" if is_fac else "NOTA_VENTA"
            doc_label = "FACTURA (CFDI)" if is_fac else "NOTA DE VENTA"
            if sale_info:
                folio_str = sale_info["folio"]
                unit_display = sale_info["price"] or sale_price
                concepto_txt = f"{'Venta Facturada CFDI' if is_fac else 'Venta POS Ticket'} — {sale_info['client_name']}"
                user_str = sale_info["seller"]
                reason_txt = reason_txt or f"{doc_label} {folio_str} cobrada en POS ({suc_key}) a {sale_info['client_name']}."
            else:
                if not (folio_str.upper().startswith("FAC") or folio_str.upper().startswith("NV")):
                    folio_str = f"{'FAC' if is_fac else 'NV'}-{folio_str[:8].upper()}"
                unit_display = u_cost if u_cost > 0 else sale_price
                concepto_txt = reason_txt or f"{doc_label} ({suc_key})"
            salida_val = qty
            running_saldo -= qty
            total_mov = -(qty * unit_display)

        elif m_type in ("DEVOLUCION", "NOTA_CREDITO") or ref_type in ("DEVOLUCION_POS", "NOTA_CREDITO"):
            tipo_io = "ENTRADA"
            is_nc = m_type == "NOTA_CREDITO" or ref_type == "NOTA_CREDITO" or folio_str.upper().startswith("NC")
            concepto_key = "NOTA_CREDITO" if is_nc else "DEVOLUCION"
            doc_label = "NOTA DE CRÉDITO" if is_nc else "DEVOLUCIÓN"
            if sale_info and not (folio_str.upper().startswith("DEV") or folio_str.upper().startswith("NC")):
                folio_str = f"{'NC' if is_nc else 'DEV'}-{sale_info['folio_num']}"
            elif not (folio_str.upper().startswith("DEV") or folio_str.upper().startswith("NC")):
                folio_str = f"{'NC' if is_nc else 'DEV'}-{folio_str[:8].upper()}"
            concepto_txt = reason_txt or (
                f"{doc_label} sobre {sale_info['folio']} — {sale_info['client_name']}"
                if sale_info else f"{doc_label} en {suc_key}"
            )
            entrada_val = qty
            running_saldo += qty
            total_mov = qty * unit_display

        elif m_type in ("TRASPASO_SALIDA", "TRASPASO_ENTRADA", "TRASLADO"):
            tipo_io = "TRASLADO"
            concepto_key = "TRASLADO"
            doc_label = "TRASPASO SUCURSAL"
            if not folio_str.upper().startswith("TRA"):
                folio_str = f"TRA-{folio_str[:8].upper()}"
            if m_type == "TRASPASO_SALIDA":
                salida_val = qty
                running_saldo -= qty
                total_mov = -(qty * unit_display)
                concepto_txt = reason_txt or f"Salida por Traspaso desde {suc_key}"
            elif m_type == "TRASPASO_ENTRADA":
                entrada_val = qty
                running_saldo += qty
                total_mov = qty * unit_display
                concepto_txt = reason_txt or f"Entrada por Traspaso en {suc_key}"
            else:
                entrada_val = qty
                salida_val = qty
                concepto_txt = reason_txt or f"Traspaso entre Sucursales ({suc_key})"

        elif m_type in ("COMPRA", "ENTRADA") or ref_type in ("INVENTARIO_INICIAL", "FACTURA_COMPRA"):
            tipo_io = "ENTRADA"
            concepto_key = "COMPRA"
            doc_label = "INVENTARIO INICIAL" if ref_type == "INVENTARIO_INICIAL" else "COMPRA / RECEPCIÓN"
            if not (folio_str.upper().startswith("OC") or folio_str.upper().startswith("INI") or folio_str.upper().startswith("COM")):
                folio_str = f"OC-{folio_str[:8].upper()}"
            concepto_txt = reason_txt or f"Entrada de Mercancía en {suc_key}"
            entrada_val = qty
            running_saldo += qty
            total_mov = qty * unit_display

        else:
            # AJUSTE / MERMA / SALIDA MANUAL
            is_neg = m_type in ("MERMA", "SALIDA", "AJUSTE_SALIDA") or "MERMA" in reason_txt.upper() or "BAJA" in reason_txt.upper()
            tipo_io = "SALIDA" if is_neg else "AJUSTE"
            concepto_key = "AJUSTE"
            doc_label = "MERMA / BAJA" if is_neg else "AJUSTE DE STOCK"
            if not folio_str.upper().startswith("AJU"):
                folio_str = f"AJU-{idx + 1:04d}"
            if is_neg:
                salida_val = qty
                running_saldo -= qty
                total_mov = -(qty * unit_display)
            else:
                entrada_val = qty
                running_saldo += qty
                total_mov = qty * unit_display
            concepto_txt = reason_txt or f"{doc_label} ({suc_key})"

        dt_obj = mv.created_at or datetime.now()
        kardex_asc.append({
            "id": mv.id,
            "movementId": mv.id,
            "saleId": sale_info["sale_id"] if sale_info else None,
            "refType": ref_type,
            "refId": ref_id,
            "fecha": _format_short_es_date(dt_obj),
            "isoDate": dt_obj.strftime("%Y-%m-%d"),
            "folio": folio_str,
            "tipo": tipo_io,
            "conceptoKey": concepto_key,
            "docTipoLabel": doc_label,
            "concepto": concepto_txt,
            "almacenKey": suc_key,
            "almacen": suc_key,
            "entrada": round(entrada_val, 4),
            "salida": round(salida_val, 4),
            "saldo": round(max(0.0, running_saldo), 4),
            "costoUnit": round(unit_display, 2),
            "costoProm": round(avg_cost, 2),
            "totalMov": round(total_mov, 2),
            "usuario": user_str,
            "obs": reason_txt or concepto_txt,
            "paymentMethod": (sale_info.get("payment_method") if sale_info else ""),
        })

    # Si hubiera ventas en SaleItem que no tenían fila en InventoryMovement, incluirlas
    for s_id, s_info in sales_by_id.items():
        if s_id in recorded_sale_ids:
            continue
        dt_obj = s_info["created_at"] or datetime.now()
        qty = abs(s_info["quantity"])
        is_ret = s_info["quantity"] < 0
        is_fac = s_info["is_cfdi"]
        suc_key = s_info["sucursal_id"]
        if is_ret:
            running_saldo += qty
            kardex_asc.append({
                "id": f"POS-DEV-{s_id[:8]}",
                "fecha": _format_short_es_date(dt_obj),
                "isoDate": dt_obj.strftime("%Y-%m-%d"),
                "folio": f"DEV-{s_info['folio_num']}",
                "tipo": "ENTRADA",
                "conceptoKey": "DEVOLUCION",
                "docTipoLabel": "DEVOLUCIÓN",
                "concepto": f"Devolución POS — {s_info['client_name']}",
                "almacenKey": suc_key,
                "almacen": suc_key,
                "entrada": round(qty, 4),
                "salida": 0.0,
                "saldo": round(max(0.0, running_saldo), 4),
                "costoUnit": round(s_info["price"], 2),
                "costoProm": round(avg_cost, 2),
                "totalMov": round(qty * s_info["price"], 2),
                "usuario": s_info["seller"],
                "obs": f"Devolución registrada en POS ({suc_key})",
            })
        else:
            running_saldo -= qty
            kardex_asc.append({
                "id": f"POS-SALE-{s_id[:8]}",
                "fecha": _format_short_es_date(dt_obj),
                "isoDate": dt_obj.strftime("%Y-%m-%d"),
                "folio": s_info["folio"],
                "tipo": "SALIDA",
                "conceptoKey": "FACTURA" if is_fac else "NOTA_VENTA",
                "docTipoLabel": "FACTURA (CFDI)" if is_fac else "NOTA DE VENTA",
                "concepto": f"{'Venta Facturada CFDI' if is_fac else 'Venta POS Ticket'} — {s_info['client_name']}",
                "almacenKey": suc_key,
                "almacen": suc_key,
                "entrada": 0.0,
                "salida": round(qty, 4),
                "saldo": round(max(0.0, running_saldo), 4),
                "costoUnit": round(s_info["price"], 2),
                "costoProm": round(avg_cost, 2),
                "totalMov": round(-(qty * s_info["price"]), 2),
                "usuario": s_info["seller"],
                "obs": f"{'Factura CFDI' if is_fac else 'Nota de Venta'} {s_info['folio']} registrada en POS ({suc_key}).",
            })

    # Ordenar del más reciente al más antiguo para la vista de Kardex
    kardex_desc = list(reversed(kardex_asc))

    warehouses_out = []
    for idx, b in enumerate(branch_defs):
        ws = ws_by_wh.get(b["warehouse_id"])
        fisico_val = float(ws.quantity or 0) if ws else 0.0
        warehouses_out.append({
            "key": b["key"],
            "sucursal_id": b["sucursal_id"],
            "warehouse_id": b["warehouse_id"],
            "nombre": b["nombre"],
            "min": max(1.0, round(min_global if b["is_main"] else max(5.0, min_global * 0.5), 2)),
            "max": max(10.0, round(max_global if b["is_main"] else max(50.0, max_global * 0.5), 2)),
            "fisico": round(fisico_val, 4),
        })

    prod_summary = next(
        (item for item in all_products_summary if item["id"] == target_product.id),
        all_products_summary[0] if all_products_summary else None,
    )

    return {
        "found": True,
        "is_unsaved": False,
        "matched_by": matched_by,
        "sku": target_product.sku,
        "costoPromedio": round(avg_cost, 2),
        "product": prod_summary,
        "branches": branch_defs,
        "products_list": all_products_summary,
        "all_products": all_products_summary,
        "warehouses": warehouses_out,
        "comprometido": round(comprometido_qty, 4),
        "kardex": kardex_desc,
    }


class ProductF3OperationIn(BaseModel):
    sku: str
    op_type: str  # ENTRADA | SALIDA | TRASLADO | AJUSTE
    concepto_key: str  # COMPRA | DEVOLUCION | NOTA_CREDITO | FACTURA | NOTA_VENTA | TRASLADO | AJUSTE
    sucursal_origen: str = "MATRIZ"
    sucursal_destino: Optional[str] = None
    cantidad: Optional[float] = None
    qty: Optional[float] = None
    costo_unit: Optional[float] = None
    unit_price_or_cost: Optional[float] = None
    folio: Optional[str] = None
    observaciones: Optional[str] = None
    obs: Optional[str] = None
    usuario: Optional[str] = None
    # Campos opcionales por si el producto aún no se había guardado con F12
    name: Optional[str] = None
    price: Optional[float] = None
    sale_unit: Optional[str] = None
    purchase_unit: Optional[str] = None


@router.get("/api/products-f3/detail")
def get_product_f3_detail(
    sku: Optional[str] = Query(None, description="SKU, Código de Barras o Código Alterno del producto a consultar"),
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    """Devuelve datos 100% reales del producto conectado al POS, sucursales, stock por bodega y Kardex."""
    return _build_f3_payload_for_product(db, empresa_id, sku=sku)


@router.post("/api/products-f3/operation")
def execute_product_f3_operation(
    body: ProductF3OperationIn,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    tenant: dict = Depends(get_tenant_context),
):
    """Ejecuta una operación real de inventario o venta/devolución en la BD y actualiza el stock del POS."""
    sku_clean = (body.sku or "").strip().upper()
    if not sku_clean:
        raise HTTPException(status_code=400, detail="El SKU del producto es obligatorio")

    eff_qty = body.qty if body.qty is not None else (body.cantidad or 0.0)
    eff_cost = body.unit_price_or_cost if body.unit_price_or_cost is not None else body.costo_unit
    eff_obs = body.obs if body.obs is not None else (body.observaciones or "")

    product = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id)
        .filter(models.Product.sku == sku_clean)
        .first()
    )
    if not product:
        # Si el usuario opera en F3 antes de guardar el producto nuevo, lo damos de alta automáticamente
        new_prod = schemas.ProductCreate(
            sku=sku_clean,
            name=(body.name or f"PRODUCTO {sku_clean}").upper(),
            description=(body.name or f"PRODUCTO {sku_clean}").upper(),
            price=float(body.price or eff_cost or 0.0),
            average_cost=float(eff_cost or 0.0),
            stock=0.0,
            sale_unit=body.sale_unit or "PIEZA",
            purchase_unit=body.purchase_unit or "PIEZA",
        )
        product = crud.create_product(db, empresa_id=empresa_id, product=new_prod, sucursal_id=body.sucursal_origen or "MATRIZ")

    branch_defs = _resolve_tenant_branches_and_warehouses(db, empresa_id)
    ws_by_wh = _ensure_product_warehouse_stock_synced(db, empresa_id, product, branch_defs)
    suc_map = {b["key"]: b for b in branch_defs}

    src_key = (body.sucursal_origen or "MATRIZ").strip().upper()
    src_b = suc_map.get(src_key) or branch_defs[0]
    src_ws = ws_by_wh[src_b["warehouse_id"]]

    op_type = (body.op_type or "ENTRADA").strip().upper()
    c_key = (body.concepto_key or "COMPRA").strip().upper()
    qty = Decimal(str(eff_qty or 0))
    unit_cost_dec = Decimal(str(eff_cost if eff_cost is not None else (product.average_cost or 0)))
    user_str = (body.usuario or tenant.get("sub") or "ADMIN").strip().upper()
    obs_str = (eff_obs or "").strip()
    stamp = str(uuid.uuid4())[:8].upper()
    folio_clean = (body.folio or "").strip().upper()

    if op_type != "AJUSTE" and qty <= Decimal("0"):
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero")

    if op_type == "ENTRADA":
        if not folio_clean:
            prefix = "DEV" if c_key == "DEVOLUCION" else ("NC" if c_key == "NOTA_CREDITO" else "OC")
            folio_clean = f"{prefix}-{stamp[:6]}"

        old_total = sum((Decimal(str(r.quantity or 0)) for r in ws_by_wh.values()), Decimal("0"))
        old_cost = Decimal(str(product.average_cost or 0))
        if c_key == "COMPRA" and unit_cost_dec > Decimal("0") and (old_total + qty) > Decimal("0"):
            product.average_cost = ((old_total * old_cost) + (qty * unit_cost_dec)) / (old_total + qty)

        src_ws.quantity = Decimal(str(src_ws.quantity or 0)) + qty
        db.add(src_ws)

        mv_type = "DEVOLUCION" if c_key == "DEVOLUCION" else ("NOTA_CREDITO" if c_key == "NOTA_CREDITO" else "COMPRA")
        ref_type = "DEVOLUCION_POS" if c_key == "DEVOLUCION" else ("NOTA_CREDITO" if c_key == "NOTA_CREDITO" else "FACTURA_COMPRA")
        default_reason = (
            f"Devolución de Cliente ({folio_clean}) en {src_b['key']}" if c_key == "DEVOLUCION"
            else f"Nota de Crédito ({folio_clean}) en {src_b['key']}" if c_key == "NOTA_CREDITO"
            else f"Compra / Recepción ({folio_clean}) en {src_b['key']}"
        )
        db.add(models.InventoryMovement(
            empresa_id=empresa_id,
            sucursal_id=src_b["key"],
            product_id=product.id,
            warehouse_id=src_b["warehouse_id"],
            movement_type=mv_type,
            quantity=qty,
            unit_cost=unit_cost_dec if unit_cost_dec > 0 else Decimal(str(product.average_cost or 0)),
            reference_type=ref_type,
            reference_id=folio_clean,
            idempotency_key=f"F3:{op_type}:{product.id}:{stamp}",
            reason=f"{default_reason}" + (f" — {obs_str}" if obs_str else ""),
            authorized_by_id=user_str,
        ))

    elif op_type == "SALIDA":
        cur_branch_qty = Decimal(str(src_ws.quantity or 0))
        if qty > cur_branch_qty:
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuficiente en {src_b['key']} (Disponible: {float(cur_branch_qty):g})",
            )

        if not folio_clean:
            prefix = "FAC" if c_key == "FACTURA" else ("NV" if c_key == "NOTA_VENTA" else "SAL")
            folio_clean = f"{prefix}-{stamp[:6]}"

        src_ws.quantity = cur_branch_qty - qty
        db.add(src_ws)

        sale_price_dec = unit_cost_dec if unit_cost_dec > Decimal("0") else Decimal(str(product.price or product.average_cost or 0))

        if c_key in ("FACTURA", "NOTA_VENTA"):
            # Registrar también la venta real en la tabla sales + sale_items para sincronización total con el POS
            walk_in = (
                db.query(models.Client)
                .filter(models.Client.empresa_id == empresa_id)
                .filter(models.Client.rfc == "XAXX010101000")
                .first()
            )
            if not walk_in:
                walk_in = db.query(models.Client).filter(models.Client.empresa_id == empresa_id).first()

            sub_tot = (qty * sale_price_dec).quantize(Decimal("0.01"))
            db_sale = models.Sale(
                empresa_id=empresa_id,
                sucursal_id=src_b["key"],
                client_id=walk_in.id if walk_in else "PUBLICO",
                total=sub_tot,
                payment_method="001",
                amount_paid=sub_tot,
                change_returned=Decimal("0"),
                is_cfdi=(c_key == "FACTURA"),
                discount=Decimal("0"),
                advance=Decimal("0"),
                is_safekept=False,
                folio=folio_clean.replace("FAC-", "").replace("NV-", ""),
                seller_id=user_str,
                canal_venta="mostrador",
            )
            db.add(db_sale)
            db.flush()

            db_si = models.SaleItem(
                empresa_id=empresa_id,
                sucursal_id=src_b["key"],
                sale_id=db_sale.id,
                product_sku=product.sku,
                product_id=product.id,
                quantity=qty,
                price=sale_price_dec,
                subtotal=sub_tot,
            )
            db.add(db_si)
            db.flush()

            db.add(models.InventoryMovement(
                empresa_id=empresa_id,
                sucursal_id=src_b["key"],
                product_id=product.id,
                warehouse_id=src_b["warehouse_id"],
                movement_type="VENTA",
                quantity=qty,
                unit_cost=sale_price_dec,
                reference_type="FACTURA_CFDI" if c_key == "FACTURA" else "NOTA_VENTA",
                reference_id=db_sale.id,
                idempotency_key=f"F3:SALE:{db_sale.id}:{db_si.id}",
                reason=(f"{'Factura CFDI' if c_key == 'FACTURA' else 'Nota de Venta'} {folio_clean} ({src_b['key']})" + (f" — {obs_str}" if obs_str else "")),
                authorized_by_id=user_str,
            ))
        else:
            db.add(models.InventoryMovement(
                empresa_id=empresa_id,
                sucursal_id=src_b["key"],
                product_id=product.id,
                warehouse_id=src_b["warehouse_id"],
                movement_type="MERMA",
                quantity=qty,
                unit_cost=Decimal(str(product.average_cost or 0)),
                reference_type="AJUSTE_MANUAL",
                reference_id=folio_clean,
                idempotency_key=f"F3:MERMA:{product.id}:{stamp}",
                reason=f"Salida / Baja de Inventario ({folio_clean}) en {src_b['key']}" + (f" — {obs_str}" if obs_str else ""),
                authorized_by_id=user_str,
            ))

    elif op_type == "TRASLADO":
        dst_key = (body.sucursal_destino or "").strip().upper()
        if not dst_key or dst_key == src_b["key"]:
            raise HTTPException(status_code=400, detail="Selecciona una sucursal destino distinta a la de origen")
        dst_b = suc_map.get(dst_key)
        if not dst_b:
            raise HTTPException(status_code=400, detail=f"Sucursal destino {dst_key} no encontrada")
        dst_ws = ws_by_wh[dst_b["warehouse_id"]]

        cur_branch_qty = Decimal(str(src_ws.quantity or 0))
        if qty > cur_branch_qty:
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuficiente en {src_b['key']} para traspasar (Disponible: {float(cur_branch_qty):g})",
            )

        if not folio_clean:
            folio_clean = f"TRA-{stamp[:6]}"

        src_ws.quantity = cur_branch_qty - qty
        dst_ws.quantity = Decimal(str(dst_ws.quantity or 0)) + qty
        db.add(src_ws)
        db.add(dst_ws)

        reason_msg = f"Traspaso entre Sucursales ({src_b['key']} ➔ {dst_b['key']})" + (f" — {obs_str}" if obs_str else "")
        db.add(models.InventoryMovement(
            empresa_id=empresa_id,
            sucursal_id=src_b["key"],
            product_id=product.id,
            warehouse_id=src_b["warehouse_id"],
            movement_type="TRASPASO_SALIDA",
            quantity=qty,
            unit_cost=Decimal(str(product.average_cost or 0)),
            reference_type="TRASPASO",
            reference_id=folio_clean,
            idempotency_key=f"F3:TRA_OUT:{product.id}:{stamp}",
            reason=reason_msg,
            authorized_by_id=user_str,
        ))
        db.add(models.InventoryMovement(
            empresa_id=empresa_id,
            sucursal_id=dst_b["key"],
            product_id=product.id,
            warehouse_id=dst_b["warehouse_id"],
            movement_type="TRASPASO_ENTRADA",
            quantity=qty,
            unit_cost=Decimal(str(product.average_cost or 0)),
            reference_type="TRASPASO",
            reference_id=folio_clean,
            idempotency_key=f"F3:TRA_IN:{product.id}:{stamp}",
            reason=reason_msg,
            authorized_by_id=user_str,
        ))

    elif op_type == "AJUSTE":
        if qty < Decimal("0"):
            raise HTTPException(status_code=400, detail="El conteo físico no puede ser negativo")
        cur_branch_qty = Decimal(str(src_ws.quantity or 0))
        diff = qty - cur_branch_qty
        if not folio_clean:
            folio_clean = f"AJU-{stamp[:6]}"

        src_ws.quantity = qty
        db.add(src_ws)

        mv_type = "AJUSTE_FISICO" if diff >= Decimal("0") else "MERMA"
        db.add(models.InventoryMovement(
            empresa_id=empresa_id,
            sucursal_id=src_b["key"],
            product_id=product.id,
            warehouse_id=src_b["warehouse_id"],
            movement_type=mv_type,
            quantity=abs(diff),
            unit_cost=Decimal(str(product.average_cost or 0)),
            reference_type="AJUSTE_MANUAL",
            reference_id=folio_clean,
            idempotency_key=f"F3:AJU:{product.id}:{stamp}",
            reason=f"Ajuste de Conteo Físico en {src_b['key']} (Anterior: {float(cur_branch_qty):g} ➔ Nuevo: {float(qty):g})" + (f" — {obs_str}" if obs_str else ""),
            authorized_by_id=user_str,
        ))

    # Actualizar el stock total cacheado en Product (leído por el POS)
    new_total_stock = sum((Decimal(str(r.quantity or 0)) for r in ws_by_wh.values()), Decimal("0"))
    product.stock = new_total_stock
    db.add(product)
    db.commit()

    return _build_f3_payload_for_product(db, empresa_id, sku=product.sku)


class ApplyScalesIn(BaseModel):
    price_scales: Optional[List[Dict[str, Any]]] = None
    branch_price_scales: Optional[List[Dict[str, Any]]] = None
    force_recalc: bool = False


@router.post("/api/products-f3/apply-scales")
def apply_scales_to_all_products(
    body: ApplyScalesIn,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    """Recalcula y aplica en tiempo real las Escalas de Precios y Escalas de Sucursales en todos los productos."""
    branch_defs = _resolve_tenant_branches_and_warehouses(db, empresa_id)
    global_sc_bundle = _get_tenant_global_scales(
        db,
        empresa_id,
        branch_defs=branch_defs,
        override_price_scales=body.price_scales,
        override_branch_scales=body.branch_price_scales,
    )
    all_prods = db.query(models.Product).filter(models.Product.empresa_id == empresa_id).all()
    updated_count = 0
    for p in all_prods:
        if _ensure_product_scales_applied(
            db,
            empresa_id,
            p,
            global_sc_bundle["price_scales"],
            global_sc_bundle["branch_price_scales"],
            force_recalc=bool(body.force_recalc),
        ):
            updated_count += 1
    db.commit()
    return {
        "ok": True,
        "updated_products": updated_count,
        "total_products": len(all_prods),
        "price_scales": global_sc_bundle["price_scales"],
        "branch_price_scales": global_sc_bundle["branch_price_scales"],
    }


@router.get("/api/products/search", response_model=List[schemas.Product])
def search_products(q: Optional[str] = "", limit: int = 500, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    products = crud.search_products(db, empresa_id=empresa_id, query=q, limit=limit)
    branch_defs = _resolve_tenant_branches_and_warehouses(db, empresa_id) if products else []
    wh_to_branch = {b["warehouse_id"]: b for b in branch_defs}
    ws_rows = (
        db.query(models.WarehouseStock)
        .filter(models.WarehouseStock.empresa_id == empresa_id)
        .all()
        if products else []
    )
    stocks_by_prod: Dict[str, Dict[str, float]] = {}
    for ws in ws_rows:
        b_info = wh_to_branch.get(ws.warehouse_id)
        if not b_info:
            continue
        p_map = stocks_by_prod.setdefault(ws.product_id, {})
        b_key = str(b_info.get("sucursal_id") or b_info.get("key") or "MATRIZ").strip().upper()
        b_name = str(b_info.get("branch_name") or b_key).strip().upper()
        qty_f = float(ws.quantity or 0.0)
        p_map[b_key] = round(p_map.get(b_key, 0.0) + qty_f, 4)
        if b_name != b_key:
            p_map[b_name] = round(p_map.get(b_name, 0.0) + qty_f, 4)

    if products:
        global_sc_bundle = _get_tenant_global_scales(db, empresa_id, branch_defs=branch_defs)
        dirty = False
        for p in products:
            if _ensure_product_scales_applied(
                db,
                empresa_id,
                p,
                global_sc_bundle["price_scales"],
                global_sc_bundle["branch_price_scales"],
                force_recalc=False,
            ):
                dirty = True
            p_meta = dict(p.meta_data) if isinstance(p.meta_data, dict) else {}
            b_stocks = dict(stocks_by_prod.get(p.id, {}))
            if not b_stocks and float(p.stock or 0) > 0:
                b_stocks["MATRIZ"] = float(p.stock or 0)
            p_meta["branch_stocks"] = b_stocks
            p_meta["branches_list"] = [
                {
                    "id": str(b.get("sucursal_id") or b.get("key") or "MATRIZ").strip().upper(),
                    "name": str(b.get("branch_name") or b.get("key") or "MATRIZ").strip().upper(),
                    "is_main": bool(b.get("is_main")),
                }
                for b in branch_defs
            ]
            p.meta_data = p_meta
        if dirty:
            db.commit()
    return [schemas.Product.from_orm_product(p) for p in products]


@router.get("/api/products/{sku:path}", response_model=schemas.Product)
def get_product(sku: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    db_product = crud.get_product(db, empresa_id=empresa_id, sku=sku)
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    branch_defs = _resolve_tenant_branches_and_warehouses(db, empresa_id)
    global_sc_bundle = _get_tenant_global_scales(db, empresa_id, branch_defs=branch_defs)
    if _ensure_product_scales_applied(
        db,
        empresa_id,
        db_product,
        global_sc_bundle["price_scales"],
        global_sc_bundle["branch_price_scales"],
        force_recalc=False,
    ):
        db.commit()
        db.refresh(db_product)
    return schemas.Product.from_orm_product(db_product)


@router.post("/api/products", response_model=schemas.Product)
def create_or_update_product(product: schemas.ProductCreate, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    clean_sku = (product.sku or "").strip().upper()
    clean_barcode = (product.barcode or "").strip().upper()
    clean_alt = (product.sales_code or "").strip().upper()

    all_existing = db.query(models.Product).filter(models.Product.empresa_id == empresa_id).all()
    db_product = next((p for p in all_existing if (p.sku or "").strip().upper() == clean_sku), None)

    for other in all_existing:
        if db_product and other.id == db_product.id:
            continue
        other_sku = (other.sku or "").strip().upper()
        other_bar = (other.barcode or "").strip().upper()
        other_alt = (other.sales_code or "").strip().upper()
        other_codes = {c for c in (other_sku, other_bar, other_alt) if c}

        if clean_barcode and clean_barcode in other_codes:
            raise HTTPException(
                status_code=409,
                detail=f"Código de barras duplicado: '{clean_barcode}' ya pertenece al producto SKU {other.sku} ({other.name}). No se puede dar de alta otro producto con el mismo código.",
            )
        if clean_alt and clean_alt in other_codes:
            raise HTTPException(
                status_code=409,
                detail=f"Código alterno duplicado: '{clean_alt}' ya pertenece al producto SKU {other.sku} ({other.name}). No se puede dar de alta otro producto con el mismo código.",
            )
        if clean_sku and clean_sku in other_codes and not db_product:
            raise HTTPException(
                status_code=409,
                detail=f"SKU duplicado: '{clean_sku}' ya está registrado como código en el producto SKU {other.sku} ({other.name}).",
            )

    if db_product:
        saved = crud.update_product(db, empresa_id=empresa_id, sku=db_product.sku, product=product)
    else:
        saved = crud.create_product(db, empresa_id=empresa_id, product=product)

    branch_defs = _resolve_tenant_branches_and_warehouses(db, empresa_id)
    global_sc_bundle = _get_tenant_global_scales(db, empresa_id, branch_defs=branch_defs)
    if _ensure_product_scales_applied(
        db,
        empresa_id,
        saved,
        global_sc_bundle["price_scales"],
        global_sc_bundle["branch_price_scales"],
        force_recalc=False,
    ):
        db.commit()
        db.refresh(saved)
    return schemas.Product.from_orm_product(saved)


@router.patch("/api/products/{sku:path}/stock-minimo", status_code=200)
def set_stock_minimo(
    sku: str,
    body: schemas.ProductStockMinimoUpdate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(role_guard(["ADMIN", "Administrador", "Gerente", "ALMACENISTA", "admin"])),
):
    """M-2: configura o desactiva el umbral de stock mínimo de un producto."""
    sucursal_id = payload.get("sucursal", "MATRIZ")
    product = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id)
        .filter(models.Product.sku == sku)
        .filter(models.Product.sucursal_id == sucursal_id)
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail=f"SKU {sku} no existe en {sucursal_id}")
    product.stock_minimo = body.stock_minimo
    db.add(product)
    db.commit()
    return {
        "ok": True, "sku": sku,
        "stock_minimo": float(body.stock_minimo) if body.stock_minimo is not None else None,
    }


@router.get("/api/products-f3/kardex-global")
def get_kardex_global(
    sku: Optional[str] = Query(None, description="SKU opcional para filtrar por un solo producto; vacío = TODOS"),
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    """Devuelve el Kardex completo (Entradas y Salidas) de TODOS los productos o de un solo producto,
    con desglose por Matriz, Sucursales o Ambas."""
    all_prods = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id)
        .order_by(models.Product.sku.asc())
        .all()
    )
    branch_defs = _resolve_tenant_branches_and_warehouses(db, empresa_id)
    target_sku = (sku or "").strip().upper()

    products_to_process = all_prods
    if target_sku and target_sku != "ALL" and target_sku != "TODOS":
        matched = [
            p for p in all_prods
            if (p.sku or "").strip().upper() == target_sku
            or (p.barcode or "").strip().upper() == target_sku
            or (p.sales_code or "").strip().upper() == target_sku
        ]
        if matched:
            products_to_process = matched

    all_movements: List[Dict[str, Any]] = []
    products_summary: List[Dict[str, Any]] = []

    for p in all_prods:
        p_meta = p.meta_data if isinstance(p.meta_data, dict) else {}
        products_summary.append({
            "id": p.id,
            "sku": p.sku,
            "barcode": p.barcode or p.sku,
            "name": p.name or p.description or p.sku,
            "sale_unit": p.sale_unit or "PIEZA",
            "stock": float(p.stock or 0),
            "price": float(p.price or 0),
            "average_cost": float(p.average_cost or 0),
            "familia": p_meta.get("familia") or "GENERAL",
            "departamento": p_meta.get("departamento") or "GENERAL",
            "marca": p_meta.get("marca") or p_meta.get("brand") or "GENÉRICO",
        })

    seen_skus = set()
    seen_mov_keys = set()
    for p in products_to_process:
        sku_clean = (p.sku or "").strip().upper()
        if not sku_clean or sku_clean in seen_skus:
            continue
        seen_skus.add(sku_clean)
        payload = _build_f3_payload_for_product(db, empresa_id, sku=p.sku)
        p_unit = p.sale_unit or "PZA"
        p_name = p.name or p.description or p.sku
        for k_row in payload.get("kardex", []):
            dedup_key = (sku_clean, str(k_row.get("folio") or ""), str(k_row.get("tipo") or ""), str(k_row.get("fecha") or ""), float(k_row.get("entrada") or 0), float(k_row.get("salida") or 0))
            if dedup_key in seen_mov_keys:
                continue
            seen_mov_keys.add(dedup_key)
            alm_key = (k_row.get("almacenKey") or "MATRIZ").strip().upper()
            b_match = next((b for b in branch_defs if b["key"] == alm_key), None)
            is_main = bool(b_match["is_main"]) if b_match else (alm_key == "MATRIZ")
            alm_nombre = b_match["nombre"] if b_match else alm_key
            row_copy = dict(k_row)
            row_copy["sku"] = p.sku
            row_copy["productName"] = p_name
            row_copy["unit"] = p_unit
            row_copy["almacenNombre"] = alm_nombre
            row_copy["isMainBranch"] = is_main
            all_movements.append(row_copy)

    # Ordenar cronológicamente descendente (más reciente primero)
    all_movements.sort(key=lambda r: (r.get("isoDate") or "", str(r.get("id") or "")), reverse=True)

    return {
        "ok": True,
        "branches": branch_defs,
        "products": products_summary,
        "movements": all_movements,
    }


@router.delete("/api/products/{sku:path}")
def delete_product_by_sku(
    sku: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    """Elimina un producto del catálogo (o sus registros asociados en inventario/escalas)."""
    clean_sku = (sku or "").strip().upper()
    product = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id)
        .filter(models.Product.sku.ilike(clean_sku))
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail=f"Producto '{sku}' no encontrado")

    # Limpiar dependencias directas de stock por almacén, escalas y movimientos de este producto
    db.query(models.WarehouseStock).filter(
        models.WarehouseStock.empresa_id == empresa_id,
        models.WarehouseStock.product_id == product.id,
    ).delete(synchronize_session=False)

    db.query(models.ProductPriceScale).filter(
        models.ProductPriceScale.empresa_id == empresa_id,
        models.ProductPriceScale.product_id == product.id,
    ).delete(synchronize_session=False)

    db.query(models.InventoryMovement).filter(
        models.InventoryMovement.empresa_id == empresa_id,
        models.InventoryMovement.product_id == product.id,
    ).delete(synchronize_session=False)

    deleted_sku = product.sku
    deleted_name = product.name
    db.delete(product)
    db.commit()
    return {"ok": True, "deleted_sku": deleted_sku, "deleted_name": deleted_name}





class KardexDocumentMetaIn(BaseModel):
    doc_key: str
    quien_llevo: Optional[str] = None
    quien_recibio: Optional[str] = None
    referencia: Optional[str] = None
    unidad_transporte: Optional[str] = None
    observaciones_entrega: Optional[str] = None
    firma_data_url: Optional[str] = None
    firmante_nombre: Optional[str] = None


@router.post("/api/products-f3/kardex-document-meta")
def save_kardex_document_meta(
    body: KardexDocumentMetaIn,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    """Guarda o actualiza metadatos de entrega, referencia, quién llevó, quién recibió y firma virtual del documento."""
    clean_key = re.sub(r"[^A-Za-z0-9_\-]", "_", (body.doc_key or "DOC").strip().upper())[:80]
    cfg_key = f"kardex_doc_meta.{clean_key}"
    row = (
        db.query(models.AdminConfig)
        .filter(models.AdminConfig.empresa_id == empresa_id, models.AdminConfig.config_key == cfg_key)
        .first()
    )
    existing = row.config_val if (row and isinstance(row.config_val, dict)) else {}
    updated = dict(existing)
    if body.quien_llevo is not None:
        updated["quien_llevo"] = body.quien_llevo.strip()
    if body.quien_recibio is not None:
        updated["quien_recibio"] = body.quien_recibio.strip()
    if body.referencia is not None:
        updated["referencia"] = body.referencia.strip()
    if body.unidad_transporte is not None:
        updated["unidad_transporte"] = body.unidad_transporte.strip()
    if body.observaciones_entrega is not None:
        updated["observaciones_entrega"] = body.observaciones_entrega.strip()
    if body.firma_data_url is not None:
        updated["firma_data_url"] = body.firma_data_url
    if body.firmante_nombre is not None:
        updated["firmante_nombre"] = body.firmante_nombre.strip()
    updated["firma_fecha"] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    if row:
        row.config_val = updated
        db.add(row)
    else:
        db.add(models.AdminConfig(
            empresa_id=empresa_id,
            config_key=cfg_key,
            config_val=updated,
            updated_by="KARDEX_DOC",
        ))
    db.commit()
    return {"ok": True, "doc_key": clean_key, "meta": updated}


@router.get("/api/products-f3/kardex-document")
def get_kardex_document_detail(
    mov_id: Optional[str] = Query(None),
    folio: Optional[str] = Query(None),
    sku: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    """Reconstruye el documento completo guardado que originó un movimiento de Kardex:
    Nota de Venta / Factura CFDI, Traspaso entre Sucursales, Entrada / Orden de Compra / Recepción,
    Devolución o Ajuste de Inventario, incluyendo desglose de Crédito, Referencias, Quién Llevó,
    Quién Recibió, Resguardos y Firma Virtual."""
    import json as _json

    branch_defs = _resolve_tenant_branches_and_warehouses(db, empresa_id)
    branch_by_key = {b["key"]: b for b in branch_defs}
    branch_by_wh = {b["warehouse_id"]: b for b in branch_defs}

    # Resolver mapa de empleados para mostrar nombres completos de vendedores/choferes/almacenistas
    emp_rows = db.query(models.Employee).filter(models.Employee.empresa_id == empresa_id).all()
    emp_map: Dict[str, str] = {}
    for e in emp_rows:
        label = (e.full_name or e.display_name or e.employee_code or e.id).upper()
        emp_map[str(e.id)] = label
        if e.user_id:
            emp_map[str(e.user_id)] = label
        if e.usuario_id:
            emp_map[str(e.usuario_id)] = label
        if e.employee_code:
            emp_map[str(e.employee_code).upper()] = label

    def _resolve_person(val: Optional[str], fallback: str = "ADMINISTRADOR / MOST. MATRIZ") -> str:
        if not val:
            return fallback
        v = str(val).strip()
        return emp_map.get(v) or emp_map.get(v.upper()) or v.upper()

    def _fmt_dt(dt_val: Any) -> str:
        if not dt_val:
            return datetime.now().strftime("%d/%m/%Y %H:%M")
        if isinstance(dt_val, str):
            return dt_val[:19].replace("T", " ")
        try:
            return dt_val.strftime("%d/%m/%Y %H:%M")
        except Exception:
            return str(dt_val)

    clean_folio = (folio or "").strip().upper()
    clean_sku = (sku or "").strip().upper()
    mv_obj = None
    if mov_id and not str(mov_id).startswith("POS-"):
        mv_obj = (
            db.query(models.InventoryMovement)
            .filter(models.InventoryMovement.empresa_id == empresa_id, models.InventoryMovement.id == str(mov_id))
            .first()
        )

    # Cargar metadatos personalizados guardados para este folio/movimiento
    doc_key_raw = clean_folio or (mv_obj.id if mv_obj else str(mov_id or "DOC"))
    clean_doc_key = re.sub(r"[^A-Za-z0-9_\-]", "_", doc_key_raw.upper())[:80]
    cfg_row = (
        db.query(models.AdminConfig)
        .filter(models.AdminConfig.empresa_id == empresa_id, models.AdminConfig.config_key == f"kardex_doc_meta.{clean_doc_key}")
        .first()
    )
    saved_meta = cfg_row.config_val if (cfg_row and isinstance(cfg_row.config_val, dict)) else {}

    # Intentar localizar Venta (Sale) asociada
    sale_obj = None
    folio_num_candidate = re.sub(r"^(NV-|FAC-|DEV-|NC-|POS-SALE-|POS-DEV-)", "", clean_folio).strip()
    if mv_obj and mv_obj.reference_id:
        ref_id_str = str(mv_obj.reference_id).strip()
        sale_obj = (
            db.query(models.Sale)
            .filter(models.Sale.empresa_id == empresa_id)
            .filter((models.Sale.id == ref_id_str) | (models.Sale.folio == ref_id_str) | (models.Sale.folio == folio_num_candidate))
            .first()
        )
    if not sale_obj and folio_num_candidate:
        sale_obj = (
            db.query(models.Sale)
            .filter(models.Sale.empresa_id == empresa_id)
            .filter((models.Sale.folio == folio_num_candidate) | (models.Sale.id.like(f"{folio_num_candidate.lower()}%")))
            .first()
        )

    # ── CASO 1: NOTA DE VENTA / FACTURA CFDI / DEVOLUCIÓN DE VENTA ─────────
    if sale_obj:
        cli = (
            db.query(models.Client)
            .filter(models.Client.empresa_id == empresa_id, models.Client.id == sale_obj.client_id)
            .first()
        )
        sale_items = (
            db.query(models.SaleItem)
            .filter(models.SaleItem.empresa_id == empresa_id, models.SaleItem.sale_id == sale_obj.id)
            .all()
        )
        # Mapear nombres de productos
        prod_ids = [si.product_id for si in sale_items if si.product_id]
        prod_skus = [si.product_sku for si in sale_items if si.product_sku]
        prods = (
            db.query(models.Product)
            .filter(models.Product.empresa_id == empresa_id)
            .filter((models.Product.id.in_(prod_ids)) | (models.Product.sku.in_(prod_skus)))
            .all()
        ) if (prod_ids or prod_skus) else []
        prod_by_id = {p.id: p for p in prods}
        prod_by_sku = {(p.sku or "").upper(): p for p in prods}

        items_out = []
        calc_subtotal = 0.0
        for idx_i, si in enumerate(sale_items, start=1):
            p_obj = prod_by_id.get(si.product_id) or prod_by_sku.get((si.product_sku or "").upper())
            qty_f = float(si.quantity or 0)
            price_f = float(si.price or 0)
            sub_f = float(si.subtotal or (qty_f * price_f))
            calc_subtotal += sub_f
            items_out.append({
                "partida": idx_i,
                "sku": si.product_sku,
                "description": (p_obj.name or p_obj.description if p_obj else si.product_sku) or si.product_sku,
                "unit": (p_obj.sale_unit if p_obj and p_obj.sale_unit else "PZA").upper(),
                "quantity": round(qty_f, 4),
                "returned_quantity": round(float(si.returned_quantity or 0), 4),
                "unit_price": round(price_f, 2),
                "subtotal": round(sub_f, 2),
                "is_highlighted": (si.product_sku or "").strip().upper() == clean_sku,
            })

        # Parsear payment_details
        pay_details = {}
        if sale_obj.payment_details:
            try:
                parsed = _json.loads(sale_obj.payment_details)
                if isinstance(parsed, dict):
                    pay_details = parsed
            except Exception:
                pay_details = {"raw": str(sale_obj.payment_details)}

        # Buscar Cuenta por Cobrar (Crédito)
        ar_obj = (
            db.query(models.AccountsReceivable)
            .filter(models.AccountsReceivable.empresa_id == empresa_id, models.AccountsReceivable.sale_id == sale_obj.id)
            .first()
        )
        pm_upper = (sale_obj.payment_method or "EFECTIVO").strip().upper()
        is_credit = bool(ar_obj) or ("CRED" in pm_upper) or ("CRÉD" in pm_upper)

        abonos_out = []
        if ar_obj:
            for pay in (ar_obj.payments or []):
                abonos_out.append({
                    "id": pay.id,
                    "fecha": _fmt_dt(pay.created_at),
                    "monto": round(float(pay.amount or 0), 2),
                    "metodo": (pay.method or "EFECTIVO").upper(),
                    "origen": (pay.applied_from or "EFECTIVO").upper(),
                    "referencia": pay.reference or "S/REF",
                    "saldo_despues": round(float(pay.balance_after or 0), 2),
                    "registrado_por": _resolve_person(pay.created_by, "CAJA POS"),
                    "notas": pay.notes or "",
                })

        # Buscar Contrato de Adhesión / Firma Virtual
        adh_obj = (
            db.query(models.AdhesionContract)
            .filter(models.AdhesionContract.empresa_id == empresa_id)
            .filter((models.AdhesionContract.sale_id == sale_obj.id) | (models.AdhesionContract.client_id == sale_obj.client_id))
            .order_by(models.AdhesionContract.created_at.desc())
            .first()
        )

        # Buscar Resguardos y Entregas de Kardex (Quién llevó / entregas parciales)
        sk_rows = (
            db.query(models.SafekeptItem)
            .filter(models.SafekeptItem.empresa_id == empresa_id, models.SafekeptItem.sale_id == sale_obj.id)
            .all()
        )
        resguardos_out = []
        delivery_notes_list = []
        for sk in sk_rows:
            delivs = []
            for d in (sk.deliveries or []):
                if d.notes:
                    delivery_notes_list.append(d.notes)
                delivs.append({
                    "fecha": _fmt_dt(d.delivery_date),
                    "cantidad": round(float(d.quantity_delivered or 0), 4),
                    "notas": d.notes or "Entrega registrada en almacén",
                })
            resguardos_out.append({
                "sku": sk.product_sku,
                "ordenado": round(float(sk.quantity_ordered or 0), 4),
                "entregado": round(float(sk.quantity_delivered or 0), 4),
                "pendiente": round(max(0.0, float(sk.quantity_ordered or 0) - float(sk.quantity_delivered or 0)), 4),
                "status": sk.status,
                "origen": sk.origen,
                "eta_date": sk.eta_date or "INMEDIATA",
                "entregas": delivs,
            })

        # Buscar Ruta / Reparto GPS si existe parada para esta venta
        stop_row = (
            db.query(models.RouteStop, models.Route)
            .join(models.Route, (models.RouteStop.route_id == models.Route.id) & (models.RouteStop.empresa_id == models.Route.empresa_id))
            .filter(models.RouteStop.empresa_id == empresa_id, models.RouteStop.sale_id == sale_obj.id)
            .first()
        )

        # Buscar Obra / Proyecto y Contratista
        proj_info = None
        if sale_obj.project_id:
            proj_obj = db.query(models.Project).filter(models.Project.empresa_id == empresa_id, models.Project.id == sale_obj.project_id).first()
            if proj_obj:
                contr_obj = db.query(models.Contractor).filter(models.Contractor.empresa_id == empresa_id, models.Contractor.id == proj_obj.contractor_id).first() if proj_obj.contractor_id else None
                proj_info = {
                    "nombre_obra": proj_obj.nombre,
                    "contratista": contr_obj.nombre if contr_obj else "SIN CONTRATISTA ASIGNADO",
                    "telefono_contratista": contr_obj.phone if contr_obj else "",
                }

        # Determinar Referencia de pago / documento
        ref_candidates = [
            saved_meta.get("referencia"),
            pay_details.get("referencia"),
            pay_details.get("aprobacion"),
            pay_details.get("numero"),
            pay_details.get("recibo"),
            (abonos_out[0]["referencia"] if abonos_out and abonos_out[0]["referencia"] != "S/REF" else None),
            sale_obj.cfdi_document_id,
            f"FOLIO-POS-{sale_obj.folio or sale_obj.id[:8].upper()}",
        ]
        referencia_final = next((str(x).strip() for x in ref_candidates if x and str(x).strip()), "VENTA DIRECTA MOSTRADOR")

        seller_name = _resolve_person(sale_obj.seller_id, "CAJERO / VENDEDOR MATRIZ")
        client_name = (cli.name if cli and cli.name else "PÚBLICO EN GENERAL").upper()

        # Determinar Quién Llevó y Quién Recibió
        carrier_default = (
            _resolve_person(stop_row[1].assigned_user, seller_name)
            if stop_row else (
                pay_details.get("quien_llevo")
                or pay_details.get("chofer")
                or (f"DESPACHO ALMACÉN / {seller_name}")
            )
        )
        quien_llevo = saved_meta.get("quien_llevo") or carrier_default
        quien_recibio = (
            saved_meta.get("quien_recibio")
            or pay_details.get("quien_recibio")
            or pay_details.get("recibido_por")
            or (delivery_notes_list[0] if delivery_notes_list else None)
            or client_name
        )
        unidad_transporte = (
            saved_meta.get("unidad_transporte")
            or pay_details.get("unidad_transporte")
            or ("RUTA DE REPARTO GPS" if stop_row else f"ENTREGA EN {((sale_obj.sucursal_entrega_id or sale_obj.sucursal_id or 'MATRIZ').upper())}")
        )

        f_num = sale_obj.folio or sale_obj.id[:8].upper()
        is_cfdi = bool(sale_obj.is_cfdi or sale_obj.cfdi_document_id)
        doc_folio = clean_folio if clean_folio.startswith(("NV-", "FAC-", "DEV-", "NC-")) else (f"FAC-{f_num}" if is_cfdi else f"NV-{f_num}")

        suc_key = (sale_obj.sucursal_id or "MATRIZ").strip().upper()
        suc_b = branch_by_key.get(suc_key)
        suc_nombre = suc_b["nombre"] if suc_b else suc_key

        dir_parts = [
            cli.direccion if cli else "",
            f"#{cli.numero_ext}" if (cli and cli.numero_ext) else "",
            f"Col. {cli.colonia}" if (cli and cli.colonia) else "",
            cli.ciudad or (cli.municipio if cli else ""),
            cli.estado if cli else "",
            f"C.P. {cli.cp}" if (cli and cli.cp) else "",
        ]
        cli_dir = " ".join([p for p in dir_parts if p]).strip() or "DOMICILIO CONOCIDO / MOSTRADOR"

        total_f = float(sale_obj.total or calc_subtotal)
        discount_f = float(sale_obj.discount or 0)
        sub_base = round(total_f / 1.16, 2) if is_cfdi else round(calc_subtotal or total_f, 2)
        iva_f = round(total_f - sub_base, 2) if is_cfdi else 0.0

        return {
            "ok": True,
            "doc_key": clean_doc_key,
            "doc_category": "VENTA",
            "doc_type_label": "FACTURA CFDI 4.0" if is_cfdi else "NOTA DE VENTA GUARDADA",
            "folio": doc_folio,
            "status": (sale_obj.status or "COMPLETED").upper(),
            "fecha_emision": _fmt_dt(sale_obj.created_at),
            "sucursal_origen": suc_nombre,
            "sucursal_entrega": (sale_obj.sucursal_entrega_id or suc_nombre).upper(),
            "canal_venta": (sale_obj.canal_venta or "MOSTRADOR").upper(),
            "vendedor": seller_name,
            "client": {
                "id": cli.id if cli else "",
                "name": client_name,
                "code": (cli.client_code if cli and cli.client_code else (cli.id[:8].upper() if cli else "PUB-GEN")),
                "rfc": (cli.rfc if cli and cli.rfc else "XAXX010101000").upper(),
                "client_type": (cli.client_type if cli and cli.client_type else "PÚBLICO GENERAL").upper(),
                "price_scale": (cli.assigned_price_scale if cli and cli.assigned_price_scale else "PÚBLICO GENERAL").upper(),
                "phone": (cli.phone or cli.whatsapp or "SIN TELÉFONO") if cli else "SIN TELÉFONO",
                "email": (cli.email or "SIN CORREO") if cli else "SIN CORREO",
                "address": cli_dir,
                "regimen_fiscal": (cli.regimen_fiscal or "616 - Sin obligaciones fiscales") if cli else "616 - Sin obligaciones fiscales",
                "uso_cfdi": (cli.uso_cfdi or "S01 - Sin efectos fiscales") if cli else "S01 - Sin efectos fiscales",
            },
            "project": proj_info,
            "payment": {
                "method": "CRÉDITO AUTORIZADO" if is_credit else pm_upper,
                "is_credit": is_credit,
                "reference": referencia_final,
                "details": pay_details,
                "subtotal": sub_base,
                "discount": round(discount_f, 2),
                "tax": iva_f,
                "total": round(total_f, 2),
                "amount_paid": round(float(sale_obj.amount_paid or 0), 2),
                "change_returned": round(float(sale_obj.change_returned or 0), 2),
                "advance": round(float(sale_obj.advance or (ar_obj.anticipo_aplicado if ar_obj else 0) or 0), 2),
                "saldo_favor_applied": round(float(sale_obj.saldo_favor_applied or 0), 2),
            },
            "credit_info": {
                "is_credit": is_credit,
                "ar_id": ar_obj.id if ar_obj else None,
                "original_amount": round(float(ar_obj.original_amount if ar_obj else (total_f if is_credit else 0)), 2),
                "anticipo": round(float(ar_obj.anticipo_aplicado if ar_obj else (sale_obj.advance or 0)), 2),
                "current_balance": round(float(ar_obj.current_balance if ar_obj else (max(0.0, total_f - float(sale_obj.amount_paid or 0)) if is_credit else 0)), 2),
                "status": (ar_obj.status if ar_obj else ("PENDIENTE" if is_credit else "LIQUIDADO")).upper(),
                "due_date": _fmt_dt(ar_obj.due_date) if (ar_obj and ar_obj.due_date) else f"{cli.dias_credito if cli else 30} DÍAS PLAZO",
                "dias_credito": int(cli.dias_credito if cli and cli.dias_credito is not None else 30),
                "limite_credito": round(float(cli.limite_credito if cli and cli.limite_credito else 0), 2),
                "saldo_total_cliente": round(float(cli.saldo_actual if cli and cli.saldo_actual else 0), 2),
                "abonos": abonos_out,
            },
            "delivery_info": {
                "quien_llevo": quien_llevo,
                "quien_recibio": quien_recibio,
                "unidad_transporte": unidad_transporte,
                "observaciones": saved_meta.get("observaciones_entrega") or (mv_obj.reason if mv_obj and mv_obj.reason else f"Documento {doc_folio} registrado y resguardado en sistema."),
                "resguardos": resguardos_out,
            },
            "signature_info": {
                "has_signature": True,
                "firmante_nombre": saved_meta.get("firmante_nombre") or quien_recibio or client_name,
                "firmante_rol": "FIRMA DE CONFORMIDAD Y PAGARÉ DE CRÉDITO" if is_credit else "FIRMA DE CONFORMIDAD Y RECEPCIÓN DE MERCANCÍA",
                "firma_medio": (adh_obj.firma_medio.upper() if adh_obj and adh_obj.firma_medio else "FIRMA VIRTUAL DIGITALIZADA"),
                "firma_fecha": saved_meta.get("firma_fecha") or (_fmt_dt(adh_obj.firma_fecha) if adh_obj and adh_obj.firma_fecha else _fmt_dt(sale_obj.created_at)),
                "firma_data_url": saved_meta.get("firma_data_url") or "",
                "contract_folio": adh_obj.id[:8].upper() if adh_obj else f"PAG-{f_num}",
            },
            "items": items_out,
        }

    # ── CASO 2: DOCUMENTO DE TRASPASO ENTRE SUCURSALES (Transfer) ─────────
    tr_obj = None
    tr_cand = re.sub(r"^(TRA-|TRAS-|TRF-)", "", clean_folio).strip()
    if mv_obj and mv_obj.reference_id:
        r_id = str(mv_obj.reference_id).strip()
        tr_obj = (
            db.query(models.Transfer)
            .filter(models.Transfer.empresa_id == empresa_id)
            .filter((models.Transfer.id == r_id) | (models.Transfer.folio == r_id) | (models.Transfer.folio == clean_folio))
            .first()
        )
    if not tr_obj and tr_cand:
        tr_obj = (
            db.query(models.Transfer)
            .filter(models.Transfer.empresa_id == empresa_id)
            .filter((models.Transfer.folio == clean_folio) | (models.Transfer.folio == tr_cand) | (models.Transfer.id.like(f"{tr_cand.lower()}%")))
            .first()
        )

    if tr_obj:
        orig_b = branch_by_wh.get(tr_obj.warehouse_origin_id) or branch_by_key.get((tr_obj.sucursal_origen_id or "MATRIZ").upper())
        dest_b = branch_by_wh.get(tr_obj.warehouse_dest_id) or branch_by_key.get((tr_obj.sucursal_destino_id or "SUCURSAL").upper())
        orig_name = orig_b["nombre"] if orig_b else (tr_obj.sucursal_origen_id or "MATRIZ")
        dest_name = dest_b["nombre"] if dest_b else (tr_obj.sucursal_destino_id or "SUCURSAL DESTINO")

        t_items = []
        total_tr = 0.0
        for idx_t, ti in enumerate(tr_obj.items or [], start=1):
            p_obj = db.query(models.Product).filter(models.Product.empresa_id == empresa_id, models.Product.sku == ti.product_sku).first()
            u_cost = float(p_obj.average_cost or p_obj.price or 0) if p_obj else 0.0
            qty_t = float(ti.quantity_received or ti.quantity_sent or ti.quantity_requested or 0)
            sub_t = qty_t * u_cost
            total_tr += sub_t
            t_items.append({
                "partida": idx_t,
                "sku": ti.product_sku,
                "description": ti.description or (p_obj.name if p_obj else ti.product_sku),
                "unit": (p_obj.sale_unit if p_obj and p_obj.sale_unit else "PZA").upper(),
                "quantity": round(qty_t, 4),
                "returned_quantity": 0.0,
                "unit_price": round(u_cost, 2),
                "subtotal": round(sub_t, 2),
                "is_highlighted": (ti.product_sku or "").strip().upper() == clean_sku,
            })

        req_by = _resolve_person(tr_obj.requested_by, "ENCARGADO DE ALMACÉN")
        auth_by = _resolve_person(tr_obj.authorized_by, "ADMINISTRADOR GENERAL")
        rec_by = _resolve_person(tr_obj.received_by, f"ALMACÉN {dest_name}")
        quien_llevo = saved_meta.get("quien_llevo") or f"TRANSPORTE INTER-SUCURSAL ({req_by})"
        quien_recibio = saved_meta.get("quien_recibio") or rec_by

        return {
            "ok": True,
            "doc_key": clean_doc_key,
            "doc_category": "TRASPASO",
            "doc_type_label": f"DOCUMENTO DE TRASPASO ({tr_obj.tipo or 'FÍSICO'})",
            "folio": tr_obj.folio or clean_folio or f"TRA-{tr_obj.id[:8].upper()}",
            "status": (tr_obj.status or "RECIBIDO").upper(),
            "fecha_emision": _fmt_dt(tr_obj.created_at),
            "sucursal_origen": orig_name,
            "sucursal_entrega": dest_name,
            "canal_venta": f"TRASPASO {tr_obj.tipo or 'FÍSICO'}",
            "vendedor": auth_by,
            "client": {
                "id": tr_obj.warehouse_dest_id,
                "name": f"BODEGA DESTINO: {dest_name}",
                "code": tr_obj.sucursal_destino_id or "DESTINO",
                "rfc": "TRASPASO INTERNO ENTRE SUCURSALES",
                "client_type": "MOVIMIENTO INTERNO DE ALMACÉN",
                "price_scale": "COSTO PROMEDIO",
                "phone": "CONTROL INTERNO",
                "email": "",
                "address": f"Origen: {orig_name} → Destino: {dest_name}",
                "regimen_fiscal": "N/A (Traspaso Interno)",
                "uso_cfdi": "N/A",
            },
            "project": None,
            "payment": {
                "method": "SIN COBRO (TRASPASO INTERNO)",
                "is_credit": False,
                "reference": saved_meta.get("referencia") or tr_obj.folio or f"TRA-{tr_obj.id[:8].upper()}",
                "details": {"solicitado_por": req_by, "autorizado_por": auth_by, "recibido_por": rec_by},
                "subtotal": round(total_tr, 2),
                "discount": 0.0,
                "tax": 0.0,
                "total": round(total_tr, 2),
                "amount_paid": round(total_tr, 2),
                "change_returned": 0.0,
                "advance": 0.0,
                "saldo_favor_applied": 0.0,
            },
            "credit_info": {"is_credit": False, "abonos": []},
            "delivery_info": {
                "quien_llevo": quien_llevo,
                "quien_recibio": quien_recibio,
                "unidad_transporte": saved_meta.get("unidad_transporte") or f"UNIDAD DE TRASLADO ({orig_name} → {dest_name})",
                "observaciones": saved_meta.get("observaciones_entrega") or tr_obj.notes or "Traspaso de mercancía entre sucursales autorizado.",
                "resguardos": [],
            },
            "signature_info": {
                "has_signature": True,
                "firmante_nombre": saved_meta.get("firmante_nombre") or quien_recibio,
                "firmante_rol": "FIRMA DE RECEPCIÓN DE TRASPASO EN BODEGA DESTINO",
                "firma_medio": "FIRMA VIRTUAL DIGITALIZADA",
                "firma_fecha": saved_meta.get("firma_fecha") or _fmt_dt(tr_obj.received_at or tr_obj.created_at),
                "firma_data_url": saved_meta.get("firma_data_url") or "",
                "contract_folio": tr_obj.folio or f"TRA-{tr_obj.id[:8].upper()}",
            },
            "items": t_items,
        }

    # ── CASO 3: RECEPCIÓN DE MERCANCÍA / ORDEN DE COMPRA (PurchaseReceipt / PurchaseOrder) ──
    pr_obj = None
    if mv_obj and mv_obj.reference_id:
        r_id = str(mv_obj.reference_id).strip()
        pr_obj = (
            db.query(models.PurchaseReceipt)
            .filter(models.PurchaseReceipt.empresa_id == empresa_id)
            .filter((models.PurchaseReceipt.id == r_id) | (models.PurchaseReceipt.folio == r_id) | (models.PurchaseReceipt.folio == clean_folio))
            .first()
        )
    if not pr_obj and clean_folio:
        pr_obj = (
            db.query(models.PurchaseReceipt)
            .filter(models.PurchaseReceipt.empresa_id == empresa_id)
            .filter(models.PurchaseReceipt.folio == clean_folio)
            .first()
        )

    if pr_obj:
        sup = pr_obj.supplier
        wh_b = branch_by_wh.get(pr_obj.warehouse_id) or branch_by_key.get((pr_obj.sucursal_id or "MATRIZ").upper())
        wh_name = wh_b["nombre"] if wh_b else (pr_obj.sucursal_id or "MATRIZ")
        rec_user = _resolve_person(pr_obj.received_by, "ALMACENISTA RECEPTOR")
        ap_obj = pr_obj.accounts_payable
        is_cred_compra = (pr_obj.payment_type or "").upper() == "CREDIT" or bool(ap_obj)

        p_items = []
        for idx_p, pri in enumerate(pr_obj.items or [], start=1):
            p_items.append({
                "partida": idx_p,
                "sku": pri.sku,
                "description": pri.description or pri.sku,
                "unit": "PZA",
                "quantity": round(float(pri.quantity_received or 0), 4),
                "returned_quantity": 0.0,
                "unit_price": round(float(pri.unit_cost or 0), 2),
                "subtotal": round(float(pri.subtotal or 0), 2),
                "is_highlighted": (pri.sku or "").strip().upper() == clean_sku,
            })

        sup_name = (sup.name if sup else "PROVEEDOR GENERAL").upper()
        quien_llevo = saved_meta.get("quien_llevo") or (sup.contact_name.upper() if sup and sup.contact_name else f"REPARTO PROVEEDOR ({sup_name})")
        quien_recibio = saved_meta.get("quien_recibio") or rec_user

        return {
            "ok": True,
            "doc_key": clean_doc_key,
            "doc_category": "ENTRADA_COMPRA",
            "doc_type_label": "DOCUMENTO DE RECEPCIÓN / COMPRA A PROVEEDOR",
            "folio": pr_obj.folio or clean_folio,
            "status": (ap_obj.status if ap_obj else "RECIBIDO EN ALMACÉN").upper(),
            "fecha_emision": _fmt_dt(pr_obj.receipt_date),
            "sucursal_origen": sup_name,
            "sucursal_entrega": wh_name,
            "canal_venta": "RECEPCIÓN DE COMPRA",
            "vendedor": rec_user,
            "client": {
                "id": sup.id if sup else "",
                "name": f"PROVEEDOR: {sup_name}",
                "code": (sup.rfc if sup and sup.rfc else "PROV-GEN"),
                "rfc": (sup.rfc if sup and sup.rfc else "XAXX010101000"),
                "client_type": "PROVEEDOR AUTORIZADO",
                "price_scale": "COSTO DE COMPRA",
                "phone": (sup.phone or sup.whatsapp or "S/TEL") if sup else "S/TEL",
                "email": (sup.email or "") if sup else "",
                "address": (sup.trade_name or sup_name) if sup else sup_name,
                "regimen_fiscal": "PROVEEDOR",
                "uso_cfdi": "G01 - Adquisición de mercancías",
            },
            "project": None,
            "payment": {
                "method": "CRÉDITO PROVEEDOR (CxP)" if is_cred_compra else "CONTADO",
                "is_credit": is_cred_compra,
                "reference": saved_meta.get("referencia") or pr_obj.folio,
                "details": {},
                "subtotal": round(float(pr_obj.subtotal or 0), 2),
                "discount": 0.0,
                "tax": round(float(pr_obj.tax_amount or 0), 2),
                "total": round(float(pr_obj.total or 0), 2),
                "amount_paid": round(float(ap_obj.amount_paid if ap_obj else pr_obj.total or 0), 2),
                "change_returned": 0.0,
                "advance": 0.0,
                "saldo_favor_applied": 0.0,
            },
            "credit_info": {
                "is_credit": is_cred_compra,
                "original_amount": round(float(ap_obj.amount if ap_obj else pr_obj.total or 0), 2),
                "anticipo": round(float(ap_obj.amount_paid if ap_obj else 0), 2),
                "current_balance": round(float(ap_obj.balance if ap_obj else 0), 2),
                "status": (ap_obj.status if ap_obj else "LIQUIDADO").upper(),
                "due_date": _fmt_dt(ap_obj.due_date) if (ap_obj and ap_obj.due_date) else f"{sup.credit_days if sup else 30} DÍAS",
                "dias_credito": int(sup.credit_days if sup and sup.credit_days else 30),
                "limite_credito": round(float(sup.credit_limit if sup and sup.credit_limit else 0), 2),
                "abonos": [],
            },
            "delivery_info": {
                "quien_llevo": quien_llevo,
                "quien_recibio": quien_recibio,
                "unidad_transporte": saved_meta.get("unidad_transporte") or "TRANSPORTE DE PROVEEDOR",
                "observaciones": saved_meta.get("observaciones_entrega") or pr_obj.notes or "Mercancía recibida y verificada físicamente en bodega.",
                "resguardos": [],
            },
            "signature_info": {
                "has_signature": True,
                "firmante_nombre": saved_meta.get("firmante_nombre") or quien_recibio,
                "firmante_rol": "FIRMA DE RECEPCIÓN Y ENTRADA A ALMACÉN",
                "firma_medio": "FIRMA VIRTUAL DIGITALIZADA",
                "firma_fecha": saved_meta.get("firma_fecha") or _fmt_dt(pr_obj.receipt_date),
                "firma_data_url": saved_meta.get("firma_data_url") or "",
                "contract_folio": pr_obj.folio,
            },
            "items": p_items,
        }

    # ── CASO 4: MOVIMIENTO DIRECTO DE KARDEX (ENTRADA / SALIDA / AJUSTE / INVENTARIO INICIAL) ──
    if not mv_obj and clean_sku:
        # Buscar por folio o último movimiento del SKU
        q_mv = (
            db.query(models.InventoryMovement)
            .join(models.Product, (models.InventoryMovement.product_id == models.Product.id) & (models.InventoryMovement.empresa_id == models.Product.empresa_id))
            .filter(models.InventoryMovement.empresa_id == empresa_id)
            .filter(models.Product.sku.ilike(clean_sku))
            .order_by(models.InventoryMovement.created_at.desc())
            .all()
        )
        if clean_folio:
            for cand in q_mv:
                if clean_folio in (cand.reference_id or "").upper():
                    mv_obj = cand
                    break
        if not mv_obj and q_mv:
            mv_obj = q_mv[0]

    if mv_obj:
        p_obj = db.query(models.Product).filter(models.Product.empresa_id == empresa_id, models.Product.id == mv_obj.product_id).first()
        wh_b = branch_by_wh.get(mv_obj.warehouse_id) or branch_by_key.get((mv_obj.sucursal_id or "MATRIZ").upper())
        wh_name = wh_b["nombre"] if wh_b else (mv_obj.sucursal_id or "MATRIZ")
        m_type = (mv_obj.movement_type or "MOVIMIENTO").upper()
        ref_type = (mv_obj.reference_type or "DOCUMENTO INTERNO").upper()
        qty_m = abs(float(mv_obj.quantity or 0))
        cost_m = float(mv_obj.unit_cost or (p_obj.average_cost if p_obj else 0) or 0)
        tot_m = round(qty_m * cost_m, 2)
        auth_user = _resolve_person(mv_obj.authorized_by_id, "ADMINISTRADOR / ALMACÉN")
        quien_llevo = saved_meta.get("quien_llevo") or auth_user
        quien_recibio = saved_meta.get("quien_recibio") or f"BODEGA {wh_name}"

        return {
            "ok": True,
            "doc_key": clean_doc_key,
            "doc_category": m_type,
            "doc_type_label": f"DOCUMENTO DE {m_type} ({ref_type})",
            "folio": clean_folio or mv_obj.reference_id or f"MOV-{mv_obj.id[:8].upper()}",
            "status": "APLICADO EN KARDEX",
            "fecha_emision": _fmt_dt(mv_obj.created_at),
            "sucursal_origen": wh_name,
            "sucursal_entrega": wh_name,
            "canal_venta": ref_type,
            "vendedor": auth_user,
            "client": {
                "id": mv_obj.warehouse_id,
                "name": f"ALMACÉN / SUCURSAL: {wh_name}",
                "code": mv_obj.sucursal_id or "MATRIZ",
                "rfc": "CONTROL INTERNO DE INVENTARIO",
                "client_type": m_type,
                "price_scale": "COSTO UNITARIO KARDEX",
                "phone": "N/A",
                "email": "",
                "address": wh_name,
                "regimen_fiscal": "CONTROL INTERNO",
                "uso_cfdi": "N/A",
            },
            "project": None,
            "payment": {
                "method": ref_type,
                "is_credit": False,
                "reference": saved_meta.get("referencia") or mv_obj.reference_id or mv_obj.id[:8].upper(),
                "details": {"idempotency_key": mv_obj.idempotency_key},
                "subtotal": tot_m,
                "discount": 0.0,
                "tax": 0.0,
                "total": tot_m,
                "amount_paid": tot_m,
                "change_returned": 0.0,
                "advance": 0.0,
                "saldo_favor_applied": 0.0,
            },
            "credit_info": {"is_credit": False, "abonos": []},
            "delivery_info": {
                "quien_llevo": quien_llevo,
                "quien_recibio": quien_recibio,
                "unidad_transporte": saved_meta.get("unidad_transporte") or "MOVIMIENTO FÍSICO EN BODEGA",
                "observaciones": saved_meta.get("observaciones_entrega") or mv_obj.reason or f"Movimiento {m_type} registrado en Kardex.",
                "resguardos": [],
            },
            "signature_info": {
                "has_signature": True,
                "firmante_nombre": saved_meta.get("firmante_nombre") or auth_user,
                "firmante_rol": f"FIRMA DE AUTORIZACIÓN Y VALIDACIÓN ({m_type})",
                "firma_medio": "FIRMA VIRTUAL DIGITALIZADA",
                "firma_fecha": saved_meta.get("firma_fecha") or _fmt_dt(mv_obj.created_at),
                "firma_data_url": saved_meta.get("firma_data_url") or "",
                "contract_folio": clean_folio or mv_obj.id[:8].upper(),
            },
            "items": [
                {
                    "partida": 1,
                    "sku": p_obj.sku if p_obj else clean_sku,
                    "description": (p_obj.name or p_obj.description) if p_obj else clean_sku,
                    "unit": (p_obj.sale_unit if p_obj and p_obj.sale_unit else "PZA").upper(),
                    "quantity": round(qty_m, 4),
                    "returned_quantity": 0.0,
                    "unit_price": round(cost_m, 2),
                    "subtotal": tot_m,
                    "is_highlighted": True,
                }
            ],
        }

    raise HTTPException(status_code=404, detail="No se encontró el documento asociado al movimiento seleccionado.")
