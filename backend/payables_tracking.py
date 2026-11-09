"""Seguimiento de Cuentas por Pagar (CxP).

Alimenta y expone, para cada cuenta por pagar, los datos de seguimiento que exige
Tesorería: folio de la cuenta (CXP-AAAA-####), folio fiscal (UUID del CFDI), serie/folio,
fecha de recepción, fecha de emisión, fecha de vencimiento, expediente de origen y los
archivos de la factura (XML/PDF) para visualizarla desde el listado.

Las CxP se generan desde Recepción de Mercancía 360° (routers/receptions.py), pero también
pueden existir de otras fuentes (importación inicial, módulo legado). Por eso `hydrate_payable`
completa en caliente lo que falte consultando el expediente / gasto de flete que la originó.
"""
from __future__ import annotations

import base64
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import models

# Columnas de seguimiento que el SQLite local debe tener (en Postgres las crea Alembic).
AP_TRACKING_COLUMNS = {
    "folio": "VARCHAR",
    "invoice_uuid": "VARCHAR",
    "invoice_ref": "VARCHAR",
    "issue_date": "DATETIME",
    "receipt_date": "DATETIME",
    "expediente_id": "VARCHAR",
    "concept": "VARCHAR",
    "credit_days": "INTEGER",
}

DOC_KINDS_MERC = ("FACTURA_XML", "FACTURA_PDF")
DOC_KINDS_FLETE = ("FLETE_XML", "FLETE_PDF")


def ensure_ap_columns(engine) -> None:
    """SQLite local: create_all() no hace ALTER; añade en caliente las columnas de seguimiento."""
    try:
        if engine.dialect.name != "sqlite":
            return
        from sqlalchemy import text as _t
        with engine.begin() as conn:
            have = {r[1] for r in conn.execute(_t("PRAGMA table_info(accounts_payable)"))}
            if not have:
                return
            for col, ddl in AP_TRACKING_COLUMNS.items():
                if col not in have:
                    conn.execute(_t(f"ALTER TABLE accounts_payable ADD COLUMN {col} {ddl}"))
    except Exception as e:  # nunca tumbar el arranque por esto
        import logging
        logging.getLogger("calebsys").warning("[CxP] ensure_ap_columns: %s", e)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _iso(dt: Any) -> Optional[str]:
    if not dt:
        return None
    try:
        return dt.isoformat()
    except Exception:
        return str(dt)


def _iso_utc(dt: Any) -> Optional[str]:
    """Fecha-hora real del sistema (UTC). SQLite devuelve datetimes sin zona: se marcan como UTC para
    que el navegador las convierta a la hora local correcta."""
    if not dt:
        return None
    try:
        if getattr(dt, "tzinfo", None) is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return str(dt)


def _iso_local(dt: Any) -> Optional[str]:
    """Fecha de emisión del CFDI: es hora local del emisor, se entrega sin zona para no desplazarla."""
    if not dt:
        return None
    try:
        return dt.replace(tzinfo=None).isoformat()
    except Exception:
        return str(dt)


def parse_dt(value: Any) -> Optional[datetime]:
    """Convierte '2026-10-24T10:00:00' / '2026-10-24' / datetime en datetime con zona UTC."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip().replace("Z", "+00:00")
    for cand in (s, s[:19], s[:10]):
        try:
            d = datetime.fromisoformat(cand)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            continue
    return None


def next_cxp_folio(db: Session, empresa_id: str) -> str:
    """Folio CXP-AAAA-#### consecutivo por empresa (sin reutilizar huecos)."""
    stem = f"CXP-{_now().year}-"
    col = models.AccountsPayable.folio
    count = (
        db.query(func.count(col))
        .filter(models.AccountsPayable.empresa_id == empresa_id, col.like(f"{stem}%"))
        .scalar()
        or 0
    )
    n = int(count) + 1
    while True:
        folio = f"{stem}{n:04d}"
        exists = (
            db.query(models.AccountsPayable.id)
            .filter(models.AccountsPayable.empresa_id == empresa_id, col == folio)
            .first()
        )
        if not exists:
            return folio
        n += 1


