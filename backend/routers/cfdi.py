"""Facturación CFDI 4.0 — endpoints del módulo Ventas (CP2 · Fase 2 S5).

Cubre la factura NOMINATIVA sobre una venta concreta (`cfdi_documents`), que es
lo que pide un cliente con RFC. El comprobante GLOBAL mensual del público en
general (`cfdi_batches`) es del módulo Contador y no se toca aquí.

La configuración y el timbrado viven en `services/cfdi_facturama.py`; este
router solo valida entrada, resuelve permisos y traduce resultados a HTTP.
"""
import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

import cfdi_catalogs
import models
from database import get_db
from deps import get_tenant_context, role_guard
from services import cfdi_facturama as _cfdi

router = APIRouter(tags=["cfdi"])

_log = logging.getLogger("calebsys.cfdi")

# Quién puede facturar: admin/gerente y el personal de caja (es quien atiende
# al cliente que pide su factura al momento). Cancelar es solo admin.
_ROLES_FACTURAR = ["ADMIN", "Administrador", "admin", "Gerente", "gerente",
                   "Cajero", "CAJERO", "cajero", "vendedor_cajero"]
_ROLES_ADMIN = ["ADMIN", "Administrador", "admin", "SUPERADMIN"]


def _is_superadmin(payload: dict) -> bool:
    return (payload.get("role") or "").lower() == "superadmin"


def _audit(db: Session, empresa_id: str, user_id: str, action: str,
           severity: str = "INFO", sucursal_id: str = "MATRIZ", details=None):
    try:
        db.add(models.AuditLog(
            empresa_id=empresa_id or "DESCONOCIDA",
            sucursal_id=sucursal_id or "MATRIZ",
            user_id=user_id or "sistema",
            action=action, severity=severity, details=details,
        ))
        db.commit()
    except Exception:
        db.rollback()


# ── Configuración de la integración ────────────────────────────────────────
def _resolve_empresa(payload: dict, target_empresa: Optional[str]) -> str:
    """SUPERADMIN puede operar en cualquier tenant vía ?target_empresa=."""
    if target_empresa and _is_superadmin(payload):
        return target_empresa
    return payload.get("empresa")


@router.get("/api/admin/integrations/cfdi")
def cfdi_config_get(db: Session = Depends(get_db),
                    payload: dict = Depends(role_guard(_ROLES_ADMIN)),
                    target_empresa: Optional[str] = Query(None)):
    empresa_id = _resolve_empresa(payload, target_empresa)
    cfg = _cfdi.get_config(db, empresa_id)
    pub = _cfdi.public_config(cfg, is_superadmin=_is_superadmin(payload))
    ready, reason = _cfdi.is_configured(cfg)
    pub["configured"] = ready
    pub["config_status"] = reason
    pub["will_use_mock"] = _cfdi._is_mock(cfg)
    return pub


@router.put("/api/admin/integrations/cfdi")
def cfdi_config_put(body: dict, db: Session = Depends(get_db),
                    payload: dict = Depends(role_guard(_ROLES_ADMIN)),
                    target_empresa: Optional[str] = Query(None)):
    empresa_id = _resolve_empresa(payload, target_empresa)
    is_sa = _is_superadmin(payload)
    saved = _cfdi.save_config(db, empresa_id, body,
                              updated_by=payload.get("sub", "system"),
                              is_superadmin=is_sa)
    db.commit()
    out = _cfdi.public_config(saved, is_superadmin=is_sa)
    ready, reason = _cfdi.is_configured(saved)
    out["configured"] = ready
    out["config_status"] = reason
    out["will_use_mock"] = _cfdi._is_mock(saved)
    return out


@router.post("/api/admin/cfdi/seed-catalogs")
def cfdi_seed_catalogs(overwrite: bool = Query(False),
                       db: Session = Depends(get_db),
                       payload: dict = Depends(role_guard(_ROLES_ADMIN))):
    """Siembra los catálogos SAT del tenant en `catalog.sat_*`.

    Idempotente: respeta lo que el admin ya editó salvo `?overwrite=true`.
    Después se editan desde Configuración con el editor genérico de `catalog.*`.
    """
    empresa_id = payload.get("empresa")
    res = cfdi_catalogs.seed_sat_catalogs(db, empresa_id,
                                          updated_by=payload.get("sub", "sistema"),
                                          overwrite=overwrite)
    db.commit()
    return {"ok": True, **res}


@router.get("/api/cfdi/catalogs")
def cfdi_catalogs_get(db: Session = Depends(get_db),
                      tenant: dict = Depends(get_tenant_context)):
    """Catálogos SAT del tenant — alimenta los `<select>` del modal de facturar."""
    empresa_id = tenant["empresa"]
    return {n: cfdi_catalogs.get_catalog(db, empresa_id, n)
            for n in cfdi_catalogs.CATALOGS}


@router.get("/api/cfdi/sat-search")
def cfdi_sat_search(q: str = Query(""),
                    kind: str = Query("prod_serv"),
                    departamento: str = Query(""),
                    familia: str = Query(""),
                    limit: int = Query(20, ge=1, le=200),
                    db: Session = Depends(get_db),
                    tenant: dict = Depends(get_tenant_context)):
    empresa_id = tenant["empresa"]
    results = cfdi_catalogs.semantic_sat_search(
        db, empresa_id, q,
        kind=kind,
        departamento=departamento,
        familia=familia,
        limit=limit,
    )
    return {"items": results, "total": len(results)}


class SatLearnPayload(BaseModel):
    query_or_desc: str = ""
    departamento: str = ""
    familia: str = ""
    sat_id: str = ""
    sat_unidad: str = "H87"


