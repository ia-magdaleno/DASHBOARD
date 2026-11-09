"""Módulo de inventario en comodato, préstamo y consignación (DA-7items, ítem 7).

Endpoints CRUD básicos. Toda la autorización requiere al menos rol gerente;
la entrega/devolución la puede registrar también el vendedor de mostrador.

Tipos soportados:
  comodato     — bien de uso cedido al cliente sin cargo; se devuelve igual.
  prestamo     — bien cedido con fecha límite y/o garantía.
  consignacion — bien entregado para que el cliente lo venda; si vende paga.
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

router = APIRouter(tags=["comodato"])

_GUARD_CONSULTA  = role_guard(["admin", "admin_sucursal", "gerente", "vendedor", "vendedor_cajero", "vendedor_calle"])
_GUARD_ESCRITURA = role_guard(["admin", "admin_sucursal", "gerente"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class ComodatoIn(BaseModel):
    tipo: str                                    # comodato | prestamo | consignacion
    descripcion: str
    cantidad: float = 1.0
    client_id: Optional[str] = None
    sale_id: Optional[str] = None
    adhesion_contract_id: Optional[str] = None
    product_id: Optional[str] = None
    fecha_entrega: Optional[datetime] = None
    fecha_devolucion_pactada: Optional[datetime] = None
    condicion_entrega: Optional[str] = None
    valor_garantia: Optional[float] = None
    precio_venta_pactado: Optional[float] = None  # solo consignacion
    notas: Optional[str] = None


class DevolucionIn(BaseModel):
    fecha_devolucion_real: Optional[datetime] = None
    condicion_retorno: Optional[str] = None
    status: str = "devuelto"   # devuelto | vendido | perdido
    notas: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

_TIPOS_VALIDOS  = {"comodato", "prestamo", "consignacion"}
_STATUS_VALIDOS = {"activo", "devuelto", "vendido", "perdido", "vencido"}


def _folio(db: Session, empresa_id: str) -> str:
    """Genera folio secuencial COM-NNNN por empresa."""
    count = db.query(models.ComodatoItem).filter(
        models.ComodatoItem.empresa_id == empresa_id
    ).count()
    return f"COM-{count + 1:04d}"


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/api/comodato")
def list_comodato(
    tipo: Optional[str] = None,
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_GUARD_CONSULTA),
):
    q = db.query(models.ComodatoItem).filter(
        models.ComodatoItem.empresa_id == empresa_id
    )
    if tipo:
        q = q.filter(models.ComodatoItem.tipo == tipo)
    if status:
        q = q.filter(models.ComodatoItem.status == status)
    if client_id:
        q = q.filter(models.ComodatoItem.client_id == client_id)
    total = q.count()
    items = q.order_by(models.ComodatoItem.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [_row(i) for i in items],
    }


@router.get("/api/comodato/{item_id}")
def get_comodato(
    item_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_GUARD_CONSULTA),
):
    item = _get_or_404(db, empresa_id, item_id)
    return _row(item)


@router.post("/api/comodato", status_code=201)
def create_comodato(
    data: ComodatoIn,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
    payload: dict = Depends(_GUARD_ESCRITURA),
):
    empresa_id  = tenant["empresa"]
    sucursal_id = tenant.get("sucursal", "MATRIZ")

    if data.tipo not in _TIPOS_VALIDOS:
        raise HTTPException(400, f"tipo debe ser: {', '.join(_TIPOS_VALIDOS)}")

    item = models.ComodatoItem(
        id=str(uuid.uuid4()),
        empresa_id=empresa_id,
        sucursal_id=sucursal_id,
        tipo=data.tipo,
        descripcion=data.descripcion,
        cantidad=data.cantidad,
        client_id=data.client_id,
        sale_id=data.sale_id,
        adhesion_contract_id=data.adhesion_contract_id,
        product_id=data.product_id,
        fecha_entrega=data.fecha_entrega or datetime.now(timezone.utc),
        fecha_devolucion_pactada=data.fecha_devolucion_pactada,
        condicion_entrega=data.condicion_entrega,
        valor_garantia=data.valor_garantia,
        precio_venta_pactado=data.precio_venta_pactado,
        notas=data.notas,
        status="activo",
        folio=_folio(db, empresa_id),
        created_by=payload.get("sub", "sistema"),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _row(item)


@router.patch("/api/comodato/{item_id}/devolucion")
def registrar_devolucion(
    item_id: str,
    data: DevolucionIn,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_GUARD_ESCRITURA),
):
    """Registra la devolución, venta o pérdida del bien."""
    item = _get_or_404(db, empresa_id, item_id)
    if item.status != "activo":
        raise HTTPException(400, f"El item ya está en estado '{item.status}'; no se puede modificar.")
    if data.status not in _STATUS_VALIDOS - {"activo"}:
        raise HTTPException(400, f"status debe ser: devuelto, vendido, perdido.")

    item.status = data.status
    item.fecha_devolucion_real = data.fecha_devolucion_real or datetime.now(timezone.utc)
    if data.condicion_retorno:
        item.condicion_retorno = data.condicion_retorno
    if data.notas:
        item.notas = (item.notas or "") + f"\n[{item.status}] {data.notas}"
    item.updated_at = datetime.now(timezone.utc)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _row(item)


@router.delete("/api/comodato/{item_id}", status_code=204)
def cancel_comodato(
    item_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(role_guard(["admin", "admin_sucursal"])),
):
    """Cancela un registro de comodato (solo admins)."""
    item = _get_or_404(db, empresa_id, item_id)
    item.status = "vencido"
    item.updated_at = datetime.now(timezone.utc)
    db.add(item)
    db.commit()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_404(db: Session, empresa_id: str, item_id: str):
    item = db.query(models.ComodatoItem).filter(
        models.ComodatoItem.empresa_id == empresa_id,
        models.ComodatoItem.id == item_id,
    ).first()
    if not item:
        raise HTTPException(404, "Registro de comodato no encontrado")
    return item


def _row(item) -> dict:
    return {
        "id":                       item.id,
        "folio":                    item.folio,
        "tipo":                     item.tipo,
        "status":                   item.status,
        "descripcion":              item.descripcion,
        "cantidad":                 float(item.cantidad or 1),
        "client_id":                item.client_id,
        "sale_id":                  item.sale_id,
        "product_id":               item.product_id,
        "adhesion_contract_id":     item.adhesion_contract_id,
        "fecha_entrega":            item.fecha_entrega.isoformat() if item.fecha_entrega else None,
        "fecha_devolucion_pactada": item.fecha_devolucion_pactada.isoformat() if item.fecha_devolucion_pactada else None,
        "fecha_devolucion_real":    item.fecha_devolucion_real.isoformat() if item.fecha_devolucion_real else None,
        "condicion_entrega":        item.condicion_entrega,
        "condicion_retorno":        item.condicion_retorno,
        "valor_garantia":           float(item.valor_garantia) if item.valor_garantia else None,
        "precio_venta_pactado":     float(item.precio_venta_pactado) if item.precio_venta_pactado else None,
        "notas":                    item.notas,
        "sucursal_id":              item.sucursal_id,
        "created_by":               item.created_by,
        "created_at":               item.created_at.isoformat() if item.created_at else None,
        "updated_at":               item.updated_at.isoformat() if item.updated_at else None,
    }