def _xml_facts(db: Session, empresa_id: str, exp_id: str, kinds, item_ref: Optional[str]) -> Dict[str, Optional[str]]:
    """Fecha de emisión / UUID leídos del XML adjunto (por si el expediente no los guardó)."""
    q = db.query(models.ReceptionFile).filter(
        models.ReceptionFile.empresa_id == empresa_id,
        models.ReceptionFile.expediente_id == exp_id,
        models.ReceptionFile.kind == kinds[0],
    )
    if item_ref:
        q = q.filter(models.ReceptionFile.item_ref == item_ref)
    f = q.first()
    out: Dict[str, Optional[str]] = {"fecha": None, "uuid": None, "serie_folio": None}
    if not f:
        return out
    try:
        xml = base64.b64decode(f.content_b64).decode("utf-8", errors="ignore")
    except Exception:
        return out
    m = re.search(r'<[\w:]*Comprobante\b[^>]*?\bFecha="([^"]+)"', xml)
    if m:
        out["fecha"] = m.group(1)
    m = re.search(r'\bUUID="([0-9A-Fa-f-]{36})"', xml)
    if m:
        out["uuid"] = m.group(1).upper()
    s = re.search(r'<[\w:]*Comprobante\b[^>]*?\bSerie="([^"]*)"', xml)
    fo = re.search(r'<[\w:]*Comprobante\b[^>]*?\bFolio="([^"]*)"', xml)
    sf = ((s.group(1) if s else "") + (fo.group(1) if fo else "")).strip()
    out["serie_folio"] = sf or None
    return out


def hydrate_payable(db: Session, ap: models.AccountsPayable) -> bool:
    """Completa en la CxP los datos de seguimiento que falten. Devuelve True si cambió algo."""
    changed = False
    empresa_id = ap.empresa_id
    exp = None
    expense = None
    if ap.expediente_id:
        exp = (db.query(models.ReceptionExpediente)
               .filter(models.ReceptionExpediente.empresa_id == empresa_id,
                       models.ReceptionExpediente.id == ap.expediente_id).first())
    if exp is None:
        exp = (db.query(models.ReceptionExpediente)
               .filter(models.ReceptionExpediente.empresa_id == empresa_id,
                       models.ReceptionExpediente.accounts_payable_id == ap.id).first())
        if exp is not None:
            ap.concept = ap.concept or "MERCANCIA"
    if exp is None:
        expense = (db.query(models.OperatingExpense)
                   .filter(models.OperatingExpense.empresa_id == empresa_id,
                           models.OperatingExpense.accounts_payable_id == ap.id).first())
        if expense is not None and expense.expediente_id:
            exp = (db.query(models.ReceptionExpediente)
                   .filter(models.ReceptionExpediente.empresa_id == empresa_id,
                           models.ReceptionExpediente.id == expense.expediente_id).first())
            ap.concept = ap.concept or "FLETE"
    elif ap.concept == "FLETE":
        expense = (db.query(models.OperatingExpense)
                   .filter(models.OperatingExpense.empresa_id == empresa_id,
                           models.OperatingExpense.accounts_payable_id == ap.id).first())

    def setv(attr: str, value: Any) -> None:
        nonlocal changed
        if value not in (None, "") and getattr(ap, attr, None) in (None, ""):
            setattr(ap, attr, value)
            changed = True

    if exp is not None:
        setv("expediente_id", exp.id)
        setv("receipt_date", exp.created_at)
        if ap.concept in (None, "", "MERCANCIA"):
            setv("concept", "MERCANCIA")
            ref = f"{exp.invoice_serie or ''}{exp.invoice_folio or ''}".strip()
            setv("invoice_uuid", (exp.invoice_uuid or "").upper() or None)
            setv("invoice_ref", ref or None)
            issue = parse_dt(exp.invoice_date)
            if issue is None:
                issue = parse_dt(_xml_facts(db, empresa_id, exp.id, DOC_KINDS_MERC, None).get("fecha"))
            setv("issue_date", issue)
        else:  # FLETE
            n = None
            if expense is not None and isinstance(expense.detail, dict):
                n = expense.detail.get("traslado")
            facts = _xml_facts(db, empresa_id, exp.id, DOC_KINDS_FLETE, f"FLETE{n}" if n else None) if n else {}
            setv("invoice_uuid", ((expense.doc_uuid if expense else None) or facts.get("uuid") or "").upper() or None)
            setv("invoice_ref", (expense.doc_folio if expense else None) or facts.get("serie_folio"))
            setv("issue_date", parse_dt(facts.get("fecha")))
    elif ap.concept is None:
        ap.concept = "MANUAL" if not ap.purchase_receipt_id else "MERCANCIA"
        changed = True

    if ap.receipt_date is None and ap.created_at is not None:
        ap.receipt_date = ap.created_at
        changed = True

    if ap.credit_days is None:
        sup = (db.query(models.Supplier)
               .filter(models.Supplier.empresa_id == empresa_id, models.Supplier.id == ap.supplier_id).first())
        ap.credit_days = int((sup.credit_days or 0) if sup else 0)
        changed = True
    if ap.due_date is None and ap.receipt_date is not None:
        base = parse_dt(ap.receipt_date) or _now()
        ap.due_date = base + timedelta(days=int(ap.credit_days or 0))
        changed = True

    if not ap.folio:
        ap.folio = next_cxp_folio(db, empresa_id)
        changed = True
        db.flush()
    return changed