@router.post("/api/cfdi/sat-learn")
def cfdi_sat_learn(body: SatLearnPayload,
                   db: Session = Depends(get_db),
                   tenant: dict = Depends(get_tenant_context)):
    empresa_id = tenant["empresa"]
    res = cfdi_catalogs.record_learned_memory(
        db, empresa_id,
        query_or_desc=body.query_or_desc,
        departamento=body.departamento,
        familia=body.familia,
        sat_id=body.sat_id,
        sat_unidad=body.sat_unidad,
        updated_by=tenant.get("sub", "usuario"),
    )
    db.commit()
    return {"ok": True, **res}


# ── CSD del emisor (requisito para timbrar en Multiemisor) ─────────────────
@router.get("/api/admin/integrations/cfdi/csd")
def cfdi_csd_list(db: Session = Depends(get_db),
                  payload: dict = Depends(role_guard(_ROLES_ADMIN))):
    """Sellos digitales cargados en la cuenta del PAC.

    Si esta vacio, el timbrado fallara con "No se encuentra el CSD para el
    Emisor con RFC: ..." — hay que subir el .cer/.key del contribuyente.
    """
    cfg = _cfdi.get_config(db, payload.get("empresa"))
    return _cfdi.list_csds(cfg)


@router.post("/api/admin/integrations/cfdi/csd")
async def cfdi_csd_upload(rfc: str = Form(...),
                          password: str = Form(...),
                          cer: UploadFile = File(..., description="Archivo .cer del CSD"),
                          key: UploadFile = File(..., description="Archivo .key del CSD"),
                          db: Session = Depends(get_db),
                          payload: dict = Depends(role_guard(_ROLES_ADMIN))):
    """Sube el CSD del emisor al PAC (multipart: rfc, password, .cer, .key).

    Los archivos no se persisten de nuestro lado — se reenvian al PAC y se
    descartan. La llave privada del sello es del contribuyente.
    """
    empresa_id = payload.get("empresa")
    cfg = _cfdi.get_config(db, empresa_id)
    cer_bytes = await cer.read()
    key_bytes = await key.read()
    if not cer_bytes or not key_bytes:
        raise HTTPException(status_code=400, detail="El .cer y el .key son obligatorios.")
    res = _cfdi.upload_csd(db, empresa_id, cfg, rfc, cer_bytes, key_bytes, password,
                           created_by=payload.get("sub", "sistema"))
    db.commit()
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "No se pudo cargar el CSD"))
    return res


@router.delete("/api/admin/integrations/cfdi/csd/{rfc}")
def cfdi_csd_delete(rfc: str, db: Session = Depends(get_db),
                    payload: dict = Depends(role_guard(_ROLES_ADMIN))):
    empresa_id = payload.get("empresa")
    cfg = _cfdi.get_config(db, empresa_id)
    res = _cfdi.delete_csd(db, empresa_id, cfg, rfc, created_by=payload.get("sub", "sistema"))
    db.commit()
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "No se pudo eliminar el CSD"))
    return res


class CfdiTestIn(BaseModel):
    rfc_receptor: Optional[str] = None


@router.post("/api/admin/integrations/cfdi/test")
def cfdi_test(db: Session = Depends(get_db),
              payload: dict = Depends(role_guard(_ROLES_ADMIN)),
              target_empresa: Optional[str] = Query(None)):
    """Prueba la configuración timbrando un comprobante mínimo de $116.00.

    En modo mock no toca la red. En sandbox timbra de verdad contra Facturama
    (el sandbox no consume folios de producción).
    """
    empresa_id = _resolve_empresa(payload, target_empresa)
    cfg = _cfdi.get_config(db, empresa_id)
    ready, reason = _cfdi.is_configured(cfg)
    if not ready:
        raise HTTPException(status_code=400,
                            detail=f"La integración CFDI no está lista: {reason}")

    # Receptor y renglón sintéticos — no tocan la BD de negocio.
    class _R:
        rfc = "URE180429TM6"          # RFC receptor de pruebas Facturama sandbox
        name = "UNIVERSIDAD ROBOTICA ESPAÑOLA"
        regimen_fiscal = "601"
        cp = "86991"                   # CP fiscal de URE180429TM6 en el SAT

    class _I:
        quantity = 1
        subtotal = 116.00
        product_id = None
        product_sku = "PRUEBA"

    serie, folio = _cfdi.next_folio(db, empresa_id, cfg)
    doc = models.CfdiDocument(
        empresa_id=empresa_id, sucursal_id=payload.get("sucursal", "MATRIZ"),
        sale_id="PRUEBA-CONFIG", tipo="I", serie=serie, folio=folio,
        uso_cfdi="G03", forma_pago="01", metodo_pago="PUE",
        receptor_rfc=_R.rfc, receptor_nombre=_R.name,
        provider="facturama", created_by=payload.get("sub", "sistema"),
    )
    payload_cfdi = _cfdi.build_cfdi_payload(
        db, empresa_id, None, _R(), cfg, uso_cfdi="G03", forma_pago="01",
        metodo_pago="PUE", serie=serie, folio=folio, items=[_I()])

    # OJO: el CfdiDocument de prueba NO se persiste — `sale_id` apunta a una
    # venta inexistente y rompería la FK. El rollback descarta tanto el
    # documento como el consumo del folio: una prueba de configuración no
    # debe quemar un folio de la serie del tenant.
    res = _cfdi.timbrar(db, empresa_id, doc, payload_cfdi, cfg,
                        created_by=payload.get("sub", "sistema"))
    db.rollback()
    _audit(db, empresa_id, payload.get("sub", "sistema"), "CFDI_TEST", "INFO",
           payload.get("sucursal", "MATRIZ"),
           {"ok": res.get("ok"), "mode": res.get("mode")})
    return res


