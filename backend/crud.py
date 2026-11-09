from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func, text
from typing import Optional
from decimal import Decimal
import models
import schemas
from datetime import datetime, timedelta, timezone
import logging

_log = logging.getLogger("calebsys.crud")

_MAX_LIMIT = 500

# ── NR-04: subdivisión Art. 29-A CFF — efectivo > $2,000 MXN ─────────────────
_NR04_LIMITE       = Decimal("2000.00")   # tope por sub-factura
_NR04_CAP_ITEM     = Decimal("1900.00")   # precio máximo por ítem rebosante
_NR04_SKU_SERVICIO = "NR04-EXCEDENTE"     # SKU virtual (servicio, sin stock)


def _nr04_next_sale_folio(db, empresa_id: str) -> str:
    """Folio secuencial por tenant: cuenta ventas raíz + 1."""
    count = (
        db.query(models.Sale)
        .filter(models.Sale.empresa_id == empresa_id)
        .filter(models.Sale.parent_sale_id == None)  # noqa: E711
        .count()
    )
    return str(count + 1)


def _nr04_split_items(items):
    """Divide los ítems en cubos con total ≤ $2,000 (NR-04).

    Reglas:
    - Ítem con precio_unitario > $2,000 → se factura a $1,900 + línea de
      servicio virtual (NR04-EXCEDENTE) por el remanente.
    - Ítem cuyo total_línea > $2,000 pero precio_unitario ≤ $2,000 → se
      expande en unidades sueltas y se distribuye entre cubos.
    - Empaque greedy: se intenta llenar el cubo actual antes de abrir uno nuevo.

    Devuelve lista de listas de dicts {'product_sku', 'quantity', 'price',
    'subtotal', '_is_service'(bool, opcional)}.
    """
    normalized = []
    for item in items:
        unit_p = Decimal(str(item.price))
        qty    = Decimal(str(item.quantity))
        total  = Decimal(str(item.subtotal))

        if unit_p > _NR04_LIMITE:
            # Cap precio unitario + servicio por el remanente
            cap_total  = (_NR04_CAP_ITEM * qty).quantize(Decimal("0.01"))
            remainder  = (total - cap_total).quantize(Decimal("0.01"))
            cap_u_price = (_NR04_CAP_ITEM).quantize(Decimal("0.0001"))  # por unidad al nuevo precio
            if qty != Decimal("1"):
                cap_u_price = (cap_total / qty).quantize(Decimal("0.0001"))
            normalized.append({
                "product_sku": item.product_sku,
                "quantity": float(qty),
                "price": float(cap_u_price),
                "subtotal": float(cap_total),
            })
            if remainder > Decimal("0.005"):
                normalized.append({
                    "product_sku": _NR04_SKU_SERVICIO,
                    "quantity": 1.0,
                    "price": float(remainder),
                    "subtotal": float(remainder),
                    "_is_service": True,
                })
        elif unit_p > Decimal("0") and total > _NR04_LIMITE:
            # Total de línea excede el tope pero precio unitario no:
            # expandir en unidades individuales para poder distribuirlas.
            qty_int = int(qty)
            qty_frac = qty - Decimal(qty_int)
            for _ in range(qty_int):
                normalized.append({
                    "product_sku": item.product_sku,
                    "quantity": 1.0,
                    "price": float(unit_p),
                    "subtotal": float(unit_p.quantize(Decimal("0.01"))),
                })
            if qty_frac > Decimal("0.0001"):
                frac_total = (unit_p * qty_frac).quantize(Decimal("0.01"))
                normalized.append({
                    "product_sku": item.product_sku,
                    "quantity": float(qty_frac),
                    "price": float(unit_p),
                    "subtotal": float(frac_total),
                })
        else:
            normalized.append({
                "product_sku": item.product_sku,
                "quantity": float(qty),
                "price": float(unit_p),
                "subtotal": float(total),
            })

    # Empaque greedy en cubos ≤ $2,000
    buckets: list[list[dict]] = [[]]
    bucket_totals: list[Decimal] = [Decimal("0")]

    for entry in normalized:
        s = Decimal(str(entry["subtotal"]))
        placed = False
        for i, t in enumerate(bucket_totals):
            if t + s <= _NR04_LIMITE + Decimal("0.005"):  # tolerancia de redondeo
                buckets[i].append(entry)
                bucket_totals[i] += s
                placed = True
                break
        if not placed:
            buckets.append([entry])
            bucket_totals.append(s)

    return [b for b in buckets if b]


import re
import unicodedata

# --- Product CRUD ---
def _strip_accents_upper(val: str) -> str:
    if not val:
        return ""
    s = unicodedata.normalize("NFKD", str(val))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return s.upper().strip()


_COMMON_TYPO_MAP = {
    "CEMETO": "CEMENTO",
    "SEMENTO": "CEMENTO",
    "CEMENTOS": "CEMENTO",
    "GALLOS": "GALLO",
    "KILOS": "KG",
    "KILO": "KG",
    "KILOGRAMOS": "KG",
    "KILOGRAMO": "KG",
    "KGS": "KG",
    "KGM": "KG",
    "LITROS": "LT",
    "LITRO": "LT",
    "LTS": "LT",
    "METROS": "M",
    "METRO": "M",
    "MTS": "M",
    "MTR": "M",
    "PIEZAS": "PZA",
    "PIEZA": "PZA",
    "PZAS": "PZA",
    "PZ": "PZA",
}


def _normalize_search_token(tok: str) -> str:
    t = _strip_accents_upper(tok)
    if not t:
        return ""
    if t in _COMMON_TYPO_MAP:
        return _COMMON_TYPO_MAP[t]
    return t


def _stem_token(tok: str) -> str:
    t = _normalize_search_token(tok)
    if len(t) > 4 and t.endswith("ES") and not t.endswith(("NES", "LES", "RES")):
        return t[:-2]
    if len(t) > 3 and t.endswith("S"):
        return t[:-1]
    return t


def _tokenize_search_query(raw_query: str) -> list[str]:
    q = _strip_accents_upper(raw_query)
    if not q:
        return []
    raw_parts = [p for p in re.split(r"[\s,;]+", q) if p]
    merged: list[str] = []
    unit_set = {"K", "KG", "KGS", "KGM", "KILO", "KILOS", "G", "GR", "LT", "LTS", "L", "ML", "M", "MT", "MTS", "MTR", "CM", "MM", "PZA", "PZ", "TON"}
    i = 0
    while i < len(raw_parts):
        cur = raw_parts[i]
        if i + 1 < len(raw_parts) and re.fullmatch(r"\d+(?:\.\d+)?", cur):
            nxt = raw_parts[i + 1].rstrip(".")
            if nxt in unit_set:
                base_u = "K" if nxt in {"K", "KG", "KGS", "KGM", "KILO", "KILOS"} else _normalize_search_token(nxt)
                merged.append(f"{cur}{base_u}")
                i += 2
                continue
        m_num_unit = re.fullmatch(r"(\d+(?:\.\d+)?)(K|KG|KGS|KGM|KILO|KILOS|G|GR|LT|LTS|L|ML|M|MT|MTS|MTR|CM|MM|PZA|PZ|TON)", cur)
        if m_num_unit:
            num_part, u_part = m_num_unit.group(1), m_num_unit.group(2)
            base_u = "K" if u_part in {"K", "KG", "KGS", "KGM", "KILO", "KILOS"} else _normalize_search_token(u_part)
            merged.append(f"{num_part}{base_u}")
            i += 1
            continue
        merged.append(_normalize_search_token(cur))
        i += 1
    return [t for t in merged if t]


def _alnum_sort_key(text: str) -> list:
    s = _strip_accents_upper(text)
    parts = re.split(r"(\d+)", s)
    out = []
    for part in parts:
        if part.isdigit():
            out.append((0, int(part), ""))
        else:
            out.append((1, 0, part))
    return out


def _build_product_search_blob(p: models.Product) -> dict:
    meta = p.meta_data if isinstance(p.meta_data, dict) else {}
    sku = _strip_accents_upper(p.sku or "")
    barcode = _strip_accents_upper(p.barcode or "")
    barcode_no_zeros = barcode.lstrip("0") if barcode else ""
    sales_code = _strip_accents_upper(p.sales_code or meta.get("codigo_alterno") or "")
    name = _strip_accents_upper(p.name or p.description or "")
    desc = _strip_accents_upper(p.description or p.name or "")
    marca = _strip_accents_upper(meta.get("marca") or meta.get("brand") or "")
    familia = _strip_accents_upper(meta.get("familia") or meta.get("category") or "")
    depto = _strip_accents_upper(meta.get("departamento") or "")
    obs = _strip_accents_upper(meta.get("observaciones") or "")
    ref = _strip_accents_upper(meta.get("referencia") or meta.get("referencias") or "")
    sat_id = _strip_accents_upper(meta.get("sat_id") or meta.get("clave_sat") or "")
    unit = _strip_accents_upper(p.sale_unit or "")
    p_unit = _strip_accents_upper(p.purchase_unit or "")

    raw_full = " ".join(
        x for x in (sku, barcode, barcode_no_zeros, sales_code, name, desc, marca, familia, depto, obs, ref, sat_id, unit, p_unit) if x
    )

    expanded_units = []
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(K|KG|KGS|KGM|KILO|KILOS|G|GR|LT|LTS|L|ML|M|MT|MTS|MTR|CM|MM|PZA|PZ|TON)\b", raw_full):
        num_v, u_v = m.group(1), m.group(2)
        if u_v in {"K", "KG", "KGS", "KGM", "KILO", "KILOS"}:
            expanded_units.extend([f"{num_v}K", f"{num_v}KG", f"{num_v} K", f"{num_v} KG"])
        else:
            norm_u = _normalize_search_token(u_v)
            expanded_units.extend([f"{num_v}{norm_u}", f"{num_v}{u_v}", f"{num_v} {norm_u}"])

    full_text = (raw_full + " " + " ".join(expanded_units)).strip()
    compact_codes = " ".join(re.sub(r"[\-_./]+", "", c) for c in (sku, barcode, barcode_no_zeros, sales_code) if c)
    compact_text = full_text + (" " + compact_codes if compact_codes else "")
    words = [w for w in re.split(r"[\s\-_,;()]+", full_text) if w]
    norm_words = [_normalize_search_token(w) for w in words]
    stem_words = [_stem_token(w) for w in words]

    return {
        "sku": sku,
        "barcode": barcode,
        "barcode_no_zeros": barcode_no_zeros,
        "sales_code": sales_code,
        "name": name,
        "desc": desc,
        "marca": marca,
        "familia": familia,
        "depto": depto,
        "full_text": full_text,
        "compact_text": compact_text,
        "words": words,
        "norm_words": norm_words,
        "stem_words": stem_words,
    }


def _token_matches_product(tok: str, blob: dict) -> tuple[bool, int]:
    t_norm = _normalize_search_token(tok)
    t_stem = _stem_token(tok)
    t_compact = re.sub(r"[\s\-_./]+", "", t_norm)

    for code_val in (blob["sku"], blob["barcode"], blob["barcode_no_zeros"], blob["sales_code"]):
        if not code_val:
            continue
        c_compact = re.sub(r"[\-_./]+", "", code_val)
        if code_val == t_norm or c_compact == t_compact:
            return True, 0
        if code_val.startswith(t_norm) or c_compact.startswith(t_compact):
            return True, 1
        if t_norm in code_val or (t_compact and t_compact in c_compact):
            return True, 2

    if blob["name"].startswith(t_norm) or blob["desc"].startswith(t_norm):
        return True, 1
    if blob["marca"] and (blob["marca"] == t_norm or blob["marca"].startswith(t_norm)):
        return True, 1

    for w, nw, sw in zip(blob["words"], blob["norm_words"], blob["stem_words"]):
        if w == t_norm or nw == t_norm or sw == t_stem:
            return True, 2
        if w.startswith(t_norm) or nw.startswith(t_norm) or (len(t_stem) >= 3 and sw.startswith(t_stem)):
            return True, 2

    if t_norm in blob["full_text"] or (t_compact and len(t_compact) >= 3 and t_compact in blob["compact_text"]):
        return True, 3
    if len(t_stem) >= 3 and t_stem in blob["full_text"]:
        return True, 3

    if len(t_stem) >= 5:
        for sw in blob["stem_words"]:
            if abs(len(sw) - len(t_stem)) <= 1 and len(sw) >= 4:
                diffs = 0
                i = j = 0
                while i < len(t_stem) and j < len(sw):
                    if t_stem[i] == sw[j]:
                        i += 1
                        j += 1
                    else:
                        diffs += 1
                        if diffs > 1:
                            break
                        if len(t_stem) > len(sw):
                            i += 1
                        elif len(sw) > len(t_stem):
                            j += 1
                        else:
                            i += 1
                            j += 1
                diffs += (len(t_stem) - i) + (len(sw) - j)
                if diffs <= 1:
                    return True, 4

    return False, 99


def get_product(db: Session, empresa_id: str, sku: str):
    clean = (sku or "").strip()
    if not clean:
        return None
    exact = (
        db.query(models.Product)
        .options(joinedload(models.Product.price_scales))
        .filter(models.Product.empresa_id == empresa_id)
        .filter(models.Product.sku == clean)
        .first()
    )
    if exact:
        return exact

    clean_upper = clean.upper()
    clean_no_zeros = clean_upper.lstrip("0")
    candidates = (
        db.query(models.Product)
        .options(joinedload(models.Product.price_scales))
        .filter(models.Product.empresa_id == empresa_id)
        .all()
    )
    for p in candidates:
        p_sku = (p.sku or "").strip().upper()
        p_bar = (p.barcode or "").strip().upper()
        p_bar_nz = p_bar.lstrip("0") if p_bar else ""
        p_alt = (p.sales_code or "").strip().upper()
        if clean_upper in (p_sku, p_bar, p_alt) or (clean_no_zeros and clean_no_zeros == p_bar_nz):
            return p
    return None


def get_products(db: Session, empresa_id: str, skip: int = 0, limit: int = 100):
    items = (
        db.query(models.Product)
        .options(joinedload(models.Product.price_scales))
        .filter(models.Product.empresa_id == empresa_id)
        .all()
    )
    items.sort(key=lambda p: (_alnum_sort_key(p.name or p.description or p.sku or ""), _alnum_sort_key(p.sku or "")))
    return items[skip : skip + min(limit, _MAX_LIMIT)]

def _sync_product_price_scales(db: Session, empresa_id: str, db_product: models.Product, raw_scales):
    """Sincroniza las filas de ProductPriceScale con las escalas enviadas desde Alta/Edicion de Producto."""
    if raw_scales is None:
        return
    db.query(models.ProductPriceScale).filter(
        models.ProductPriceScale.empresa_id == empresa_id,
        models.ProductPriceScale.product_id == db_product.id,
    ).delete(synchronize_session=False)
    db.flush()

    seen_names = set()
    for item in (raw_scales or []):
        if not isinstance(item, dict):
            continue
        if item.get("activa") is False:
            continue
        scale_name = str(item.get("scale_name") or item.get("nombre") or item.get("name") or "").strip()
        if not scale_name:
            continue
        key_upper = scale_name.upper()
        if key_upper in seen_names:
            continue
        seen_names.add(key_upper)

        raw_price = item.get("price")
        if raw_price is None:
            raw_price = item.get("precio_activo") if item.get("precio_activo") is not None else item.get("precio")
        raw_margin = item.get("margin")
        if raw_margin is None:
            raw_margin = item.get("margen_trabajo") if item.get("margen_trabajo") is not None else item.get("margen_ideal")

        try:
            price_val = Decimal(str(round(float(raw_price or 0.0), 4)))
        except Exception:
            price_val = Decimal("0.0000")
        try:
            margin_val = Decimal(str(round(float(raw_margin or 0.0), 4)))
        except Exception:
            margin_val = Decimal("0.0000")

        db.add(models.ProductPriceScale(
            empresa_id=empresa_id,
            product_id=db_product.id,
            scale_name=scale_name,
            price=price_val,
            margin=margin_val,
        ))


def search_products(db: Session, empresa_id: str, query: str, limit: int = 50):
    """Busca productos por SKU, codigo de barras, codigo alterno, nombre, descripcion,
    marca, familia, departamento, referencias y medidas (ej. 50 K, CEMEX, CEM...),
    ordenando los resultados en orden alfanumerico natural."""
    all_products = (
        db.query(models.Product)
        .options(joinedload(models.Product.price_scales))
        .filter(models.Product.empresa_id == empresa_id)
        .all()
    )
    raw_q = (query or "").strip()
    if not raw_q:
        all_products.sort(key=lambda p: (_alnum_sort_key(p.name or p.description or p.sku or ""), _alnum_sort_key(p.sku or "")))
        return all_products[:limit]

    q_upper = _strip_accents_upper(raw_q)
    q_compact = re.sub(r"[\s\-_./]+", "", q_upper)
    tokens = _tokenize_search_query(raw_q)
    if not tokens:
        tokens = [q_upper]

    full_matches = []
    partial_matches = []

    for p in all_products:
        blob = _build_product_search_blob(p)

        is_exact_code = q_upper in (blob["sku"], blob["barcode"], blob["barcode_no_zeros"], blob["sales_code"]) or (
            q_compact and q_compact in (blob["sku"], blob["barcode"], blob["barcode_no_zeros"], blob["sales_code"])
        )
        starts_with_q = (
            blob["name"].startswith(q_upper)
            or blob["desc"].startswith(q_upper)
            or blob["sku"].startswith(q_upper)
            or blob["sku"].replace("-", "").startswith(q_compact)
            or (blob["barcode"] and blob["barcode"].startswith(q_upper))
        )

        matched_count = 0
        best_tier = 99
        total_tier = 0
        for tok in tokens:
            ok, tier = _token_matches_product(tok, blob)
            if ok:
                matched_count += 1
                total_tier += tier
                if tier < best_tier:
                    best_tier = tier

        alnum_name = _alnum_sort_key(p.name or p.description or p.sku or "")
        alnum_sku = _alnum_sort_key(p.sku or "")

        if is_exact_code:
            full_matches.append((0, 0, alnum_name, alnum_sku, p))
        elif matched_count == len(tokens):
            prefix_rank = 0 if starts_with_q else 1
            full_matches.append((1, prefix_rank, alnum_name, alnum_sku, p))
        elif len(tokens) >= 2 and matched_count >= max(1, len(tokens) - 1):
            missing = len(tokens) - matched_count
            partial_matches.append((2 + missing, total_tier, alnum_name, alnum_sku, p))

    full_matches.sort(key=lambda item: (item[0], item[1], item[2], item[3]))
    if full_matches:
        results = [item[4] for item in full_matches]
        if len(tokens) >= 3 and partial_matches:
            partial_matches.sort(key=lambda item: (item[0], item[1], item[2], item[3]))
            seen_ids = {p.id for p in results}
            for item in partial_matches:
                if item[4].id not in seen_ids:
                    results.append(item[4])
        return results[:limit]

    partial_matches.sort(key=lambda item: (item[0], item[1], item[2], item[3]))
    return [item[4] for item in partial_matches[:limit]]

def create_product(db: Session, empresa_id: str, product: schemas.ProductCreate, sucursal_id: str = "MATRIZ"):
    sale_unit = product.sale_unit or product.unit or "PIEZA"
    name = product.name or product.description
    meta = dict(product.meta_data or {})
    if product.price_scales is not None and "price_scales" not in meta:
        meta["price_scales"] = product.price_scales
    raw_stock = float(product.stock or 0.0)
    if raw_stock <= 0 and meta.get("stock_almacen"):
        try:
            raw_stock = float(meta.get("stock_almacen") or 0.0)
        except Exception:
            raw_stock = 0.0

    clean_foto = product.foto_url
    if isinstance(clean_foto, str):
        clean_foto = clean_foto.strip()
        if not clean_foto or ("/admin" in clean_foto and not clean_foto.startswith("data:image/")):
            clean_foto = None
    if not clean_foto and isinstance(meta.get("foto_url"), str):
        mf = meta.get("foto_url").strip()
        if mf and not ("/admin" in mf and not mf.startswith("data:image/")):
            clean_foto = mf
    if clean_foto:
        meta["foto_url"] = clean_foto

    db_product = models.Product(
        empresa_id=empresa_id,
        sucursal_id=sucursal_id or "MATRIZ",
        sku=product.sku,
        barcode=product.barcode or product.sku,
        sales_code=product.sales_code,
        name=name,
        description=product.description,
        purchase_unit=product.purchase_unit or "CAJA",
        sale_unit=sale_unit,
        conversion_factor=product.conversion_factor or 1.0,
        average_cost=product.average_cost or 0.0,
        price=product.price,
        stock=raw_stock,
        stock_minimo=product.stock_minimo,
        meta_data=meta,
        foto_url=clean_foto
    )
    db.add(db_product)
    db.flush()

    raw_scales = product.price_scales if product.price_scales is not None else meta.get("price_scales")
    if raw_scales is not None:
        _sync_product_price_scales(db, empresa_id, db_product, raw_scales)

    # Sincronizar WarehouseStock con las bodegas reales del tenant
    whs = db.query(models.Warehouse).filter(models.Warehouse.empresa_id == empresa_id).all()
    if not whs:
        main_wh = _get_or_create_default_warehouse(db, empresa_id, sucursal_id or "MATRIZ")
        whs = [main_wh]

    assigned_stock = False
    for w in whs:
        is_target_branch = (w.sucursal_id == (sucursal_id or "MATRIZ")) or (not assigned_stock and w.sucursal_id == "MATRIZ")
        qty_for_wh = Decimal(str(raw_stock)) if (is_target_branch and not assigned_stock) else Decimal("0")
        if is_target_branch and not assigned_stock:
            assigned_stock = True
        ws = models.WarehouseStock(
            empresa_id=empresa_id,
            product_id=db_product.id,
            warehouse_id=w.id,
            quantity=qty_for_wh,
        )
        db.add(ws)
        if qty_for_wh > 0:
            db.add(models.InventoryMovement(
                empresa_id=empresa_id,
                sucursal_id=w.sucursal_id or "MATRIZ",
                product_id=db_product.id,
                warehouse_id=w.id,
                movement_type="COMPRA",
                quantity=qty_for_wh,
                unit_cost=Decimal(str(product.average_cost or 0.0)),
                reference_type="INVENTARIO_INICIAL",
                reference_id=f"INI-{db_product.sku}",
                idempotency_key=f"INI:{empresa_id}:{db_product.id}:{w.id}",
                reason=f"Existencia inicial registrada en Alta de Producto ({db_product.sku})",
            ))

    db.commit()
    db.refresh(db_product)
    return db_product


def update_product(db: Session, empresa_id: str, sku: str, product: schemas.ProductCreate, sucursal_id: str = "MATRIZ"):
    db_product = get_product(db, empresa_id=empresa_id, sku=sku)
    if not db_product:
        return create_product(db, empresa_id=empresa_id, product=product, sucursal_id=sucursal_id)

    sale_unit = product.sale_unit or product.unit or db_product.sale_unit or "PIEZA"
    name = product.name or product.description or db_product.name
    meta = dict(db_product.meta_data or {})
    if product.meta_data:
        meta.update(product.meta_data)
    if product.price_scales is not None:
        meta["price_scales"] = product.price_scales

    db_product.barcode = product.barcode or db_product.barcode or db_product.sku
    db_product.sales_code = product.sales_code if product.sales_code is not None else db_product.sales_code
    db_product.name = name
    db_product.description = product.description or db_product.description
    db_product.purchase_unit = product.purchase_unit or db_product.purchase_unit or "CAJA"
    db_product.sale_unit = sale_unit
    if product.conversion_factor is not None:
        db_product.conversion_factor = product.conversion_factor
    if product.average_cost is not None:
        db_product.average_cost = product.average_cost
    if product.price is not None:
        db_product.price = product.price
    if product.stock_minimo is not None:
        db_product.stock_minimo = product.stock_minimo

    incoming_foto = product.foto_url
    if isinstance(incoming_foto, str):
        incoming_foto = incoming_foto.strip()
        if not incoming_foto or ("/admin" in incoming_foto and not incoming_foto.startswith("data:image/")):
            incoming_foto = None
    if incoming_foto:
        db_product.foto_url = incoming_foto
        meta["foto_url"] = incoming_foto
    elif db_product.foto_url and not ("/admin" in str(db_product.foto_url) and not str(db_product.foto_url).startswith("data:image/")):
        meta["foto_url"] = db_product.foto_url

    db_product.meta_data = meta

    raw_scales = product.price_scales if product.price_scales is not None else (product.meta_data or {}).get("price_scales")
    if raw_scales is not None:
        _sync_product_price_scales(db, empresa_id, db_product, raw_scales)

    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product


# --- Client CRUD ---
def get_client(db: Session, empresa_id: str, client_id: str):
    return db.query(models.Client).filter(models.Client.empresa_id == empresa_id).filter(models.Client.id == client_id).first()

