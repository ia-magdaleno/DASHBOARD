"""Contratos de adhesión (DA-7items, ítem 6).

Un contrato de adhesión es el documento que el cliente firma aceptando las
condiciones generales de venta, crédito, comodato o servicio del tenant.

Flujo típico:
  1. El admin crea una plantilla maestra (client_id=None, sale_id=None).
  2. Al activar el contrato con un cliente concreto se crea una instancia
     con client_id/sale_id y status='borrador'.
  3. Cuando el cliente acepta (firma digital, WhatsApp, física) se hace PATCH
     firmado_cliente=True + firma_medio + fecha.
  4. status pasa a 'vigente'.

El contenido del contrato (texto legal) se puede guardar en AdminConfig
bajo la clave 'adhesion.template.<tipo>' para reutilización y versionado.
"""
from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from deps import get_empresa_id, role_guard, get_tenant_context

router = APIRouter(tags=["adhesion"])

_GUARD_CONSULTA  = role_guard(["admin", "admin_sucursal", "gerente", "vendedor", "vendedor_cajero"])
_GUARD_ESCRITURA = role_guard(["admin", "admin_sucursal", "gerente"])
_GUARD_ADMIN     = role_guard(["admin", "admin_sucursal"])

_TIPOS_VALIDOS   = {"venta", "credito", "comodato", "servicio"}
_STATUS_VALIDOS  = {"borrador", "vigente", "vencido", "cancelado"}
_MEDIOS_FIRMA    = {"digital", "fisica", "whatsapp", "email"}


class AdhesionIn(BaseModel):
    tipo: str = "venta"
    client_id: Optional[str] = None
    sale_id: Optional[str] = None
    version: Optional[str] = None
    contenido: Optional[str] = None   # texto legal completo
    notas: Optional[str] = None


class AdhesionFirmaIn(BaseModel):
    firma_medio: str                       # digital | fisica | whatsapp | email
    firma_fecha: Optional[datetime] = None
    notas: Optional[str] = None


class AdhesionPatchIn(BaseModel):
    status: Optional[str] = None
    contenido: Optional[str] = None
    version: Optional[str] = None
    notas: Optional[str] = None


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/api/adhesion-contracts")
def list_contracts(
    tipo: Optional[str] = None,
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_GUARD_CONSULTA),
):
    q = db.query(models.AdhesionContract).filter(
        models.AdhesionContract.empresa_id == empresa_id
    )
    if tipo:
        q = q.filter(models.AdhesionContract.tipo == tipo)
    if status:
        q = q.filter(models.AdhesionContract.status == status)
    if client_id:
        q = q.filter(models.AdhesionContract.client_id == client_id)
    total = q.count()
    rows  = q.order_by(models.AdhesionContract.created_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_row(r) for r in rows]}


@router.get("/api/adhesion-contracts/{contract_id}")
def get_contract(
    contract_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_GUARD_CONSULTA),
):
    return _row(_get_or_404(db, empresa_id, contract_id))


@router.post("/api/adhesion-contracts", status_code=201)
def create_contract(
    data: AdhesionIn,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
    payload: dict = Depends(_GUARD_ESCRITURA),
):
    empresa_id  = tenant["empresa"]
    sucursal_id = tenant.get("sucursal", "MATRIZ")

    if data.tipo not in _TIPOS_VALIDOS:
        raise HTTPException(400, f"tipo debe ser: {', '.join(_TIPOS_VALIDOS)}")

    # Si no se provee contenido, intentar cargar la plantilla del tenant.
    contenido = data.contenido
    if not contenido:
        tmpl_row = db.query(models.AdminConfig).filter(
            models.AdminConfig.empresa_id == empresa_id,
            models.AdminConfig.config_key == f"adhesion.template.{data.tipo}",
        ).first()
        if tmpl_row:
            contenido = tmpl_row.config_val

    contract = models.AdhesionContract(
        id=str(uuid.uuid4()),
        empresa_id=empresa_id,
        sucursal_id=sucursal_id,
        tipo=data.tipo,
        client_id=data.client_id,
        sale_id=data.sale_id,
        version=data.version or "1.0",
        contenido=contenido,
        notas=data.notas,
        status="borrador",
        created_by=payload.get("sub", "sistema"),
    )
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return _row(contract)


@router.patch("/api/adhesion-contracts/{contract_id}/firmar")
def firmar_contract(
    contract_id: str,
    data: AdhesionFirmaIn,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_GUARD_ESCRITURA),
):
    """El cliente acepta / firma el contrato."""
    c = _get_or_404(db, empresa_id, contract_id)
    if c.status not in {"borrador", "vigente"}:
        raise HTTPException(400, f"No se puede firmar un contrato en estado '{c.status}'.")
    if data.firma_medio not in _MEDIOS_FIRMA:
        raise HTTPException(400, f"firma_medio debe ser: {', '.join(_MEDIOS_FIRMA)}")

    c.firmado_cliente = True
    c.firma_medio     = data.firma_medio
    c.firma_fecha     = data.firma_fecha or datetime.now(timezone.utc)
    c.status          = "vigente"
    c.updated_at      = datetime.now(timezone.utc)
    if data.notas:
        c.notas = (c.notas or "") + f"\n[firma] {data.notas}"
    db.add(c)
    db.commit()
    db.refresh(c)
    return _row(c)


@router.patch("/api/adhesion-contracts/{contract_id}")
def update_contract(
    contract_id: str,
    data: AdhesionPatchIn,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_GUARD_ADMIN),
):
    c = _get_or_404(db, empresa_id, contract_id)
    if data.status and data.status not in _STATUS_VALIDOS:
        raise HTTPException(400, f"status debe ser: {', '.join(_STATUS_VALIDOS)}")
    if data.status:
        c.status = data.status
    if data.contenido is not None:
        c.contenido = data.contenido
    if data.version:
        c.version = data.version
    if data.notas:
        c.notas = data.notas
    c.updated_at = datetime.now(timezone.utc)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _row(c)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_404(db: Session, empresa_id: str, contract_id: str):
    c = db.query(models.AdhesionContract).filter(
        models.AdhesionContract.empresa_id == empresa_id,
        models.AdhesionContract.id == contract_id,
    ).first()
    if not c:
        raise HTTPException(404, "Contrato de adhesión no encontrado")
    return c


def _row(c) -> dict:
    return {
        "id":              c.id,
        "tipo":            c.tipo,
        "status":          c.status,
        "client_id":       c.client_id,
        "sale_id":         c.sale_id,
        "version":         c.version,
        "contenido":       c.contenido,
        "firmado_cliente": c.firmado_cliente,
        "firma_fecha":     c.firma_fecha.isoformat() if c.firma_fecha else None,
        "firma_medio":     c.firma_medio,
        "notas":           c.notas,
        "sucursal_id":     c.sucursal_id,
        "created_by":      c.created_by,
        "created_at":      c.created_at.isoformat() if c.created_at else None,
        "updated_at":      c.updated_at.isoformat() if c.updated_at else None,
    }