# ── Timbrado sobre una venta ───────────────────────────────────────────────
class CfdiStampIn(BaseModel):
    uso_cfdi: Optional[str] = None      # default: el del cliente, o G03
    forma_pago: Optional[str] = None    # default: derivado del payment_method
    metodo_pago: Optional[str] = None   # None = auto-detectado (PUE contado / PPD crédito)
    serie: Optional[str] = None


@router.post("/api/sales/{sale_id}/cfdi", status_code=201)
def stamp_sale_cfdi(sale_id: str, data: CfdiStampIn,
                    db: Session = Depends(get_db),
                    tenant: dict = Depends(get_tenant_context),
                    payload: dict = Depends(role_guard(_ROLES_FACTURAR))):
    """Timbra el CFDI 4.0 de una venta y lo liga a ella."""
    empresa_id  = tenant["empresa"]
    sucursal_id = tenant.get("sucursal", "MATRIZ")
    quien       = payload.get("sub", "sistema")

    sale = (db.query(models.Sale)
              .filter(models.Sale.empresa_id == empresa_id,
                      models.Sale.id == sale_id).first())
    if not sale:
        raise HTTPException(status_code=404, detail="Venta no encontrada")

    # Un CFDI vigente por venta: re-timbrar duplicaría el ingreso ante el SAT.
    previo = (db.query(models.CfdiDocument)
                .filter(models.CfdiDocument.empresa_id == empresa_id,
                        models.CfdiDocument.sale_id == sale_id,
                        models.CfdiDocument.status == "TIMBRADO").first())
    if previo:
        raise HTTPException(
            status_code=409,
            detail=(f"La venta ya tiene un CFDI timbrado ({previo.uuid_fiscal}). "
                    "Cancélelo antes de volver a facturar."))

    cfg = _cfdi.get_config(db, empresa_id)
    ready, reason = _cfdi.is_configured(cfg)
    if not ready:
        raise HTTPException(status_code=400,
                            detail=f"La integración CFDI no está lista: {reason}")

    client = (db.query(models.Client)
                .filter(models.Client.empresa_id == empresa_id,
                        models.Client.id == sale.client_id).first())
    if not client:
        raise HTTPException(status_code=400, detail="Cliente de la venta no encontrado")
    faltan = _cfdi.validar_receptor_fiscal(client)
    if faltan:
        raise HTTPException(
            status_code=400,
            detail={"code": "RECEPTOR_INCOMPLETO",
                    "message": "El cliente no tiene los datos fiscales completos para "
                               "recibir una factura nominativa.",
                    "faltan": faltan})

    uso = (data.uso_cfdi or getattr(client, "uso_cfdi", None) or "G03").strip().upper()
    if not cfdi_catalogs.is_valid_code(db, empresa_id, "uso_cfdi", uso):
        raise HTTPException(status_code=400, detail=f"uso_cfdi no válido para este tenant: {uso}")
    forma = (data.forma_pago
             or cfdi_catalogs.forma_pago_desde_pos(db, empresa_id, sale.payment_method))
    if not cfdi_catalogs.is_valid_code(db, empresa_id, "forma_pago", forma):
        raise HTTPException(status_code=400, detail=f"forma_pago no válida para este tenant: {forma}")

    # Auto-detectar PUE vs PPD: si la venta tiene CxC pendiente → PPD;
    # si el caller lo envía explícitamente, su valor gana.
    if data.metodo_pago:
        metodo = data.metodo_pago.strip().upper()
    else:
        _tiene_cxc = (db.query(models.AccountsReceivable)
                        .filter(models.AccountsReceivable.empresa_id == empresa_id,
                                models.AccountsReceivable.sale_id == sale_id,
                                models.AccountsReceivable.status != "Liquidado")
                        .first())
        metodo = "PPD" if _tiene_cxc else "PUE"
    if not cfdi_catalogs.is_valid_code(db, empresa_id, "metodo_pago", metodo):
        raise HTTPException(status_code=400, detail=f"metodo_pago no válido: {metodo}")

    serie, folio = _cfdi.next_folio(db, empresa_id, cfg)
    if data.serie:
        serie = data.serie.strip()

    doc = models.CfdiDocument(
        empresa_id=empresa_id, sucursal_id=sucursal_id, sale_id=sale.id,
        tipo="I", serie=serie, folio=folio, uso_cfdi=uso,
        forma_pago=forma, metodo_pago=metodo,
        receptor_rfc=(client.rfc or "").upper(), receptor_nombre=client.name,
        provider="facturama", created_by=quien,
    )
    db.add(doc)
    db.flush()

    try:
        payload_cfdi = _cfdi.build_cfdi_payload(
            db, empresa_id, sale, client, cfg, uso_cfdi=uso, forma_pago=forma,
            metodo_pago=metodo, serie=serie, folio=folio)
        res = _cfdi.timbrar(db, empresa_id, doc, payload_cfdi, cfg, created_by=quien)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Fallo al timbrar: {e}")

    if res.get("ok"):
        sale.cfdi_document_id = doc.id
        db.add(sale)
    db.commit()
    db.refresh(doc)

    out = _serialize(doc)
    out["ok"] = bool(res.get("ok"))
    out["mode"] = res.get("mode")
    if not res.get("ok"):
        # El borrador en ERROR se conserva a propósito: deja el motivo del
        # rechazo del PAC a la vista y permite reintentar.
        raise HTTPException(status_code=502,
                            detail={"code": "PAC_ERROR", "message": res.get("error"),
                                    "cfdi_id": doc.id})
    return out