def get_client_by_phone(db: Session, empresa_id: str, phone: str):
    clean_phone = "".join(filter(str.isdigit, phone))
    if not clean_phone:
        return None
    return db.query(models.Client).filter(models.Client.empresa_id == empresa_id).filter(models.Client.phone == clean_phone).first()

def get_clients(db: Session, empresa_id: str, skip: int = 0, limit: int = 100):
    return db.query(models.Client).filter(models.Client.empresa_id == empresa_id).offset(skip).limit(min(limit, _MAX_LIMIT)).all()

def search_clients(db: Session, empresa_id: str, query: str, limit: int = 50):
    """Busca clientes por nombre, RFC, telefono, email o codigo.

    RUTAS DE DIALECTO (FASE 5.1E-R):
    - postgresql : ruta oficial SaaS (ORM models.Customer, errores propagados)
    - sqlite     : SQLITE LEGACY COMPAT — temporal, no usar como ruta SaaS oficial
                   TICKET-BACKEND-01 — Retirar compat shim SQLite cuando crud.py
                   se normalice hacia Customer real en PostgreSQL oficial.
                   Causa: tabla 'customers' no existe en SQLite local; la tabla
                   legacy disponible es 'clients'.
    """
    dialect = db.bind.dialect.name  # 'sqlite' | 'postgresql'

    if dialect == "postgresql":
        # ── RUTA OFICIAL SAAS ─────────────────────────────────────────────────
        # En PostgreSQL los errores se propagan normalmente (no ocultos).
        q_str = (query or "").strip()
        qs = db.query(models.Client).filter(models.Client.empresa_id == empresa_id)
        if q_str:
            clean_digits = "".join(filter(str.isdigit, q_str))
            filters = [
                func.lower(models.Client.name).contains(q_str.lower()),
                func.lower(models.Client.rfc).contains(q_str.lower()),
                func.lower(models.Client.client_code).contains(q_str.lower()),
                func.lower(models.Client.email).contains(q_str.lower()),
            ]
            if clean_digits:
                filters += [
                    models.Client.phone.contains(clean_digits),
                    models.Client.whatsapp.contains(clean_digits),
                ]
            qs = qs.filter(or_(*filters))
        return qs.order_by(models.Client.name).limit(limit).all()

    # ── SQLITE LEGACY COMPAT — temporal, no usar como ruta SaaS oficial ──────
    # TICKET-BACKEND-01 — Retirar cuando crud.py use Customer real en PostgreSQL.
    _log.warning(
        "[COMPAT-SQLITE] search_clients usando ruta legacy SQLite. "
        "La tabla 'customers' no existe en el schema local; usando tabla 'clients'. "
        "empresa_id=%s query=%r",
        empresa_id, query
    )
    q_str = (query or "").strip()
    if not q_str:
        sql = text(
            "SELECT id, empresa_id, sucursal_id, name, rfc, phone, whatsapp, "
            "email, client_code, client_type, saldo_favor, limite_credito, "
            "dias_credito, puntos, saldo_actual, ultima_compra, is_synced, "
            "assigned_price_scale "
            "FROM clients WHERE empresa_id = :eid ORDER BY name LIMIT :lim"
        )
        rows = db.execute(sql, {"eid": empresa_id, "lim": limit}).mappings().all()
    else:
        clean_digits = "".join(filter(str.isdigit, q_str))
        p = f"%{q_str}%"
        pd_val = f"%{clean_digits}%" if clean_digits else p
        sql = text(
            "SELECT id, empresa_id, sucursal_id, name, rfc, phone, whatsapp, "
            "email, client_code, client_type, saldo_favor, limite_credito, "
            "dias_credito, puntos, saldo_actual, ultima_compra, is_synced, "
            "assigned_price_scale "
            "FROM clients WHERE empresa_id = :eid AND ("
            "  LOWER(name) LIKE LOWER(:p) OR LOWER(rfc) LIKE LOWER(:p) OR "
            "  LOWER(client_code) LIKE LOWER(:p) OR phone LIKE :pd OR "
            "  whatsapp LIKE :pd OR LOWER(email) LIKE LOWER(:p)"
            ") ORDER BY name LIMIT :lim"
        )
        rows = db.execute(sql, {"eid": empresa_id, "p": p, "pd": pd_val, "lim": limit}).mappings().all()
    return [dict(r) for r in rows]

def create_client(db: Session, empresa_id: str, client: schemas.ClientCreate):
    clean_phone = "".join(filter(str.isdigit, client.phone)) if client.phone else None
    
    client_code = client.client_code
    if not client_code:
        count = db.query(models.Client).filter(models.Client.empresa_id == empresa_id).count()
        client_code = f"C1-{(count + 1):04d}"
        
    db_client = models.Client(empresa_id=empresa_id, 
        client_code=client_code,
        name=client.name,
        rfc=client.rfc,
        client_type=client.client_type,
        phone=clean_phone,
        whatsapp=client.whatsapp,
        saldo_favor=client.saldo_favor,
        email=client.email,
        regimen_fiscal=client.regimen_fiscal,
        uso_cfdi=client.uso_cfdi,
        direccion=client.direccion,
        numero_ext=client.numero_ext,
        numero_int=client.numero_int,
        colonia=client.colonia,
        ciudad=client.ciudad,
        municipio=client.municipio,
        estado=client.estado,
        cp=client.cp,
        pais=client.pais,
        limite_credito=client.limite_credito,
        dias_credito=client.dias_credito,
        puntos=client.puntos,
        resguardos=client.resguardos,
        apartados=client.apartados,
        ultima_compra=client.ultima_compra,
        saldo_actual=client.saldo_actual,
        assigned_price_scale=client.assigned_price_scale or "Público General"
    )
    db.add(db_client)
    db.commit()
    db.refresh(db_client)
    
    if client.saldo_favor != 0.0:
        tx_type = "CREDIT" if client.saldo_favor > 0 else "DEBIT"
        db_ledger = models.CustomerCreditLedger(empresa_id=empresa_id, 
            client_id=db_client.id,
            amount=client.saldo_favor,
            transaction_type=tx_type,
            description="Saldo a favor inicial al registrar cliente"
        )
        db.add(db_ledger)
        db.commit()
        
    return db_client

def update_client_saldo_favor(db: Session, empresa_id: str, client_id: str, amount: float, sale_id: Optional[int] = None, description: Optional[str] = None):
    db_client = db.query(models.Client).filter(models.Client.empresa_id == empresa_id).filter(models.Client.id == client_id).first()
    if not db_client:
        raise ValueError("Client not found")
    # saldo_favor es Numeric -> Decimal en la sesion real; amount llega como
    # float desde la API. Decimal + float truena con TypeError (hallazgo C3).
    db_client.saldo_favor += Decimal(str(amount))
    db.add(db_client)
    
    tx_type = "CREDIT" if amount >= 0 else "DEBIT"
    db_ledger = models.CustomerCreditLedger(empresa_id=empresa_id, 
        client_id=db_client.id,
        amount=amount,
        transaction_type=tx_type,
        sale_id=sale_id,
        description=description or ("Abono de saldo a favor" if amount >= 0 else "Cargo/Uso de saldo a favor")
    )
    db.add(db_ledger)
    db.commit()
    db.refresh(db_client)
    return db_client

def register_anticipo(
    db: Session,
    empresa_id: str,
    client_id: str,
    amount: float,
    description: Optional[str] = None,
    payment_method: Optional[str] = "efectivo",
):
    """E-06c: Registra un anticipo puro (prepago no vinculado a una venta).

    Los anticipos NO vencen — se acumulan en saldo_favor del cliente
    indefinidamente hasta que se apliquen en una venta (E-06a) o se
    conviertan explícitamente via devolución.
    """
    if amount <= 0:
        raise ValueError("El monto del anticipo debe ser mayor a cero.")
    db_client = (db.query(models.Client)
                   .filter(models.Client.empresa_id == empresa_id,
                           models.Client.id == client_id)
                   .with_for_update()
                   .first())
    if not db_client:
        raise ValueError("Cliente no encontrado.")

    db_client.saldo_favor = (db_client.saldo_favor or Decimal("0")) + Decimal(str(amount))
    desc = description or f"Anticipo recibido ({payment_method or 'efectivo'})"
    db.add(models.CustomerCreditLedger(
        empresa_id=empresa_id,
        client_id=client_id,
        amount=Decimal(str(amount)),
        transaction_type="CREDIT",
        description=desc,
    ))
    db.commit()
    db.refresh(db_client)
    return db_client