def sync_payables(db: Session, empresa_id: str) -> int:
    """Asigna folio y completa datos de seguimiento a las CxP que aún no los tienen."""
    rows = (
        db.query(models.AccountsPayable)
        .filter(models.AccountsPayable.empresa_id == empresa_id,
                or_(models.AccountsPayable.folio.is_(None), models.AccountsPayable.folio == "",
                    models.AccountsPayable.concept.is_(None),
                    models.AccountsPayable.due_date.is_(None)))
        .order_by(models.AccountsPayable.created_at.asc())
        .all()
    )
    n = 0
    for ap in rows:
        try:
            if hydrate_payable(db, ap):
                n += 1
        except Exception:
            db.rollback()
            raise
    if n:
        db.commit()
    return n


def _supplier_map(db: Session, empresa_id: str, ids: List[str]) -> Dict[str, models.Supplier]:
    if not ids:
        return {}
    return {s.id: s for s in db.query(models.Supplier)
            .filter(models.Supplier.empresa_id == empresa_id, models.Supplier.id.in_(ids)).all()}


def _exp_map(db: Session, empresa_id: str, ids: List[str]) -> Dict[str, models.ReceptionExpediente]:
    ids = [i for i in ids if i]
    if not ids:
        return {}
    return {e.id: e for e in db.query(models.ReceptionExpediente)
            .filter(models.ReceptionExpediente.empresa_id == empresa_id, models.ReceptionExpediente.id.in_(ids)).all()}


def _row(ap: models.AccountsPayable, sup: Optional[models.Supplier], exp: Optional[models.ReceptionExpediente]) -> Dict[str, Any]:
    return {
        "id": ap.id, "folio": ap.folio, "supplier_id": ap.supplier_id,
        "supplier_name": sup.name if sup else None, "supplier_rfc": sup.rfc if sup else None,
        "concept": ap.concept, "amount": _f(ap.amount), "total": _f(ap.amount),
        "amount_paid": _f(ap.amount_paid), "balance": _f(ap.balance), "status": ap.status,
        "due_date": _iso_utc(ap.due_date), "issue_date": _iso_local(ap.issue_date), "receipt_date": _iso_utc(ap.receipt_date),
        "invoice_uuid": ap.invoice_uuid, "invoice_ref": ap.invoice_ref, "credit_days": ap.credit_days,
        "expediente_id": ap.expediente_id, "receipt_folio": exp.folio if exp else None,
        "purchase_receipt_id": ap.purchase_receipt_id,
        "has_invoice": bool(ap.expediente_id),
    }


def list_payables(db: Session, empresa_id: str, status: Optional[str], supplier_id: Optional[str],
                  skip: int, limit: int) -> List[Dict[str, Any]]:
    sync_payables(db, empresa_id)
    q = db.query(models.AccountsPayable).filter(models.AccountsPayable.empresa_id == empresa_id)
    if status:
        q = q.filter(models.AccountsPayable.status == status)
    if supplier_id:
        q = q.filter(models.AccountsPayable.supplier_id == supplier_id)
    aps = q.order_by(models.AccountsPayable.due_date.asc()).offset(skip).limit(limit).all()
    sups = _supplier_map(db, empresa_id, list({a.supplier_id for a in aps}))
    exps = _exp_map(db, empresa_id, [a.expediente_id for a in aps])
    return [_row(a, sups.get(a.supplier_id), exps.get(a.expediente_id)) for a in aps]