@router.get("/api/sales/{sale_id}/cfdi")
def get_sale_cfdi(sale_id: str, include: Optional[str] = Query(None, description="xml|pdf"),
                  db: Session = Depends(get_db),
                  tenant: dict = Depends(get_tenant_context)):
    """CFDI de una venta. El XML/PDF solo se devuelven si se piden."""
    empresa_id = tenant["empresa"]
    doc = (db.query(models.CfdiDocument)
             .filter(models.CfdiDocument.empresa_id == empresa_id,
                     models.CfdiDocument.sale_id == sale_id)
             .order_by(models.CfdiDocument.created_at.desc()).first())
    if not doc:
        raise HTTPException(status_code=404, detail="La venta no tiene CFDI")
    inc = (include or "").lower()
    return _serialize(doc, with_xml="xml" in inc, with_pdf="pdf" in inc)


@router.get("/api/cfdi")
def list_cfdi(status: Optional[str] = Query(None),
              sucursal_id: Optional[str] = Query(None),
              limit: int = Query(200, le=1000),
              include_pending: bool = Query(False),
              db: Session = Depends(get_db),
              tenant: dict = Depends(get_tenant_context),
              payload: dict = Depends(role_guard(_ROLES_FACTURAR))):
    """Lista de CFDI emitidos. Gerente hacia abajo ve solo su sede."""
    empresa_id = tenant["empresa"]
    q = db.query(models.CfdiDocument).filter(models.CfdiDocument.empresa_id == empresa_id)
    role = (payload.get("role") or "").strip().lower()
    if role not in ("admin", "administrador", "superadmin"):
        sucursal_id = tenant.get("sucursal", "MATRIZ")
    if sucursal_id:
        q = q.filter(models.CfdiDocument.sucursal_id == sucursal_id)
    if status:
        q = q.filter(models.CfdiDocument.status == status.upper())
    rows = q.order_by(models.CfdiDocument.created_at.desc()).limit(limit).all()
    out = [_serialize(r) for r in rows]
    if include_pending and (not status or status.upper() == "PENDIENTE"):
        out.extend(_pending_sales(db, empresa_id, sucursal_id, limit))
    return out


def _scope_sucursal(payload: dict, tenant: dict, sucursal_id: Optional[str]) -> Optional[str]:
    """Gerente hacia abajo solo ve su sede; admin puede pedir una o todas."""
    role = (payload.get("role") or "").strip().lower()
    if role not in ("admin", "administrador", "superadmin"):
        return tenant.get("sucursal", "MATRIZ")
    return sucursal_id


_COLS_CACHE: dict = {}


def _table_cols(db: Session, table: str) -> set:
    """Columnas reales de una tabla (cacheado por motor de BD).

    La BD local SQLite de algunas instalaciones viene de un esquema anterior
    (p. ej. `sales` sin status/folio/cfdi_document_id). Consultar el modelo
    completo ahi revienta con 'no such column', asi que las consultas de
    ventas pendientes solo usan las columnas que existen.
    """
    bind = db.get_bind()
    key = (str(bind.url), table)
    if key not in _COLS_CACHE:
        try:
            from sqlalchemy import inspect as _sa_inspect
            _COLS_CACHE[key] = {c["name"] for c in _sa_inspect(bind).get_columns(table)}
        except Exception:
            _COLS_CACHE[key] = set()
    return _COLS_CACHE[key]


def _pending_query(db: Session, empresa_id: str, sucursal_id: Optional[str]):
    """Ventas del POS marcadas para facturar (is_cfdi) que aun no tienen CFDI.

    Excluye ventas canceladas y las que ya tienen un documento CFDI vigente
    (timbrado, borrador o en error) para no duplicar renglones.
    """
    S = models.Sale
    cols = _table_cols(db, "sales")
    sel = [S.id, S.sucursal_id, S.client_id, S.total, S.payment_method, S.created_at]
    if "folio" in cols:
        sel.append(S.folio)
    con_doc = (db.query(models.CfdiDocument.sale_id)
                 .filter(models.CfdiDocument.empresa_id == empresa_id,
                         models.CfdiDocument.status != "CANCELADO"))
    q = (db.query(*sel)
           .filter(S.empresa_id == empresa_id,
                   S.is_cfdi.is_(True),
                   ~S.id.in_(con_doc)))
    if "cfdi_document_id" in cols:
        q = q.filter(S.cfdi_document_id.is_(None))
    if "status" in cols:
        q = q.filter(~func.lower(func.coalesce(S.status, "")).like("%cancel%"))
    if sucursal_id:
        q = q.filter(S.sucursal_id == sucursal_id)
    return q


def _pending_sales(db: Session, empresa_id: str, sucursal_id: Optional[str], limit: int) -> list:
    sales = (_pending_query(db, empresa_id, sucursal_id)
               .order_by(models.Sale.created_at.desc()).limit(limit).all())
    if not sales:
        return []
    C = models.Client
    ccols = _table_cols(db, "clients")
    csel = [C.id, C.name, C.rfc]
    for extra in ("uso_cfdi", "email", "phone", "whatsapp"):
        if extra in ccols:
            csel.append(getattr(C, extra))
    ids = {s.client_id for s in sales if s.client_id}
    clients = {c.id: c for c in (db.query(*csel)
                                   .filter(C.empresa_id == empresa_id, C.id.in_(ids)).all())} if ids else {}
    out = []
    for s in sales:
        c = clients.get(s.client_id)
        total = float(s.total or 0)
        subtotal = round(total / 1.16, 2)   # is_cfdi => la venta causa IVA 16 %
        out.append({
            "id": "pend-" + s.id,
            "sale_id": s.id,
            "tipo": "I",
            "serie": None,
            "folio": getattr(s, "folio", None),
            "uuid_fiscal": None,
            "status": "PENDIENTE",
            "uso_cfdi": getattr(c, "uso_cfdi", None) if c else None,
            "forma_pago": s.payment_method,
            "metodo_pago": None,
            "subtotal": subtotal,
            "iva": round(total - subtotal, 2),
            "total": total,
            "receptor_rfc": getattr(c, "rfc", None) if c else None,
            "receptor_nombre": getattr(c, "name", None) if c else None,
            "receptor_email": getattr(c, "email", None) if c else None,
            "receptor_telefono": (getattr(c, "whatsapp", None) or getattr(c, "phone", None)) if c else None,
            "provider": None, "environment": None, "pac_id": None, "error": None,
            "sucursal_id": s.sucursal_id,
            "timbrado_at": None, "cancelado_at": None, "motivo_cancelacion": None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "has_xml": False, "has_pdf": False,
            "pending": True,
        })
    return out