def get_client_ledger(db: Session, empresa_id: str, client_id: str):
    """E-06c: Devuelve historial de movimientos del saldo_favor del cliente."""
    db_client = (db.query(models.Client)
                   .filter(models.Client.empresa_id == empresa_id,
                           models.Client.id == client_id)
                   .first())
    if not db_client:
        raise ValueError("Cliente no encontrado.")
    entries = (db.query(models.CustomerCreditLedger)
                 .filter(models.CustomerCreditLedger.empresa_id == empresa_id,
                         models.CustomerCreditLedger.client_id == client_id)
                 .order_by(models.CustomerCreditLedger.created_at)
                 .all())
    return {
        "credit_balance": float(db_client.saldo_favor or 0),
        "entries": [
            {
                "id": e.id,
                "amount": float(e.amount),
                "transaction_type": e.transaction_type,
                "description": e.description,
                "sale_id": e.sale_id,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in entries
        ],
    }


def update_client_saldo_favor_by_phone(db: Session, empresa_id: str, phone: str, amount: float, client_name: str = "Cliente Nuevo", sale_id: Optional[int] = None, description: Optional[str] = None):
    clean_phone = "".join(filter(str.isdigit, phone))
    if not clean_phone or len(clean_phone) != 10:
        raise ValueError("Phone number must be exactly 10 digits")
    db_client = db.query(models.Client).filter(models.Client.empresa_id == empresa_id).filter(models.Client.phone == clean_phone).first()
    if not db_client:
        db_client = models.Client(empresa_id=empresa_id, 
            name=client_name,
            rfc="XAXX010101000",
            client_type="Público General",
            phone=clean_phone,
            saldo_favor=amount,
            limite_credito=0.0,
            dias_credito=30,
            puntos=0,
            resguardos=False,
            apartados=0.0,
            ultima_compra="S/N",
            saldo_actual=0.0
        )
        db.add(db_client)
        db.flush()
    else:
        db_client.saldo_favor += Decimal(str(amount))
        db.add(db_client)
        
    tx_type = "CREDIT" if amount >= 0 else "DEBIT"
    db_ledger = models.CustomerCreditLedger(empresa_id=empresa_id, 
        client_id=db_client.id,
        amount=amount,
        transaction_type=tx_type,
        sale_id=sale_id,
        description=description or ("Abono de saldo a favor" if amount >= 0 else "Cargo/Uso de saldo a favor")
    )
    db.add(db_ledger)
    db.commit()
    db.refresh(db_client)
    return db_client

# --- Sale & Transactions CRUD (Supports Credit & Safekeeping) ---
def get_sale(db: Session, empresa_id: str, sale_id: str):
    return db.query(models.Sale).filter(models.Sale.empresa_id == empresa_id).filter(models.Sale.id == sale_id).first()

def get_sales(db: Session, empresa_id: str, skip: int = 0, limit: int = 100):
    return db.query(models.Sale).filter(models.Sale.empresa_id == empresa_id).order_by(models.Sale.created_at.desc()).offset(skip).limit(min(limit, _MAX_LIMIT)).all()

def get_client_purchase_history(db: Session, empresa_id: str, client_id: str, sku: str = None):
    """Historial de compras de un cliente para un SKU en todas las sedes del tenant."""
    q = (db.query(
            models.Sale.id,
            models.Sale.sucursal_id,
            models.Sale.created_at,
            models.SaleItem.price,
            models.SaleItem.quantity,
            models.SaleItem.product_sku,
         )
         .join(models.SaleItem, models.SaleItem.sale_id == models.Sale.id)
         .filter(models.Sale.empresa_id == empresa_id)
         .filter(models.Sale.client_id == str(client_id))
         .filter(models.Sale.parent_sale_id == None)  # noqa: E711
    )
    if sku:
        q = q.filter(models.SaleItem.product_sku == str(sku))
    rows = q.order_by(models.Sale.created_at.desc()).limit(20).all()
    return [
        {"sale_id": r[0], "sucursal_id": r[1],
         "fecha": r[2].isoformat() if r[2] else None,
         "price": float(r[3]) if r[3] is not None else 0.0,
         "quantity": float(r[4]) if r[4] is not None else 0.0,
         "product_sku": r[5]}
        for r in rows
    ]

def _get_or_create_default_warehouse(db: Session, empresa_id: str, sucursal_id: str = "MATRIZ"):
    """Resuelve la bodega activa (no-transito) de la sucursal o del tenant para registrar
    movimientos de Kardex.
    """
    target_suc = (sucursal_id or "MATRIZ").strip()
    warehouse = (
        db.query(models.Warehouse)
        .filter(models.Warehouse.empresa_id == empresa_id)
        .filter(models.Warehouse.sucursal_id == target_suc)
        .order_by(models.Warehouse.name)
        .first()
    )
    if warehouse:
        return warehouse
    warehouse = (
        db.query(models.Warehouse)
        .filter(models.Warehouse.empresa_id == empresa_id)
        .order_by(models.Warehouse.name)
        .first()
    )
    if warehouse:
        return warehouse
    warehouse = models.Warehouse(
        empresa_id=empresa_id, sucursal_id=target_suc,
        name="BODEGA PRINCIPAL", is_transit=False,
    )
    db.add(warehouse)
    db.flush()
    return warehouse


def _get_warehouse_by_id(db: Session, empresa_id: str, warehouse_id: str):
    return (
        db.query(models.Warehouse)
        .filter(models.Warehouse.empresa_id == empresa_id)
        .filter(models.Warehouse.id == warehouse_id)
        .first()
    )


def _get_or_create_warehouse_stock(db: Session, empresa_id: str, product_id: str, warehouse_id: str):
    """Fila de existencia (empresa_id, product_id, warehouse_id) en
    warehouse_stock, bloqueada con FOR UPDATE. Se crea en 0 si el producto
    nunca tuvo movimiento en esa bodega (mismo patron defensivo que
    _get_or_create_default_warehouse: no debe tronar el checkout por falta
    de una fila de catalogo que perfectamente puede no existir todavia).
    """
    row = (
        db.query(models.WarehouseStock)
        .filter(models.WarehouseStock.empresa_id == empresa_id)
        .filter(models.WarehouseStock.product_id == product_id)
        .filter(models.WarehouseStock.warehouse_id == warehouse_id)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if row:
        return row
    row = models.WarehouseStock(
        empresa_id=empresa_id, product_id=product_id,
        warehouse_id=warehouse_id, quantity=Decimal("0"),
    )
    db.add(row)
    db.flush()
    return row


def _find_donor_warehouse_stock(db: Session, empresa_id: str, product_id: str, exclude_warehouse_id: str, qty_needed: Decimal):
    """Selecciona automaticamente una bodega donante con existencia >=
    qty_needed, distinta de la bodega vendedora (decision de negocio 1/3,
    'Corrigiendo C2 de auditoria.md': automatico con respaldo manual -- el
    respaldo manual, para cuando el cajero necesita forzar una bodega
    especifica, queda fuera de alcance de este commit).
    Limitacion conocida: solo cubre el caso de UNA bodega donante con
    existencia suficiente por si sola. Repartir el faltante entre varias
    bodegas donantes a la vez no esta cubierto (fuera de alcance).
    """
    return (
        db.query(models.WarehouseStock)
        .filter(models.WarehouseStock.empresa_id == empresa_id)
        .filter(models.WarehouseStock.product_id == product_id)
        .filter(models.WarehouseStock.warehouse_id != exclude_warehouse_id)
        .filter(models.WarehouseStock.quantity >= qty_needed)
        .with_for_update()
        .populate_existing()
        .order_by(models.WarehouseStock.quantity.desc())
        .first()
    )


def generate_sale_entry(
    db: Session,
    empresa_id: str,
    sucursal_id: str,
    sale_id: str,
    total_venta: Decimal,
    total_iva: Decimal,
    total_costo: Decimal,
    payment_method: str,
    created_by: str,
    concepto: str,
) -> models.AccountingEntry:
    """Genera el asiento contable de partida doble para una venta.

    Catálogo SAT Anexo 24 (México):
      102.01  Caja                     — efectivo recibido
      105.01  Clientes (CxC)           — crédito otorgado
      151.01  Inventario de mercancías — salida de almacén al costo
      216.01  IVA trasladado           — IVA a enterar al SAT
      401.01  Ventas                   — ingreso por la venta (neto sin IVA)
      501.01  Costo de lo vendido      — gasto por costo del producto

    Estructura del asiento (efectivo, con IVA):
      DEBE  102.01 Caja             total_venta + total_iva
      HABER 401.01 Ventas           total_venta
      HABER 216.01 IVA trasladado   total_iva
      DEBE  501.01 Costo de ventas  total_costo
      HABER 151.01 Inventario       total_costo

    Estructura del asiento (crédito, con IVA):
      DEBE  105.01 Clientes         total_venta + total_iva
      HABER 401.01 Ventas           total_venta
      HABER 216.01 IVA trasladado   total_iva
      DEBE  501.01 Costo de ventas  total_costo
      HABER 151.01 Inventario       total_costo

    El Debe siempre == el Haber (se verifica antes de insertar y se lanza
    ValueError si no cuadra — nunca se registra un asiento descuadrado).

    Para Colombia (LMCont-IQ): mismo patrón, reemplazar códigos SAT por
    PUC DIAN (110505 Caja, 130505 Clientes, 143505 Inventario,
    240805 IVA por pagar, 410510 Ventas, 613595 CMV).
    """
    total_venta = Decimal(str(total_venta))
    total_iva   = Decimal(str(total_iva))
    total_costo = Decimal(str(total_costo))

    # Cuenta de contrapartida según forma de pago
    # 006 = Crédito; cualquier otro = Efectivo/otros medios → Caja
    es_credito = (payment_method == "006")
    cuenta_cobro       = "105.01" if es_credito else "102.01"
    nombre_cobro       = "Clientes" if es_credito else "Caja"
    monto_cobro        = total_venta + total_iva

    # Líneas del asiento
    lines_data = [
        # ── Ingreso ──────────────────────────────────────────────────────────
        dict(cuenta_sat="401.01", cuenta_nombre="Ventas",
             tipo_movimiento="HABER", monto=total_venta,
             descripcion=f"Ingreso por venta {concepto}"),
        dict(cuenta_sat=cuenta_cobro, cuenta_nombre=nombre_cobro,
             tipo_movimiento="DEBE", monto=monto_cobro,
             descripcion=f"Cobro en {nombre_cobro} — {concepto}"),
    ]
    if total_iva > Decimal("0"):
        lines_data.append(
            dict(cuenta_sat="216.01", cuenta_nombre="IVA trasladado",
                 tipo_movimiento="HABER", monto=total_iva,
                 descripcion=f"IVA trasladado — {concepto}")
        )

    # ── Costo ─────────────────────────────────────────────────────────────
    if total_costo > Decimal("0"):
        lines_data += [
            dict(cuenta_sat="501.01", cuenta_nombre="Costo de lo vendido",
                 tipo_movimiento="DEBE", monto=total_costo,
                 descripcion=f"CMV salida inventario — {concepto}"),
            dict(cuenta_sat="151.01", cuenta_nombre="Inventario de mercancías",
                 tipo_movimiento="HABER", monto=total_costo,
                 descripcion=f"Salida inventario al costo — {concepto}"),
        ]

    # Verificar cuadre antes de insertar (nunca registrar asiento descuadrado)
    total_debe  = sum(Decimal(str(l["monto"])) for l in lines_data if l["tipo_movimiento"] == "DEBE")
    total_haber = sum(Decimal(str(l["monto"])) for l in lines_data if l["tipo_movimiento"] == "HABER")
    if total_debe != total_haber:
        raise ValueError(
            f"[generate_sale_entry] Asiento descuadrado para venta {sale_id}: "
            f"Debe={total_debe} ≠ Haber={total_haber}. No se registra."
        )

    entry = models.AccountingEntry(
        empresa_id      = empresa_id,
        sucursal_id     = sucursal_id,
        referencia_tipo = "VENTA",
        referencia_id   = sale_id,
        concepto        = concepto,
        total_debe      = total_debe,
        total_haber     = total_haber,
        status          = "POSTED",
        created_by      = created_by,
    )
    db.add(entry)
    db.flush()  # Obtener entry.id para las líneas

    for ld in lines_data:
        db.add(models.AccountingEntryLine(
            empresa_id      = empresa_id,
            entry_id        = entry.id,
            cuenta_sat      = ld["cuenta_sat"],
            cuenta_nombre   = ld["cuenta_nombre"],
            tipo_movimiento = ld["tipo_movimiento"],
            monto           = Decimal(str(ld["monto"])),
            descripcion     = ld.get("descripcion"),
        ))

    return entry


# ── Notificaciones por evento discreto (enfoque híbrido, D.3) ───────────────
def push_notification(db: Session, empresa_id: str, tipo: str, titulo: str,
                      cuerpo: str, roles_dest: list,
                      *, sucursal_id: str | None = None, severidad: str = "INFO",
                      ref_tipo: str | None = None, ref_id: str | None = None,
                      meta: dict | None = None) -> "models.Notification":
    """Inserta una Notification. NO hace commit — lo hace el caller dentro de
    su propia transacción."""
    n = models.Notification(
        empresa_id=empresa_id,
        sucursal_id=sucursal_id,
        tipo=tipo,
        severidad=severidad,
        titulo=titulo,
        cuerpo=cuerpo,
        roles_dest=list(roles_dest or []),
        ref_tipo=ref_tipo,
        ref_id=ref_id,
        meta=meta,
    )
    db.add(n)
    return n


# Roles que atienden un resguardo por faltante (N-01): Almacén + Compras + Admin.
# El módulo de Compras opera hoy bajo ADMIN/ALMACENISTA; se incluye Gerente.
RESGUARDO_ROLES_DEST = [
    "ADMIN", "Administrador", "admin",
    "ALMACENISTA", "Almacenista",
    "Gerente",
]

# Estados de SafekeptItem que cuentan como "abiertos" (pendientes de cerrar).
# Incluye el legado 'Pendiente'. Cerrados: 'ENTREGADO'/'Entregado'/'AJUSTADO'.
SAFEKEPT_ABIERTOS = [
    "SOLICITADO", "ETA_CONFIRMADA", "EN_INVENTARIO", "POR_VENCER", "Pendiente",
]

def _process_sale_item(
    db,
    empresa_id: str,
    db_sale,
    item,
    warehouse,
    *,
    is_safekept: bool,
):
    """Procesa un renglón: bloquea stock (FOR UPDATE + populate_existing),
    crea SaleItem, calcula sold/falta, genera SafekeptItem si aplica,
    ejecuta traspaso virtual entre bodegas y registra Kardex VENTA.

    Devuelve (costo_surtido: Decimal, resguardo: dict | None).

    populate_existing() es obligatorio: sin él SQLAlchemy puede devolver
    el objeto del identity map con stock PREVIO al FOR UPDATE, causando
    sobreventa real bajo dos cajeros concurrentes.
    """
    # Línea de servicio virtual NR-04: sin producto, sin stock, sin Kardex.
    if item.product_sku == _NR04_SKU_SERVICIO:
        db.add(models.SaleItem(
            empresa_id=empresa_id,
            sale_id=db_sale.id,
            product_sku=item.product_sku,
            product_id=None,
            quantity=item.quantity,
            price=item.price,
            subtotal=item.subtotal,
        ))
        db.flush()
        return Decimal("0"), None

    product = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id)
        .filter(models.Product.sku == item.product_sku)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if not product:
        raise ValueError(f"Product SKU {item.product_sku} not found")

    db_item = models.SaleItem(
        empresa_id=empresa_id,
        sucursal_id=db_sale.sucursal_id or "MATRIZ",
        sale_id=db_sale.id,
        product_sku=item.product_sku,
        product_id=product.id,
        quantity=item.quantity,
        price=item.price,
        subtotal=item.subtotal,
    )
    db.add(db_item)
    db.flush()  # Obtener db_item.id para la idempotency_key del Kardex

    qty       = Decimal(str(item.quantity))
    avg_cost  = product.average_cost or Decimal("0")
    stock_tot = product.stock if product.stock and product.stock > 0 else Decimal("0")
    sale_branch = db_sale.sucursal_id or warehouse.sucursal_id or "MATRIZ"
    folio_num = db_sale.folio or db_sale.id[:8].upper()

    # Caso Devolución directa en Caja POS (F2: cantidad negativa)
    if qty < 0:
        abs_qty = abs(qty)
        product.stock = (product.stock or Decimal("0")) + abs_qty
        db.add(product)
        local_stock = _get_or_create_warehouse_stock(db, empresa_id, product.id, warehouse.id)
        local_stock.quantity = local_stock.quantity + abs_qty
        db.add(local_stock)
        db.add(models.InventoryMovement(
            empresa_id=empresa_id,
            sucursal_id=sale_branch,
            product_id=product.id,
            warehouse_id=warehouse.id,
            movement_type="DEVOLUCION",
            quantity=abs_qty,
            unit_cost=avg_cost,
            reference_type="DEVOLUCION_POS",
            reference_id=f"DEV-{folio_num}",
            idempotency_key=f"SALE:{db_sale.id}:{db_item.id}:DEV",
            reason=f"Devolución registrada en Caja POS (Folio #{folio_num})",
        ))
        return Decimal("0"), None

    # is_safekept=True: apartado explícito — nada se despacha ahora
    sold      = Decimal("0") if is_safekept else (qty if stock_tot >= qty else stock_tot)
    falta     = qty - sold

    resguardo = None
    if falta > 0:
        db.add(models.SafekeptItem(
            empresa_id=empresa_id,
            sucursal_id=sale_branch,
            sale_id=db_sale.id,
            product_sku=item.product_sku,
            quantity_ordered=falta,
            quantity_delivered=Decimal("0"),
            status="SOLICITADO",
            origen="apartado_explicito" if is_safekept else "sin_stock",
            costo_estimado=(falta * avg_cost),
            expira_at=datetime.now(timezone.utc) + timedelta(days=180),
        ))
        resguardo = {"sku": item.product_sku, "falta": float(falta)}

    if sold <= 0:
        # Renglón 100% en resguardo: no hay stock que mover ni Kardex.
        return Decimal("0"), resguardo

    product.stock = stock_tot - sold
    db.add(product)

    local_stock = _get_or_create_warehouse_stock(db, empresa_id, product.id, warehouse.id)
    if local_stock.quantity < sold:
        # Traspaso virtual automático (decisión de negocio 2/3): la venta
        # NUNCA se bloquea por falta de stock LOCAL — el faltante TOTAL ya
        # se resolvió como resguardo arriba. Se busca una bodega donante.
        faltante_local = sold - local_stock.quantity
        donor = _find_donor_warehouse_stock(
            db, empresa_id, product.id, warehouse.id, faltante_local
        )
        if donor is not None:
            donor.quantity = donor.quantity - faltante_local
            local_stock.quantity = local_stock.quantity + faltante_local
            db.add(donor)
            donor_wh = _get_warehouse_by_id(db, empresa_id, donor.warehouse_id)
            donor_suc = (donor_wh.sucursal_id if donor_wh else None) or "MATRIZ"
            db.add(models.InventoryMovement(
                empresa_id=empresa_id, sucursal_id=donor_suc,
                product_id=product.id, warehouse_id=donor.warehouse_id,
                movement_type="TRASPASO_SALIDA", quantity=faltante_local,
                unit_cost=product.average_cost, reference_type="TICKET_VENTA",
                reference_id=db_sale.id,
                idempotency_key=f"SALE:{db_sale.id}:{db_item.id}:TRASPASO_SALIDA",
                reason=f"Traspaso automático por venta #{folio_num} hacia {sale_branch}",
            ))
            db.add(models.InventoryMovement(
                empresa_id=empresa_id, sucursal_id=sale_branch,
                product_id=product.id, warehouse_id=warehouse.id,
                movement_type="TRASPASO_ENTRADA", quantity=faltante_local,
                unit_cost=product.average_cost, reference_type="TICKET_VENTA",
                reference_id=db_sale.id,
                idempotency_key=f"SALE:{db_sale.id}:{db_item.id}:TRASPASO_ENTRADA",
                reason=f"Recepción automática por venta #{folio_num} desde {donor_suc}",
            ))
        else:
            total_wh_qty = (
                db.query(func.coalesce(func.sum(models.WarehouseStock.quantity), 0))
                .filter(models.WarehouseStock.empresa_id == empresa_id)
                .filter(models.WarehouseStock.product_id == product.id)
                .scalar()
            )
            total_wh_dec = Decimal(str(total_wh_qty or 0))
            if stock_tot > total_wh_dec and (local_stock.quantity + (stock_tot - total_wh_dec)) >= sold:
                local_stock.quantity = local_stock.quantity + (stock_tot - total_wh_dec)
                db.add(local_stock)
            else:
                raise ValueError(
                    f"Stock insuficiente en una sola bodega para cubrir el "
                    f"faltante de SKU {item.product_sku} ({faltante_local} "
                    f"unidades) via traspaso automatico, aunque el total "
                    f"del tenant si alcanza. Requiere traspaso manual "
                    f"entre varias bodegas (fuera de alcance de este fix)."
                )

    local_stock.quantity = local_stock.quantity - sold
    db.add(local_stock)

    ref_type_doc = "FACTURA_CFDI" if db_sale.is_cfdi else "TICKET_VENTA"
    doc_label = f"Factura CFDI FAC-{folio_num}" if db_sale.is_cfdi else f"Nota de Venta NV-{folio_num}"
    db.add(models.InventoryMovement(
        empresa_id=empresa_id,
        sucursal_id=sale_branch,
        product_id=product.id,
        warehouse_id=warehouse.id,
        movement_type="VENTA",
        quantity=sold,
        unit_cost=product.average_cost,
        reference_type=ref_type_doc,
        reference_id=db_sale.id,
        idempotency_key=f"SALE:{db_sale.id}:{db_item.id}",
        reason=f"{doc_label} registrada en POS ({sale_branch})",
    ))

    return sold * avg_cost, resguardo


def _create_sale_credit(db, empresa_id: str, db_sale, sale) -> None:
    """Crea AccountsReceivable + primer abono (anticipo) para ventas a crédito (006).

    CP2: original_amount = total real; anticipo_aplicado = enganche;
    current_balance = total − enganche. El anticipo queda como primer abono.
    """
    _total_credito = Decimal(str(sale.total))
    _anticipo      = Decimal(str(sale.advance or 0))
    if _anticipo < 0:
        raise ValueError("El anticipo no puede ser negativo.")
    if _anticipo > _total_credito:
        raise ValueError(
            f"El anticipo (${_anticipo}) no puede exceder el total de la "
            f"venta a credito (${_total_credito})."
        )
    debt_amount = _total_credito - _anticipo

    _cli = get_client(db, empresa_id=empresa_id, client_id=sale.client_id)
    _dias_credito = int(getattr(_cli, "dias_credito", 30) or 30) if _cli else 30
    _due = datetime.now(timezone.utc) + timedelta(days=_dias_credito)

    db_debt = models.AccountsReceivable(
        empresa_id=empresa_id,
        sucursal_id=db_sale.sucursal_id or "MATRIZ",
        client_id=sale.client_id,
        sale_id=db_sale.id,
        original_amount=_total_credito,
        current_balance=debt_amount,
        anticipo_aplicado=_anticipo,
        due_date=_due,
        sale_folio=f"V-{db_sale.id[:8].upper()}",
        status="Pendiente" if debt_amount > 0 else "Liquidado",
        seller_id=getattr(db_sale, "seller_id", None),
        is_paid=(debt_amount <= 0),
    )
    db.add(db_debt)
    db.flush()  # obtener db_debt.id para el abono del anticipo

    if _anticipo > 0:
        db.add(models.AccountReceivablePayment(
            empresa_id=empresa_id,
            sucursal_id=db_sale.sucursal_id or "MATRIZ",
            ar_id=db_debt.id,
            client_id=sale.client_id,
            amount=_anticipo,
            method="efectivo",
            applied_from="anticipo",
            balance_after=debt_amount,
            notes=f"Anticipo entregado en la venta {db_debt.sale_folio}",
            idempotency_key=f"ANTICIPO:{db_debt.id}",
        ))


def _post_sale_hooks(db, empresa_id: str, db_sale, sale, resguardos: list) -> None:
    """Efectos post-venta: notificación de resguardos, comisión de proyecto,
    y acumulación de puntos de lealtad. Todos opcionales; ninguno bloquea."""
    if resguardos:
        _skus = ", ".join(r["sku"] for r in resguardos)
        push_notification(
            db, empresa_id,
            tipo="resguardo_solicitado",
            severidad="WARNING",
            titulo=f"Resguardo por faltante — Venta #{db_sale.id[:8].upper()}",
            cuerpo=(f"{len(resguardos)} renglón(es) sin existencia quedaron a "
                    f"resguardo (SOLICITADO): {_skus}. Falta fijar la ETA."),
            roles_dest=RESGUARDO_ROLES_DEST,
            sucursal_id=db_sale.sucursal_id or "MATRIZ",
            ref_tipo="sale",
            ref_id=db_sale.id,
            meta={"items": resguardos},
        )

    _proj_id = getattr(sale, "project_id", None)
    if _proj_id:
        _project = db.query(models.Project).filter(
            models.Project.empresa_id == empresa_id,
            models.Project.id == _proj_id,
            models.Project.status == "activo",
        ).first()
        if _project and _project.commission_rate and _project.commission_rate > 0:
            _commission = (
                Decimal(str(sale.total)) * Decimal(str(_project.commission_rate))
            ).quantize(Decimal("0.0001"))
            db.add(models.ProjectCommissionLedger(
                id=str(__import__("uuid").uuid4()),
                empresa_id=empresa_id,
                project_id=_proj_id,
                entry_type="generated",
                amount=_commission,
                sale_id=db_sale.id,
                descripcion=f"Comisión automática venta #{db_sale.id[:8].upper()}",
                registrado_por="system",
            ))

    if sale.client_id:
        import json as _json2
        _loyalty_row = db.query(models.AdminConfig).filter(
            models.AdminConfig.empresa_id == empresa_id,
            models.AdminConfig.config_key == "loyalty.config",
        ).first()
        if _loyalty_row:
            try:
                _lcfg = _json2.loads(_loyalty_row.config_val)
                _mode = _lcfg.get("mode", "percent")
                _rate = float(_lcfg.get("rate", 0))
                if _rate > 0:
                    if _mode == "percent":
                        _pts = int(Decimal(str(sale.total)) * Decimal(str(_rate)) / 100)
                    else:
                        _pts = int(_rate)
                    if _pts > 0:
                        _client_loy = db.query(models.Client).filter(
                            models.Client.empresa_id == empresa_id,
                            models.Client.id == sale.client_id,
                        ).first()
                        if _client_loy:
                            _client_loy.puntos = (_client_loy.puntos or 0) + _pts
            except (ValueError, TypeError):
                pass  # config malformada → ignorar silenciosamente


def create_sale(
    db,
    empresa_id: str,
    sale: schemas.SaleCreate,
    *,
    sucursal_id: str = "MATRIZ",
    _folio_override: str | None = None,
    _parent_sale_id: str | None = None,
):
    """Crea una venta completa: cabecera + renglones + stock + Kardex + CxC.

    _folio_override y _parent_sale_id son internos: los usa create_sale_nr04_split
    para asignar folio y enlazar sub-facturas sin exponer estos campos en el schema.
    """
    # Idempotencia: reintento con misma key devuelve la venta original.
    if sale.idempotency_key:
        existing = (
            db.query(models.Sale)
            .filter(models.Sale.empresa_id == empresa_id)
            .filter(models.Sale.idempotency_key == sale.idempotency_key)
            .first()
        )
        if existing:
            return existing

    import json as _json
    _payment_details_str = (
        _json.dumps(sale.payment_details, ensure_ascii=False)
        if sale.payment_details else None
    )

    # Folio legible: se acepta override (NR-04 ya lo calculó) o se genera aquí.
    _folio = _folio_override or _nr04_next_sale_folio(db, empresa_id)
    target_sucursal = getattr(sale, "sucursal_id", None) or sucursal_id or "MATRIZ"

    db_sale = models.Sale(empresa_id=empresa_id,
        sucursal_id=target_sucursal,
        client_id=sale.client_id,
        total=sale.total,
        payment_method=sale.payment_method,
        amount_paid=sale.amount_paid,
        change_returned=sale.change_returned,
        is_cfdi=sale.is_cfdi,
        discount=sale.discount,
        advance=sale.advance,
        is_safekept=sale.is_safekept,
        idempotency_key=sale.idempotency_key,
        payment_details=_payment_details_str,
        seller_id=getattr(sale, "seller_id", None),
        project_id=getattr(sale, "project_id", None),
        folio=_folio,
        parent_sale_id=_parent_sale_id,
        canal_venta=getattr(sale, "canal_venta", None) or "mostrador",
        sucursal_entrega_id=getattr(sale, "sucursal_entrega_id", None),
        saldo_favor_applied=Decimal(str(getattr(sale, "saldo_favor_applied", 0) or 0)),
    )
    db.add(db_sale)
    db.flush()  # Obtain db_sale.id

    # E-06a: aplicar saldo_favor del cliente si se indicó en la venta.
    _sf_solicitado = Decimal(str(getattr(sale, "saldo_favor_applied", 0) or 0))
    if _sf_solicitado > 0 and sale.client_id:
        _sf_client = (db.query(models.Client)
                        .filter(models.Client.empresa_id == empresa_id,
                                models.Client.id == sale.client_id)
                        .with_for_update()
                        .first())
        if _sf_client:
            _sf_disponible = Decimal(str(_sf_client.saldo_favor or 0))
            _sf_aplicado = min(_sf_solicitado, _sf_disponible,
                               Decimal(str(sale.total)))
            if _sf_aplicado > 0:
                _sf_client.saldo_favor = _sf_disponible - _sf_aplicado
                db_sale.saldo_favor_applied = _sf_aplicado
                db.add(models.CustomerCreditLedger(
                    empresa_id=empresa_id,
                    client_id=sale.client_id,
                    amount=_sf_aplicado,
                    transaction_type="DEBIT",
                    sale_id=db_sale.id,
                    description=(
                        f"Saldo aplicado en venta "
                        f"#{db_sale.folio or db_sale.id[:8].upper()}"
                    ),
                ))

    warehouse = _get_or_create_default_warehouse(db, empresa_id, target_sucursal)
    _costo_vendido = Decimal("0")   # CMV real (solo lo efectivamente surtido)
    _resguardos    = []             # renglones que quedaron a resguardo (T-4a/N-01)

    for item in sale.items:
        costo, resguardo = _process_sale_item(
            db, empresa_id, db_sale, item, warehouse, is_safekept=sale.is_safekept
        )
        _costo_vendido += costo
        if resguardo:
            _resguardos.append(resguardo)

    if sale.payment_method == "006":
        _create_sale_credit(db, empresa_id, db_sale, sale)

    # Asiento contable automático (libro interno — partida doble SAT Anexo 24).
    # IVA implícito en el total (precio con IVA incluido es el estándar POS):
    #   total = base + base*tasa  →  base = total / (1 + tasa)
    _total_venta = Decimal(str(sale.total))
    if _total_venta >= Decimal("0"):
        _tasa_iva    = Decimal("0.16") if sale.is_cfdi else Decimal("0")
        if _tasa_iva > 0:
            _base_venta = (_total_venta / (1 + _tasa_iva)).quantize(Decimal("0.0001"))
            _total_iva  = (_total_venta - _base_venta).quantize(Decimal("0.0001"))
        else:
            _base_venta = _total_venta
            _total_iva  = Decimal("0")

        # CMV = solo lo efectivamente surtido; el del faltante se difiere a la entrega.
        generate_sale_entry(
            db             = db,
            empresa_id     = empresa_id,
            sucursal_id    = db_sale.sucursal_id or "MATRIZ",
            sale_id        = db_sale.id,
            total_venta    = _base_venta,
            total_iva      = _total_iva,
            total_costo    = _costo_vendido,
            payment_method = sale.payment_method,
            created_by     = sale.client_id,
            concepto       = f"Venta #{db_sale.id[:8].upper()}",
        )

    _post_sale_hooks(db, empresa_id, db_sale, sale, _resguardos)

    db.commit()
    db.refresh(db_sale)
    return db_sale


def create_sale_nr04_split(db, empresa_id: str, sale: schemas.SaleCreate, sucursal_id: str = "MATRIZ"):
    """Para ventas en efectivo > $2,000 MXN: divide en sub-facturas ≤ $2,000.

    Devuelve la factura raíz con `nr04_sub_sales` poblado.
    Si el total ≤ $2,000 o el método de pago no es efectivo, delega a create_sale.
    """
    _pm = (sale.payment_method or "").upper().strip()
    _total = Decimal(str(sale.total)) if sale.total else Decimal("0")

    if _pm not in ("EFECTIVO", "CASH", "EFE") or _total <= _NR04_LIMITE:
        result = create_sale(db, empresa_id, sale, sucursal_id=sucursal_id)
        result.nr04_sub_sales = []
        return result

    # Calcular el folio raíz antes de insertar cualquier venta.
    root_folio = _nr04_next_sale_folio(db, empresa_id)

    buckets = _nr04_split_items(sale.items)

    if len(buckets) <= 1:
        # Nada que dividir (items ya caben solos).
        result = create_sale(db, empresa_id, sale, sucursal_id=sucursal_id, _folio_override=root_folio)
        result.nr04_sub_sales = []
        return result

    # Construir schema auxiliar para sub-facturas (sin idempotency_key duplicada).
    import copy as _copy

    sub_sales_created = []
    suffix_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

    for idx, bucket in enumerate(buckets):
        sub_total = sum(Decimal(str(e["subtotal"])) for e in bucket)
        sub_letter = suffix_letters[idx] if idx < len(suffix_letters) else str(idx)
        sub_folio = f"{root_folio}-{sub_letter}"

        # Construir SaleCreate para este bucket.
        sub_items = []
        for entry in bucket:
            sub_items.append(schemas.SaleItemCreate(
                product_sku=entry["product_sku"],
                quantity=entry["quantity"],
                price=entry["price"],
                subtotal=entry["subtotal"],
            ))

        sub_sale_data = schemas.SaleCreate(
            client_id=sale.client_id,
            total=float(sub_total),
            payment_method=sale.payment_method,
            amount_paid=float(sub_total),
            change_returned=0.0,
            is_cfdi=sale.is_cfdi,
            discount=0.0,
            advance=getattr(sale, "advance", None),
            is_safekept=getattr(sale, "is_safekept", False),
            idempotency_key=None,
            payment_details=getattr(sale, "payment_details", None),
            seller_id=getattr(sale, "seller_id", None),
            project_id=getattr(sale, "project_id", None),
            items=sub_items,
        )

        parent_id = None if idx == 0 else sub_sales_created[0].id
        is_root = idx == 0

        db_sub = create_sale(
            db,
            empresa_id,
            sub_sale_data,
            sucursal_id=sucursal_id,
            _folio_override=sub_folio,
            _parent_sale_id=None if is_root else sub_sales_created[0].id,
        )
        sub_sales_created.append(db_sub)

    # La "raíz" es la primera sub-factura (folio sin sufijo de índice, e.g. "315-A").
    root_sale = sub_sales_created[0]
    root_sale.nr04_sub_sales = [
        {"id": s.id, "folio": s.folio, "total": float(s.total)}
        for s in sub_sales_created[1:]
    ]
    return root_sale


# --- ACCOUNTS RECEIVABLE (Cuentas por Cobrar) CRUD ---
def get_accounts_receivable(db: Session, empresa_id: str, client_id: Optional[int] = None,
                            status: Optional[str] = None, sucursal_id: Optional[str] = None):
    query = db.query(models.AccountsReceivable).filter(models.AccountsReceivable.empresa_id == empresa_id)
    if client_id is not None:
        query = query.filter(models.AccountsReceivable.client_id == client_id)
    if status:
        query = query.filter(models.AccountsReceivable.status == status)
    if sucursal_id:
        query = query.filter(models.AccountsReceivable.sucursal_id == sucursal_id)
    return query.order_by(models.AccountsReceivable.created_at.desc()).all()


def get_account_receivable(db: Session, empresa_id: str, ar_id: str):
    return (db.query(models.AccountsReceivable)
              .filter(models.AccountsReceivable.empresa_id == empresa_id,
                      models.AccountsReceivable.id == ar_id)
              .first())


def get_ar_payments(db: Session, empresa_id: str, ar_id: str):
    """Historial de abonos de una cuenta por cobrar (orden cronologico)."""
    return (db.query(models.AccountReceivablePayment)
              .filter(models.AccountReceivablePayment.empresa_id == empresa_id,
                      models.AccountReceivablePayment.ar_id == ar_id)
              .order_by(models.AccountReceivablePayment.created_at)
              .all())


# Origenes de fondos validos para un abono (ver AccountReceivablePayment).
AR_APPLIED_FROM = ("efectivo", "saldo_favor", "anticipo")


def _get_seller_commission_rate(db, empresa_id: str, employee_id: str) -> Decimal:
    """Tasa efectiva de comisión del vendedor (scope default o commission_factor).

    Usa la misma lógica que GET /api/sellers/{id}/commission-rate pero sin
    filtros de categoría/escala — toma solo la tasa base (default scope).
    """
    rules = (db.query(models.SellerCommissionRule)
               .filter(models.SellerCommissionRule.empresa_id == empresa_id,
                       models.SellerCommissionRule.employee_id == employee_id,
                       models.SellerCommissionRule.scope == "default",
                       models.SellerCommissionRule.scope_value == None)  # noqa: E711
               .first())
    if rules and rules.rate:
        return Decimal(str(rules.rate))
    emp = db.query(models.Employee).filter(
        models.Employee.empresa_id == empresa_id,
        models.Employee.id == employee_id,
        models.Employee.is_deleted == False,
    ).first()
    return Decimal(str(emp.commission_factor or 0)) if emp else Decimal("0")


def register_ar_payment(db: Session, empresa_id: str, ar_id: str, amount,
                        *, method: str = "efectivo", reference: Optional[str] = None,
                        applied_from: str = "efectivo", notes: Optional[str] = None,
                        created_by: Optional[str] = None,
                        idempotency_key: Optional[str] = None,
                        sucursal_id: Optional[str] = None):
    """Registra un abono a una cuenta por cobrar — reemplaza a
    `pay_account_receivable`, que solo restaba del saldo sin dejar rastro.

    Hace, en una sola transaccion:
      1. valida el abono contra el saldo vigente (no permite sobrepago);
      2. si `applied_from='saldo_favor'`, descuenta el saldo a favor del
         cliente y lo asienta en CustomerCreditLedger (DEBIT);
      3. inserta el AccountReceivablePayment con el saldo resultante congelado;
      4. baja `current_balance` y liquida la cuenta al llegar a cero;
      5. genera el asiento contable de partida doble del cobro.

    Idempotente por `idempotency_key`: un reintento con la misma key devuelve
    el abono ya registrado en vez de cobrar dos veces.
    """
    debt = get_account_receivable(db, empresa_id, ar_id)
    if not debt:
        raise ValueError("Debt record not found")

    applied_from = (applied_from or "efectivo").strip().lower()
    if applied_from not in AR_APPLIED_FROM:
        raise ValueError(
            f"applied_from invalido: '{applied_from}'. "
            f"Valores validos: {', '.join(AR_APPLIED_FROM)}."
        )

    # Idempotencia optimista: si ya existe un abono con esta key, devolverlo
    # tal cual (el UNIQUE de la tabla atrapa la carrera real en el commit).
    if idempotency_key:
        prev = (db.query(models.AccountReceivablePayment)
                  .filter(models.AccountReceivablePayment.empresa_id == empresa_id,
                          models.AccountReceivablePayment.idempotency_key == idempotency_key)
                  .first())
        if prev:
            return prev

    monto = Decimal(str(amount))
    if monto <= 0:
        raise ValueError("El monto del abono debe ser mayor a cero.")

    saldo = Decimal(str(debt.current_balance or 0))
    if saldo <= 0:
        raise ValueError("La cuenta ya esta liquidada; no admite mas abonos.")
    if monto > saldo:
        raise ValueError(
            f"El abono (${monto}) excede el saldo pendiente (${saldo}). "
            "Registre un abono menor o igual al saldo."
        )

    # ── Saldo a favor: el dinero sale de la bolsa del propio cliente ──────
    if applied_from == "saldo_favor":
        cli = get_client(db, empresa_id=empresa_id, client_id=debt.client_id)
        if not cli:
            raise ValueError("Cliente de la cuenta no encontrado.")
        disponible = Decimal(str(cli.saldo_favor or 0))
        if disponible < monto:
            raise ValueError(
                f"Saldo a favor insuficiente: disponible ${disponible}, "
                f"se intento aplicar ${monto}."
            )
        cli.saldo_favor = disponible - monto
        db.add(cli)
        db.add(models.CustomerCreditLedger(
            empresa_id=empresa_id,
            sucursal_id=debt.sucursal_id or "MATRIZ",
            client_id=debt.client_id,
            amount=float(-monto),
            transaction_type="DEBIT",
            sale_id=debt.sale_id,
            description=f"Saldo a favor aplicado a la cuenta {debt.sale_folio or debt.id[:8]}",
        ))

    nuevo_saldo = saldo - monto

    pago = models.AccountReceivablePayment(
        empresa_id=empresa_id,
        sucursal_id=sucursal_id or debt.sucursal_id or "MATRIZ",
        ar_id=debt.id,
        client_id=debt.client_id,
        amount=monto,
        method=(method or "efectivo").strip().lower(),
        reference=reference,
        applied_from=applied_from,
        balance_after=nuevo_saldo,
        notes=notes,
        created_by=created_by,
        idempotency_key=idempotency_key,
    )
    db.add(pago)

    debt.current_balance = nuevo_saldo
    if nuevo_saldo <= 0:
        debt.current_balance = Decimal("0")
        debt.status = "Liquidado"
        debt.is_paid = True
    db.add(debt)

    # ── Asiento contable del cobro (partida doble, SAT Anexo 24) ──────────
    #   Efectivo / anticipo : Debe 102.01 Caja      / Haber 105.01 Clientes
    #   Saldo a favor       : Debe 205.01 Anticipos / Haber 105.01 Clientes
    # (no toca 401.01 Ventas ni IVA: el ingreso ya se reconocio al vender —
    #  esto es solo la cobranza de una cuenta ya devengada).
    if applied_from == "saldo_favor":
        cuenta_debe, nombre_debe = "205.01", "Anticipos de clientes"
    else:
        cuenta_debe, nombre_debe = "102.01", "Caja"
    concepto = f"Abono cuenta {debt.sale_folio or debt.id[:8].upper()}"

    entry = models.AccountingEntry(
        empresa_id      = empresa_id,
        sucursal_id     = debt.sucursal_id or "MATRIZ",
        referencia_tipo = "COBRANZA",
        referencia_id   = debt.id,
        concepto        = concepto,
        total_debe      = monto,
        total_haber     = monto,
        status          = "POSTED",
        created_by      = created_by,
    )
    db.add(entry)
    db.flush()
    db.add(models.AccountingEntryLine(
        empresa_id=empresa_id, entry_id=entry.id,
        cuenta_sat=cuenta_debe, cuenta_nombre=nombre_debe,
        tipo_movimiento="DEBE", monto=monto,
        descripcion=f"Cobro en {nombre_debe} — {concepto}",
    ))
    db.add(models.AccountingEntryLine(
        empresa_id=empresa_id, entry_id=entry.id,
        cuenta_sat="105.01", cuenta_nombre="Clientes",
        tipo_movimiento="HABER", monto=monto,
        descripcion=f"Cancelacion de CxC — {concepto}",
    ))

    # ── Comisión al vendedor por recaudo (DA-7items, ítem 2) ─────────────────
    # Se calcula AQUÍ, sobre el monto efectivamente cobrado, no al momento de
    # la venta. Exclusiones automáticas:
    #   - canal_venta == 'caja': venta de mostrador/caja sin comisión (ítem 3)
    #   - rol del vendedor en ROLES_SIN_COMISION ('cajero'): ítem 4
    #   - applied_from == 'anticipo': el anticipo ya se cobró en la venta;
    #     no genera comisión doble (el pago original no era crédito).
    if applied_from != "anticipo" and debt.seller_id:
        _seller = db.query(models.Employee).filter(
            models.Employee.empresa_id == empresa_id,
            models.Employee.id == debt.seller_id,
            models.Employee.is_deleted == False,
        ).first()
        _sale_for_comm = (db.query(models.Sale).filter(
            models.Sale.empresa_id == empresa_id,
            models.Sale.id == debt.sale_id,
        ).first() if debt.sale_id else None)
        _canal = getattr(_sale_for_comm, "canal_venta", "mostrador") or "mostrador"
        _seller_role = getattr(_seller, "role", "") or ""
        _skip_commission = (
            _canal == "caja"
            or _seller_role in models.ROLES_SIN_COMISION
        )
        if _seller and not _skip_commission:
            _rate = _get_seller_commission_rate(db, empresa_id, debt.seller_id)
            if _rate and _rate > 0:
                _comm = (monto * Decimal(str(_rate)) / 100).quantize(Decimal("0.0001"))
                if _comm > 0:
                    db.add(models.SellerCommissionLedger(
                        id=str(__import__("uuid").uuid4()),
                        empresa_id=empresa_id,
                        employee_id=debt.seller_id,
                        entry_type="generated",
                        amount=_comm,
                        sale_id=debt.sale_id,
                        ar_payment_id=pago.id,
                        base_amount=monto,
                        rate_applied=_rate,
                        descripcion=(
                            f"Comisión por cobro venta "
                            f"{debt.sale_folio or (debt.sale_id or '')[:8].upper()} "
                            f"— abono ${monto}"
                        ),
                        registrado_por="system",
                    ))
                    if _seller.commission_balance is None:
                        _seller.commission_balance = Decimal("0")
                    _seller.commission_balance = (
                        Decimal(str(_seller.commission_balance)) + _comm
                    ).quantize(Decimal("0.0001"))
                    db.add(_seller)

    db.commit()
    db.refresh(pago)
    return pago


def pay_account_receivable(db: Session, empresa_id: str, debt_id: str, payment_amount: float):
    """COMPAT — firma vieja usada por el frontend previo a CP2.

    Delega en `register_ar_payment` (abono en efectivo, sin referencia) y
    devuelve la CUENTA, no el abono, como hacia antes. El endpoint nuevo
    `POST /api/accounts-receivable/{id}/payments` es el que debe usarse.
    """
    register_ar_payment(db, empresa_id, debt_id, payment_amount,
                        method="efectivo", applied_from="efectivo",
                        notes="Abono registrado por el endpoint legacy /pay")
    return get_account_receivable(db, empresa_id, debt_id)


# ── Antiguedad de saldos (aging) ────────────────────────────────────────────
# Cortes en dias vencidos. El bucket "por_vencer" agrupa lo que aun no llega a
# su fecha de vencimiento (incluye lo que no tiene due_date registrado).
AR_AGING_BUCKETS = ("por_vencer", "1-30", "31-60", "61-90", "90+")


def _aging_bucket(due_date, as_of: datetime) -> str:
    """Clasifica una cuenta por sus dias de vencimiento a la fecha de corte."""
    if not due_date:
        return "por_vencer"
    # El due_date puede venir naive (SQLite) o aware (Postgres); normalizar
    # antes de restar para no tronar con "can't subtract offset-naive and
    # offset-aware datetimes".
    dd = due_date
    if dd.tzinfo is None:
        dd = dd.replace(tzinfo=timezone.utc)
    ref = as_of if as_of.tzinfo else as_of.replace(tzinfo=timezone.utc)
    dias = (ref - dd).days
    if dias <= 0:
        return "por_vencer"
    if dias <= 30:
        return "1-30"
    if dias <= 60:
        return "31-60"
    if dias <= 90:
        return "61-90"
    return "90+"


def get_ar_aging(db: Session, empresa_id: str, *, sucursal_id: Optional[str] = None,
                 client_id: Optional[str] = None, as_of: Optional[datetime] = None):
    """Reporte de antiguedad de saldos de la cartera.

    Devuelve, por cliente, el saldo pendiente repartido en los buckets de
    AR_AGING_BUCKETS, mas el gran total del tenant. Solo considera cuentas con
    saldo vivo (`current_balance > 0`).
    """
    as_of = as_of or datetime.now(timezone.utc)

    q = (db.query(models.AccountsReceivable)
           .filter(models.AccountsReceivable.empresa_id == empresa_id,
                   models.AccountsReceivable.current_balance > 0))
    if sucursal_id:
        q = q.filter(models.AccountsReceivable.sucursal_id == sucursal_id)
    if client_id:
        q = q.filter(models.AccountsReceivable.client_id == client_id)
    cuentas = q.all()

    # Nombres de cliente en un solo SELECT (evita N+1 sobre la cartera).
    ids = {c.client_id for c in cuentas}
    nombres = {}
    if ids:
        for cid, nombre in (db.query(models.Client.id, models.Client.name)
                              .filter(models.Client.empresa_id == empresa_id,
                                      models.Client.id.in_(ids)).all()):
            nombres[cid] = nombre

    por_cliente: dict = {}
    totales = {b: Decimal("0") for b in AR_AGING_BUCKETS}

    for c in cuentas:
        saldo  = Decimal(str(c.current_balance or 0))
        bucket = _aging_bucket(c.due_date, as_of)
        fila = por_cliente.setdefault(c.client_id, {
            "client_id": c.client_id,
            "client_name": nombres.get(c.client_id) or c.client_id,
            "cuentas": 0,
            "total": Decimal("0"),
            "buckets": {b: Decimal("0") for b in AR_AGING_BUCKETS},
        })
        fila["cuentas"] += 1
        fila["total"]  += saldo
        fila["buckets"][bucket] += saldo
        totales[bucket] += saldo

    rows = sorted(por_cliente.values(), key=lambda r: r["total"], reverse=True)
    for r in rows:
        r["total"] = float(r["total"])
        r["buckets"] = {b: float(v) for b, v in r["buckets"].items()}

    return {
        "as_of": as_of.isoformat(),
        "buckets": list(AR_AGING_BUCKETS),
        "rows": rows,
        "totales": {b: float(v) for b, v in totales.items()},
        "total_cartera": float(sum(totales.values())),
        "cuentas": len(cuentas),
    }


# --- MATERIAL SAFEKEEPING (Resguardo de Material & Kardex) CRUD ---
def get_safekept_items(db: Session, empresa_id: str, client_id: Optional[int] = None):
    query = db.query(models.SafekeptItem).filter(models.SafekeptItem.empresa_id == empresa_id)
    if client_id is not None:
        # Join with sale to filter by client_id
        query = query.join(models.Sale).filter(models.Sale.client_id == client_id)
    return query.order_by(models.SafekeptItem.created_at.desc()).all()

def get_safekept_item(db: Session, empresa_id: str, item_id: int):
    return db.query(models.SafekeptItem).filter(models.SafekeptItem.empresa_id == empresa_id).filter(models.SafekeptItem.id == item_id).first()

def create_kardex_delivery(db: Session, empresa_id: str, delivery: schemas.KardexDeliveryCreate):
    safekept_item = db.query(models.SafekeptItem).filter(models.SafekeptItem.empresa_id == empresa_id).filter(models.SafekeptItem.id == delivery.safekept_item_id).first()
    if not safekept_item:
        raise ValueError("Safekept item record not found")

    # Fix 2026-08-10 (verificacion tras restaurar SafekeptItem/KardexDelivery
    # en models.py -- este codigo nunca se habia podido ejecutar de verdad
    # porque la tabla no existia, asi que este bug quedo sin detectar hasta
    # ahora): quantity_ordered/quantity_delivered son Numeric(15,4) -> el
    # ORM los entrega como decimal.Decimal, pero
    # schemas.KardexDeliveryCreate.quantity_delivered es float (Pydantic).
    # `Decimal += float` truena con TypeError explicito en Python (a
    # diferencia de las comparaciones < / >, que si mezclan ambos tipos sin
    # quejarse). Mismo patron ya usado en crud.create_sale para este
    # problema: normalizar a Decimal via str() antes de operar.
    qty_delivered = Decimal(str(delivery.quantity_delivered))

    # Validate delivery logic
    available_to_deliver = safekept_item.quantity_ordered - safekept_item.quantity_delivered
    if qty_delivered > available_to_deliver:
        raise ValueError(f"Cannot deliver {qty_delivered} units. Only {available_to_deliver} units pending.")

    # 1. Update delivery quantities in safekept record
    safekept_item.quantity_delivered += qty_delivered
    if safekept_item.quantity_delivered >= safekept_item.quantity_ordered:
        safekept_item.status = "Entregado"
    db.add(safekept_item)

    # 2. Deduct inventory stock (as materials physically leave warehouse now)
    product = db.query(models.Product).filter(models.Product.empresa_id == empresa_id).filter(models.Product.sku == safekept_item.product_sku).first()
    if product:
        product.stock -= qty_delivered
        db.add(product)

    # 3. Create Kardex Delivery entry log
    db_delivery = models.KardexDelivery(empresa_id=empresa_id, 
        safekept_item_id=delivery.safekept_item_id,
        quantity_delivered=qty_delivered,
        notes=delivery.notes
    )
    db.add(db_delivery)

    db.commit()
    db.refresh(safekept_item)
    return db_delivery


# =============================================================================
# RESGUARDOS — ciclo de vida (D.1: T-4d ETA, T-4e recepción, T-4g vencimiento,
# T-4h ajuste → anticipo). Ver [[calebsys-flujo-resguardo-por-faltante]].
# =============================================================================

SAFEKEPT_CERRADOS = ("ENTREGADO", "Entregado", "AJUSTADO", "VENCIDO")


def attach_resguardos(db: Session, empresa_id: str, db_sale) -> None:
    """T-4f: adjunta a la venta los renglones a resguardo (leyenda POS/ticket)."""
    try:
        rows = (
            db.query(models.SafekeptItem)
            .filter(models.SafekeptItem.empresa_id == empresa_id)
            .filter(models.SafekeptItem.sale_id == db_sale.id)
            .all()
        )
        db_sale.resguardos = [
            {
                "id": r.id,
                "product_sku": r.product_sku,
                "quantity_pending": float((r.quantity_ordered or 0) - (r.quantity_delivered or 0)),
                "status": r.status,
                "eta_date": r.eta_date,
            }
            for r in rows
        ]
    except Exception:
        db_sale.resguardos = []


def _resguardo_cliente(db: Session, empresa_id: str, sale_id: str):
    """(client, sale) del resguardo — para avisar por WhatsApp / acreditar anticipo."""
    sale = (
        db.query(models.Sale)
        .filter(models.Sale.empresa_id == empresa_id, models.Sale.id == sale_id)
        .first()
    )
    if not sale:
        return None, None
    client = (
        db.query(models.Client)
        .filter(models.Client.empresa_id == empresa_id, models.Client.id == sale.client_id)
        .first()
    )
    return client, sale


def _wa_cliente(db: Session, empresa_id: str, client, texto: str, contexto: str) -> None:
    """Aviso best-effort al cliente por WhatsApp. No revienta si no hay canal."""
    try:
        if client and getattr(client, "whatsapp", None):
            from services import whatsapp as _wa
            _wa.send_whatsapp(db, empresa_id, client.whatsapp, texto,
                              created_by="sistema", context=contexto)
    except Exception:
        pass


def get_resguardos(db: Session, empresa_id: str, status: Optional[str] = None,
                   client_id: Optional[str] = None, abiertos: bool = False) -> list:
    """Lista de resguardos con datos del cliente resueltos para la UI."""
    q = (
        db.query(models.SafekeptItem, models.Sale.client_id,
                 models.Client.name.label("client_name"),
                 models.Client.whatsapp.label("client_whatsapp"))
        .join(models.Sale, (models.SafekeptItem.sale_id == models.Sale.id) &
                            (models.SafekeptItem.empresa_id == models.Sale.empresa_id))
        .outerjoin(models.Client, (models.Sale.client_id == models.Client.id) &
                                   (models.Sale.empresa_id == models.Client.empresa_id))
        .filter(models.SafekeptItem.empresa_id == empresa_id)
    )
    if status:
        q = q.filter(models.SafekeptItem.status == status)
    elif abiertos:
        q = q.filter(models.SafekeptItem.status.in_(SAFEKEPT_ABIERTOS))
    if client_id:
        q = q.filter(models.Sale.client_id == client_id)
    rows = q.order_by(models.SafekeptItem.created_at.desc()).all()
    out = []
    for sk, client_id_, client_name, client_wa in rows:
        pend = float((sk.quantity_ordered or 0) - (sk.quantity_delivered or 0))
        out.append({
            "id": sk.id,
            "sale_id": sk.sale_id,
            "product_sku": sk.product_sku,
            "status": sk.status,
            "origen": sk.origen,
            "quantity_ordered": float(sk.quantity_ordered or 0),
            "quantity_delivered": float(sk.quantity_delivered or 0),
            "quantity_pending": pend,
            "costo_estimado": float(sk.costo_estimado) if sk.costo_estimado is not None else None,
            "eta_date": sk.eta_date,
            "expira_at": sk.expira_at.isoformat() if sk.expira_at else None,
            "created_at": sk.created_at.isoformat() if sk.created_at else None,
            "client_id": client_id_,
            "client_name": client_name,
            "client_whatsapp": client_wa,
        })
    return out


def set_resguardo_eta(db: Session, empresa_id: str, resguardo_id: str,
                      eta_date: str, expira_at: Optional[str] = None,
                      dias_resguardo: int = 15, actor: str = "sistema") -> dict:
    """T-4d: Compras/Admin fijan la ETA. SOLICITADO → ETA_CONFIRMADA."""
    from datetime import datetime as _dt, timedelta as _td
    sk = get_safekept_item(db, empresa_id, resguardo_id)
    if not sk:
        raise ValueError("Resguardo no encontrado")
    if sk.status in SAFEKEPT_CERRADOS:
        raise ValueError(f"El resguardo está {sk.status}; no admite ETA.")

    sk.eta_date = eta_date
    if expira_at:
        try:
            sk.expira_at = _dt.fromisoformat(expira_at.replace("Z", ""))
        except Exception:
            sk.expira_at = None
    if sk.expira_at is None:
        try:
            sk.expira_at = _dt.fromisoformat(eta_date) + _td(days=dias_resguardo)
        except Exception:
            sk.expira_at = _dt.utcnow() + _td(days=dias_resguardo)
    if sk.status in ("SOLICITADO", "Pendiente", "POR_VENCER"):
        sk.status = "ETA_CONFIRMADA"
    db.add(sk)

    client, _ = _resguardo_cliente(db, empresa_id, sk.sale_id)
    push_notification(
        db, empresa_id, tipo="resguardo_eta_confirmada", severidad="INFO",
        titulo=f"ETA fijada — {sk.product_sku}",
        cuerpo=f"El resguardo de {sk.product_sku} llega aprox. {eta_date}.",
        roles_dest=RESGUARDO_ROLES_DEST, ref_tipo="safekept", ref_id=sk.id,
        meta={"eta_date": eta_date},
    )
    _wa_cliente(db, empresa_id, client,
                f"Tu pedido de {sk.product_sku} queda en resguardo. Fecha estimada de "
                f"llegada: {eta_date}. Te avisamos cuando esté listo para recoger.",
                "resguardo_eta")
    db.commit()
    db.refresh(sk)
    return {"ok": True, "id": sk.id, "status": sk.status, "eta_date": sk.eta_date,
            "expira_at": sk.expira_at.isoformat() if sk.expira_at else None}


def promote_resguardos_por_sku(db: Session, empresa_id: str, skus, sucursal_id: str = "MATRIZ") -> list:
    """T-4e: al recibir mercancía de estos SKUs, los resguardos abiertos pasan
    a EN_INVENTARIO y se notifica (interno + WhatsApp al cliente). No hace
    commit — lo hace el caller dentro de la transacción de recepción."""
    skus = [s for s in {*(skus or [])} if s]
    if not skus:
        return []
    rows = (
        db.query(models.SafekeptItem)
        .filter(models.SafekeptItem.empresa_id == empresa_id)
        .filter(models.SafekeptItem.product_sku.in_(skus))
        .filter(models.SafekeptItem.status.in_(["SOLICITADO", "ETA_CONFIRMADA", "POR_VENCER", "Pendiente"]))
        .all()
    )
    tocados = []
    for sk in rows:
        sk.status = "EN_INVENTARIO"
        db.add(sk)
        tocados.append({"id": sk.id, "sku": sk.product_sku, "sale_id": sk.sale_id})
        client, _ = _resguardo_cliente(db, empresa_id, sk.sale_id)
        push_notification(
            db, empresa_id, tipo="resguardo_en_inventario", severidad="INFO",
            titulo=f"Mercancía recibida para resguardo — {sk.product_sku}",
            cuerpo=f"El resguardo de {sk.product_sku} ya está en inventario, listo para entrega.",
            roles_dest=RESGUARDO_ROLES_DEST, sucursal_id=sucursal_id,
            ref_tipo="safekept", ref_id=sk.id,
        )
        _wa_cliente(db, empresa_id, client,
                    f"¡Buenas noticias! Tu producto {sk.product_sku} ya llegó y está "
                    f"listo para que lo pases a recoger.",
                    "resguardo_llego")
    return tocados


def ajustar_resguardo(db: Session, empresa_id: str, resguardo_id: str,
                      motivo: str, actor: str = "sistema") -> dict:
    """T-4h / C-4: Almacén ajusta un resguardo no entregado. Estado → AJUSTADO
    y el valor de lo pendiente se acredita al cliente como Anticipo
    (clients.saldo_favor) con su registro en CustomerCreditLedger."""
    sk = get_safekept_item(db, empresa_id, resguardo_id)
    if not sk:
        raise ValueError("Resguardo no encontrado")
    if sk.status in SAFEKEPT_CERRADOS:
        raise ValueError(f"El resguardo ya está {sk.status}.")

    pend = Decimal(str(sk.quantity_ordered or 0)) - Decimal(str(sk.quantity_delivered or 0))
    client, sale = _resguardo_cliente(db, empresa_id, sk.sale_id)

    # Valor a acreditar = cantidad pendiente * precio de venta del renglón
    precio = Decimal("0")
    si = (
        db.query(models.SaleItem)
        .filter(models.SaleItem.empresa_id == empresa_id)
        .filter(models.SaleItem.sale_id == sk.sale_id)
        .filter(models.SaleItem.product_sku == sk.product_sku)
        .first()
    )
    if si and si.price is not None:
        precio = Decimal(str(si.price))
    valor = (pend * precio).quantize(Decimal("0.01"))

    sk.status = "AJUSTADO"
    db.add(sk)

    credito_aplicado = 0.0
    if client and valor > 0:
        client.saldo_favor = (client.saldo_favor or Decimal("0")) + valor
        db.add(client)
        db.add(models.CustomerCreditLedger(
            empresa_id=empresa_id, client_id=client.id, amount=float(valor),
            transaction_type="CREDIT", sale_id=sk.sale_id,
            description=f"Ajuste de resguardo {sk.product_sku} ({motivo}) → anticipo",
        ))
        credito_aplicado = float(valor)

    push_notification(
        db, empresa_id, tipo="resguardo_ajustado", severidad="WARNING",
        titulo=f"Resguardo ajustado — {sk.product_sku}",
        cuerpo=(f"{motivo}. Se acreditó ${credito_aplicado:,.2f} como anticipo "
                f"al cliente {getattr(client, 'name', '—')}."),
        roles_dest=RESGUARDO_ROLES_DEST, ref_tipo="safekept", ref_id=sk.id,
        meta={"motivo": motivo, "credito": credito_aplicado},
    )
    _wa_cliente(db, empresa_id, client,
                f"Tu resguardo de {sk.product_sku} no pudo completarse ({motivo}). "
                f"Acreditamos ${credito_aplicado:,.2f} a tu saldo a favor para tu "
                f"próxima compra.",
                "resguardo_ajuste")
    db.commit()
    db.refresh(sk)
    return {"ok": True, "id": sk.id, "status": sk.status,
            "credito_anticipo": credito_aplicado}


def partial_withdraw_safekept(
    db: Session, empresa_id: str, safekept_id: str,
    quantity: float, notes: str = "", actor: str = "sistema",
) -> dict:
    """E-03a: entrega parcial o total de un resguardo.

    Actualiza quantity_delivered, descuenta stock del inventario y registra
    un KardexDelivery. Si quantity_delivered >= quantity_ordered → ENTREGADO.
    """
    sk = get_safekept_item(db, empresa_id, safekept_id)
    if not sk:
        raise ValueError("Resguardo no encontrado")
    if sk.status in SAFEKEPT_CERRADOS:
        raise ValueError(f"El resguardo ya está {sk.status} — no se puede entregar más.")

    qty = Decimal(str(quantity))
    if qty <= 0:
        raise ValueError("La cantidad debe ser mayor a cero")

    pending = Decimal(str(sk.quantity_ordered or 0)) - Decimal(str(sk.quantity_delivered or 0))
    if qty > pending + Decimal("0.0001"):
        raise ValueError(
            f"Solo quedan {float(pending):.4f} unidades pendientes; "
            f"no se puede entregar {float(qty):.4f}"
        )

    sk.quantity_delivered = Decimal(str(sk.quantity_delivered)) + qty
    full_delivery = sk.quantity_delivered >= Decimal(str(sk.quantity_ordered)) - Decimal("0.0001")
    if full_delivery:
        sk.status = "ENTREGADO"
    db.add(sk)

    product = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id,
                models.Product.sku == sk.product_sku)
        .first()
    )
    if product and product.stock is not None:
        product.stock = max(Decimal("0"), Decimal(str(product.stock)) - qty)
        db.add(product)

    db.add(models.KardexDelivery(
        empresa_id=empresa_id,
        safekept_item_id=sk.id,
        quantity_delivered=qty,
        notes=notes or f"Retiro parcial — actor: {actor}",
    ))

    client, _ = _resguardo_cliente(db, empresa_id, sk.sale_id)
    if full_delivery:
        push_notification(
            db, empresa_id,
            tipo="resguardo_entregado",
            severidad="INFO",
            titulo=f"Resguardo entregado — {sk.product_sku}",
            cuerpo=(f"Entrega completa del resguardo {sk.product_sku} "
                    f"al cliente {getattr(client, 'name', '—')}."),
            roles_dest=RESGUARDO_ROLES_DEST,
            ref_tipo="safekept", ref_id=sk.id,
            meta={"qty_delivered": float(qty), "actor": actor},
        )
        _wa_cliente(
            db, empresa_id, client,
            f"Tu resguardo de {sk.product_sku} ya está listo y fue entregado. "
            f"Gracias por tu preferencia.",
            "resguardo_entregado",
        )

    db.commit()
    db.refresh(sk)
    qty_pending = float(Decimal(str(sk.quantity_ordered)) - Decimal(str(sk.quantity_delivered)))
    return {
        "id": sk.id,
        "product_sku": sk.product_sku,
        "status": sk.status,
        "quantity_ordered": float(sk.quantity_ordered),
        "quantity_delivered": float(sk.quantity_delivered),
        "quantity_pending": max(0.0, qty_pending),
        "delivered_now": float(qty),
        "full_delivery": full_delivery,
    }


