"""Consola del SUPERADMIN — provisión y estado de tenants.

Solo el dueño del software (rol `superadmin`). El admin del tenant NO entra aquí
(ver deps.superadmin_only). El superadmin crea el `Company`, su sucursal matriz
`AAA-001` y el `User` admin/dueño del tenant.
"""
import re

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from deps import superadmin_only

router = APIRouter(tags=["superadmin"])

SYS = "SYS-000"
_PREFIJO_RE = re.compile(r"^[A-Za-z]{3}$")


class TenantCreate(BaseModel):
    prefijo: str                      # 3 letras -> empresa_id = PREFIJO-001
    nombre: str
    rfc: str | None = None
    admin_username: str
    admin_password: str
    admin_nombre: str | None = None
    plan: str | None = "SIGAC-CalebSys MVP"


class TenantUpdate(BaseModel):
    status: str | None = None         # ACTIVE | SUSPENDED
    plan: str | None = None


def _counts(db, empresa_id: str) -> dict:
    def c(model):
        try:
            return db.query(model).filter(model.empresa_id == empresa_id).count()
        except Exception:
            return None
    return {
        "usuarios":  c(models.User),
        "sucursales": c(models.Branch),
        "productos": c(models.Product),
        "clientes":  c(models.Client),
    }


@router.get("/api/superadmin/tenants")
def listar_tenants(db: Session = Depends(get_db), _sa: dict = Depends(superadmin_only)):
    rows = (db.query(models.Company)
              .filter(models.Company.id != SYS)
              .order_by(models.Company.created_at.desc())
              .all())
    return [{
        "empresa_id": r.id,
        "nombre": r.name,
        "rfc": r.rfc,
        "status": r.status,
        "plan": r.plan_name,
        "creado": r.created_at.isoformat() if r.created_at else None,
        **_counts(db, r.id),
    } for r in rows]


@router.post("/api/superadmin/tenants", status_code=201)
def crear_tenant(body: TenantCreate, db: Session = Depends(get_db),
                 sa: dict = Depends(superadmin_only)):
    prefijo = (body.prefijo or "").strip().upper()
    if not _PREFIJO_RE.match(prefijo):
        raise HTTPException(status_code=400, detail="el prefijo debe ser exactamente 3 letras")
    if not (body.nombre or "").strip():
        raise HTTPException(status_code=400, detail="falta nombre del tenant")
    if not (body.admin_username or "").strip():
        raise HTTPException(status_code=400, detail="falta admin_username")
    if len((body.admin_password or "")) < 6:
        raise HTTPException(status_code=400, detail="la contraseña del admin debe tener al menos 6 caracteres")

    empresa_id = f"{prefijo}-001"
    if db.query(models.Company).filter(models.Company.id == empresa_id).first():
        raise HTTPException(status_code=409, detail=f"el tenant {empresa_id} ya existe")

    db.add(models.Company(id=empresa_id, name=body.nombre.strip(),
                          rfc=(body.rfc or "").strip() or None,
                          status="ACTIVE", plan_name=(body.plan or "CalebSys MVP")))
    db.add(models.Branch(empresa_id=empresa_id, id=empresa_id, name="Matriz",
                         is_main=True, status="ACTIVE"))
    hashed = bcrypt.hashpw(body.admin_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    admin = models.User(empresa_id=empresa_id, sucursal_id=empresa_id,
                        username=body.admin_username.strip(), hashed_password=hashed,
                        role="admin", status="ACTIVE")
    db.add(admin)

    db.add(models.AuditLog(
        empresa_id=empresa_id, sucursal_id=empresa_id, user_id=sa.get("sub", "superadmin"),
        action=f"TENANT_CREATE:{empresa_id} ({body.nombre})", severity="WARNING",
    ))
    db.commit()
    return {"ok": True, "empresa_id": empresa_id, "admin_username": admin.username,
            "message": f"Tenant {empresa_id} creado. El admin ya puede iniciar sesión."}


@router.put("/api/superadmin/tenants/{empresa_id}")
def actualizar_tenant(empresa_id: str, body: TenantUpdate, db: Session = Depends(get_db),
                      sa: dict = Depends(superadmin_only)):
    if empresa_id == SYS:
        raise HTTPException(status_code=400, detail="no se puede modificar el tenant de sistema")
    row = db.query(models.Company).filter(models.Company.id == empresa_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="tenant no encontrado")
    if body.status is not None:
        st = body.status.strip().upper()
        if st not in ("ACTIVE", "SUSPENDED"):
            raise HTTPException(status_code=400, detail="status debe ser ACTIVE o SUSPENDED")
        row.status = st
    if body.plan is not None:
        row.plan_name = body.plan.strip()
    db.add(models.AuditLog(
        empresa_id=empresa_id, sucursal_id=empresa_id, user_id=sa.get("sub", "superadmin"),
        action=f"TENANT_UPDATE:{empresa_id} status={row.status} plan={row.plan_name}",
        severity="WARNING",
    ))
    db.commit()
    return {"ok": True, "empresa_id": empresa_id, "status": row.status, "plan": row.plan_name}