def _doc_files(db: Session, ap: models.AccountsPayable, exp: Optional[models.ReceptionExpediente]) -> List[Dict[str, Any]]:
    """XML/PDF de la factura que dio origen a la CxP (mercancía o el traslado de flete correspondiente)."""
    if exp is None:
        return []
    q = db.query(models.ReceptionFile).filter(models.ReceptionFile.empresa_id == ap.empresa_id,
                                              models.ReceptionFile.expediente_id == exp.id)
    out = []
    if ap.concept == "FLETE":
        n = None
        x = (db.query(models.OperatingExpense)
             .filter(models.OperatingExpense.empresa_id == ap.empresa_id,
                     models.OperatingExpense.accounts_payable_id == ap.id).first())
        if x is not None and isinstance(x.detail, dict):
            n = x.detail.get("traslado")
        files = [f for f in q.filter(models.ReceptionFile.kind.in_(DOC_KINDS_FLETE)).order_by(models.ReceptionFile.created_at.asc()).all()
                 if (not n or f.item_ref in (None, "", f"FLETE{n}"))]
    else:
        files = q.filter(models.ReceptionFile.kind.in_(DOC_KINDS_MERC)).order_by(models.ReceptionFile.created_at.asc()).all()
    for f in files:
        out.append({"id": f.id, "kind": f.kind, "filename": f.filename, "mime": f.mime, "size": f.size_bytes})
    return out


def payable_detail(db: Session, empresa_id: str, ap_id: str) -> Optional[Dict[str, Any]]:
    ap = (db.query(models.AccountsPayable)
          .filter(models.AccountsPayable.empresa_id == empresa_id, models.AccountsPayable.id == ap_id).first())
    if not ap:
        return None
    if hydrate_payable(db, ap):
        db.commit()
    sup = _supplier_map(db, empresa_id, [ap.supplier_id]).get(ap.supplier_id)
    exp = _exp_map(db, empresa_id, [ap.expediente_id]).get(ap.expediente_id) if ap.expediente_id else None
    d = _row(ap, sup, exp)
    d["payments"] = [
        {"id": p.id, "amount": _f(p.amount), "payment_method": p.payment_method,
         "payment_date": str(p.payment_date), "reference": p.reference}
        for p in (ap.payments or [])
    ]
    d["invoice_files"] = _doc_files(db, ap, exp)
    d["receipt_folio_legacy"] = None
    invoice = None
    if exp is not None:
        P = exp.payload or {}
        F = P.get("p3_factura") or {}
        if ap.concept == "FLETE":
            invoice = {"tipo": "FLETE", "uuid": ap.invoice_uuid, "serie_folio": ap.invoice_ref,
                       "fecha": _iso_local(ap.issue_date), "total": _f(ap.amount), "conceptos": []}
            x = (db.query(models.OperatingExpense)
                 .filter(models.OperatingExpense.empresa_id == empresa_id,
                         models.OperatingExpense.accounts_payable_id == ap.id).first())
            leg_n = (x.detail or {}).get("traslado") if (x is not None and isinstance(x.detail, dict)) else None
            for t in ((P.get("p7_flete") or {}).get("traslados") or []):
                if leg_n is not None and t.get("n") == leg_n:
                    invoice["conceptos"] = [
                        {"codigo": r.get("type"), "descripcion": r.get("note") or r.get("type"),
                         "cantidad": 1, "valor_unitario": _f(r.get("amount")), "importe": _f(r.get("amount"))}
                        for r in (t.get("renglones") or [])
                    ]
                    invoice["transportista"] = t.get("transportista")
        else:
            invoice = {
                "tipo": "MERCANCIA", "uuid": exp.invoice_uuid, "serie_folio": ap.invoice_ref,
                "fecha": F.get("fecha") or exp.invoice_date, "subtotal": _f(exp.subtotal), "iva": _f(exp.tax_amount),
                "total": _f(exp.total), "metodo_pago": F.get("metodoPago"), "forma_pago": F.get("formaPago"),
                "conceptos": F.get("conceptos") or [],
            }
        d["receipt_status"] = exp.status
        d["payable_total"] = _f(exp.payable_total)
        d["disputed_amount"] = _f(exp.disputed_amount)
    d["invoice"] = invoice
    return d


def payable_file(db: Session, empresa_id: str, ap_id: str, file_id: str) -> Optional[models.ReceptionFile]:
    """Devuelve el archivo SOLO si pertenece al expediente de esa CxP y es un documento de factura."""
    ap = (db.query(models.AccountsPayable)
          .filter(models.AccountsPayable.empresa_id == empresa_id, models.AccountsPayable.id == ap_id).first())
    if not ap or not ap.expediente_id:
        return None
    return (db.query(models.ReceptionFile)
            .filter(models.ReceptionFile.empresa_id == empresa_id, models.ReceptionFile.id == file_id,
                    models.ReceptionFile.expediente_id == ap.expediente_id,
                    models.ReceptionFile.kind.in_(DOC_KINDS_MERC + DOC_KINDS_FLETE)).first())