def escanear_vencimientos_resguardo(db: Session, empresa_id: str,
                                    dias_aviso: int = 3) -> dict:
    """T-4g / N-05: marca POR_VENCER los resguardos cuyo expira_at cae dentro
    de `dias_aviso` días y alerta a Almacén + Admin + WhatsApp al cliente."""
    from datetime import datetime as _dt, timedelta as _td
    limite = _dt.utcnow() + _td(days=dias_aviso)
    rows = (
        db.query(models.SafekeptItem)
        .filter(models.SafekeptItem.empresa_id == empresa_id)
        .filter(models.SafekeptItem.status.in_(["ETA_CONFIRMADA", "EN_INVENTARIO", "SOLICITADO"]))
        .filter(models.SafekeptItem.expira_at.isnot(None))
        .filter(models.SafekeptItem.expira_at <= limite)
        .all()
    )
    marcados = []
    for sk in rows:
        sk.status = "POR_VENCER"
        db.add(sk)
        client, _ = _resguardo_cliente(db, empresa_id, sk.sale_id)
        push_notification(
            db, empresa_id, tipo="resguardo_por_vencer", severidad="WARNING",
            titulo=f"Resguardo por vencer — {sk.product_sku}",
            cuerpo=(f"El resguardo de {sk.product_sku} vence el "
                    f"{sk.expira_at.date().isoformat() if sk.expira_at else '—'}. "
                    f"Contactar al cliente."),
            roles_dest=RESGUARDO_ROLES_DEST, ref_tipo="safekept", ref_id=sk.id,
        )
        _wa_cliente(db, empresa_id, client,
                    f"Tu resguardo de {sk.product_sku} está por vencer. Comunícate con "
                    f"nosotros para coordinar la entrega o extender el plazo.",
                    "resguardo_por_vencer")
        marcados.append({"id": sk.id, "sku": sk.product_sku})
    db.commit()
    return {"ok": True, "marcados": len(marcados), "items": marcados}