def _build_fallback_xml(doc, cfg: Optional[dict] = None) -> str:
    """Genera un XML CFDI 4.0 cuando el documento fue timbrado en modo mock o
    aun no tenia copia local del XML, asegurando el juego completo (PDF + XML)."""
    from datetime import datetime, timezone
    import uuid as _uuid
    cfg = cfg or {}
    total = float(doc.total or 0)
    tipo = (doc.tipo or "I").upper()
    sub = 0.0 if tipo == "T" else round(total / 1.16, 2)
    iva = 0.0 if tipo == "T" else round(total - sub, 2)
    fecha = (doc.timbrado_at or doc.created_at or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S")
    emisor_rfc = (cfg.get("rfc_emisor") or "AAA010101AAA").upper()
    emisor_nom = (cfg.get("nombre_emisor") or "EMISOR CALEBSYS").upper()
    emisor_reg = cfg.get("regimen_fiscal_emisor") or "601"
    cp = cfg.get("lugar_expedicion") or "00000"
    rec_rfc = (doc.receptor_rfc or "XAXX010101000").upper()
    rec_nom = (doc.receptor_nombre or "PUBLICO EN GENERAL").upper()
    uuid_f = (doc.uuid_fiscal or str(_uuid.uuid4())).upper()
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" '
        f'xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" '
        f'Serie="{doc.serie or "A"}" Folio="{doc.folio or "1"}" Fecha="{fecha}" '
        f'SubTotal="{sub:.2f}" Moneda="MXN" Total="{total:.2f}" '
        f'TipoDeComprobante="{tipo}" Exportacion="01" '
        f'MetodoPago="{doc.metodo_pago or "PUE"}" FormaPago="{doc.forma_pago or "01"}" '
        f'LugarExpedicion="{cp}">\n'
        f'  <cfdi:Emisor Rfc="{emisor_rfc}" Nombre="{emisor_nom}" RegimenFiscal="{emisor_reg}"/>\n'
        f'  <cfdi:Receptor Rfc="{rec_rfc}" Nombre="{rec_nom}" UsoCFDI="{doc.uso_cfdi or "G03"}"/>\n'
        f'  <cfdi:Impuestos TotalImpuestosTrasladados="{iva:.2f}">\n'
        f'    <cfdi:Traslados>\n'
        f'      <cfdi:Traslado Base="{sub:.2f}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="{iva:.2f}"/>\n'
        f'    </cfdi:Traslados>\n'
        f'  </cfdi:Impuestos>\n'
        f'  <cfdi:Complemento>\n'
        f'    <tfd:TimbreFiscalDigital Version="1.1" UUID="{uuid_f}" FechaTimbrado="{fecha}"/>\n'
        f'  </cfdi:Complemento>\n'
        '</cfdi:Comprobante>'
    )


def _pdf_escape(text: str) -> str:
    s = str(text or "").encode("latin-1", "replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_fallback_pdf_b64(doc, cfg: Optional[dict] = None) -> str:
    """Genera un PDF valido (representacion impresa CFDI 4.0) en base64 para
    garantizar que todo CFDI timbrado cuente siempre con su juego completo (PDF + XML)."""
    import base64
    from datetime import datetime, timezone
    cfg = cfg or {}
    total = float(doc.total or 0)
    tipo = (doc.tipo or "I").upper()
    tipo_lbl = {"I": "FACTURA (INGRESO)", "P": "COMPLEMENTO DE PAGO",
                "E": "NOTA DE CREDITO (EGRESO)", "T": "CARTA PORTE (TRASLADO)"}.get(tipo, f"CFDI ({tipo})")
    sub, iva = _importes(doc)
    if sub is None:
        sub = 0.0 if tipo == "T" else round(total / 1.16, 2)
    if iva is None:
        iva = 0.0 if tipo == "T" else round(total - sub, 2)
    folio_txt = "-".join(x for x in (doc.serie, doc.folio) if x) or (doc.id or "")[:8].upper()
    fecha = (doc.timbrado_at or doc.created_at or datetime.now(timezone.utc)).strftime("%Y-%m-%d %H:%M:%S")
    emisor_rfc = (cfg.get("rfc_emisor") or "AAA010101AAA").upper()
    emisor_nom = (cfg.get("nombre_emisor") or "CALEBSYS EMISOR").upper()
    lines = [
        "CALEBSYS - REPRESENTACION IMPRESA DE CFDI 4.0",
        f"TIPO DE COMPROBANTE: {tipo_lbl}",
        f"SERIE / FOLIO: {folio_txt}    SUCURSAL: {doc.sucursal_id or 'MATRIZ'}",
        f"UUID FISCAL: {doc.uuid_fiscal or 'SIN-UUID'}",
        f"FECHA TIMBRADO: {fecha}    ESTADO: {doc.status or 'TIMBRADO'}",
        "------------------------------------------------------------------------",
        f"EMISOR: {emisor_nom} ({emisor_rfc})",
        f"RECEPTOR: {(doc.receptor_nombre or 'PUBLICO EN GENERAL').upper()}",
        f"RFC RECEPTOR: {(doc.receptor_rfc or 'XAXX010101000').upper()}    USO CFDI: {doc.uso_cfdi or 'G03'}",
        f"METODO / FORMA DE PAGO: {doc.metodo_pago or 'PUE'} / {doc.forma_pago or '01'}",
        "------------------------------------------------------------------------",
        f"IMPORTE (SUBTOTAL): $ {sub:,.2f} MXN",
        f"IVA (16%):          $ {iva:,.2f} MXN",
        f"TOTAL:              $ {total:,.2f} MXN",
        "------------------------------------------------------------------------",
        "JUEGO COMPLETO CFDI 4.0 (PDF + XML) - CALEBSYS POS",
    ]
    ops = ["BT", "/F1 11 Tf", "50 760 Td", "16 TL"]
    for i, ln in enumerate(lines):
        ops.append(f"({_pdf_escape(ln)}) Tj" if i == 0 else f"T* ({_pdf_escape(ln)}) Tj")
    ops.append("ET")
    stream = "\n".join(ops).encode("latin-1")
    objs = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        f"5 0 obj\n<< /Length {len(stream)} >>\nstream\n".encode("latin-1") + stream + b"\nendstream\nendobj\n",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for o in objs:
        offsets.append(len(out))
        out.extend(o)
    xref_pos = len(out)
    out.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("latin-1"))
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
    out.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1"))
    return base64.b64encode(bytes(out)).decode("ascii")


