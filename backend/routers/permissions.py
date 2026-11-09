"""Ítem 4: Gestión de permisos temporales de módulo.

Permite al ADMIN_GENERAL otorgar, listar y revocar permisos temporales para
que un ADMIN_SUCURSAL acceda a módulos normalmente bloqueados (RRHH, COMPRAS,
CONFIGURACION) durante un rango de fechas.

Endpoints:
  POST   /api/permissions/temp-grants         — crear permiso temporal
  GET    /api/permissions/temp-grants          — listar (filtrable por user_id)
  DELETE /api/permissions/temp-grants/{id}     — revocar (soft)
  GET    /api/permissions/sucursal-blocked-modules — ver módulos bloqueados del tenant
  PUT    /api/permissions/sucursal-blocked-modules — actualizar lista (ADMIN_GENERAL only)
"""

from datetime import datetime, timezone
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from deps import get_empresa_id, get_tenant_context, role_guard

router = APIRouter(tags=["permisos"])

# Solo el ADMIN_GENERAL puede gestionar permisos temporales.
_ADMIN_GUARD = role_guard(["admin", "Administrador"])


@router.post("/api/permissions/temp-grants", response_model=schemas.TempPermissionGrantOut)
def create_temp_grant(
    data: schemas.TempPermissionGrantCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_ADMIN_GUARD),
):
    """Crea un permiso temporal. Solo ADMIN_GENERAL."""
    role = (payload.get("role") or "").lower()
    if role not in ("admin", "administrador", "superadmin"):
        raise HTTPException(status_code=403, detail="Solo el administrador general puede otorgar permisos temporales")

    try:
        valid_from  = datetime.fromisoformat(data.valid_from).replace(tzinfo=timezone.utc)
        valid_until = datetime.fromisoformat(data.valid_until).replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido. Usa ISO 8601 (YYYY-MM-DDTHH:MM:SS)")

    if valid_until <= valid_from:
        raise HTTPException(status_code=400, detail="valid_until debe ser posterior a valid_from")

    # Verificar que el usuario objetivo existe en el tenant y es admin_sucursal
    target_user = (db.query(models.User)
                     .filter(models.User.empresa_id == empresa_id,
                             models.User.id == data.user_id)
                     .first())
    if not target_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado en este tenant")

    granted_by = payload.get("sub") or payload.get("user_id") or "unknown"

    grant = models.TempPermissionGrant(
        id          = str(uuid.uuid4()),
        empresa_id  = empresa_id,
        user_id     = data.user_id,
        module      = data.module.upper(),
        sucursal_id = data.sucursal_id,
        granted_by  = granted_by,
        valid_from  = valid_from,
        valid_until = valid_until,
        revoked     = False,
    )
    db.add(grant)
    db.commit()
    db.refresh(grant)
    return _to_out(grant)


@router.get("/api/permissions/temp-grants", response_model=List[schemas.TempPermissionGrantOut])
def list_temp_grants(
    user_id: Optional[str] = None,
    module: Optional[str] = None,
    active_only: bool = False,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    """Lista permisos temporales del tenant. Filtrable por user_id, module o activos."""
    q = db.query(models.TempPermissionGrant).filter(
        models.TempPermissionGrant.empresa_id == empresa_id
    )
    if user_id:
        q = q.filter(models.TempPermissionGrant.user_id == user_id)
    if module:
        q = q.filter(models.TempPermissionGrant.module == module.upper())
    if active_only:
        now = datetime.now(timezone.utc)
        q = q.filter(
            models.TempPermissionGrant.revoked == False,
            models.TempPermissionGrant.valid_from  <= now,
            models.TempPermissionGrant.valid_until >= now,
        )
    return [_to_out(g) for g in q.order_by(models.TempPermissionGrant.created_at.desc()).all()]


@router.delete("/api/permissions/temp-grants/{grant_id}")
def revoke_temp_grant(
    grant_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    """Revoca (soft-delete) un permiso temporal."""
    grant = (db.query(models.TempPermissionGrant)
               .filter(models.TempPermissionGrant.empresa_id == empresa_id,
                       models.TempPermissionGrant.id == grant_id)
               .first())
    if not grant:
        raise HTTPException(status_code=404, detail="Permiso no encontrado")
    grant.revoked = True
    db.commit()
    return {"ok": True, "revoked": grant_id}


@router.get("/api/permissions/sucursal-blocked-modules")
def get_blocked_modules(
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    """Devuelve la lista de módulos bloqueados para admin_sucursal en este tenant."""
    row = (db.query(models.AdminConfig)
             .filter(models.AdminConfig.empresa_id == empresa_id,
                     models.AdminConfig.config_key == "roles.sucursal_blocked_modules")
             .first())
    modules = row.config_val if (row and isinstance(row.config_val, list)) else ["RRHH", "COMPRAS", "CONFIGURACION"]
    return {"blocked_modules": modules}


@router.put("/api/permissions/sucursal-blocked-modules")
def set_blocked_modules(
    body: dict,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_ADMIN_GUARD),
):
    """Actualiza la lista de módulos bloqueados. Solo ADMIN_GENERAL."""
    role = (payload.get("role") or "").lower()
    if role not in ("admin", "administrador", "superadmin"):
        raise HTTPException(status_code=403, detail="Solo el administrador general puede modificar los módulos bloqueados")

    modules = body.get("blocked_modules", [])
    if not isinstance(modules, list):
        raise HTTPException(status_code=400, detail="blocked_modules debe ser una lista")

    modules_upper = [str(m).upper() for m in modules]

    row = (db.query(models.AdminConfig)
             .filter(models.AdminConfig.empresa_id == empresa_id,
                     models.AdminConfig.config_key == "roles.sucursal_blocked_modules")
             .first())
    if row:
        row.config_val = modules_upper
    else:
        row = models.AdminConfig(
            empresa_id  = empresa_id,
            config_key  = "roles.sucursal_blocked_modules",
            config_val  = modules_upper,
        )
        db.add(row)
    db.commit()
    return {"ok": True, "blocked_modules": modules_upper}


def _to_out(g: models.TempPermissionGrant) -> dict:
    return {
        "id":          g.id,
        "empresa_id":  g.empresa_id,
        "user_id":     g.user_id,
        "module":      g.module,
        "sucursal_id": g.sucursal_id,
        "granted_by":  g.granted_by,
        "valid_from":  g.valid_from.isoformat() if g.valid_from else None,
        "valid_until": g.valid_until.isoformat() if g.valid_until else None,
        "revoked":     g.revoked,
        "created_at":  g.created_at.isoformat() if g.created_at else None,
    }