def vencer_resguardos_expirados(db: Session, empresa_id: str) -> dict:
    """E-03b: cierra como VENCIDO los resguardos cuyo expira_at ya pasó.

    Misma lógica que ajustar_resguardo: el valor pendiente se acredita al
    cliente como saldo_favor. Llamar desde cron o el endpoint admin.
    """
    now = datetime.now(timezone.utc)
    rows = (
        db.query(models.SafekeptItem)
        .filter(models.SafekeptItem.empresa_id == empresa_id)
        .filter(models.SafekeptItem.status.in_(SAFEKEPT_ABIERTOS))
        .filter(models.SafekeptItem.expira_at.isnot(None))
        .filter(models.SafekeptItem.expira_at <= now)
        .all()
    )

    vencidos = []
    for sk in rows:
        pend = Decimal(str(sk.quantity_ordered or 0)) - Decimal(str(sk.quantity_delivered or 0))
        client, _ = _resguardo_cliente(db, empresa_id, sk.sale_id)

        credito = Decimal("0")
        if pend > 0 and client:
            si = (
                db.query(models.SaleItem)
                .filter(models.SaleItem.empresa_id == empresa_id,
                        models.SaleItem.sale_id == sk.sale_id,
                        models.SaleItem.product_sku == sk.product_sku)
                .first()
            )
            precio = Decimal(str(si.price)) if si and si.price is not None else Decimal("0")
            credito = (pend * precio).quantize(Decimal("0.01"))
            if credito > 0:
                client.saldo_favor = (client.saldo_favor or Decimal("0")) + credito
                db.add(client)
                db.add(models.CustomerCreditLedger(
                    empresa_id=empresa_id, client_id=client.id, amount=float(credito),
                    transaction_type="CREDIT", sale_id=sk.sale_id,
                    description=f"Vencimiento de resguardo {sk.product_sku} → anticipo",
                ))

        sk.status = "VENCIDO"
        db.add(sk)

        push_notification(
            db, empresa_id, tipo="resguardo_vencido", severidad="WARNING",
            titulo=f"Resguardo vencido — {sk.product_sku}",
            cuerpo=(f"Resguardo de {sk.product_sku} expiró. "
                    f"Se acreditaron ${float(credito):,.2f} al cliente "
                    f"{getattr(client, 'name', '—')} como anticipo."),
            roles_dest=RESGUARDO_ROLES_DEST, ref_tipo="safekept", ref_id=sk.id,
            meta={"credito": float(credito)},
        )
        _wa_cliente(
            db, empresa_id, client,
            f"Tu resguardo de {sk.product_sku} expiró. Acreditamos "
            f"${float(credito):,.2f} a tu saldo a favor para tu próxima compra.",
            "resguardo_vencido",
        )
        vencidos.append({"id": sk.id, "sku": sk.product_sku, "credito": float(credito)})

    db.commit()
    return {"ok": True, "vencidos": len(vencidos), "items": vencidos}


def prorrogar_resguardo(
    db: Session, empresa_id: str, resguardo_id: str,
    days: int, motivo: str = "", actor: str = "sistema",
) -> dict:
    """E-03b: prórroga — extiende expira_at de un resguardo abierto.

    Permite al admin dar más tiempo a un resguardo POR_VENCER o cualquier
    estado abierto. Si el resguardo estaba POR_VENCER lo devuelve a
    ETA_CONFIRMADA (o SOLICITADO si no tiene ETA) para que deje de aparecer
    en alertas.
    """
    sk = get_safekept_item(db, empresa_id, resguardo_id)
    if not sk:
        raise ValueError("Resguardo no encontrado")
    if sk.status in SAFEKEPT_CERRADOS:
        raise ValueError(f"El resguardo ya está {sk.status}; no admite prórroga.")
    if days <= 0:
        raise ValueError("'days' debe ser mayor a cero")

    base = max(
        datetime.now(timezone.utc),
        sk.expira_at if sk.expira_at and sk.expira_at > datetime.now(timezone.utc)
        else datetime.now(timezone.utc),
    )
    sk.expira_at = base + timedelta(days=days)

    if sk.status == "POR_VENCER":
        sk.status = "ETA_CONFIRMADA" if sk.eta_date else "SOLICITADO"
    db.add(sk)

    client, _ = _resguardo_cliente(db, empresa_id, sk.sale_id)
    nueva_fecha = sk.expira_at.date().isoformat()
    push_notification(
        db, empresa_id, tipo="resguardo_prorrogado", severidad="INFO",
        titulo=f"Resguardo prorrogado — {sk.product_sku}",
        cuerpo=(f"Nueva fecha de vencimiento: {nueva_fecha}. "
                f"Motivo: {motivo or 'sin motivo'}. Actor: {actor}."),
        roles_dest=RESGUARDO_ROLES_DEST, ref_tipo="safekept", ref_id=sk.id,
        meta={"days": days, "nueva_fecha": nueva_fecha, "motivo": motivo},
    )
    _wa_cliente(
        db, empresa_id, client,
        f"El plazo de tu resguardo de {sk.product_sku} fue extendido hasta "
        f"{nueva_fecha}. {motivo}",
        "resguardo_prorroga",
    )
    db.commit()
    db.refresh(sk)
    return {
        "ok": True, "id": sk.id, "product_sku": sk.product_sku,
        "status": sk.status, "expira_at": sk.expira_at.isoformat(),
        "days_added": days,
    }


# --- BRANCH WAREHOUSE TRANSFERS CRUD ---
def create_transfer(db: Session, empresa_id: str, transfer: schemas.TransferLogCreate):
    """Traspaso real entre bodegas (fix C2, auditoria 2026-08-03).

    Reemplaza la implementacion anterior, que referenciaba models.TransferLog
    -- clase que NUNCA existio en este models.py. La unica huella que dejo
    fue el guard `hasattr(models, "TransferLog")` en main.py (siempre
    False), que por eso forzaba SIEMPRE la rama "legacy SQLite" -- incluso
    corriendo contra Postgres oficial -- ejecutando raw SQL contra una
    tabla 'transfer_logs' que tampoco existe ahi. O sea: create_transfer no
    solo descontaba stock sin sumarlo a ningun lado (C2 original); el
    registro de bitacora que "compensaba" eso tronaba con AttributeError
    antes de llegar siquiera a esa linea. Se reemplaza por completo: el
    traspaso ahora mueve cantidades reales entre dos filas de
    warehouse_stock y deja dos InventoryMovement (TRASPASO_SALIDA /
    TRASPASO_ENTRADA), igual que el traspaso virtual automatico usado
    dentro de create_sale.
    """
    product = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id)
        .filter(models.Product.sku == transfer.product_sku)
        .first()
    )
    if not product:
        raise ValueError(f"Product SKU {transfer.product_sku} not found")

    qty = Decimal(str(transfer.quantity))
    if qty <= 0:
        raise ValueError("La cantidad a traspasar debe ser mayor a cero")

    source_warehouse = (
        _get_warehouse_by_id(db, empresa_id, transfer.source_warehouse_id)
        if transfer.source_warehouse_id
        else _get_or_create_default_warehouse(db, empresa_id)
    )
    if not source_warehouse:
        raise ValueError(f"Bodega origen {transfer.source_warehouse_id} no existe")
    dest_warehouse = _get_warehouse_by_id(db, empresa_id, transfer.destination_warehouse_id)
    if not dest_warehouse:
        raise ValueError(f"Bodega destino {transfer.destination_warehouse_id} no existe")
    if source_warehouse.id == dest_warehouse.id:
        raise ValueError("La bodega origen y destino no pueden ser la misma")

    source_stock = _get_or_create_warehouse_stock(db, empresa_id, product.id, source_warehouse.id)
    if source_stock.quantity < qty:
        raise ValueError(
            f"Stock insuficiente en bodega origen para SKU {transfer.product_sku}: "
            f"disponible {source_stock.quantity}, solicitado {qty}"
        )
    dest_stock = _get_or_create_warehouse_stock(db, empresa_id, product.id, dest_warehouse.id)

    source_stock.quantity = source_stock.quantity - qty
    dest_stock.quantity = dest_stock.quantity + qty
    db.add(source_stock)
    db.add(dest_stock)
    # Product.stock (total cacheado) no cambia: el traspaso mueve unidades
    # entre bodegas del mismo tenant, no altera el total.

    stamp = datetime.utcnow().isoformat()
    salida = models.InventoryMovement(
        empresa_id=empresa_id, sucursal_id=source_warehouse.sucursal_id,
        product_id=product.id, warehouse_id=source_warehouse.id,
        movement_type="TRASPASO_SALIDA", quantity=qty,
        unit_cost=product.average_cost, reference_type="TRASPASO",
        reference_id=dest_warehouse.id,
        idempotency_key=f"TRASPASO:{product.id}:{source_warehouse.id}:{dest_warehouse.id}:{stamp}",
    )
    db.add(salida)
    db.flush()
    entrada = models.InventoryMovement(
        empresa_id=empresa_id, sucursal_id=dest_warehouse.sucursal_id,
        product_id=product.id, warehouse_id=dest_warehouse.id,
        movement_type="TRASPASO_ENTRADA", quantity=qty,
        unit_cost=product.average_cost, reference_type="TRASPASO",
        reference_id=source_warehouse.id,
        idempotency_key=f"{salida.idempotency_key}:ENTRADA",
    )
    db.add(entrada)

    db.commit()
    db.refresh(entrada)
    return entrada

def get_transfers(db: Session, empresa_id: str, limit: int = 100, offset: int = 0):
    """Lista traspasos reales desde InventoryMovement (ver create_transfer
    para el porque ya no se usa models.TransferLog, que nunca existio).
    Se agrupa por el lado TRASPASO_ENTRADA (uno por traspaso) y se resuelve
    el SKU, nombre del producto y los nombres de bodega.
    """
    q = (
        db.query(models.InventoryMovement, models.Product.sku, models.Product.name.label("product_name"))
        .join(models.Product, (models.InventoryMovement.product_id == models.Product.id) &
                               (models.InventoryMovement.empresa_id == models.Product.empresa_id))
        .filter(models.InventoryMovement.empresa_id == empresa_id)
        .filter(models.InventoryMovement.movement_type == "TRASPASO_ENTRADA")
        .order_by(models.InventoryMovement.created_at.desc())
    )
    total = q.count()
    rows  = q.offset(offset).limit(min(limit, _MAX_LIMIT)).all()

    warehouse_ids = {mv.warehouse_id for mv, _, _ in rows} | {mv.reference_id for mv, _, _ in rows}
    warehouses = {
        w.id: w.name
        for w in db.query(models.Warehouse)
        .filter(models.Warehouse.empresa_id == empresa_id)
        .filter(models.Warehouse.id.in_(warehouse_ids))
        .all()
    } if warehouse_ids else {}

    items = [
        {
            "id": mv.id,
            "product_sku": sku,
            "product_name": product_name,
            "quantity": float(mv.quantity),
            "source_warehouse_id": mv.reference_id,
            "source_warehouse_name": warehouses.get(mv.reference_id),
            "destination_warehouse_id": mv.warehouse_id,
            "destination_warehouse_name": warehouses.get(mv.warehouse_id),
            "destination": warehouses.get(mv.warehouse_id),
            "created_at": mv.created_at,
        }
        for mv, sku, product_name in rows
    ]
    return {"total": total, "items": items}


# =============================================================================
# MÓDULO ALMACÉN — Fase 2
# Entradas de mercancía, Devoluciones de venta (fix), Ajustes de inventario,
# CRUD de Bodegas, Stock por bodega, Kardex con filtros.
# =============================================================================

# ---------------------------------------------------------------------------
# FIX: register_product_return — reemplaza la implementación anterior
#
# Bugs encontrados en la versión original (2026-08-12):
#   1. No registraba InventoryMovement — el Kardex quedaba ciego a la devolución.
#   2. Solo tocaba Product.stock global, no WarehouseStock — la bodega no
#      recuperaba el stock y el próximo traspaso automático usaba datos stale.
#   3. No generaba asiento contable de reverso — el libro interno quedaba
#      descuadrado (la venta tenía su asiento pero la devolución no tenía
#      el asiento de contrapartida).
#   4. register_return_batch llamado desde el endpoint no existía en crud.
# ---------------------------------------------------------------------------
def register_product_return(
    db: Session,
    empresa_id: str,
    sale_id: str,
    product_sku: str,
    quantity_returned: float,
    notes: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    authorized_by_id: Optional[str] = None,
) -> dict:
    """Devuelve unidades de un renglón de venta al inventario.

    Flujo:
      1. Valida que el renglón existe y que la cantidad a devolver no
         supera lo disponible (quantity - returned_quantity).
      2. Actualiza SaleItem.returned_quantity.
      3. Restaura WarehouseStock en la bodega indicada (o la predeterminada).
      4. Actualiza Product.stock (total cacheado).
      5. Registra InventoryMovement tipo DEVOLUCION_VENTA (Kardex).
      6. Si era crédito (006), reduce la CxC en el monto del reembolso.
      7. Genera asiento contable de reverso (contrapartida del asiento
         original de venta).
      8. Commit único — todo o nada.
    """
    qty = Decimal(str(quantity_returned))
    if qty <= 0:
        raise ValueError("La cantidad a devolver debe ser mayor a cero")

    # 1. Renglón de venta
    sale_item = (
        db.query(models.SaleItem)
        .filter(models.SaleItem.empresa_id == empresa_id)
        .filter(models.SaleItem.sale_id == sale_id)
        .filter(models.SaleItem.product_sku == product_sku)
        .first()
    )
    if not sale_item:
        raise ValueError(f"Renglón SKU {product_sku} no encontrado en venta {sale_id}")

    disponible = Decimal(str(sale_item.quantity)) - Decimal(str(sale_item.returned_quantity))
    if qty > disponible:
        raise ValueError(
            f"No se pueden devolver {qty} unidades de SKU {product_sku}. "
            f"Máximo disponible para devolución: {disponible}"
        )

    sale_item.returned_quantity = Decimal(str(sale_item.returned_quantity)) + qty
    db.add(sale_item)

    # 2. Producto con lock
    product = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id)
        .filter(models.Product.sku == product_sku)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if not product:
        raise ValueError(f"Producto SKU {product_sku} no encontrado")

    # 3. WarehouseStock — bodega de retorno
    warehouse = (
        _get_warehouse_by_id(db, empresa_id, warehouse_id)
        if warehouse_id
        else _get_or_create_default_warehouse(db, empresa_id)
    )
    wstock = _get_or_create_warehouse_stock(db, empresa_id, product.id, warehouse.id)
    wstock.quantity = wstock.quantity + qty
    db.add(wstock)

    # 4. Product.stock total cacheado
    product.stock = product.stock + qty
    db.add(product)

    # 5. Kardex DEVOLUCION_VENTA
    db.add(models.InventoryMovement(
        empresa_id=empresa_id,
        sucursal_id=warehouse.sucursal_id if hasattr(warehouse, "sucursal_id") else "MATRIZ",
        product_id=product.id,
        warehouse_id=warehouse.id,
        movement_type="DEVOLUCION_VENTA",
        quantity=qty,
        unit_cost=Decimal(str(sale_item.price)),
        reference_type="TICKET_VENTA",
        reference_id=sale_id,
        idempotency_key=f"DEVOL:{sale_id}:{product_sku}:{sale_item.returned_quantity}",
        reason=notes,
        authorized_by_id=authorized_by_id,
    ))

    # 6. Venta y CxC
    sale = (
        db.query(models.Sale)
        .filter(models.Sale.empresa_id == empresa_id)
        .filter(models.Sale.id == sale_id)
        .first()
    )
    refund_amount = qty * Decimal(str(sale_item.price))
    if sale:
        sale.total = max(Decimal("0"), Decimal(str(sale.total)) - refund_amount)
        db.add(sale)
        if sale.payment_method == "006":
            debt = (
                db.query(models.AccountsReceivable)
                .filter(models.AccountsReceivable.empresa_id == empresa_id)
                .filter(models.AccountsReceivable.sale_id == sale_id)
                .first()
            )
            if debt:
                debt.current_balance = max(Decimal("0"), Decimal(str(debt.current_balance)) - refund_amount)
                if debt.current_balance <= 0:
                    debt.status = "Liquidado"
                db.add(debt)

    # 7. Asiento de reverso (contrapartida del asiento original)
    #    La devolución invierte el ingreso y restaura el inventario al costo.
    #    IVA: si la venta original era CFDI se revierte el IVA implícito.
    _tasa_iva   = Decimal("0.16") if (sale and sale.is_cfdi) else Decimal("0")
    if _tasa_iva > 0:
        _base_dev = (refund_amount / (1 + _tasa_iva)).quantize(Decimal("0.0001"))
        _iva_dev  = (refund_amount - _base_dev).quantize(Decimal("0.0001"))
    else:
        _base_dev = refund_amount
        _iva_dev  = Decimal("0")
    _costo_dev = qty * Decimal(str(product.average_cost))

    # Reverso: el asiento original era Debe Caja/Clientes / Haber Ventas.
    # La contrapartida invierte: Debe Ventas / Haber Caja/Clientes (reembolso).
    _es_credito   = sale and sale.payment_method == "006"
    _cuenta_cobro = "105.01" if _es_credito else "102.01"
    _nombre_cobro = "Clientes" if _es_credito else "Caja"
    _concepto_dev = f"Devolución venta {sale_id[:8].upper()} — SKU {product_sku}"

    lines_dev = [
        dict(cuenta_sat="401.01", cuenta_nombre="Ventas",
             tipo_movimiento="DEBE", monto=_base_dev,
             descripcion=_concepto_dev),
        dict(cuenta_sat=_cuenta_cobro, cuenta_nombre=_nombre_cobro,
             tipo_movimiento="HABER", monto=refund_amount,
             descripcion=f"Reembolso en {_nombre_cobro} — {_concepto_dev}"),
    ]
    if _iva_dev > 0:
        lines_dev.append(dict(
            cuenta_sat="216.01", cuenta_nombre="IVA trasladado",
            tipo_movimiento="DEBE", monto=_iva_dev,
            descripcion=f"Reverso IVA — {_concepto_dev}",
        ))
    if _costo_dev > 0:
        lines_dev += [
            dict(cuenta_sat="151.01", cuenta_nombre="Inventario de mercancías",
                 tipo_movimiento="DEBE", monto=_costo_dev,
                 descripcion=f"Reingreso inventario — {_concepto_dev}"),
            dict(cuenta_sat="501.01", cuenta_nombre="Costo de lo vendido",
                 tipo_movimiento="HABER", monto=_costo_dev,
                 descripcion=f"Reverso CMV — {_concepto_dev}"),
        ]

    _td = sum(Decimal(str(l["monto"])) for l in lines_dev if l["tipo_movimiento"] == "DEBE")
    _th = sum(Decimal(str(l["monto"])) for l in lines_dev if l["tipo_movimiento"] == "HABER")
    if _td != _th:
        raise ValueError(f"Asiento de reverso descuadrado: Debe={_td} ≠ Haber={_th}")

    entry = models.AccountingEntry(
        empresa_id=empresa_id, sucursal_id="MATRIZ",
        referencia_tipo="DEVOLUCION", referencia_id=sale_id,
        concepto=_concepto_dev,
        total_debe=_td, total_haber=_th, status="POSTED",
        created_by=authorized_by_id,
    )
    db.add(entry)
    db.flush()
    for ld in lines_dev:
        db.add(models.AccountingEntryLine(
            empresa_id=empresa_id, entry_id=entry.id,
            cuenta_sat=ld["cuenta_sat"], cuenta_nombre=ld["cuenta_nombre"],
            tipo_movimiento=ld["tipo_movimiento"],
            monto=Decimal(str(ld["monto"])), descripcion=ld.get("descripcion"),
        ))

    db.commit()
    return {
        "sale_id": sale_id,
        "product_sku": product_sku,
        "quantity_returned": float(qty),
        "refund_amount": float(refund_amount),
        "warehouse_id": warehouse.id,
        "accounting_entry_id": entry.id,
    }


def register_return_batch(db: Session, empresa_id: str, sale_id: str, batch: "schemas.SaleReturnBatch") -> list:
    """Devolución de múltiples renglones en una sola operación.

    Itera sobre los ítems del batch y llama a register_product_return por
    cada uno.  Si cualquier ítem falla, el error se propaga y SQLAlchemy
    hace rollback de toda la operación (no hay commit parcial).
    """
    results = []
    for item in batch.items:
        result = register_product_return(
            db=db,
            empresa_id=empresa_id,
            sale_id=sale_id,
            product_sku=item.product_sku,
            quantity_returned=item.quantity_returned,
            notes=item.notes,
            warehouse_id=getattr(item, "warehouse_id", None),
            authorized_by_id=getattr(item, "authorized_by_id", None),
        )
        results.append(result)
    return results