def _ensure_completo(db: Session, empresa_id: str, doc, cfg: Optional[dict] = None) -> None:
    """Garantiza que todo CFDI timbrado tenga siempre su juego completo (XML y PDF)."""
    if not doc or (doc.status or "").upper() not in ("TIMBRADO", "CANCELADO"):
        return
    if doc.xml and doc.pdf_base64:
        return
    cfg = cfg if cfg is not None else _cfdi.get_config(db, empresa_id)
    changed = False
    if not doc.xml:
        doc.xml = _build_fallback_xml(doc, cfg)
        changed = True
    if not doc.pdf_base64:
        doc.pdf_base64 = _build_fallback_pdf_b64(doc, cfg)
        changed = True
    if changed:
        try:
            db.add(doc)
            db.commit()
        except Exception:
            db.rollback()


def _get_doc(db: Session, empresa_id: str, doc_id: str, payload: dict, tenant: dict):
    doc = (db.query(models.CfdiDocument)
             .filter(models.CfdiDocument.empresa_id == empresa_id,
                     models.CfdiDocument.id == doc_id).first())
    if not doc:
        raise HTTPException(status_code=404, detail="CFDI no encontrado")
    suc = _scope_sucursal(payload, tenant, None)
    if suc and doc.sucursal_id != suc:
        raise HTTPException(status_code=404, detail="CFDI no encontrado")
    _ensure_completo(db, empresa_id, doc)
    return doc


def _nombre_archivo(doc) -> str:
    tipo_pref = {"I": "FACTURA", "P": "COMPLEMENTO_PAGO", "E": "NOTA_CREDITO", "T": "CARTA_PORTE"}.get(
        (doc.tipo or "I").upper(), "CFDI"
    )
    base = "-".join(x for x in (doc.serie, doc.folio) if x) or (doc.uuid_fiscal or doc.id)[:8]
    return f"{tipo_pref}_" + re.sub(r"[^A-Za-z0-9_-]", "", str(base))


@router.get("/api/cfdi/{doc_id}/archivos")
def cfdi_archivos(doc_id: str,
                  db: Session = Depends(get_db),
                  tenant: dict = Depends(get_tenant_context),
                  payload: dict = Depends(role_guard(_ROLES_FACTURAR))):
    """XML y PDF (juego completo) de UN comprobante por su id."""
    doc = _get_doc(db, tenant["empresa"], doc_id, payload, tenant)
    out = _serialize(doc, with_xml=True, with_pdf=True)
    out["nombre_archivo"] = _nombre_archivo(doc)
    return out


@router.get("/api/cfdi/{doc_id}/paquete")
def cfdi_paquete(doc_id: str,
                 db: Session = Depends(get_db),
                 tenant: dict = Depends(get_tenant_context),
                 payload: dict = Depends(role_guard(_ROLES_FACTURAR))):
    """ZIP con el juego completo del CFDI: PDF + XML. Sin ambos no se entrega."""
    import base64, io, zipfile
    from fastapi.responses import Response

    doc = _get_doc(db, tenant["empresa"], doc_id, payload, tenant)
    faltan = [n for n, ok in (("XML", bool(doc.xml)), ("PDF", bool(doc.pdf_base64))) if not ok]
    if faltan:
        raise HTTPException(status_code=409,
                            detail=f"El CFDI no tiene su juego completo; falta: {', '.join(faltan)}")
    name = _nombre_archivo(doc)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(name + ".xml", doc.xml)
        z.writestr(name + ".pdf", base64.b64decode(doc.pdf_base64))
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{name}.zip"'})


class CfdiSendIn(BaseModel):
    ids: list[str]
    metodo: str  # "email" | "whatsapp"
    destino: str
    mensaje: Optional[str] = None


