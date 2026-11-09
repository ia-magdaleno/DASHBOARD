"""Ítem 2: Contratistas y Proyectos de obra.

Endpoints Contratistas:
  GET    /api/contractors              — listar (admin)
  POST   /api/contractors              — crear (admin)
  GET    /api/contractors/{id}         — detalle (admin)
  PUT    /api/contractors/{id}         — actualizar (admin)

Endpoints Proyectos:
  GET    /api/projects                 — listar (admin; filtra por contractor_id, status, client_id)
  POST   /api/projects                 — crear (admin)
  GET    /api/projects/{id}            — detalle (admin)
  PUT    /api/projects/{id}            — actualizar (admin)
  POST   /api/projects/{id}/close      — cerrar proyecto (admin)

Ledger de comisiones por proyecto:
  GET    /api/projects/{id}/commission-ledger        — historial (admin)
  POST   /api/projects/{id}/commission-ledger        — registrar pago manual (admin)

Utilidad POS:
  GET    /api/projects/lookup?client_id=X            — proyectos activos de un cliente
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from deps import get_empresa_id, get_tenant_context, role_guard

router = APIRouter(tags=["proyectos"])

_ADMIN_GUARD = role_guard(["admin", "Administrador"])
_STAFF_GUARD = role_guard(["admin", "Administrador", "Gerente", "vendedor", "cajero", "vendedor_cajero"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _contractor_out(c: models.Contractor) -> dict:
    return {
        "id": c.id, "empresa_id": c.empresa_id, "nombre": c.nombre,
        "rfc": c.rfc, "phone": c.phone, "email": c.email, "notas": c.notas,
        "status": c.status,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _project_out(p: models.Project) -> dict:
    return {
        "id": p.id, "empresa_id": p.empresa_id, "nombre": p.nombre,
        "client_id": p.client_id, "contractor_id": p.contractor_id,
        "commission_rate": float(p.commission_rate or 0),
        "status": p.status, "notas": p.notas,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "closed_at": p.closed_at.isoformat() if p.closed_at else None,
    }


def _ledger_out(e: models.ProjectCommissionLedger) -> dict:
    return {
        "id": e.id, "empresa_id": e.empresa_id, "project_id": e.project_id,
        "entry_type": e.entry_type, "amount": float(e.amount),
        "sale_id": e.sale_id, "descripcion": e.descripcion,
        "registrado_por": e.registrado_por,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


# ── Contratistas ──────────────────────────────────────────────────────────────

@router.get("/api/contractors")
def list_contractors(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    q = db.query(models.Contractor).filter(models.Contractor.empresa_id == empresa_id)
    if status:
        q = q.filter(models.Contractor.status == status)
    return [_contractor_out(c) for c in q.order_by(models.Contractor.nombre).all()]


@router.post("/api/contractors", status_code=201)
def create_contractor(
    data: schemas.ContractorCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    c = models.Contractor(
        id=str(uuid.uuid4()), empresa_id=empresa_id,
        nombre=data.nombre, rfc=data.rfc, phone=data.phone,
        email=data.email, notas=data.notas, status="activo",
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _contractor_out(c)


@router.get("/api/contractors/{contractor_id}")
def get_contractor(
    contractor_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    c = db.query(models.Contractor).filter(
        models.Contractor.empresa_id == empresa_id,
        models.Contractor.id == contractor_id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Contratista no encontrado")
    return _contractor_out(c)


@router.put("/api/contractors/{contractor_id}")
def update_contractor(
    contractor_id: str,
    data: schemas.ContractorUpdate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    c = db.query(models.Contractor).filter(
        models.Contractor.empresa_id == empresa_id,
        models.Contractor.id == contractor_id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Contratista no encontrado")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(c, field, value)
    db.commit()
    db.refresh(c)
    return _contractor_out(c)


# ── Proyectos ─────────────────────────────────────────────────────────────────

@router.get("/api/projects")
def list_projects(
    contractor_id: Optional[str] = None,
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    q = db.query(models.Project).filter(models.Project.empresa_id == empresa_id)
    if contractor_id:
        q = q.filter(models.Project.contractor_id == contractor_id)
    if client_id:
        q = q.filter(models.Project.client_id == client_id)
    if status:
        q = q.filter(models.Project.status == status)
    return [_project_out(p) for p in q.order_by(models.Project.created_at.desc()).all()]


@router.get("/api/projects/lookup")
def lookup_projects_by_client(
    client_id: str = Query(...),
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_STAFF_GUARD),
):
    """El POS llama esto para mostrar al vendedor los proyectos activos del cliente."""
    rows = db.query(models.Project).filter(
        models.Project.empresa_id == empresa_id,
        models.Project.client_id == client_id,
        models.Project.status == "activo",
    ).order_by(models.Project.nombre).all()
    return [_project_out(p) for p in rows]


@router.post("/api/projects", status_code=201)
def create_project(
    data: schemas.ProjectCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    if data.contractor_id:
        exists = db.query(models.Contractor).filter(
            models.Contractor.empresa_id == empresa_id,
            models.Contractor.id == data.contractor_id,
        ).first()
        if not exists:
            raise HTTPException(status_code=400, detail="Contratista no encontrado")

    p = models.Project(
        id=str(uuid.uuid4()), empresa_id=empresa_id,
        nombre=data.nombre, client_id=data.client_id,
        contractor_id=data.contractor_id,
        commission_rate=data.commission_rate,
        notas=data.notas, status="activo",
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _project_out(p)


@router.get("/api/projects/{project_id}")
def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    p = _get_project_or_404(db, empresa_id, project_id)
    return _project_out(p)


@router.put("/api/projects/{project_id}")
def update_project(
    project_id: str,
    data: schemas.ProjectUpdate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    p = _get_project_or_404(db, empresa_id, project_id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    return _project_out(p)


@router.post("/api/projects/{project_id}/close")
def close_project(
    project_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    p = _get_project_or_404(db, empresa_id, project_id)
    if p.status == "cerrado":
        raise HTTPException(status_code=409, detail="El proyecto ya está cerrado")
    p.status = "cerrado"
    p.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(p)
    return _project_out(p)


# ── Ledger de comisiones ──────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/commission-ledger")
def list_commission_ledger(
    project_id: str,
    entry_type: Optional[str] = None,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    _get_project_or_404(db, empresa_id, project_id)
    q = db.query(models.ProjectCommissionLedger).filter(
        models.ProjectCommissionLedger.empresa_id == empresa_id,
        models.ProjectCommissionLedger.project_id == project_id,
    )
    if entry_type:
        q = q.filter(models.ProjectCommissionLedger.entry_type == entry_type)
    entries = q.order_by(models.ProjectCommissionLedger.created_at.asc()).all()

    # Resumen acumulado
    total_generated = sum(float(e.amount) for e in entries if e.entry_type == "generated")
    total_paid      = sum(float(e.amount) for e in entries if e.entry_type == "paid")
    return {
        "summary": {
            "total_generated": total_generated,
            "total_paid": total_paid,
            "balance_pending": total_generated - total_paid,
        },
        "entries": [_ledger_out(e) for e in entries],
    }


@router.post("/api/projects/{project_id}/commission-ledger", status_code=201)
def record_commission_payment(
    project_id: str,
    data: schemas.ProjectCommissionLedgerCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_ADMIN_GUARD),
):
    """Admin registra manualmente un pago al contratista (entry_type=paid)."""
    _get_project_or_404(db, empresa_id, project_id)
    if data.entry_type not in ("generated", "paid"):
        raise HTTPException(status_code=400, detail="entry_type debe ser: generated o paid")

    user_id = payload.get("sub") or payload.get("user_id") or "admin"
    entry = models.ProjectCommissionLedger(
        id=str(uuid.uuid4()), empresa_id=empresa_id,
        project_id=project_id, entry_type=data.entry_type,
        amount=data.amount, sale_id=data.sale_id,
        descripcion=data.descripcion, registrado_por=user_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _ledger_out(entry)


# ── Utilidad interna ──────────────────────────────────────────────────────────

def _get_project_or_404(db: Session, empresa_id: str, project_id: str) -> models.Project:
    p = db.query(models.Project).filter(
        models.Project.empresa_id == empresa_id,
        models.Project.id == project_id,
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return p