# ---------------------------------------------------------------------------
# ENTRADAS DE MERCANCÍA (Recepciones / Compras)
# ---------------------------------------------------------------------------
def create_purchase_entry(db: Session, empresa_id: str, purchase: "schemas.PurchaseEntryCreate") -> dict:
    """Registra la recepción de mercancía en almacén.

    Flujo:
      1. Por cada renglón: valida producto, suma cantidad a WarehouseStock
         y a Product.stock, actualiza average_cost (costo promedio ponderado),
         registra InventoryMovement tipo COMPRA.
      2. Genera asiento contable:
           Debe  151.01 Inventario      (costo total recibido)
           Haber 201.01 Proveedores CxP (si es crédito) o 102.01 Caja
      3. Commit único.
    """
    warehouse = (
        _get_warehouse_by_id(db, empresa_id, purchase.warehouse_id)
        if purchase.warehouse_id
        else _get_or_create_default_warehouse(db, empresa_id)
    )
    if not warehouse:
        raise ValueError(f"Bodega {purchase.warehouse_id} no encontrada")

    stamp = datetime.utcnow().isoformat()
    total_costo_compra = Decimal("0")
    movements = []

    for item in purchase.items:
        qty   = Decimal(str(item.quantity))
        costo = Decimal(str(item.unit_cost))
        if qty <= 0:
            raise ValueError(f"Cantidad inválida para SKU {item.product_sku}: {qty}")
        if costo < 0:
            raise ValueError(f"Costo inválido para SKU {item.product_sku}: {costo}")

        product = (
            db.query(models.Product)
            .filter(models.Product.empresa_id == empresa_id)
            .filter(models.Product.sku == item.product_sku)
            .with_for_update()
            .populate_existing()
            .first()
        )
        if not product:
            raise ValueError(f"Producto SKU {item.product_sku} no encontrado")

        # Costo promedio ponderado: (stock_actual * costo_actual + qty * costo_nuevo) / (stock + qty)
        stock_actual = Decimal(str(product.stock))
        costo_actual = Decimal(str(product.average_cost))
        nuevo_stock  = stock_actual + qty
        if nuevo_stock > 0:
            product.average_cost = (
                (stock_actual * costo_actual + qty * costo) / nuevo_stock
            ).quantize(Decimal("0.0001"))
        product.stock = nuevo_stock
        db.add(product)

        wstock = _get_or_create_warehouse_stock(db, empresa_id, product.id, warehouse.id)
        wstock.quantity = wstock.quantity + qty
        db.add(wstock)

        mov = models.InventoryMovement(
            empresa_id=empresa_id,
            sucursal_id=warehouse.sucursal_id if hasattr(warehouse, "sucursal_id") else "MATRIZ",
            product_id=product.id,
            warehouse_id=warehouse.id,
            movement_type="COMPRA",
            quantity=qty,
            unit_cost=costo,
            reference_type="FACTURA_COMPRA",
            reference_id=purchase.folio_proveedor or stamp,
            idempotency_key=f"COMPRA:{empresa_id}:{item.product_sku}:{stamp}",
            reason=purchase.notas,
            authorized_by_id=purchase.authorized_by_id,
        )
        db.add(mov)
        movements.append(mov)
        total_costo_compra += qty * costo

    db.flush()

    # Asiento contable de compra
    _es_credito   = purchase.payment_method == "credito"
    _cuenta_pago  = "201.01" if _es_credito else "102.01"
    _nombre_pago  = "Proveedores" if _es_credito else "Caja"
    _concepto_cmp = f"Compra {purchase.folio_proveedor or stamp[:8]}"

    lines_cmp = [
        dict(cuenta_sat="151.01", cuenta_nombre="Inventario de mercancías",
             tipo_movimiento="DEBE", monto=total_costo_compra,
             descripcion=f"Entrada inventario — {_concepto_cmp}"),
        dict(cuenta_sat=_cuenta_pago, cuenta_nombre=_nombre_pago,
             tipo_movimiento="HABER", monto=total_costo_compra,
             descripcion=f"Pago/CxP — {_concepto_cmp}"),
    ]
    _td = sum(Decimal(str(l["monto"])) for l in lines_cmp if l["tipo_movimiento"] == "DEBE")
    _th = sum(Decimal(str(l["monto"])) for l in lines_cmp if l["tipo_movimiento"] == "HABER")
    if _td != _th:
        raise ValueError(f"Asiento de compra descuadrado: Debe={_td} ≠ Haber={_th}")

    entry = models.AccountingEntry(
        empresa_id=empresa_id, sucursal_id="MATRIZ",
        referencia_tipo="COMPRA", referencia_id=purchase.folio_proveedor or stamp,
        concepto=_concepto_cmp,
        total_debe=_td, total_haber=_th, status="POSTED",
        created_by=purchase.authorized_by_id,
    )
    db.add(entry)
    db.flush()
    for ld in lines_cmp:
        db.add(models.AccountingEntryLine(
            empresa_id=empresa_id, entry_id=entry.id,
            cuenta_sat=ld["cuenta_sat"], cuenta_nombre=ld["cuenta_nombre"],
            tipo_movimiento=ld["tipo_movimiento"],
            monto=Decimal(str(ld["monto"])), descripcion=ld.get("descripcion"),
        ))

    db.commit()
    return {
        "folio_proveedor": purchase.folio_proveedor,
        "warehouse_id": warehouse.id,
        "total_costo": float(total_costo_compra),
        "items_count": len(movements),
        "accounting_entry_id": entry.id,
    }


# (create_inventory_adjustment huérfana eliminada 2026-09-18: 0 llamadas en
# todo el backend. Generaba asiento contable automático del ajuste, pero
# adjust_inventory (la función viva, usada por /api/warehouse/adjust) documenta
# lo contrario como decisión de diseño consciente: los ajustes/mermas los
# contabiliza el Contador manualmente, solo ventas/compras/devoluciones son
# automáticas. No es solo código muerto — es una versión de un diseño ya
# revertido a propósito.)
def create_warehouse(db: Session, empresa_id: str, warehouse: "schemas.WarehouseCreate") -> models.Warehouse:
    """Crea una nueva bodega para el tenant."""
    existing = (
        db.query(models.Warehouse)
        .filter(models.Warehouse.empresa_id == empresa_id)
        .filter(models.Warehouse.name == warehouse.name)
        .first()
    )
    if existing:
        raise ValueError(f"Ya existe una bodega con el nombre '{warehouse.name}'")

    db_wh = models.Warehouse(
        empresa_id=empresa_id,
        sucursal_id=warehouse.sucursal_id or "MATRIZ",
        name=warehouse.name,
        is_transit=warehouse.is_transit or False,
    )
    db.add(db_wh)
    db.commit()
    db.refresh(db_wh)
    return db_wh


def update_warehouse(db: Session, empresa_id: str, warehouse_id: str, data: dict) -> models.Warehouse:
    """Actualiza nombre o sucursal de una bodega."""
    wh = _get_warehouse_by_id(db, empresa_id, warehouse_id)
    if not wh:
        raise ValueError(f"Bodega {warehouse_id} no encontrada")
    if "name" in data and data["name"] != wh.name:
        dup = (
            db.query(models.Warehouse)
            .filter(models.Warehouse.empresa_id == empresa_id)
            .filter(models.Warehouse.name == data["name"])
            .filter(models.Warehouse.id != warehouse_id)
            .first()
        )
        if dup:
            raise ValueError(f"Ya existe una bodega con el nombre '{data['name']}'")
        wh.name = data["name"]
    if "sucursal_id" in data:
        wh.sucursal_id = data["sucursal_id"]
    db.add(wh)
    db.commit()
    db.refresh(wh)
    return wh


# --- Parked Sales CRUD ---
# (get_kardex huérfana eliminada 2026-09-18: 0 llamadas en todo el backend;
# su propio docstring decía que reemplazaba a /api/kardex pero nunca se
# conectó. Su reemplazo real, con paginación, es get_kardex_full más abajo,
# usado por /api/kardex/v2.)
def get_parked_sales(db: Session, empresa_id: str, branch: Optional[str] = None, seller: Optional[str] = None, query: Optional[str] = None):
    # Retrieve active parked sales (where is_merged is False)
    q = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).filter(models.ParkedSale.is_merged == False)
    if branch:
        q = q.filter(models.ParkedSale.branch == branch)
    if seller:
        q = q.filter(models.ParkedSale.seller == seller)
    if query:
        search_pattern = f"%{query}%"
        q = q.filter(
            or_(
                models.ParkedSale.client_name.like(search_pattern),
                models.ParkedSale.folio.like(search_pattern)
            )
        )
    return q.order_by(models.ParkedSale.created_at.desc()).all()

def get_parked_sale(db: Session, empresa_id: str, parked_id: str):
    return db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).filter(models.ParkedSale.id == parked_id).first()

def ensure_product_exists(db: Session, empresa_id: str, sku: str, description: str):
    if not db.query(models.Product).filter(models.Product.empresa_id == empresa_id).filter(models.Product.sku == sku).first():
        new_prod = models.Product(empresa_id=empresa_id, 
            sku=sku,
            description=description,
            price=0.0,
            stock=0.0
        )
        db.add(new_prod)
        db.flush()

def create_parked_sale(db: Session, empresa_id: str, sale: schemas.ParkedSaleCreate):
    # 1. Create sale record
    db_sale = models.ParkedSale(empresa_id=empresa_id, 
        client_id=sale.client_id,
        client_name=sale.client_name,
        client_rfc=sale.client_rfc,
        seller=sale.seller,
        branch=sale.branch,
        total=sale.total,
        is_merged=sale.is_merged,
        merged_from_ids=sale.merged_from_ids
    )
    db.add(db_sale)
    db.flush() # get db_sale.id

    # Create Folio A-XXXXXX (contador por tenant; db_sale.id es un UUID de
    # texto desde la migracion 8276e9755f9a, ya no un entero autoincremental,
    # asi que no se puede foliar con :06d sobre el id -- ver hallazgo C3)
    seq = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).count()
    db_sale.folio = f"A-{seq:06d}"
    db.add(db_sale)

    # 2. Add items
    for item in sale.items:
        ensure_product_exists(db, empresa_id, item.product_sku, item.description)
        db_item = models.ParkedSaleItem(empresa_id=empresa_id, 
            parked_sale_id=db_sale.id,
            product_sku=item.product_sku,
            description=item.description,
            quantity=item.quantity,
            price=item.price,
            subtotal=item.subtotal,
            source_group=item.source_group
        )
        db.add(db_item)

    # 3. Add initial comment if present
    if sale.comment:
        db_comment = models.ParkedSaleComment(empresa_id=empresa_id, 
            parked_sale_id=db_sale.id,
            author=sale.seller,
            comment=sale.comment
        )
        db.add(db_comment)

    db.commit()
    db.refresh(db_sale)
    return db_sale

def update_parked_sale_name(db: Session, empresa_id: str, parked_id: str, new_name: str):
    db_sale = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).filter(models.ParkedSale.id == parked_id).first()
    if not db_sale:
        raise ValueError("Parked sale not found")
    db_sale.client_name = new_name
    db.add(db_sale)
    db.commit()
    db.refresh(db_sale)
    return db_sale

def delete_parked_sales(db: Session, empresa_id: str, ids: list):
    sales = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).filter(models.ParkedSale.id.in_(ids)).all()
    for s in sales:
        # Note: We DO NOT cascade delete child accounts (merged_from_ids) 
        # so they can be restored later via split logic.
        db.delete(s)
    db.commit()
    return True

def transfer_parked_sales(db: Session, empresa_id: str, ids: list, destination_branch: str):
    sales = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).filter(models.ParkedSale.id.in_(ids)).all()
    for s in sales:
        s.branch = destination_branch
        db.add(s)
        # If it is a master account, also transfer its child accounts
        if s.merged_from_ids:
            # merged_from_ids guarda ids de texto (UUID) desde la migracion
            # a String -- ya no son enteros, no convertir con int() (hallazgo C3)
            child_ids = [x.strip() for x in s.merged_from_ids.split(",") if x.strip()]
            child_sales = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).filter(models.ParkedSale.id.in_(child_ids)).all()
            for cs in child_sales:
                cs.branch = destination_branch
                db.add(cs)
    db.commit()
    return True

def merge_parked_sales(db: Session, empresa_id: str, ids: list, new_client_name: str, seller: str, branch: str):
    sales = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).filter(models.ParkedSale.id.in_(ids)).all()
    if not sales:
        raise ValueError("No accounts found to merge")

    # Calculate combined totals and combined items
    # total_importe empieza en 0.0 (float) pero s.total es Numeric -> Decimal
    # en la sesion real (Postgres/SQLAlchemy); float + Decimal truena con
    # TypeError. Se castea a float en cada suma (hallazgo C3).
    total_importe = 0.0
    combined_items_dict = {} # sku -> { sku, desc, qty, price, subtotal }
    combined_comments = []

    # Get first client phone number and rfc
    first_client_id = sales[0].client_id
    first_client_rfc = sales[0].client_rfc

    for s in sales:
        total_importe += float(s.total)
        # Merge items
        for item in s.items:
            sku = item.product_sku
            if sku in combined_items_dict:
                combined_items_dict[sku]["quantity"] += item.quantity
                combined_items_dict[sku]["subtotal"] = combined_items_dict[sku]["quantity"] * item.price
            else:
                combined_items_dict[sku] = {
                    "product_sku": sku,
                    "description": item.description,
                    "quantity": item.quantity,
                    "price": item.price,
                    "subtotal": item.subtotal
                }
        # Gather original comment logs
        for comment in s.comments:
            combined_comments.append({
                "author": comment.author,
                "comment": f"[{s.folio}] {comment.comment}",
                "created_at": comment.created_at
            })

    # Create the master account
    master_sale = models.ParkedSale(empresa_id=empresa_id, 
        client_id=first_client_id,
        client_name=new_client_name,
        client_rfc=first_client_rfc,
        seller=seller,
        branch=branch,
        total=total_importe,
        is_merged=False,
        merged_from_ids=",".join([str(s.id) for s in sales])
    )
    db.add(master_sale)
    db.flush() # get id

    seq = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).count()
    master_sale.folio = f"A-{seq:06d}"
    db.add(master_sale)

    # Add items to master account
    for sku, it in combined_items_dict.items():
        ensure_product_exists(db, empresa_id, it["product_sku"], it["description"])
        db_item = models.ParkedSaleItem(empresa_id=empresa_id, 
            parked_sale_id=master_sale.id,
            product_sku=it["product_sku"],
            description=it["description"],
            quantity=it["quantity"],
            price=it["price"],
            subtotal=it["subtotal"]
        )
        db.add(db_item)

    # Mark original accounts as merged (sets is_merged = True) so they are hidden
    for s in sales:
        s.is_merged = True
        db.add(s)

    # Copy comments to master account comment log
    for c in combined_comments:
        db_comment = models.ParkedSaleComment(empresa_id=empresa_id, 
            parked_sale_id=master_sale.id,
            author=c["author"],
            comment=c["comment"],
            created_at=c["created_at"]
        )
        db.add(db_comment)

    # Add a merge comment log
    merge_log_comment = models.ParkedSaleComment(empresa_id=empresa_id, 
        parked_sale_id=master_sale.id,
        author=seller,
        comment=f"Cuenta fusión creada a partir de: {', '.join([s.folio for s in sales])}."
    )
    db.add(merge_log_comment)

    db.commit()
    db.refresh(master_sale)
    return master_sale

# --- Quotes CRUD ---

def create_quote(db: Session, empresa_id: str, quote: schemas.QuoteCreate):
    db_quote = models.Quote(empresa_id=empresa_id, 
        client_id=quote.client_id,
        client_name=quote.client_name,
        total=quote.total,
        status="PENDIENTE"
    )
    db.add(db_quote)
    db.flush()

    seq = db.query(models.Quote).filter(models.Quote.empresa_id == empresa_id).count()
    db_quote.folio = f"C-{seq:06d}"
    db.add(db_quote)

    for item in quote.items:
        db_item = models.QuoteItem(empresa_id=empresa_id, 
            quote_id=db_quote.id,
            product_sku=item.product_sku,
            description=item.description,
            quantity=item.quantity,
            price=item.price,
            subtotal=item.subtotal
        )
        db.add(db_item)
    
    db.commit()
    db.refresh(db_quote)
    return db_quote

def get_client_quotes(db: Session, empresa_id: str, client_id: str):
    return db.query(models.Quote).filter(models.Quote.empresa_id == empresa_id).filter(models.Quote.client_id == client_id).order_by(models.Quote.created_at.desc()).all()

def get_all_quotes(db: Session, empresa_id: str):
    return db.query(models.Quote).filter(models.Quote.empresa_id == empresa_id).order_by(models.Quote.created_at.desc()).all()

def get_filtered_quotes(db: Session, empresa_id: str, client_id: str = None, client_name: str = None):
    query = db.query(models.Quote).filter(models.Quote.empresa_id == empresa_id)
    if client_id:
        query = query.filter(models.Quote.client_id == client_id)
    if client_name:
        query = query.filter(models.Quote.client_name.ilike(f"%{client_name}%"))
    return query.order_by(models.Quote.created_at.desc()).all()

def get_quote(db: Session, empresa_id: str, quote_id: str):
    return db.query(models.Quote).filter(models.Quote.empresa_id == empresa_id).filter(models.Quote.id == quote_id).first()

def close_quote(db: Session, empresa_id: str, quote_id: str):
    db_quote = db.query(models.Quote).filter(models.Quote.empresa_id == empresa_id).filter(models.Quote.id == quote_id).first()
    if not db_quote:
        raise ValueError("Quote not found")
    db_quote.status = "CERRADA"
    db.commit()
    db.refresh(db_quote)
    return db_quote

def split_parked_sale(db: Session, empresa_id: str, parked_id: str):
    master_sale = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).filter(models.ParkedSale.id == parked_id).first()
    if not master_sale:
        raise ValueError("Master parked sale not found")
    if not master_sale.merged_from_ids:
        raise ValueError("Account is not a merged master account")

    child_ids = [x.strip() for x in master_sale.merged_from_ids.split(",") if x.strip()]
    child_sales = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).filter(models.ParkedSale.id.in_(child_ids)).all()

    # Tally master items
    master_items_dict = {}
    for item in master_sale.items:
        sku = item.product_sku
        if sku not in master_items_dict:
            master_items_dict[sku] = {
                "product_sku": sku,
                "description": item.description,
                "price": item.price,
                "quantity": 0
            }
        master_items_dict[sku]["quantity"] += item.quantity

    # Tally child items
    child_items_dict = {}
    for cs in child_sales:
        for item in cs.items:
            sku = item.product_sku
            child_items_dict[sku] = child_items_dict.get(sku, 0) + item.quantity

    # Calculate diff
    extra_items = []
    # extra_total arrancaba en 0.0 (float); m_data/subtotal son Numeric ->
    # Decimal, y float + Decimal truena con TypeError (mismo hallazgo C3
    # que total_importe en merge_parked_sales). 0 (int) si combina con Decimal.
    extra_total = 0

    for sku, m_data in master_items_dict.items():
        c_qty = child_items_dict.get(sku, 0)
        diff_qty = m_data["quantity"] - c_qty
        if diff_qty > 0:
            subtotal = diff_qty * m_data["price"]
            extra_items.append({
                "product_sku": sku,
                "description": m_data["description"],
                "quantity": diff_qty,
                "price": m_data["price"],
                "subtotal": subtotal
            })
            extra_total += subtotal

    # Create Extra account if needed
    if extra_items:
        extra_sale = models.ParkedSale(empresa_id=empresa_id, 
            client_id=master_sale.client_id,
            client_name=f"{master_sale.client_name}-Extra",
            client_rfc=master_sale.client_rfc,
            seller=master_sale.seller,
            branch=master_sale.branch,
            total=extra_total,
            is_merged=False,
            merged_from_ids=None
        )
        db.add(extra_sale)
        db.flush()
        seq = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).count()
        extra_sale.folio = f"A-{seq:06d}"
        db.add(extra_sale)

        for ex in extra_items:
            db_item = models.ParkedSaleItem(empresa_id=empresa_id, 
                parked_sale_id=extra_sale.id,
                product_sku=ex["product_sku"],
                description=ex["description"],
                quantity=ex["quantity"],
                price=ex["price"],
                subtotal=ex["subtotal"]
            )
            db.add(db_item)

    # Restore original accounts and rename
    index = 1
    for cs in child_sales:
        cs.is_merged = False
        cs.client_name = f"{master_sale.client_name}-{index}"
        db.add(cs)
        index += 1

    # Delete master account
    db.delete(master_sale)
    db.commit()
    return True

def add_parked_sale_comment(db: Session, empresa_id: str, parked_id: str, author: str, comment_text: str):
    db_comment = models.ParkedSaleComment(empresa_id=empresa_id, 
        parked_sale_id=parked_id,
        author=author,
        comment=comment_text
    )
    db.add(db_comment)
    db.commit()
    db.refresh(db_comment)
    return db_comment

def split_merged_parked_sale(db: Session, empresa_id: str, parked_id: str):
    master_sale = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).filter(models.ParkedSale.id == parked_id).first()
    if not master_sale:
        raise ValueError("Master parked sale not found")

    # Group items by source_group
    groups = {}
    extra_items = []
    
    for item in master_sale.items:
        sg = item.source_group
        if sg:
            if sg not in groups:
                groups[sg] = []
            groups[sg].append(item)
        else:
            extra_items.append(item)

    # Create a new parked sale for each group
    base_name = master_sale.client_name.lstrip('* ').strip()
    
    for idx, (sg_name, items) in enumerate(groups.items(), start=1):
        total = sum(i.subtotal for i in items)
        new_sale = models.ParkedSale(empresa_id=empresa_id, 
            client_id=master_sale.client_id,
            client_name=f"{base_name} - {idx}",
            client_rfc=master_sale.client_rfc,
            seller=master_sale.seller,
            branch=master_sale.branch,
            total=total,
            is_merged=False,
            merged_from_ids=None
        )
        db.add(new_sale)
        db.flush()
        seq = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).count()
        new_sale.folio = f"A-{seq:06d}"
        db.add(new_sale)

        for i in items:
            db_item = models.ParkedSaleItem(empresa_id=empresa_id, 
                parked_sale_id=new_sale.id,
                product_sku=i.product_sku,
                description=i.description,
                quantity=i.quantity,
                price=i.price,
                subtotal=i.subtotal,
                source_group=None
            )
            db.add(db_item)

    # Create a new parked sale for extra items
    if extra_items:
        total = sum(i.subtotal for i in extra_items)
        new_sale = models.ParkedSale(empresa_id=empresa_id, 
            client_id=master_sale.client_id,
            client_name=f"{base_name} - {len(groups) + 1}",
            client_rfc=master_sale.client_rfc,
            seller=master_sale.seller,
            branch=master_sale.branch,
            total=total,
            is_merged=False,
            merged_from_ids=None
        )
        db.add(new_sale)
        db.flush()
        seq = db.query(models.ParkedSale).filter(models.ParkedSale.empresa_id == empresa_id).count()
        new_sale.folio = f"A-{seq:06d}"
        db.add(new_sale)

        for i in extra_items:
            db_item = models.ParkedSaleItem(empresa_id=empresa_id, 
                parked_sale_id=new_sale.id,
                product_sku=i.product_sku,
                description=i.description,
                quantity=i.quantity,
                price=i.price,
                subtotal=i.subtotal,
                source_group=None
            )
            db.add(db_item)

    # Delete master sale
    db.delete(master_sale)
    db.commit()


# =============================================================================
# MÓDULO ALMACÉN — lógica de negocio (Fase 2)
# =============================================================================

def get_warehouses(db: Session, empresa_id: str) -> list:
    return (
        db.query(models.Warehouse)
        .filter(models.Warehouse.empresa_id == empresa_id)
        .order_by(models.Warehouse.name)
        .all()
    )


def create_warehouse_op(db: Session, empresa_id: str, sucursal_id: str,
                        data: "schemas.WarehouseCreate") -> models.Warehouse:
    w = models.Warehouse(
        empresa_id=empresa_id,
        sucursal_id=sucursal_id,
        name=data.name,
        is_transit=data.is_transit,
    )
    db.add(w)
    db.commit()
    db.refresh(w)
    return w


def get_stock_by_warehouse(db: Session, empresa_id: str,
                           warehouse_id: str | None = None,
                           product_sku: str | None = None) -> list:
    """Stock actual por bodega, con nombre de producto y bodega resueltos."""
    q = (
        db.query(
            models.WarehouseStock,
            models.Product.sku,
            models.Product.name.label("product_name"),
            models.Product.average_cost.label("unit_cost"),
            models.Warehouse.name.label("warehouse_name"),
        )
        .join(models.Product, (models.WarehouseStock.product_id == models.Product.id) &
                               (models.WarehouseStock.empresa_id == models.Product.empresa_id))
        .join(models.Warehouse, (models.WarehouseStock.warehouse_id == models.Warehouse.id) &
                                 (models.WarehouseStock.empresa_id == models.Warehouse.empresa_id))
        .filter(models.WarehouseStock.empresa_id == empresa_id)
    )
    if warehouse_id:
        q = q.filter(models.WarehouseStock.warehouse_id == warehouse_id)
    if product_sku:
        q = q.filter(models.Product.sku == product_sku)
    rows = q.order_by(models.Warehouse.name, models.Product.sku).all()
    out = []
    for ws, sku, product_name, unit_cost, warehouse_name in rows:
        qty  = float(ws.quantity)
        cost = float(unit_cost or 0)
        out.append({
            "warehouse_id":   ws.warehouse_id,
            "warehouse_name": warehouse_name,
            "product_id":     ws.product_id,
            "product_sku":    sku,
            "product_name":   product_name,
            "quantity":       qty,
            "unit_cost":      cost,
            "valor_linea":    round(qty * cost, 2),
        })
    return out