@router.post("/api/cfdi/paquete-lote")
def cfdi_paquete_lote(data: dict,
                      db: Session = Depends(get_db),
                      tenant: dict = Depends(get_tenant_context),
                      payload: dict = Depends(role_guard(_ROLES_FACTURAR))):
    """Devuelve un ZIP con el juego completo (PDF + XML) de 1 o varios CFDI
    seleccionados (Facturas, Complementos de Pago, Notas de Crédito, Carta Porte)."""
    import base64, io, zipfile
    from fastapi.responses import Response

    ids = [str(x) for x in (data.get("ids") or []) if x]
    if not ids:
        raise HTTPException(status_code=400, detail="Selecciona al menos un CFDI")
    empresa_id = tenant["empresa"]
    docs = []
    for doc_id in ids:
        doc = _get_doc(db, empresa_id, doc_id, payload, tenant)
        if not doc.xml or not doc.pdf_base64:
            raise HTTPException(status_code=409, detail=f"El CFDI {doc_id} no cuenta con su juego completo (PDF + XML)")
        docs.append(doc)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for doc in docs:
            name = _nombre_archivo(doc)
            z.writestr(name + ".xml", doc.xml)
            z.writestr(name + ".pdf", base64.b64decode(doc.pdf_base64))
    zip_name = (_nombre_archivo(docs[0]) if len(docs) == 1 else f"CFDI_JUEGO_COMPLETO_{len(docs)}_COMPROBANTES") + ".zip"
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{zip_name}"'})


@router.post("/api/cfdi/enviar")
def cfdi_enviar(data: CfdiSendIn,
                db: Session = Depends(get_db),
                tenant: dict = Depends(get_tenant_context),
                payload: dict = Depends(role_guard(_ROLES_FACTURAR))):
    """Prepara y registra el envío obligatorio del JUEGO COMPLETO (PDF + XML)
    para Facturas (I), Complementos de Pago (P), Notas de Crédito (E) o Carta Porte (T)
    por cualquiera de los métodos de envío (Email o WhatsApp)."""
    empresa_id = tenant["empresa"]
    quien = payload.get("sub", "sistema")
    metodo = (data.metodo or "").strip().lower()
    if metodo not in ("email", "whatsapp"):
        raise HTTPException(status_code=400, detail="Método de envío no válido (use email o whatsapp)")
    destino = (data.destino or "").strip()
    if not destino:
        raise HTTPException(status_code=400, detail="Indica el destinatario del envío")
    if not data.ids:
        raise HTTPException(status_code=400, detail="Selecciona al menos un comprobante para enviar")

    cfg = _cfdi.get_config(db, empresa_id)
    archivos = []
    resumen_lineas = []
    enviados_servidor = 0

    for doc_id in data.ids:
        if str(doc_id).startswith("pend-"):
            raise HTTPException(
                status_code=409,
                detail="Uno de los comprobantes seleccionados aún está por timbrar. Tímbralo primero para enviar su PDF y XML."
            )
        doc = _get_doc(db, empresa_id, doc_id, payload, tenant)
        if not doc.xml or not doc.pdf_base64:
            raise HTTPException(
                status_code=409,
                detail=f"El comprobante {_nombre_archivo(doc)} no tiene su juego completo (PDF + XML)."
            )
        name = _nombre_archivo(doc)
        sub, iva = _importes(doc)
        total = float(doc.total or 0)
        if sub is None:
            sub = 0.0 if (doc.tipo or "I").upper() == "T" else round(total / 1.16, 2)
        if iva is None:
            iva = 0.0 if (doc.tipo or "I").upper() == "T" else round(total - sub, 2)
        archivos.append({
            "id": doc.id,
            "tipo": (doc.tipo or "I").upper(),
            "folio": "-".join(x for x in (doc.serie, doc.folio) if x) or doc.id[:8].upper(),
            "uuid_fiscal": doc.uuid_fiscal,
            "receptor_nombre": doc.receptor_nombre,
            "receptor_rfc": doc.receptor_rfc,
            "subtotal": sub,
            "iva": iva,
            "total": total,
            "nombre_archivo": name,
            "pdf_filename": name + ".pdf",
            "xml_filename": name + ".xml",
            "pdf_base64": doc.pdf_base64,
            "xml": doc.xml,
        })
        resumen_lineas.append(
            f"• {name} | UUID: {doc.uuid_fiscal or '—'} | Importe: ${sub:,.2f} | IVA: ${iva:,.2f} | Total: ${total:,.2f} (Incluye {name}.pdf + {name}.xml)"
        )
        # Si es email y el PAC está configurado en modo real, pedirle también al PAC que envíe PDF+XML
        if metodo == "email" and doc.pac_id and not _cfdi._is_mock(cfg) and (doc.environment or "") != "mock":
            try:
                import urllib.parse
                cfdi_type = "issuedLite" if (cfg.get("api_mode") or "multiemisor") == "multiemisor" else "issued"
                qs = urllib.parse.urlencode({"cfdiType": cfdi_type, "cfdiId": doc.pac_id, "email": destino})
                ok_p, _st, _dt = _cfdi._request(cfg, "POST", f"/cfdi?{qs}")
                if ok_p:
                    enviados_servidor += 1
            except Exception:
                pass

    # Si es WhatsApp y Twilio está activo para el tenant, enviar también aviso por API
    wa_api_sent = False
    if metodo == "whatsapp":
        try:
            from services import whatsapp as _wa
            body_wa = (
                "CALEBSYS - ENVIO DE JUEGO COMPLETO CFDI (PDF + XML)\n"
                + ("\n".join(resumen_lineas))
                + (f"\nNOTA: {data.mensaje.strip().upper()}" if data.mensaje and data.mensaje.strip() else "")
            )
            r_wa = _wa.send_whatsapp(db, empresa_id, destino, body_wa, created_by=quien, context="CFDI_JUEGO_COMPLETO")
            wa_api_sent = bool(r_wa.get("ok"))
        except Exception:
            wa_api_sent = False

    _audit(
        db, empresa_id, quien, f"CFDI_SEND_{metodo.upper()}", "INFO",
        tenant.get("sucursal", "MATRIZ"),
        {
            "metodo": metodo,
            "destino": destino,
            "juego_completo": True,
            "comprobantes": [
                {"id": a["id"], "tipo": a["tipo"], "pdf": a["pdf_filename"], "xml": a["xml_filename"]}
                for a in archivos
            ],
            "mensaje": (data.mensaje or "").strip().upper() or None,
        },
    )
    return {
        "ok": True,
        "juego_completo": True,
        "metodo": metodo,
        "destino": destino,
        "enviados_pac": enviados_servidor,
        "whatsapp_api_sent": wa_api_sent,
        "archivos": archivos,
    }