def get_inventario_kpis(db: Session, empresa_id: str) -> dict:
    """KPIs agregados para la vista de Inventario (GAP-3).

    - productos:  productos dados de alta en el tenant
    - bodegas:    bodegas del tenant
    - valor_total: sum(existencia * costo promedio) sobre WarehouseStock
    - sin_stock:  productos con stock total <= 0
    - resguardos: SafekeptItem en estado 'Pendiente' (por surtir)
    - apartados:  total histórico de SafekeptItem del tenant
    """
    productos = (
        db.query(func.count(models.Product.id))
        .filter(models.Product.empresa_id == empresa_id)
        .scalar()
    ) or 0

    bodegas = (
        db.query(func.count(models.Warehouse.id))
        .filter(models.Warehouse.empresa_id == empresa_id)
        .scalar()
    ) or 0

    valor_total = (
        db.query(func.coalesce(func.sum(models.WarehouseStock.quantity * models.Product.average_cost), 0))
        .join(models.Product, (models.WarehouseStock.product_id == models.Product.id) &
                               (models.WarehouseStock.empresa_id == models.Product.empresa_id))
        .filter(models.WarehouseStock.empresa_id == empresa_id)
        .scalar()
    ) or 0

    sin_stock = (
        db.query(func.count(models.Product.id))
        .filter(models.Product.empresa_id == empresa_id)
        .filter(func.coalesce(models.Product.stock, 0) <= 0)
        .scalar()
    ) or 0

    resguardos = (
        db.query(func.count(models.SafekeptItem.id))
        .filter(models.SafekeptItem.empresa_id == empresa_id)
        .filter(models.SafekeptItem.status.in_(SAFEKEPT_ABIERTOS))
        .scalar()
    ) or 0

    apartados = (
        db.query(func.count(models.SafekeptItem.id))
        .filter(models.SafekeptItem.empresa_id == empresa_id)
        .scalar()
    ) or 0

    return {
        "productos":   int(productos),
        "bodegas":     int(bodegas),
        "valor_total": round(float(valor_total), 2),
        "sin_stock":   int(sin_stock),
        "resguardos":  int(resguardos),
        "apartados":   int(apartados),
    }


def get_sku_compromisos(db: Session, empresa_id: str) -> dict:
    """Cuenta de resguardos abiertos y apartados (histórico) por SKU.

    Devuelve {sku: {"resguardos": N, "apartados": N}}.
    resguardos = SafekeptItem abiertos (SAFEKEPT_ABIERTOS) del SKU.
    apartados  = total histórico de SafekeptItem del SKU.
    """
    from sqlalchemy import case as sa_case

    rows = (
        db.query(
            models.SafekeptItem.product_sku,
            func.count(models.SafekeptItem.id).label("total"),
            func.sum(
                sa_case(
                    (models.SafekeptItem.status.in_(SAFEKEPT_ABIERTOS), 1),
                    else_=0,
                )
            ).label("abiertos"),
        )
        .filter(models.SafekeptItem.empresa_id == empresa_id)
        .group_by(models.SafekeptItem.product_sku)
        .all()
    )

    return {
        r.product_sku: {
            "resguardos": int(r.abiertos or 0),
            "apartados":  int(r.total or 0),
        }
        for r in rows
    }


def get_kardex_full(db: Session, empresa_id: str,
                    product_sku: str | None = None,
                    warehouse_id: str | None = None,
                    movement_type: str | None = None,
                    limit: int = 200,
                    offset: int = 0) -> dict:
    """Kardex completo con filtros, nombres resueltos y paginación."""
    q = (
        db.query(
            models.InventoryMovement,
            models.Product.sku,
            models.Product.name.label("product_name"),
            models.Warehouse.name.label("warehouse_name"),
        )
        .join(models.Product, (models.InventoryMovement.product_id == models.Product.id) &
                               (models.InventoryMovement.empresa_id == models.Product.empresa_id))
        .join(models.Warehouse, (models.InventoryMovement.warehouse_id == models.Warehouse.id) &
                                 (models.InventoryMovement.empresa_id == models.Warehouse.empresa_id))
        .filter(models.InventoryMovement.empresa_id == empresa_id)
    )
    if product_sku:
        q = q.filter(models.Product.sku == product_sku)
    if warehouse_id:
        q = q.filter(models.InventoryMovement.warehouse_id == warehouse_id)
    if movement_type:
        types = [t.strip() for t in movement_type.split(",") if t.strip()]
        if len(types) == 1:
            q = q.filter(models.InventoryMovement.movement_type == types[0])
        else:
            q = q.filter(models.InventoryMovement.movement_type.in_(types))

    total = q.count()
    rows  = q.order_by(models.InventoryMovement.created_at.desc()).offset(offset).limit(limit).all()

    items = [
        {
            "id":             mv.id,
            "timestamp":      mv.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "product_sku":    sku,
            "product_name":   product_name,
            "warehouse_id":   mv.warehouse_id,
            "warehouse_name": warehouse_name,
            "movement_type":  mv.movement_type,
            "quantity":       float(mv.quantity),
            "unit_cost":      float(mv.unit_cost),
            "reference_type": mv.reference_type,
            "reference_id":   mv.reference_id,
            "reason":         mv.reason,
        }
        for mv, sku, product_name, warehouse_name in rows
    ]
    return {"total": total, "items": items}


def process_sale_return(db: Session, empresa_id: str, sucursal_id: str,
                        data: "schemas.SaleReturnCreate",
                        created_by: str) -> dict:
    """Devolución de venta: regresa unidades al stock y genera asiento inverso.

    Por cada ítem devuelto:
      - Valida que la venta exista y que el ítem forme parte de ella
      - Verifica que no se devuelva más de lo vendido (incluyendo
        devoluciones previas via returned_quantity)
      - Incrementa WarehouseStock en la bodega de restock
      - Actualiza Product.stock (total cacheado)
      - Registra InventoryMovement (DEVOLUCION)
      - Actualiza SaleItem.returned_quantity

    Asiento contable (inverso a la venta):
      DEBE  401.01 Ventas         (reversa del ingreso)
      HABER 102.01/105.01 Caja/Clientes  (devolución de efectivo o abono a CxC)
      DEBE  151.01 Inventario     (entrada al costo)
      HABER 501.01 CMV            (reversa del costo)
    """
    # Idempotencia
    if data.idempotency_key:
        existing = (
            db.query(models.InventoryMovement)
            .filter(models.InventoryMovement.empresa_id == empresa_id)
            .filter(models.InventoryMovement.idempotency_key == data.idempotency_key)
            .first()
        )
        if existing:
            return {"ok": True, "sale_id": data.sale_id,
                    "items_returned": 0, "total_restocked": 0.0,
                    "accounting_entry_id": None, "already_existed": True}

    sale = (
        db.query(models.Sale)
        .filter(models.Sale.empresa_id == empresa_id)
        .filter(models.Sale.id == data.sale_id)
        .first()
    )
    if not sale:
        raise ValueError(f"Venta {data.sale_id} no existe")

    restock_wh = (
        _get_warehouse_by_id(db, empresa_id, data.restock_warehouse_id)
        if data.restock_warehouse_id
        else _get_or_create_default_warehouse(db, empresa_id)
    )

    stamp            = datetime.utcnow().isoformat()
    items_returned   = 0
    total_restocked  = Decimal("0")
    total_valor_dev  = Decimal("0")
    total_costo_dev  = Decimal("0")

    for ret in data.items:
        product = (
            db.query(models.Product)
            .filter(models.Product.empresa_id == empresa_id)
            .filter(models.Product.sku == ret.product_sku)
            .with_for_update().populate_existing().first()
        )
        if not product:
            raise ValueError(f"SKU {ret.product_sku} no existe")

        sale_item = (
            db.query(models.SaleItem)
            .filter(models.SaleItem.empresa_id == empresa_id)
            .filter(models.SaleItem.sale_id == data.sale_id)
            .filter(models.SaleItem.product_sku == ret.product_sku)
            .first()
        )
        if not sale_item:
            raise ValueError(
                f"SKU {ret.product_sku} no pertenece a la venta {data.sale_id}")

        qty_dev = Decimal(str(ret.quantity_returned))
        ya_devuelto = Decimal(str(sale_item.returned_quantity or 0))
        max_devolvible = Decimal(str(sale_item.quantity)) - ya_devuelto
        if qty_dev > max_devolvible:
            raise ValueError(
                f"SKU {ret.product_sku}: se intenta devolver {qty_dev} "
                f"pero solo quedan {max_devolvible} unidades devolvibles "
                f"(vendidas {sale_item.quantity}, ya devueltas {ya_devuelto})"
            )

        # Actualizar sale_item y stock
        sale_item.returned_quantity = float(ya_devuelto + qty_dev)
        db.add(sale_item)

        product.stock = (product.stock or Decimal("0")) + qty_dev
        db.add(product)

        ws = _get_or_create_warehouse_stock(db, empresa_id, product.id, restock_wh.id)
        ws.quantity = ws.quantity + qty_dev
        db.add(ws)

        idk = (data.idempotency_key or stamp) + f":{ret.product_sku}"
        db.add(models.InventoryMovement(
            empresa_id=empresa_id, sucursal_id=sucursal_id,
            product_id=product.id, warehouse_id=restock_wh.id,
            movement_type="DEVOLUCION", quantity=qty_dev,
            unit_cost=product.average_cost,
            reference_type="TICKET_VENTA", reference_id=data.sale_id,
            idempotency_key=idk,
            reason=ret.notes or "Devolución de venta",
            authorized_by_id=data.authorized_by,
        ))

        # Acumular para el asiento
        valor_item       = qty_dev * Decimal(str(sale_item.price))
        costo_item       = qty_dev * (product.average_cost or Decimal("0"))
        total_valor_dev  += valor_item
        total_costo_dev  += costo_item
        total_restocked  += qty_dev
        items_returned   += 1

    db.flush()

    # Asiento contable inverso
    es_credito   = (sale.payment_method == "006")
    cuenta_cobro = "105.01" if es_credito else "102.01"
    nombre_cobro = "Clientes" if es_credito else "Caja"

    lines_dev = [
        dict(cuenta_sat="401.01", cuenta_nombre="Ventas",
             tipo_movimiento="DEBE", monto=total_valor_dev,
             descripcion=f"Reversa venta por devolución #{data.sale_id[:8]}"),
        dict(cuenta_sat=cuenta_cobro, cuenta_nombre=nombre_cobro,
             tipo_movimiento="HABER", monto=total_valor_dev,
             descripcion=f"Devolución efectivo/abono CxC #{data.sale_id[:8]}"),
    ]
    if total_costo_dev > 0:
        lines_dev += [
            dict(cuenta_sat="151.01", cuenta_nombre="Inventario de mercancías",
                 tipo_movimiento="DEBE", monto=total_costo_dev,
                 descripcion=f"Reingreso inventario devolución #{data.sale_id[:8]}"),
            dict(cuenta_sat="501.01", cuenta_nombre="Costo de lo vendido",
                 tipo_movimiento="HABER", monto=total_costo_dev,
                 descripcion=f"Reversa CMV devolución #{data.sale_id[:8]}"),
        ]

    td = sum(Decimal(str(l["monto"])) for l in lines_dev if l["tipo_movimiento"] == "DEBE")
    th = sum(Decimal(str(l["monto"])) for l in lines_dev if l["tipo_movimiento"] == "HABER")
    if td != th:
        raise ValueError(f"Asiento de devolución descuadrado: Debe={td} ≠ Haber={th}")

    entry = models.AccountingEntry(
        empresa_id=empresa_id, sucursal_id=sucursal_id,
        referencia_tipo="DEVOLUCION", referencia_id=data.sale_id,
        concepto=f"Devolución venta #{data.sale_id[:8].upper()}",
        total_debe=td, total_haber=th, status="POSTED", created_by=created_by,
    )
    db.add(entry)
    db.flush()
    for ld in lines_dev:
        db.add(models.AccountingEntryLine(
            empresa_id=empresa_id, entry_id=entry.id,
            cuenta_sat=ld["cuenta_sat"], cuenta_nombre=ld["cuenta_nombre"],
            tipo_movimiento=ld["tipo_movimiento"],
            monto=Decimal(str(ld["monto"])), descripcion=ld["descripcion"],
        ))

    db.commit()
    return {
        "ok": True, "sale_id": data.sale_id,
        "items_returned": items_returned,
        "total_restocked": float(total_restocked),
        "accounting_entry_id": entry.id,
    }


# ── NR-01: devolución cross-sucursal ────────────────────────────────────────
def create_cross_return(db: Session, empresa_id: str,
                        sucursal_restock: str, role_name: str,
                        data: "schemas.SaleReturnCreate",
                        created_by: str) -> dict:
    """NR-01: devolución de venta que puede venir de cualquier sucursal.

    Flujo:
      - Gerente/Cajero/Vendedor inician → estado PENDIENTE (sin mover stock aún).
      - ADMIN o Gerente de CUALQUIER sucursal aprueba → llama a approve_cross_return().
      - ADMIN puede aprobar en el mismo request (auto-aprobado).

    El campo sucursal_origen viene de la venta original; sucursal_restock
    es la sucursal del usuario que registra la devolución.
    """
    from datetime import datetime as _dt, timezone as _tz
    import uuid as _uuid

    # Idempotencia
    if data.idempotency_key:
        existing = (
            db.query(models.SaleReturn)
            .filter(models.SaleReturn.empresa_id == empresa_id)
            .filter(models.SaleReturn.idempotency_key == data.idempotency_key)
            .first()
        )
        if existing:
            return {"ok": True, "return_id": existing.id,
                    "estado": existing.estado, "already_existed": True}

    # La venta puede ser de CUALQUIER sucursal (cross-branch)
    sale = (
        db.query(models.Sale)
        .filter(models.Sale.empresa_id == empresa_id)
        .filter(models.Sale.id == data.sale_id)
        .first()
    )
    if not sale:
        raise ValueError(f"Venta {data.sale_id} no existe en empresa {empresa_id}")

    sucursal_origen = getattr(sale, "sucursal_id", "MATRIZ") or "MATRIZ"
    now_str = _dt.now(_tz.utc).isoformat()

    # ADMIN auto-aprueba; otros roles quedan PENDIENTE
    is_admin = role_name.lower() in ("admin", "administrador")
    estado_inicial = "APROBADA" if is_admin else "PENDIENTE"

    ret_header = models.SaleReturn(
        id=str(_uuid.uuid4()),
        empresa_id=empresa_id,
        sale_id=data.sale_id,
        sucursal_origen=sucursal_origen,
        sucursal_restock=sucursal_restock,
        estado=estado_inicial,
        authorized_by=created_by if is_admin else None,
        authorized_at=now_str if is_admin else None,
        notes=getattr(data, "notes", None),
        idempotency_key=data.idempotency_key,
        created_by=created_by,
        created_at=now_str,
    )
    db.add(ret_header)
    db.flush()

    # Si ADMIN → ejecutar movimientos de inventario inmediatamente
    if is_admin:
        result = process_sale_return(db, empresa_id, sucursal_restock, data, created_by)
        ret_header.accounting_entry_id = result.get("accounting_entry_id")
        db.add(ret_header)
        db.commit()
        return {
            "ok": True, "return_id": ret_header.id, "estado": "APROBADA",
            "items_returned": result["items_returned"],
            "total_restocked": result["total_restocked"],
            "accounting_entry_id": result.get("accounting_entry_id"),
        }

    # Alerta a Gerente, Admin y Almacén — la aprueban desde el Admin Shell.
    try:
        _lineas = ", ".join(
            f"{it.product_sku}×{getattr(it, 'quantity_returned', 0):g}"
            for it in (getattr(data, "items", None) or [])
        )[:400]
        _motivo = getattr(data, "notes", None)
        push_notification(
            db, empresa_id,
            tipo="devolucion_solicitada",
            titulo=f"Devolución solicitada — Venta {str(data.sale_id)[:8]}…",
            cuerpo=(
                f"{created_by} solicitó una devolución"
                + (f": {_lineas}" if _lineas else "")
                + (f" · Motivo: {_motivo}" if _motivo else "")
            ),
            roles_dest=[
                "ADMIN", "Administrador", "admin",
                "Gerente",
                "ALMACENISTA", "Almacenista",
            ],
            severidad="WARNING",
            sucursal_id=sucursal_restock,
            ref_tipo="return", ref_id=ret_header.id,
            meta={"sale_id": data.sale_id, "return_id": ret_header.id,
                  "created_by": created_by},
        )
    except Exception:
        pass  # la notificación es best-effort; no bloquea la solicitud

    db.commit()
    return {
        "ok": True, "return_id": ret_header.id, "estado": "PENDIENTE",
        "items_returned": 0, "total_restocked": 0.0,
        "message": "Devolución registrada — pendiente de aprobación por Gerente/Admin",
    }


def approve_cross_return(db: Session, empresa_id: str, return_id: str,
                         approved_by: str) -> dict:
    """Aprueba una devolución PENDIENTE: ejecuta movimientos de stock y asiento."""
    from datetime import datetime as _dt, timezone as _tz

    ret = (
        db.query(models.SaleReturn)
        .filter(models.SaleReturn.empresa_id == empresa_id)
        .filter(models.SaleReturn.id == return_id)
        .with_for_update()
        .first()
    )
    if not ret:
        raise ValueError(f"Devolución {return_id} no existe")
    if ret.estado != "PENDIENTE":
        raise ValueError(f"Devolución {return_id} ya está en estado {ret.estado}")

    # Reconstruir SaleReturnCreate desde la cabecera (los ítems están en sale_items)
    # Leemos los SaleItem que tienen returned_quantity pendiente de aplicar
    # Usamos un SaleReturnCreate sintético con los ítems originales de la venta
    sale_items = (
        db.query(models.SaleItem)
        .filter(models.SaleItem.empresa_id == empresa_id)
        .filter(models.SaleItem.sale_id == ret.sale_id)
        .all()
    )
    # Importar schemas localmente para evitar circular
    import schemas as _sch
    items_ret = [
        _sch.SaleReturnItem(
            product_sku=si.product_sku,
            quantity_returned=float(si.quantity) - float(si.returned_quantity or 0),
        )
        for si in sale_items
        if (float(si.quantity) - float(si.returned_quantity or 0)) > 0
    ]
    if not items_ret:
        raise ValueError("No hay ítems pendientes de devolver en esta venta")

    data = _sch.SaleReturnCreate(sale_id=ret.sale_id, items=items_ret)
    result = process_sale_return(db, empresa_id, ret.sucursal_restock, data, approved_by)

    ret.estado = "APROBADA"
    ret.authorized_by = approved_by
    ret.authorized_at = _dt.now(_tz.utc).isoformat()
    ret.accounting_entry_id = result.get("accounting_entry_id")
    db.add(ret)
    db.commit()
    return {
        "ok": True, "return_id": ret.id, "estado": "APROBADA",
        "items_returned": result["items_returned"],
        "total_restocked": result["total_restocked"],
        "accounting_entry_id": result.get("accounting_entry_id"),
    }


def reject_cross_return(db: Session, empresa_id: str, return_id: str,
                        rejected_by: str, reason: str | None = None) -> dict:
    """NR-01: rechaza una devolución PENDIENTE sin mover stock ni generar asiento."""
    from datetime import datetime as _dt, timezone as _tz

    ret = (
        db.query(models.SaleReturn)
        .filter(models.SaleReturn.empresa_id == empresa_id)
        .filter(models.SaleReturn.id == return_id)
        .with_for_update()
        .first()
    )
    if not ret:
        raise ValueError(f"Devolución {return_id} no existe")
    if ret.estado != "PENDIENTE":
        raise ValueError(f"Devolución {return_id} ya está en estado {ret.estado}")

    ret.estado = "RECHAZADA"
    ret.authorized_by = rejected_by
    ret.authorized_at = _dt.now(_tz.utc).isoformat()
    if reason:
        ret.notes = reason
    db.add(ret)
    db.commit()
    return {"ok": True, "return_id": ret.id, "estado": "RECHAZADA"}


# ── M-2: utilidad de alertas de stock mínimo ────────────────────────────────
def get_low_stock_alerts(db: Session, empresa_id: str,
                         sucursal_id: str | None = None) -> list:
    """Retorna productos con stock <= stock_minimo (solo los que tienen stock_minimo configurado).

    Si sucursal_id se omite, devuelve todas las sucursales de la empresa (vista ADMIN).
    """
    q = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id)
        .filter(models.Product.stock_minimo.isnot(None))
        .filter(models.Product.stock <= models.Product.stock_minimo)
    )
    if sucursal_id:
        q = q.filter(models.Product.sucursal_id == sucursal_id)
    productos = q.order_by(models.Product.stock.asc()).all()
    return [
        {
            "sku": p.sku,
            "name": p.name,
            "sucursal_id": p.sucursal_id,
            "stock": float(p.stock),
            "stock_minimo": float(p.stock_minimo),
            "deficit": float(p.stock_minimo - p.stock),
        }
        for p in productos
    ]


def adjust_inventory(db: Session, empresa_id: str, sucursal_id: str,
                     data: "schemas.InventoryAdjustCreate") -> dict:
    """Ajuste manual de inventario (mermas, correcciones físicas, donaciones).

    quantity_delta > 0 → entrada (ajuste positivo)
    quantity_delta < 0 → salida/merma (ajuste negativo)

    Requiere authorized_by — no se permite ajuste sin autorización.
    Genera InventoryMovement con movement_type = reason (MERMA | AJUSTE_FISICO | etc.)
    NO genera asiento contable automático — los ajustes manuales los registra
    el Contador (decisión de diseño: solo ventas/compras/devoluciones son
    automáticas; mermas y ajustes son evento contable editorial).
    """
    warehouse = _get_warehouse_by_id(db, empresa_id, data.warehouse_id)
    if not warehouse:
        raise ValueError(f"Bodega {data.warehouse_id} no existe")

    stamp       = datetime.utcnow().isoformat()
    movement_ids = []

    for item in data.items:
        product = (
            db.query(models.Product)
            .filter(models.Product.empresa_id == empresa_id)
            .filter(models.Product.sku == item.product_sku)
            .with_for_update().populate_existing().first()
        )
        if not product:
            raise ValueError(f"SKU {item.product_sku} no existe")

        delta = Decimal(str(item.quantity_delta))
        nuevo_stock = (product.stock or Decimal("0")) + delta
        if nuevo_stock < 0:
            raise ValueError(
                f"SKU {item.product_sku}: el ajuste dejaría stock negativo "
                f"({product.stock} + ({delta}) = {nuevo_stock})"
            )

        product.stock = nuevo_stock
        db.add(product)

        ws = _get_or_create_warehouse_stock(db, empresa_id, product.id, warehouse.id)
        nuevo_ws = ws.quantity + delta
        if nuevo_ws < 0:
            raise ValueError(
                f"SKU {item.product_sku}: ajuste deja stock negativo en bodega "
                f"{warehouse.name} ({ws.quantity} + ({delta}) = {nuevo_ws})"
            )
        ws.quantity = nuevo_ws
        db.add(ws)

        idk = f"AJUSTE:{product.id}:{warehouse.id}:{stamp}:{item.product_sku}"
        mv = models.InventoryMovement(
            empresa_id=empresa_id, sucursal_id=sucursal_id,
            product_id=product.id, warehouse_id=warehouse.id,
            movement_type=item.reason,
            quantity=abs(delta),
            unit_cost=product.average_cost,
            reference_type="AJUSTE_MANUAL",
            reference_id=data.authorized_by,
            idempotency_key=idk,
            reason=f"{item.reason} | {data.notes or ''} | Auth: {data.authorized_by}",
            authorized_by_id=data.authorized_by,
        )
        db.add(mv)
        db.flush()
        movement_ids.append(mv.id)

    db.commit()
    return {"ok": True, "movement_ids": movement_ids}