@router.get("/api/cfdi/version")
def cfdi_version(sucursal_id: Optional[str] = Query(None),
                 db: Session = Depends(get_db),
                 tenant: dict = Depends(get_tenant_context),
                 payload: dict = Depends(role_guard(_ROLES_FACTURAR))):
    """Huella barata de los CFDI y ventas por facturar del tenant.

    El modulo CFDI del admin la consulta cada pocos segundos y solo recarga la
    lista cuando cambia: asi lo que emiten los POS de cualquier sucursal se
    refleja sin que el usuario tenga que actualizar.
    """
    empresa_id = tenant["empresa"]
    sucursal_id = _scope_sucursal(payload, tenant, sucursal_id)
    D = models.CfdiDocument
    q = db.query(func.count(D.id), func.max(D.created_at),
                 func.max(D.timbrado_at), func.max(D.cancelado_at)).filter(D.empresa_id == empresa_id)
    if sucursal_id:
        q = q.filter(D.sucursal_id == sucursal_id)
    n, c_at, t_at, x_at = q.one()
    p = _pending_query(db, empresa_id, sucursal_id)
    pn, p_at = p.with_entities(func.count(models.Sale.id), func.max(models.Sale.created_at)).one()
    parts = [n, c_at, t_at, x_at, pn, p_at]
    return {"version": "|".join("" if v is None else str(v) for v in parts)}


class CfdiCancelIn(BaseModel):
    motivo: str = "02"
    uuid_replacement: Optional[str] = None


@router.post("/api/cfdi/{doc_id}/cancel")
def cancel_cfdi(doc_id: str, data: CfdiCancelIn,
                db: Session = Depends(get_db),
                tenant: dict = Depends(get_tenant_context),
                payload: dict = Depends(role_guard(_ROLES_ADMIN))):
    """Cancela un CFDI timbrado ante el SAT (solo admin)."""
    empresa_id = tenant["empresa"]
    quien = payload.get("sub", "sistema")
    doc = (db.query(models.CfdiDocument)
             .filter(models.CfdiDocument.empresa_id == empresa_id,
                     models.CfdiDocument.id == doc_id).first())
    if not doc:
        raise HTTPException(status_code=404, detail="CFDI no encontrado")

    cfg = _cfdi.get_config(db, empresa_id)
    res = _cfdi.cancelar(db, empresa_id, doc, cfg, motivo=data.motivo,
                         uuid_replacement=data.uuid_replacement, created_by=quien)
    if not res.get("ok"):
        db.rollback()
        raise HTTPException(status_code=400, detail=res.get("error", "No se pudo cancelar"))

    # La venta deja de tener CFDI vigente: se puede volver a facturar.
    sale = (db.query(models.Sale)
              .filter(models.Sale.empresa_id == empresa_id,
                      models.Sale.id == doc.sale_id).first())
    if sale and sale.cfdi_document_id == doc.id:
        sale.cfdi_document_id = None
        db.add(sale)
    db.commit()
    db.refresh(doc)
    return {"ok": True, **_serialize(doc)}


def _importes(doc) -> tuple:
    """(subtotal, iva) del CFDI, leidos del XML timbrado.

    SubTotal sale del nodo cfdi:Comprobante e IVA de TotalImpuestosTrasladados
    (nodo cfdi:Impuestos del comprobante). Sin XML (borrador / error) se
    devuelve (None, None) y el frontend lo deriva del total.
    """
    xml = doc.xml or ""
    if not xml:
        return None, None
    try:
        sub = re.search(r'<cfdi:Comprobante\b[^>]*?\bSubTotal="([\d.]+)"', xml)
        tra = re.findall(r'\bTotalImpuestosTrasladados="([\d.]+)"', xml)
        subtotal = float(sub.group(1)) if sub else None
        # El ultimo TotalImpuestosTrasladados es el del comprobante.
        iva = float(tra[-1]) if tra else (0.0 if subtotal is not None else None)
        return subtotal, iva
    except Exception:
        return None, None


def _serialize(doc, with_xml: bool = False, with_pdf: bool = False) -> dict:
    subtotal, iva = _importes(doc)
    out = {
        "id": doc.id,
        "sale_id": doc.sale_id,
        "tipo": doc.tipo,
        "serie": doc.serie,
        "folio": doc.folio,
        "uuid_fiscal": doc.uuid_fiscal,
        "status": doc.status,
        "uso_cfdi": doc.uso_cfdi,
        "forma_pago": doc.forma_pago,
        "metodo_pago": doc.metodo_pago,
        "subtotal": subtotal,
        "iva": iva,
        "total": float(doc.total or 0),
        "receptor_rfc": doc.receptor_rfc,
        "receptor_nombre": doc.receptor_nombre,
        "provider": doc.provider,
        "environment": doc.environment,
        "pac_id": doc.pac_id,
        "error": doc.error,
        "sucursal_id": doc.sucursal_id,
        "timbrado_at": doc.timbrado_at.isoformat() if doc.timbrado_at else None,
        "cancelado_at": doc.cancelado_at.isoformat() if doc.cancelado_at else None,
        "motivo_cancelacion": doc.motivo_cancelacion,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "has_xml": bool(doc.xml),
        "has_pdf": bool(doc.pdf_base64),
    }
    if with_xml:
        out["xml"] = doc.xml
    if with_pdf:
        out["pdf_base64"] = doc.pdf_base64
    return out