def transfer_between_warehouses(db: Session, empresa_id: str, sucursal_id: str,
                                data: "schemas.WarehouseTransferCreate") -> dict:
    """Traslado enriquecido entre bodegas (wrapper del create_transfer existente
    con soporte para notes, authorized_by e idempotency_key del schema nuevo).
    """
    # Idempotencia
    if data.idempotency_key:
        existing = (
            db.query(models.InventoryMovement)
            .filter(models.InventoryMovement.empresa_id == empresa_id)
            .filter(models.InventoryMovement.idempotency_key == data.idempotency_key)
            .first()
        )
        if existing:
            return {"ok": True, "source_movement_id": existing.id,
                    "destination_movement_id": existing.id, "already_existed": True}

    product = (
        db.query(models.Product)
        .filter(models.Product.empresa_id == empresa_id)
        .filter(models.Product.sku == data.product_sku)
        .first()
    )
    if not product:
        raise ValueError(f"SKU {data.product_sku} no existe")

    qty = Decimal(str(data.quantity))
    if qty <= 0:
        raise ValueError("La cantidad debe ser mayor a cero")

    src_wh  = _get_warehouse_by_id(db, empresa_id, data.source_warehouse_id)
    dest_wh = _get_warehouse_by_id(db, empresa_id, data.destination_warehouse_id)
    if not src_wh:
        raise ValueError(f"Bodega origen {data.source_warehouse_id} no existe")
    if not dest_wh:
        raise ValueError(f"Bodega destino {data.destination_warehouse_id} no existe")
    if src_wh.id == dest_wh.id:
        raise ValueError("Origen y destino no pueden ser la misma bodega")

    src_stock = _get_or_create_warehouse_stock(db, empresa_id, product.id, src_wh.id)
    if src_stock.quantity < qty:
        raise ValueError(
            f"Stock insuficiente en {src_wh.name}: "
            f"disponible {src_stock.quantity}, solicitado {qty}"
        )
    dest_stock = _get_or_create_warehouse_stock(db, empresa_id, product.id, dest_wh.id)

    src_stock.quantity  = src_stock.quantity - qty
    dest_stock.quantity = dest_stock.quantity + qty
    db.add(src_stock); db.add(dest_stock)

    stamp = datetime.utcnow().isoformat()
    idk   = data.idempotency_key or f"XFER:{product.id}:{src_wh.id}:{dest_wh.id}:{stamp}"
    nota  = data.notes or ""

    salida = models.InventoryMovement(
        empresa_id=empresa_id, sucursal_id=src_wh.sucursal_id,
        product_id=product.id, warehouse_id=src_wh.id,
        movement_type="TRASPASO_SALIDA", quantity=qty,
        unit_cost=product.average_cost,
        reference_type="TRASPASO", reference_id=dest_wh.id,
        idempotency_key=idk + ":SALIDA",
        reason=f"Traslado a {dest_wh.name} | {nota}",
        authorized_by_id=data.authorized_by,
    )
    db.add(salida); db.flush()

    entrada = models.InventoryMovement(
        empresa_id=empresa_id, sucursal_id=dest_wh.sucursal_id,
        product_id=product.id, warehouse_id=dest_wh.id,
        movement_type="TRASPASO_ENTRADA", quantity=qty,
        unit_cost=product.average_cost,
        reference_type="TRASPASO", reference_id=src_wh.id,
        idempotency_key=idk + ":ENTRADA",
        reason=f"Traslado desde {src_wh.name} | {nota}",
        authorized_by_id=data.authorized_by,
    )
    db.add(entrada); db.flush()

    db.commit()
    return {"ok": True, "source_movement_id": salida.id,
            "destination_movement_id": entrada.id}


# =============================================================================
# MÓDULO COMPRAS — CRUD
# Flujo: Proveedor → OC → Recepción → Stock+CxP → Abono proveedor
# =============================================================================

# ── helpers ──────────────────────────────────────────────────────────────────

def _next_folio(db, empresa_id: str, prefix: str, table_col) -> str:
    """Folio autoincremental por empresa. ej: OC-2026-0001 / REC-2026-0001."""
    from sqlalchemy import func as sqlfunc
    # Filtrar por empresa_id para evitar conteo cross-tenant
    empresa_col = table_col.class_.empresa_id
    count = (db.query(sqlfunc.count(table_col))
               .filter(empresa_col == empresa_id, table_col.ilike(f"{prefix}%"))
               .scalar() or 0)
    return f"{prefix}{count + 1:04d}"


# ── PROVEEDORES ───────────────────────────────────────────────────────────────

def get_suppliers(db, empresa_id: str, status: str | None = None,
                  skip: int = 0, limit: int = 50):
    q = db.query(models.Supplier).filter(models.Supplier.empresa_id == empresa_id)
    if status:
        q = q.filter(models.Supplier.status == status)
    return q.order_by(models.Supplier.name).offset(skip).limit(limit).all()


def get_supplier(db, empresa_id: str, supplier_id: str):
    return (db.query(models.Supplier)
              .filter(models.Supplier.empresa_id == empresa_id,
                      models.Supplier.id == supplier_id)
              .first())


def create_supplier(db, empresa_id: str, data: dict) -> models.Supplier:
    supplier = models.Supplier(empresa_id=empresa_id, **data)
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


def update_supplier(db, empresa_id: str, supplier_id: str,
                    data: dict) -> models.Supplier | None:
    supplier = get_supplier(db, empresa_id, supplier_id)
    if not supplier:
        return None
    for k, v in data.items():
        if hasattr(supplier, k):
            setattr(supplier, k, v)
    from sqlalchemy.sql import func as sqlfunc2
    supplier.updated_at = sqlfunc2.now()
    db.commit()
    db.refresh(supplier)
    return supplier


# ── ÓRDENES DE COMPRA ─────────────────────────────────────────────────────────

def get_purchase_orders(db, empresa_id: str, status: str | None = None,
                        supplier_id: str | None = None,
                        skip: int = 0, limit: int = 50):
    q = db.query(models.PurchaseOrder).filter(
        models.PurchaseOrder.empresa_id == empresa_id)
    if status:
        q = q.filter(models.PurchaseOrder.status == status)
    if supplier_id:
        q = q.filter(models.PurchaseOrder.supplier_id == supplier_id)
    return q.order_by(models.PurchaseOrder.issue_date.desc()).offset(skip).limit(limit).all()


def get_purchase_order(db, empresa_id: str, po_id: str):
    return (db.query(models.PurchaseOrder)
              .filter(models.PurchaseOrder.empresa_id == empresa_id,
                      models.PurchaseOrder.id == po_id)
              .first())


def _parse_date(value):
    """Convierte string ISO date/datetime a datetime con tz UTC. None→None."""
    if not value:
        return None
    from datetime import datetime, timezone
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(value)[:19], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def create_purchase_order(db, empresa_id: str, sucursal_id: str,
                          data: dict) -> models.PurchaseOrder:
    """Crea OC en DRAFT con sus ítems. Calcula subtotal/total."""
    items_data = data.pop("items", [])
    data["expected_date"] = _parse_date(data.get("expected_date"))
    folio = _next_folio(db, empresa_id, "OC-", models.PurchaseOrder.folio)
    po = models.PurchaseOrder(
        empresa_id=empresa_id, sucursal_id=sucursal_id,
        folio=folio, **data,
    )
    db.add(po)
    db.flush()

    from decimal import Decimal
    subtotal = Decimal("0")
    for item in items_data:
        qty = Decimal(str(item["quantity_ordered"]))
        cost = Decimal(str(item["unit_cost"]))
        sub = qty * cost
        poi = models.PurchaseOrderItem(
            empresa_id=empresa_id,
            purchase_order_id=po.id,
            product_id=item.get("product_id"),
            sku=item["sku"],
            description=item.get("description", ""),
            quantity_ordered=qty,
            unit_cost=cost,
            subtotal=sub,
        )
        db.add(poi)
        subtotal += sub

    po.subtotal = subtotal
    po.tax_amount = Decimal("0")   # IVA se calcula al emitir — en México es editorial del Contador
    po.total = subtotal
    db.commit()
    db.refresh(po)
    return po


def update_purchase_order(db, empresa_id: str, po_id: str,
                          data: dict) -> "models.PurchaseOrder | None":
    """Actualiza una OC en estado DRAFT. Reemplaza ítems completamente."""
    po = get_purchase_order(db, empresa_id, po_id)
    if not po or po.status != "DRAFT":
        return None

    items_data = data.pop("items", [])

    # Cabecera: solo campos permitidos
    for field in ["supplier_id", "notes"]:
        if field in data:
            setattr(po, field, data[field])
    if "expected_date" in data:
        po.expected_date = _parse_date(data["expected_date"])

    # Reemplazar ítems (delete + insert)
    db.query(models.PurchaseOrderItem).filter(
        models.PurchaseOrderItem.purchase_order_id == po_id,
        models.PurchaseOrderItem.empresa_id == empresa_id,
    ).delete(synchronize_session="fetch")

    from decimal import Decimal
    subtotal = Decimal("0")
    for item in items_data:
        qty  = Decimal(str(item["quantity_ordered"]))
        cost = Decimal(str(item["unit_cost"]))
        sub  = qty * cost
        poi  = models.PurchaseOrderItem(
            empresa_id=empresa_id,
            purchase_order_id=po.id,
            product_id=item.get("product_id"),
            sku=item["sku"],
            description=item.get("description", ""),
            quantity_ordered=qty,
            unit_cost=cost,
            subtotal=sub,
        )
        db.add(poi)
        subtotal += sub

    tax       = Decimal(str(data.get("tax_amount", 0)))
    po.subtotal   = subtotal
    po.tax_amount = tax
    po.total      = subtotal + tax

    db.commit()
    db.refresh(po)
    return po


def send_purchase_order(db, empresa_id: str, po_id: str,
                        authorized_by: str) -> models.PurchaseOrder | None:
    """DRAFT → SENT. Solo admin puede aprobar."""
    po = get_purchase_order(db, empresa_id, po_id)
    if not po or po.status != "DRAFT":
        return None
    po.status = "SENT"
    po.authorized_by = authorized_by
    db.commit()
    db.refresh(po)
    return po


def cancel_purchase_order(db, empresa_id: str, po_id: str) -> models.PurchaseOrder | None:
    """Cancela OC si está en DRAFT o SENT y no tiene recepciones."""
    po = get_purchase_order(db, empresa_id, po_id)
    if not po or po.status in ("COMPLETED", "CANCELLED"):
        return None
    receipts_count = (db.query(models.PurchaseReceipt)
                        .filter(models.PurchaseReceipt.empresa_id == empresa_id,
                                models.PurchaseReceipt.purchase_order_id == po_id)
                        .count())
    if receipts_count > 0:
        raise ValueError("No se puede cancelar una OC con recepciones registradas")
    po.status = "CANCELLED"
    db.commit()
    db.refresh(po)
    return po


# ── RECEPCIÓN DE MERCANCÍA ────────────────────────────────────────────────────

def receive_purchase(db, empresa_id: str, sucursal_id: str,
                     received_by: str, data: dict) -> dict:
    """Recibe mercancía contra OC o entrada directa.

    Efectos:
      1. WarehouseStock += quantity_received por ítem
      2. Product.stock  += quantity_received (cache total)
      3. Product.average_cost actualizado (costo promedio ponderado)
      4. InventoryMovement(COMPRA) por ítem
      5. PurchaseOrderItem.quantity_received += ... → status PARTIAL|RECEIVED
      6. PurchaseOrder.status → PARTIAL|COMPLETED
      7. AccountsPayable si payment_type=CREDIT
    """
    from decimal import Decimal
    import uuid as _uuid

    idk = data.get("idempotency_key") or str(_uuid.uuid4())

    # Idempotencia: si ya existe esta recepción, retornamos el id existente
    existing = (db.query(models.PurchaseReceipt)
                  .filter(models.PurchaseReceipt.empresa_id == empresa_id,
                          models.PurchaseReceipt.idempotency_key == idk)
                  .first())
    if existing:
        return {"ok": True, "receipt_id": existing.id, "duplicate": True}

    items_data = data.pop("items", [])
    po_id = data.get("purchase_order_id")
    supplier_id = data["supplier_id"]
    warehouse_id = data["warehouse_id"]
    payment_type = data.get("payment_type", "CREDIT")

    # Validar bodega
    wh = (db.query(models.Warehouse)
            .filter(models.Warehouse.empresa_id == empresa_id,
                    models.Warehouse.id == warehouse_id)
            .first())
    if not wh:
        raise ValueError(f"Bodega {warehouse_id} no encontrada")

    folio = _next_folio(db, empresa_id, "REC-", models.PurchaseReceipt.folio)
    receipt = models.PurchaseReceipt(
        empresa_id=empresa_id, sucursal_id=sucursal_id,
        folio=folio, received_by=received_by,
        idempotency_key=idk,
        **{k: v for k, v in data.items()
           if k not in ("idempotency_key",)},
    )
    db.add(receipt)
    db.flush()

    total_receipt = Decimal("0")

    for item in items_data:
        product_id = item["product_id"]
        qty = Decimal(str(item["quantity_received"]))
        cost = Decimal(str(item["unit_cost"]))
        sub = qty * cost
        total_receipt += sub

        # Ítem de recepción
        pri = models.PurchaseReceiptItem(
            empresa_id=empresa_id,
            receipt_id=receipt.id,
            purchase_order_item_id=item.get("purchase_order_item_id"),
            product_id=product_id,
            sku=item["sku"],
            description=item.get("description", ""),
            quantity_received=qty,
            unit_cost=cost,
            subtotal=sub,
        )
        db.add(pri)

        # WarehouseStock (upsert)
        ws = (db.query(models.WarehouseStock)
                .filter(models.WarehouseStock.empresa_id == empresa_id,
                        models.WarehouseStock.product_id == product_id,
                        models.WarehouseStock.warehouse_id == warehouse_id)
                .with_for_update()
                .first())
        if ws:
            ws.quantity += qty
        else:
            ws = models.WarehouseStock(
                empresa_id=empresa_id, product_id=product_id,
                warehouse_id=warehouse_id, quantity=qty)
            db.add(ws)
        db.flush()

        # Product.stock (cache) + costo promedio ponderado
        product = (db.query(models.Product)
                     .filter(models.Product.empresa_id == empresa_id,
                             models.Product.id == product_id)
                     .with_for_update()
                     .populate_existing()
                     .first())
        if product:
            old_stock = product.stock or Decimal("0")
            old_cost  = product.average_cost or Decimal("0")
            new_stock = old_stock + qty
            if new_stock > 0:
                product.average_cost = (
                    (old_stock * old_cost + qty * cost) / new_stock
                )
            product.stock = new_stock
            db.flush()

        # InventoryMovement(COMPRA)
        mv = models.InventoryMovement(
            empresa_id=empresa_id, sucursal_id=sucursal_id,
            product_id=product_id, warehouse_id=warehouse_id,
            movement_type="COMPRA", quantity=qty,
            unit_cost=cost, total_freight_cost=Decimal("0"),
            reference_type="RECEPCION_COMPRA", reference_id=receipt.id,
            idempotency_key=f"{idk}:{product_id}",
            reason=f"Recepción {folio}",
        )
        db.add(mv)

        # Actualizar PurchaseOrderItem si hay OC vinculada
        poi_id = item.get("purchase_order_item_id")
        if poi_id:
            poi = (db.query(models.PurchaseOrderItem)
                     .filter(models.PurchaseOrderItem.empresa_id == empresa_id,
                             models.PurchaseOrderItem.id == poi_id)
                     .first())
            if poi:
                poi.quantity_received = (poi.quantity_received or Decimal("0")) + qty
                if poi.quantity_received >= poi.quantity_ordered:
                    poi.status = "RECEIVED"
                else:
                    poi.status = "PARTIAL"

    receipt.subtotal = total_receipt
    receipt.total    = total_receipt

    # Avanzar estado de PurchaseOrder
    if po_id:
        po = get_purchase_order(db, empresa_id, po_id)
        if po and po.status not in ("CANCELLED",):
            all_items = (db.query(models.PurchaseOrderItem)
                           .filter(models.PurchaseOrderItem.empresa_id == empresa_id,
                                   models.PurchaseOrderItem.purchase_order_id == po_id)
                           .all())
            all_received = all(i.status == "RECEIVED" for i in all_items) if all_items else False
            po.status = "COMPLETED" if all_received else "PARTIAL"

    # AccountsPayable si pago a crédito
    if payment_type == "CREDIT":
        supplier = get_supplier(db, empresa_id, supplier_id)
        from datetime import datetime, timedelta
        credit_days = (supplier.credit_days or 0) if supplier else 0
        due = datetime.utcnow() + timedelta(days=credit_days) if credit_days else None
        ap = models.AccountsPayable(
            empresa_id=empresa_id, sucursal_id=sucursal_id,
            supplier_id=supplier_id,
            purchase_receipt_id=receipt.id,
            purchase_order_id=po_id,
            amount=total_receipt, balance=total_receipt,
            due_date=due,
        )
        db.add(ap)

    # Asiento contable: DEBE 151.01 / HABER 201.01
    entry = models.AccountingEntry(
        empresa_id=empresa_id, sucursal_id=sucursal_id,
        folio=f"AC-{folio}",
        fecha=models.func.now() if hasattr(models, 'func') else None,
        tipo="COMPRA",
        referencia_tipo="RECEPCION_COMPRA", referencia_id=receipt.id,
        total=total_receipt,
        notas=f"Recepción de mercancía {folio}",
    )
    db.add(entry)
    db.flush()
    db.add(models.AccountingEntryLine(
        empresa_id=empresa_id, entry_id=entry.id,
        cuenta_sat="151.01", cuenta_nombre="Inventario de Mercancías",
        tipo_movimiento="DEBE", monto=total_receipt,
        descripcion=f"Entrada por recepción {folio}",
    ))
    db.add(models.AccountingEntryLine(
        empresa_id=empresa_id, entry_id=entry.id,
        cuenta_sat="201.01", cuenta_nombre="Proveedores",
        tipo_movimiento="HABER", monto=total_receipt,
        descripcion=f"CxP proveedor — recepción {folio}",
    ))

    # T-4e: los resguardos abiertos de los SKUs recibidos pasan a EN_INVENTARIO
    resguardos_promovidos = promote_resguardos_por_sku(
        db, empresa_id,
        [it.get("sku") for it in items_data if it.get("sku")],
        sucursal_id=sucursal_id,
    )

    db.commit()
    return {"ok": True, "receipt_id": receipt.id, "folio": folio,
            "total": float(total_receipt),
            "resguardos_promovidos": resguardos_promovidos}


def get_purchase_receipts(db, empresa_id: str, supplier_id: str | None = None,
                          skip: int = 0, limit: int = 50):
    q = (db.query(models.PurchaseReceipt)
           .filter(models.PurchaseReceipt.empresa_id == empresa_id))
    if supplier_id:
        q = q.filter(models.PurchaseReceipt.supplier_id == supplier_id)
    return q.order_by(models.PurchaseReceipt.receipt_date.desc()).offset(skip).limit(limit).all()


# ── CUENTAS POR PAGAR ─────────────────────────────────────────────────────────

def get_accounts_payable(db, empresa_id: str, status: str | None = None,
                         supplier_id: str | None = None,
                         skip: int = 0, limit: int = 50):
    q = (db.query(models.AccountsPayable)
           .filter(models.AccountsPayable.empresa_id == empresa_id))
    if status:
        q = q.filter(models.AccountsPayable.status == status)
    if supplier_id:
        q = q.filter(models.AccountsPayable.supplier_id == supplier_id)
    return q.order_by(models.AccountsPayable.due_date.asc()).offset(skip).limit(limit).all()


def pay_accounts_payable(db, empresa_id: str, ap_id: str,
                         registered_by: str, data: dict) -> dict:
    """Registra abono a CxP. Si saldo = 0 → PAID. Genera asiento contable."""
    from decimal import Decimal

    ap = (db.query(models.AccountsPayable)
            .filter(models.AccountsPayable.empresa_id == empresa_id,
                    models.AccountsPayable.id == ap_id)
            .with_for_update()
            .first())
    if not ap:
        raise ValueError("CxP no encontrada")
    if ap.status == "PAID":
        raise ValueError("Esta CxP ya está pagada")

    amount = Decimal(str(data["amount"]))
    if amount > ap.balance:
        raise ValueError(f"El abono ({amount}) supera el saldo ({ap.balance})")

    payment = models.SupplierPayment(
        empresa_id=empresa_id,
        accounts_payable_id=ap.id,
        amount=amount,
        payment_method=data.get("payment_method", "CASH"),
        reference=data.get("reference"),
        registered_by=registered_by,
        notes=data.get("notes"),
    )
    db.add(payment)

    ap.amount_paid += amount
    ap.balance     -= amount
    if ap.balance <= Decimal("0"):
        ap.status = "PAID"
        ap.balance = Decimal("0")
    elif ap.status == "PENDING":
        ap.status = "PARTIAL"
    from sqlalchemy.sql import func as sqlfunc3
    ap.updated_at = sqlfunc3.now()

    # Asiento: DEBE 201.01 (CxP) / HABER 102.01 (Caja)
    entry = models.AccountingEntry(
        empresa_id=empresa_id, sucursal_id=ap.sucursal_id,
        folio=f"PAG-{str(ap.id)[:8].upper()}",
        fecha=None,
        tipo="PAGO_PROVEEDOR",
        referencia_tipo="SUPPLIER_PAYMENT", referencia_id=ap.id,
        total=amount,
        notas=f"Abono CxP proveedor — {data.get('reference', '')}",
    )
    db.add(entry)
    db.flush()
    db.add(models.AccountingEntryLine(
        empresa_id=empresa_id, entry_id=entry.id,
        cuenta_sat="201.01", cuenta_nombre="Proveedores",
        tipo_movimiento="DEBE", monto=amount,
        descripcion="Cancelación parcial/total CxP",
    ))
    db.add(models.AccountingEntryLine(
        empresa_id=empresa_id, entry_id=entry.id,
        cuenta_sat="102.01", cuenta_nombre="Bancos / Caja",
        tipo_movimiento="HABER", monto=amount,
        descripcion="Salida de caja para pago a proveedor",
    ))

    db.commit()
    return {"ok": True, "payment_id": payment.id,
            "new_balance": float(ap.balance), "status": ap.status}


# =============================================================================
# PRE-RESERVAS DE INVENTARIO (C-04 / nr07_stock_reservation)
# =============================================================================

def _active_reserved_qty(db: Session, empresa_id: str,
                          product_id: str, warehouse_id: str) -> Decimal:
    from sqlalchemy import update as _upd
    now = datetime.now(timezone.utc)
    total = (
        db.query(func.coalesce(func.sum(models.StockReservation.quantity), 0))
          .filter(
              models.StockReservation.empresa_id == empresa_id,
              models.StockReservation.product_id == product_id,
              models.StockReservation.warehouse_id == warehouse_id,
              models.StockReservation.status == "ACTIVE",
              models.StockReservation.expires_at > now,
          )
          .scalar()
    )
    return Decimal(str(total or 0))


def get_available_stock_reserved(db: Session, empresa_id: str,
                                  product_id: str, warehouse_id: str) -> dict:
    ws = (
        db.query(models.WarehouseStock)
          .filter_by(empresa_id=empresa_id, product_id=product_id,
                     warehouse_id=warehouse_id)
          .first()
    )
    physical = Decimal(str(ws.quantity)) if ws else Decimal("0")
    reserved = _active_reserved_qty(db, empresa_id, product_id, warehouse_id)
    available = max(Decimal("0"), physical - reserved)
    return {"physical": float(physical), "reserved": float(reserved),
            "available": float(available)}


def reserve_stock(db: Session, empresa_id: str, sucursal_id: str,
                  product_id: str, warehouse_id: str, quantity: float,
                  reference_type: str, reference_id: str,
                  expires_minutes: int = 180,
                  created_by: str = None) -> models.StockReservation:
    import uuid as _uuid
    qty = Decimal(str(quantity))
    stock_info = get_available_stock_reserved(db, empresa_id, product_id, warehouse_id)
    if Decimal(str(stock_info["available"])) < qty:
        raise ValueError(
            f"Stock insuficiente para reservar: "
            f"disponible {stock_info['available']}, solicitado {float(qty)}"
        )
    res = models.StockReservation(
        id=str(_uuid.uuid4()),
        empresa_id=empresa_id,
        sucursal_id=sucursal_id,
        product_id=product_id,
        warehouse_id=warehouse_id,
        quantity=qty,
        reference_type=reference_type,
        reference_id=reference_id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=expires_minutes),
        status="ACTIVE",
        created_by=created_by,
    )
    db.add(res)
    return res


def release_reservation(db: Session, empresa_id: str,
                         reservation_id: str) -> bool:
    res = (
        db.query(models.StockReservation)
          .filter_by(empresa_id=empresa_id, id=reservation_id, status="ACTIVE")
          .first()
    )
    if not res:
        return False
    res.status = "RELEASED"
    return True


def consume_reservations(db: Session, empresa_id: str,
                          reference_type: str, reference_id: str) -> int:
    from sqlalchemy import update as _upd
    result = db.execute(
        _upd(models.StockReservation)
        .where(
            models.StockReservation.empresa_id == empresa_id,
            models.StockReservation.reference_type == reference_type,
            models.StockReservation.reference_id == reference_id,
            models.StockReservation.status == "ACTIVE",
        )
        .values(status="CONSUMED")
    )
    return result.rowcount


def expire_old_reservations(db: Session, empresa_id: str = None) -> int:
    from sqlalchemy import update as _upd
    now = datetime.now(timezone.utc)
    q = (
        _upd(models.StockReservation)
        .where(
            models.StockReservation.status == "ACTIVE",
            models.StockReservation.expires_at <= now,
        )
    )
    if empresa_id:
        q = q.where(models.StockReservation.empresa_id == empresa_id)
    result = db.execute(q.values(status="EXPIRED"))
    return result.rowcount
