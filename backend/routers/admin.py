"""Módulo Administración — endpoints extraídos de main.py (strangler fig, Fase 1 MVP).

Contiene, por ahora: sucursales (branches) y multi-sucursal / terminales
autorizadas. El comportamiento es idéntico al que tenían estos endpoints en
main.py; solo se movieron a un router y se sacaron del bloque
`if os.path.exists(frontend_dir):` en el que estaban anidados.

A medida que se toquen otras piezas del módulo Admin (usuarios/roles, AuditLog,
AdminConfig, reloj) se irán moviendo aquí.
"""
import datetime as _dt
import logging as _logging_admin
import re as _re
import uuid as _uuid_admin
from typing import Any, Optional

import bcrypt as _bcrypt
import jwt

from fastapi import APIRouter, Body, Depends, File as FastAPIFile, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

import models
import roles as roles_catalog
import schemas
from database import get_db
import crud
from deps import JWT_ALGORITHM, JWT_SECRET, get_empresa_id, role_guard, require_module_access
from services.employee_photo_storage import (
    LocalEmployeePhotoStorage, MAX_PHOTO_BYTES, PhotoStorageError,
)

router = APIRouter(tags=["admin"])

_log_admin = _logging_admin.getLogger("calebsys.admin")

_RH_ROLES = ["admin", "Administrador", "SUPERADMIN", "Gerente", "recursos humanos"]

# ─── RH-04 reloj: constantes compartidas con main.py ─────────────────────────
RELOJ_ROLES_AUTORIZAN   = {"admin", "gerente", "superadmin"}
RELOJ_MIN_HORAS_JORNADA = 4.0

# ─── Foto de empleado ─────────────────────────────────────────────────────────
_employee_photo_storage = LocalEmployeePhotoStorage()


# ─── T-8: Multi-sucursal (terminales autorizadas por sede) ───────────────
# Alcance actual: superficie de configuración + verificador ASESOR (no
# bloquea el login todavía). Enganche pendiente: llamar a
# check_terminal_autorizada() dentro de /api/auth/login cuando
# `multisucursal.enforce` sea true. AdminConfig key: 'multisucursal'.
_MS_KEY = "multisucursal"


def _ms_get(db, empresa_id: str) -> dict:
    row = (db.query(models.AdminConfig)
             .filter(models.AdminConfig.empresa_id == empresa_id)
             .filter(models.AdminConfig.config_key == _MS_KEY)
             .first())
    cfg = (row.config_val if row else None) or {}
    return cfg if isinstance(cfg, dict) else {}


def check_terminal_autorizada(db, empresa_id: str, terminal_id: str) -> dict:
    """D4: ¿está esta terminal registrada para el tenant, y a qué sede pertenece?

    Devuelve siempre un dict (nunca lanza):
      enforced    — el tenant exige login solo desde terminales autorizadas
      authorized  — la terminal está en el registro
      sucursal_id — sede a la que pertenece la terminal (si está registrada)
      label       — nombre legible de la terminal

    El que decide qué hacer con esto es /api/auth/login: si enforced y no
    authorized → 403. Si enforced y authorized → la sesión se ata a esa sede.
    """
    cfg = _ms_get(db, empresa_id)
    terms = cfg.get("terminales") or {}
    entry = terms.get((terminal_id or "").strip()) if terminal_id else None
    return {
        "enforced":    bool(cfg.get("enforce")),
        "authorized":  entry is not None,
        "sucursal_id": (entry or {}).get("sucursal_id"),
        "label":       (entry or {}).get("label"),
    }


@router.get("/api/multisucursal/config")
def ms_config_get(
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
    _m: None = Depends(require_module_access("CONFIGURACION")),
):
    cfg = _ms_get(db, tenant.get("empresa"))
    return {
        "tenant_id":  tenant.get("empresa"),
        "enforce":    bool(cfg.get("enforce")),
        "terminales": cfg.get("terminales") or {},
    }


@router.put("/api/multisucursal/config")
def ms_config_put(
    body: dict,
    db: Session = Depends(get_db),
    payload: dict = Depends(role_guard(["ADMIN", "admin", "SUPERADMIN"])),
    _m: None = Depends(require_module_access("CONFIGURACION")),
):
    empresa_id = payload.get("empresa")
    cfg = _ms_get(db, empresa_id)
    if "enforce" in (body or {}):
        cfg["enforce"] = bool(body["enforce"])
    if isinstance((body or {}).get("terminales"), dict):
        cfg["terminales"] = body["terminales"]
    row = (db.query(models.AdminConfig)
             .filter(models.AdminConfig.empresa_id == empresa_id)
             .filter(models.AdminConfig.config_key == _MS_KEY)
             .first())
    if row:
        row.config_val = cfg
        row.updated_by = payload.get("user_id", "system")
    else:
        db.add(models.AdminConfig(empresa_id=empresa_id, config_key=_MS_KEY,
                                  config_val=cfg, updated_by=payload.get("user_id", "system")))
    db.commit()
    return {"ok": True, "enforce": bool(cfg.get("enforce")),
            "terminales": cfg.get("terminales") or {}}


@router.get("/api/multisucursal/check")
def ms_check(
    terminal_id: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Verificador ASESOR: dice si una terminal está registrada y a qué
    sede pertenece. No bloquea nada por sí mismo."""
    cfg = _ms_get(db, tenant.get("empresa"))
    terms = cfg.get("terminales") or {}
    entry = terms.get(terminal_id)
    return {
        "terminal_id":  terminal_id,
        "authorized":   entry is not None,
        "enforced":     bool(cfg.get("enforce")),
        "sucursal_id":  (entry or {}).get("sucursal_id"),
        "label":        (entry or {}).get("label"),
    }


@router.get("/api/terminal/whoami")
def terminal_whoami(
    empresa_id: str,
    terminal_id: str,
    db: Session = Depends(get_db),
):
    """D4 — PÚBLICO (pre-login). La terminal se autoidentifica: dado su
    `empresa_id` (tenant) y su `terminal_id` local, devuelve a qué sede
    pertenece y si el tenant exige login solo desde terminales autorizadas.
    Sirve para que la pantalla de login muestre "Sucursal: …" y decida si
    mandar `terminal_id` en el login. No expone credenciales ni datos de
    usuarios — solo la etiqueta de la sede."""
    info = check_terminal_autorizada(db, empresa_id, terminal_id)
    return {
        "empresa_id":   empresa_id,
        "terminal_id":  terminal_id,
        "enforced":     info["enforced"],
        "authorized":   info["authorized"],
        "sucursal_id":  info["sucursal_id"],
        "label":        info["label"],
    }


# ─── Sucursales (Branches) ────────────────────────────────────────────────

@router.get("/api/branches")
def list_branches(
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Lista todas las sucursales activas e inactivas del tenant."""
    empresa_id = tenant.get("empresa")
    rows = (
        db.query(models.Branch)
        .filter(models.Branch.empresa_id == empresa_id)
        .order_by(models.Branch.is_main.desc(), models.Branch.name)
        .all()
    )
    return [
        {
            "id":         r.id,
            "name":       r.name,
            "address":    r.address,
            "phone":      r.phone,
            "email":      r.email,
            "status":     r.status,
            "is_main":    r.is_main,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/api/branches", status_code=201)
def create_branch(
    req: schemas.BranchCreate,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Crea una nueva sucursal para el tenant."""
    empresa_id = tenant.get("empresa")
    branch = models.Branch(
        empresa_id = empresa_id,
        name       = req.name,
        address    = req.address,
        phone      = req.phone,
        email      = req.email,
        is_main    = req.is_main,
        status     = "ACTIVE",
    )
    db.add(branch)
    db.add(models.AuditLog(
        empresa_id  = empresa_id,
        user_id     = tenant.get("user_id", "system"),
        action      = f"BRANCH_CREATE:{req.name}",
        severity    = "INFO",
    ))
    db.commit()
    db.refresh(branch)
    return {"ok": True, "id": branch.id, "name": branch.name}


@router.put("/api/branches/{branch_id}")
def update_branch(
    branch_id: str,
    req: schemas.BranchUpdate,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Actualiza nombre, contacto, status o flag is_main de una sucursal."""
    empresa_id = tenant.get("empresa")
    branch = db.query(models.Branch).filter(
        models.Branch.id         == branch_id,
        models.Branch.empresa_id == empresa_id,
    ).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")

    if req.name    is not None: branch.name    = req.name
    if req.address is not None: branch.address = req.address
    if req.phone   is not None: branch.phone   = req.phone
    if req.email   is not None: branch.email   = req.email
    if req.status  is not None: branch.status  = req.status
    if req.is_main is not None: branch.is_main = req.is_main

    db.add(models.AuditLog(
        empresa_id  = empresa_id,
        user_id     = tenant.get("user_id", "system"),
        action      = f"BRANCH_UPDATE:{branch_id}",
        severity    = "INFO",
    ))
    db.commit()
    return {"ok": True}


# ─── Catálogo de roles del tenant (D2) ───────────────────────────────────────

@router.get("/api/admin/roles")
def admin_list_roles(
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Roles vigentes del tenant (los suyos si definió 'catalog.roles', o el
    catálogo por defecto). Alimenta el <select> de rol en Usuarios."""
    return {"roles": roles_catalog.get_tenant_roles(db, tenant.get("empresa"))}


# ─── Usuarios del sistema (ADMIN) ───────────────────────────────────────────

@router.get("/api/admin/users")
def admin_list_users(
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Lista de usuarios del sistema para el tenant (ADMIN)."""
    empresa_id = tenant.get("empresa")
    users = db.query(models.User).filter(
        models.User.empresa_id == empresa_id
    ).order_by(models.User.created_at.desc()).all()
    return [
        {
            "id":          u.id,
            "username":    u.username,
            "role":        u.role,
            "sucursal_id": u.sucursal_id,
            "status":      u.status,
            "created_at":  u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.post("/api/admin/users", status_code=201)
def admin_create_user(
    req: schemas.UserCreateRequest,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Crea un nuevo usuario del sistema (ADMIN)."""
    empresa_id = tenant.get("empresa")
    # D2: el rol debe existir en el catálogo del tenant.
    if not roles_catalog.role_is_valid(db, empresa_id, req.role):
        raise HTTPException(status_code=400, detail=f"Rol no válido para este tenant: {req.role}")
    role_slug = roles_catalog.normalize_role(req.role)
    # Verificar username único dentro del tenant
    existing = db.query(models.User).filter(
        models.User.empresa_id == empresa_id,
        models.User.username   == req.username,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="El usuario ya existe en este tenant")

    hashed = _bcrypt.hashpw(req.password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")
    new_user = models.User(
        empresa_id      = empresa_id,
        sucursal_id     = req.sucursal_id,
        username        = req.username,
        hashed_password = hashed,
        role            = role_slug,
        status          = "ACTIVE",
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    # Registrar en audit_log
    db.add(models.AuditLog(
        empresa_id  = empresa_id,
        sucursal_id = new_user.sucursal_id,
        user_id     = tenant.get("sub", "admin"),
        action      = f"Creó usuario: {req.username} (rol={role_slug})",
        severity    = "INFO",
    ))
    db.commit()
    return {"ok": True, "id": new_user.id, "username": new_user.username}


@router.put("/api/admin/users/{user_id}")
def admin_update_user(
    user_id: str,
    req: schemas.UserUpdateRequest,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Actualiza rol / status / sucursal de un usuario (ADMIN)."""
    empresa_id = tenant.get("empresa")
    u = db.query(models.User).filter(
        models.User.empresa_id == empresa_id,
        models.User.id         == user_id,
    ).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if req.role is not None:
        if not roles_catalog.role_is_valid(db, empresa_id, req.role):
            raise HTTPException(status_code=400, detail=f"Rol no válido para este tenant: {req.role}")
        u.role = roles_catalog.normalize_role(req.role)
    if req.status      is not None: u.status      = req.status
    if req.sucursal_id is not None: u.sucursal_id = req.sucursal_id
    db.commit()
    db.add(models.AuditLog(
        empresa_id  = empresa_id,
        sucursal_id = u.sucursal_id,
        user_id     = tenant.get("sub", "admin"),
        action      = f"Actualizó usuario: {u.username}",
        severity    = "INFO",
    ))
    db.commit()
    return {"ok": True}


@router.delete("/api/admin/users/{user_id}")
def admin_delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Desactiva un usuario (soft-delete) (ADMIN)."""
    empresa_id = tenant.get("empresa")
    u = db.query(models.User).filter(
        models.User.empresa_id == empresa_id,
        models.User.id         == user_id,
    ).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    # Proteger al único admin
    if u.role in ("admin", "ADMIN") and u.username == tenant.get("sub"):
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta de admin")
    u.status = "INACTIVE"
    db.commit()
    db.add(models.AuditLog(
        empresa_id  = empresa_id,
        sucursal_id = u.sucursal_id,
        user_id     = tenant.get("sub", "admin"),
        action      = f"Desactivó usuario: {u.username}",
        severity    = "WARNING",
    ))
    db.commit()
    return {"ok": True}


# ─── Auditoría ──────────────────────────────────────────────────────────────

@router.get("/api/admin/audit-logs")
def admin_audit_logs(
    severity: Optional[str] = Query(None),
    search:   Optional[str] = Query(None),
    limit:    int = Query(100, le=500),
    offset:   int = Query(0, ge=0),
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN", "Gerente"])),
):
    """Log de auditoría con filtros de severidad y búsqueda (ADMIN/GERENTE)."""
    empresa_id = tenant.get("empresa")
    q = db.query(models.AuditLog).filter(
        models.AuditLog.empresa_id == empresa_id
    )
    if severity and severity != "TODOS":
        q = q.filter(models.AuditLog.severity == severity.upper())
    if search:
        like = f"%{search}%"
        q = q.filter(
            (models.AuditLog.action.ilike(like)) |
            (models.AuditLog.user_id.ilike(like))
        )
    total = q.count()
    rows  = q.order_by(models.AuditLog.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id":         r.id,
                "user_id":    r.user_id,
                "action":     r.action,
                "severity":   r.severity,
                "details":    r.details,
                "ip_address": r.ip_address,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.get("/api/admin/empresa")
def admin_empresa_info(
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Info resumida del tenant / empresa (ADMIN)."""
    empresa_id = tenant.get("empresa")
    total_users = db.query(models.User).filter(
        models.User.empresa_id == empresa_id,
        models.User.status     == "ACTIVE",
    ).count()
    # Contar sucursales reales de la tabla Branch (no por DISTINCT de usuarios)
    sucursales = db.query(models.Branch).filter(
        models.Branch.empresa_id == empresa_id,
        models.Branch.status     == "ACTIVE",
    ).count()
    return {
        "empresa_id":        empresa_id,
        "total_users":       total_users,
        "total_sucursales":  sucursales,
        "plan":              "CalebSys Fase 2 — MVP",
    }


# ─── AdminConfig (parámetros, folios, catálogos) ────────────────────────────

@router.get("/api/admin/config")
def admin_config_list(
    prefix: Optional[str] = Query(None, description="Filtrar por prefijo: params, folio, catalog"),
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
    _m: None = Depends(require_module_access("CONFIGURACION")),
):
    """Devuelve todos los AdminConfig del tenant, opcionalmente filtrados por prefijo."""
    empresa_id = tenant.get("empresa")
    q = db.query(models.AdminConfig).filter(
        models.AdminConfig.empresa_id == empresa_id,
    )
    if prefix:
        q = q.filter(models.AdminConfig.config_key.startswith(prefix))
    rows = q.order_by(models.AdminConfig.config_key).all()
    return {r.config_key: r.config_val for r in rows}


@router.get("/api/admin/config/{key}")
def admin_config_get_one(
    key: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
    _m: None = Depends(require_module_access("CONFIGURACION")),
):
    """Devuelve el valor de UNA clave de AdminConfig (o 404 si no existe)."""
    row = db.query(models.AdminConfig).filter(
        models.AdminConfig.empresa_id == tenant.get("empresa"),
        models.AdminConfig.config_key == key,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="clave_no_encontrada")
    return {"key": key, "value": row.config_val,
            "updated_by": row.updated_by,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None}


@router.put("/api/admin/config/{key}")
def admin_config_upsert(
    key: str,
    body: Any = Body(...),
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
    _m: None = Depends(require_module_access("CONFIGURACION")),
):
    """Crea o actualiza un AdminConfig por clave (upsert).
    Body: CUALQUIER JSON (objeto, lista, string, número, bool) — se almacena
    tal cual en config_val. Ej.: PUT /api/admin/config/catalog.roles con un
    array; PUT /api/admin/config/ticket.header con {"value": "..."}.
    """
    empresa_id = tenant.get("empresa")
    row = db.query(models.AdminConfig).filter(
        models.AdminConfig.empresa_id == empresa_id,
        models.AdminConfig.config_key == key,
    ).first()
    if row:
        row.config_val  = body
        row.updated_by  = tenant.get("user_id", "system")
    else:
        row = models.AdminConfig(
            empresa_id  = empresa_id,
            config_key  = key,
            config_val  = body,
            updated_by  = tenant.get("user_id", "system"),
        )
        db.add(row)
    db.add(models.AuditLog(
        empresa_id  = empresa_id,
        sucursal_id = tenant.get("sucursal"),
        user_id     = tenant.get("user_id", "system"),
        action      = f"ADMIN_CONFIG_UPSERT:{key}",
        severity    = "INFO",
    ))
    db.commit()
    return {"ok": True, "key": key}


def _count_products_by_brand(db: Session, empresa_id: str, brand_upper: str) -> int:
    prods = db.query(models.Product).filter(models.Product.empresa_id == empresa_id).all()
    cnt = 0
    for p in prods:
        md = p.meta_data if isinstance(p.meta_data, dict) else {}
        b = str(md.get("marca") or md.get("brand") or "").strip().upper()
        if b == brand_upper:
            cnt += 1
    return cnt


@router.put("/api/admin/catalogs/marcas/rename")
def admin_catalog_marca_rename(
    body: dict = Body(...),
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
    _m: None = Depends(require_module_access("CONFIGURACION")),
):
    """Renombra una marca en catalog.marcas y propaga el nuevo nombre a los productos asociados."""
    empresa_id = tenant.get("empresa")
    old_name = str((body or {}).get("old_name") or "").strip().upper()
    new_name = str((body or {}).get("new_name") or "").strip().upper()
    if not old_name or not new_name:
        raise HTTPException(status_code=400, detail="Nombre de marca inválido")

    row = db.query(models.AdminConfig).filter(
        models.AdminConfig.empresa_id == empresa_id,
        models.AdminConfig.config_key == "catalog.marcas",
    ).first()
    marcas = list(row.config_val) if (row and isinstance(row.config_val, list)) else []
    marcas_norm = [str(x).strip().upper() for x in marcas if str(x).strip()]

    if old_name != new_name and new_name in marcas_norm:
        raise HTTPException(status_code=409, detail="Esta marca ya se encuentra registrada")

    updated_marcas = []
    replaced = False
    for m in marcas_norm:
        if m == old_name:
            if new_name not in updated_marcas:
                updated_marcas.append(new_name)
            replaced = True
        else:
            if m not in updated_marcas:
                updated_marcas.append(m)
    if not replaced and new_name not in updated_marcas:
        updated_marcas.append(new_name)

    if row:
        row.config_val = updated_marcas
        row.updated_by = tenant.get("user_id", "system")
    else:
        db.add(models.AdminConfig(
            empresa_id=empresa_id,
            config_key="catalog.marcas",
            config_val=updated_marcas,
            updated_by=tenant.get("user_id", "system"),
        ))

    updated_products = 0
    if old_name != new_name:
        prods = db.query(models.Product).filter(models.Product.empresa_id == empresa_id).all()
        for p in prods:
            md = dict(p.meta_data) if isinstance(p.meta_data, dict) else {}
            cur_b = str(md.get("marca") or md.get("brand") or "").strip().upper()
            if cur_b == old_name:
                md["marca"] = new_name
                if "brand" in md:
                    md["brand"] = new_name
                p.meta_data = md
                updated_products += 1

    db.add(models.AuditLog(
        empresa_id=empresa_id,
        sucursal_id=tenant.get("sucursal"),
        user_id=tenant.get("user_id", "system"),
        action=f"CATALOG_MARCA_RENAME:{old_name}->{new_name} (prods={updated_products})",
        severity="INFO",
    ))
    db.commit()
    return {"ok": True, "old_name": old_name, "new_name": new_name, "marcas": updated_marcas, "updated_products": updated_products}


@router.delete("/api/admin/catalogs/marcas/{marca_name}")
def admin_catalog_marca_delete(
    marca_name: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
    _m: None = Depends(require_module_access("CONFIGURACION")),
):
    """Elimina una marca validando en caliente que no tenga artículos asignados (> 0 bloquea)."""
    empresa_id = tenant.get("empresa")
    target = str(marca_name or "").strip().upper()
    if not target:
        raise HTTPException(status_code=400, detail="Marca inválida")

    assigned = _count_products_by_brand(db, empresa_id, target)
    if assigned > 0:
        raise HTTPException(
            status_code=409,
            detail="No se puede eliminar porque tiene artículos asignados",
        )

    row = db.query(models.AdminConfig).filter(
        models.AdminConfig.empresa_id == empresa_id,
        models.AdminConfig.config_key == "catalog.marcas",
    ).first()
    marcas = list(row.config_val) if (row and isinstance(row.config_val, list)) else []
    updated_marcas = [str(x).strip().upper() for x in marcas if str(x).strip().upper() != target]

    if row:
        row.config_val = updated_marcas
        row.updated_by = tenant.get("user_id", "system")

    db.add(models.AuditLog(
        empresa_id=empresa_id,
        sucursal_id=tenant.get("sucursal"),
        user_id=tenant.get("user_id", "system"),
        action=f"CATALOG_MARCA_DELETE:{target}",
        severity="WARNING",
    ))
    db.commit()
    return {"ok": True, "deleted": target, "marcas": updated_marcas}


# ─── RH / Empleados ─────────────────────────────────────────────────────────
# El rol vive en User (Employee.user_id -> User). Los endpoints de foto
# (upload/serve) siguen en main.py: dependen de services.employee_photo_storage.

@router.get("/api/rh/employees", response_model=schemas.EmployeeListResponse)
def list_employees(
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(_RH_ROLES)),
    _m: None = Depends(require_module_access("RRHH")),
):
    empresa_id = tenant.get("empresa")
    if not empresa_id:
        raise HTTPException(status_code=401, detail="tenant_missing")

    sucursal_id = tenant.get("sucursal")
    query = db.query(models.Employee).filter(
        models.Employee.empresa_id == empresa_id,
        models.Employee.is_deleted == False,
    )
    if sucursal_id and sucursal_id.upper() != "MATRIZ":
        query = query.filter(models.Employee.sucursal_id == sucursal_id)

    employees = query.order_by(models.Employee.created_at.desc()).all()
    return schemas.EmployeeListResponse(ok=True, employees=employees)


@router.post("/api/rh/employees", response_model=schemas.EmployeeCreateResponse)
def create_employee(
    payload: schemas.EmployeeCreateRequest,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(_RH_ROLES)),
    _m: None = Depends(require_module_access("RRHH")),
):
    empresa_id = tenant.get("empresa")
    if not empresa_id:
        raise HTTPException(status_code=401, detail="tenant_missing")

    if not payload.full_name: raise HTTPException(status_code=400, detail="full_name_required")
    if not payload.area: raise HTTPException(status_code=400, detail="area_required")
    if not payload.position: raise HTTPException(status_code=400, detail="position_required")
    if not payload.hire_date: raise HTTPException(status_code=400, detail="hire_date_required")
    if not payload.sucursal_id: raise HTTPException(status_code=400, detail="sucursal_required")

    existing_emp = db.query(models.Employee).filter(
        models.Employee.empresa_id == empresa_id,
        models.Employee.sucursal_id == payload.sucursal_id,
        models.Employee.full_name == payload.full_name,
        models.Employee.phone == payload.phone,
        models.Employee.is_deleted == False,
    ).first()
    if existing_emp:
        raise HTTPException(status_code=409, detail="employee_duplicate")

    user_obj = None
    if payload.can_login:
        if not payload.usuario_id: raise HTTPException(status_code=400, detail="usuario_id_required")
        if not payload.temporary_password: raise HTTPException(status_code=400, detail="password_required")
        if payload.temporary_password != payload.temporary_password_confirm: raise HTTPException(status_code=400, detail="password_confirm_mismatch")
        if not payload.role: raise HTTPException(status_code=400, detail="role_required")
        # D2: el rol debe existir en el catálogo del tenant.
        if not roles_catalog.role_is_valid(db, empresa_id, payload.role):
            raise HTTPException(status_code=400, detail=f"rol_no_valido:{payload.role}")
        role_slug = roles_catalog.normalize_role(payload.role)

        existing_user = db.query(models.User).filter(
            models.User.empresa_id == empresa_id,
            models.User.username == payload.usuario_id,
        ).first()
        if existing_user:
            raise HTTPException(status_code=409, detail="usuario_id_duplicado")

        pw_bytes = payload.temporary_password.encode("utf-8")
        hashed_pw = _bcrypt.hashpw(pw_bytes, _bcrypt.gensalt()).decode("utf-8")
        user_obj = models.User(
            empresa_id=empresa_id,
            sucursal_id=payload.sucursal_id,
            username=payload.usuario_id,
            hashed_password=hashed_pw,
            role=role_slug,
            created_at=_dt.datetime.utcnow(),
        )
        db.add(user_obj)
        try:
            db.flush()
        except Exception:
            db.rollback()
            raise HTTPException(status_code=500, detail="user_create_failed")

    pin_hash = None
    if payload.can_clock_in:
        if not payload.pin: raise HTTPException(status_code=400, detail="pin_required")
        if not payload.pin.isdigit() or len(payload.pin) != 4: raise HTTPException(status_code=400, detail="pin_invalid_format")
        if payload.pin != payload.pin_confirm: raise HTTPException(status_code=400, detail="pin_confirm_mismatch")
        pin_hash = _bcrypt.hashpw(payload.pin.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")

    try:
        new_emp = models.Employee(
            empresa_id=empresa_id,
            sucursal_id=payload.sucursal_id,
            user_id=user_obj.id if user_obj else None,
            usuario_id=user_obj.username if user_obj else None,
            employee_code=payload.employee_code,
            full_name=payload.full_name,
            display_name=payload.display_name,
            phone=payload.phone,
            email=payload.email,
            area=payload.area,
            position=payload.position,
            employment_type=payload.employment_type,
            hire_date=payload.hire_date,
            status=payload.status,
            assigned_warehouse_id=payload.assigned_warehouse_id,
            assigned_warehouse_name=payload.assigned_warehouse_name,
            can_login=payload.can_login,
            can_clock_in=payload.can_clock_in,
            pin_hash=pin_hash,
            # is_deleted explícito: el server_default "false" (string) se guarda
            # literal en SQLite y el filtro is_deleted == False nunca lo matchea
            # -> el empleado quedaría invisible en el listado. (bug 04-sep-2026)
            is_deleted=False,
            created_at=_dt.datetime.utcnow(),
        )
        db.add(new_emp)
        db.commit()
    except Exception as _e:
        db.rollback()
        import logging
        logging.error(f"Error creating employee: {_e}")
        raise HTTPException(status_code=500, detail="employee_create_failed")

    db.add(models.AuditLog(
        empresa_id=empresa_id, sucursal_id=new_emp.sucursal_id,
        user_id=tenant.get("sub", "system"),
        action=f"EMPLOYEE_CREATE: {new_emp.full_name} (id={new_emp.id})",
        severity="INFO",
    ))
    db.commit()

    return schemas.EmployeeCreateResponse(
        ok=True,
        employee_id=new_emp.id,
        user_id=user_obj.id if user_obj else None,
        usuario_id=user_obj.username if user_obj else None,
        can_login=payload.can_login,
        can_clock_in=payload.can_clock_in,
        message="Empleado registrado correctamente",
    )


@router.get("/api/rh/employees/{employee_id}", response_model=schemas.EmployeeResponse)
def get_employee(
    employee_id: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(_RH_ROLES)),
    _m: None = Depends(require_module_access("RRHH")),
):
    empresa_id = tenant.get("empresa")
    if not empresa_id:
        raise HTTPException(status_code=401, detail="tenant_missing")
    emp = db.query(models.Employee).filter(
        models.Employee.id == employee_id,
        models.Employee.empresa_id == empresa_id,
        models.Employee.is_deleted == False,
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="employee_not_found")
    return emp


@router.put("/api/rh/employees/{employee_id}", response_model=schemas.EmployeeResponse)
def update_employee(
    employee_id: str,
    payload: schemas.EmployeeUpdateRequest,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(_RH_ROLES)),
    _m: None = Depends(require_module_access("RRHH")),
):
    empresa_id = tenant.get("empresa")
    if not empresa_id:
        raise HTTPException(status_code=401, detail="tenant_missing")

    emp = db.query(models.Employee).filter(
        models.Employee.id == employee_id,
        models.Employee.empresa_id == empresa_id,
        models.Employee.is_deleted == False,
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="employee_not_found")

    if payload.employee_code and payload.employee_code != emp.employee_code:
        duplicate = db.query(models.Employee).filter(
            models.Employee.empresa_id == empresa_id,
            models.Employee.employee_code == payload.employee_code,
            models.Employee.is_deleted == False,
            models.Employee.id != employee_id,
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="employee_code_duplicate")

    if payload.employee_code is not None: emp.employee_code = payload.employee_code
    if payload.full_name is not None: emp.full_name = payload.full_name
    if payload.display_name is not None: emp.display_name = payload.display_name
    if payload.phone is not None: emp.phone = payload.phone
    if payload.email is not None: emp.email = payload.email
    if payload.area is not None: emp.area = payload.area
    if payload.position is not None: emp.position = payload.position
    if payload.employment_type is not None: emp.employment_type = payload.employment_type
    if payload.hire_date is not None: emp.hire_date = payload.hire_date
    if payload.status is not None: emp.status = payload.status
    if payload.sucursal_id is not None: emp.sucursal_id = payload.sucursal_id
    if payload.assigned_warehouse_id is not None: emp.assigned_warehouse_id = payload.assigned_warehouse_id
    if payload.assigned_warehouse_name is not None: emp.assigned_warehouse_name = payload.assigned_warehouse_name
    if payload.assigned_cash_register_id is not None: emp.assigned_cash_register_id = payload.assigned_cash_register_id
    if payload.commission_factor is not None: emp.commission_factor = payload.commission_factor
    if payload.can_clock_in is not None: emp.can_clock_in = payload.can_clock_in

    # Unificación Usuario/Empleado: si el empleado tiene login, rol y sucursal
    # se mantienen sincronizados con el User enlazado.
    role_changed = False
    if emp.user_id and (payload.role is not None or payload.sucursal_id is not None):
        linked_user = db.query(models.User).filter(models.User.id == emp.user_id).first()
        if linked_user:
            if payload.role is not None:
                # D2: validar contra el catálogo antes de sincronizar.
                if not roles_catalog.role_is_valid(db, empresa_id, payload.role):
                    raise HTTPException(status_code=400, detail=f"rol_no_valido:{payload.role}")
                new_role = roles_catalog.normalize_role(payload.role)
                if new_role != linked_user.role:
                    linked_user.role = new_role
                    role_changed = True
            if payload.sucursal_id is not None:
                linked_user.sucursal_id = payload.sucursal_id

    if hasattr(emp, "updated_at"):
        emp.updated_at = _dt.datetime.utcnow()

    db.commit()
    db.refresh(emp)

    db.add(models.AuditLog(
        empresa_id=empresa_id, sucursal_id=emp.sucursal_id,
        user_id=tenant.get("sub", "system"),
        action=f"EMPLOYEE_UPDATE: {emp.full_name} (id={emp.id})" +
               (f" rol->{roles_catalog.normalize_role(payload.role)}" if role_changed else ""),
        severity="INFO",
    ))
    db.commit()
    return emp


@router.put("/api/rh/employees/{employee_id}/pin")
def update_employee_pin(
    employee_id: str,
    payload: schemas.EmployeeUpdatePinRequest,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(_RH_ROLES)),
    _m: None = Depends(require_module_access("RRHH")),
):
    empresa_id = tenant.get("empresa")
    if not empresa_id:
        raise HTTPException(status_code=401, detail="tenant_missing")

    emp = db.query(models.Employee).filter(
        models.Employee.id == employee_id,
        models.Employee.empresa_id == empresa_id,
        models.Employee.is_deleted == False,
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="employee_not_found")

    if not payload.pin or not _re.fullmatch(r"\d{4}", payload.pin):
        raise HTTPException(status_code=400, detail="pin_invalid_format")
    if not payload.pin_confirm:
        raise HTTPException(status_code=400, detail="pin_confirm_mismatch")
    if payload.pin != payload.pin_confirm:
        raise HTTPException(status_code=400, detail="pin_confirm_mismatch")

    emp.pin_hash = _bcrypt.hashpw(payload.pin.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")
    if hasattr(emp, "updated_at"):
        emp.updated_at = _dt.datetime.utcnow()
    db.commit()

    db.add(models.AuditLog(
        empresa_id=empresa_id, sucursal_id=emp.sucursal_id,
        user_id=tenant.get("sub", "system"),
        action=f"EMPLOYEE_PIN_UPDATE: {emp.full_name} (id={emp.id})",
        severity="WARNING",
    ))
    db.commit()
    return {"ok": True, "message": "pin_updated"}


@router.delete("/api/rh/employees/{employee_id}")
def delete_employee(
    employee_id: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(_RH_ROLES)),
    _m: None = Depends(require_module_access("RRHH")),
):
    empresa_id = tenant.get("empresa")
    if not empresa_id:
        raise HTTPException(status_code=401, detail="tenant_missing")

    emp = db.query(models.Employee).filter(
        models.Employee.id == employee_id,
        models.Employee.empresa_id == empresa_id,
        models.Employee.is_deleted == False,
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="employee_not_found")

    emp.is_deleted = True
    emp.status = "Inactivo"
    if hasattr(emp, "deleted_at"):
        emp.deleted_at = _dt.datetime.utcnow()
    if hasattr(emp, "deleted_by"):
        emp.deleted_by = tenant.get("sub", "unknown_user")
    db.commit()

    db.add(models.AuditLog(
        empresa_id=empresa_id, sucursal_id=emp.sucursal_id,
        user_id=tenant.get("sub", "system"),
        action=f"EMPLOYEE_DELETE: {emp.full_name} (id={emp.id})",
        severity="WARNING",
    ))
    db.commit()
    return {"ok": True, "message": "employee_soft_deleted"}


# ══════════════════════════════════════════════════════════════════════════════
# RH-04 — Autorización de salida temprana del reloj checador
# ══════════════════════════════════════════════════════════════════════════════

class RelojAutorizacionResolve(BaseModel):
    aprobar: bool


def _reloj_ensure_auth_table(db: Session) -> None:
    """Crea attendance_authorizations si no existe (SQLite fallback; en PG la crea Alembic)."""
    try:
        db.execute(text(
            "CREATE TABLE IF NOT EXISTS attendance_authorizations ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT,"
            " user_id TEXT NOT NULL,"
            " empresa_id TEXT NOT NULL,"
            " sucursal_id TEXT,"
            " event_date TEXT NOT NULL,"
            " entrada_ts TEXT NOT NULL,"
            " intento_ts TEXT NOT NULL,"
            " horas_transcurridas REAL NOT NULL,"
            " status TEXT NOT NULL DEFAULT 'pendiente',"
            " resolved_by TEXT,"
            " resolved_at TEXT,"
            " salida_event_id TEXT,"
            " created_at TEXT NOT NULL DEFAULT (datetime('now'))"
            ")"
        ))
        db.commit()
    except Exception as _e:
        _log_admin.error("[RH04] No pudo asegurar attendance_authorizations: %s", str(_e))


def _reloj_actor_desde_jwt(request: Request, db: Session):
    """Devuelve (username, role, user_id) del JWT activo, o (None, None, None)."""
    _raw = request.cookies.get("access_token") or request.headers.get("Authorization", "")
    tok = _raw.strip().strip('"').strip("'")
    if tok.lower().startswith("bearer "):
        tok = tok[7:]
    if not tok:
        return None, None, None
    try:
        payload = jwt.decode(tok, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        uname = payload.get("sub") or payload.get("user_id") or payload.get("username")
    except Exception:
        return None, None, None
    if not uname:
        return None, None, None
    try:
        row = db.execute(
            text("SELECT id, role FROM users WHERE username = :u LIMIT 1"), {"u": uname}
        ).fetchone()
        if not row:
            return uname, None, None
        return uname, (row[1] or "").lower().strip(), row[0]
    except Exception:
        return uname, None, None


@router.post("/api/asistencia/reloj/autorizaciones/{auth_id}/resolver")
def resolver_autorizacion_reloj(auth_id: int, body: RelojAutorizacionResolve,
                                request: Request, db: Session = Depends(get_db)):
    """Admin/Gerente aprueba o rechaza una salida temprana (< 4h). Si aprueba,
    la salida se registra AHORA en attendance_events (hora de salida = hora de
    aprobación, según Don Antonio)."""
    uname, role, _uid = _reloj_actor_desde_jwt(request, db)
    if not uname:
        return JSONResponse({"ok": False, "error": "no_autenticado"}, status_code=401)
    if role not in RELOJ_ROLES_AUTORIZAN:
        return JSONResponse({"ok": False, "error": "sin_permiso",
                             "message": "Solo Admin o Gerente autorizan salidas."}, status_code=403)

    _reloj_ensure_auth_table(db)
    row = db.execute(text(
        "SELECT id, user_id, empresa_id, sucursal_id, event_date, entrada_ts, "
        "horas_transcurridas, status FROM attendance_authorizations WHERE id = :id"
    ), {"id": auth_id}).fetchone()
    if not row:
        return JSONResponse({"ok": False, "error": "no_encontrada"}, status_code=404)
    if row[7] != "pendiente":
        return JSONResponse({"ok": False, "error": "ya_resuelta", "status": row[7]})

    now_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
    salida_event_id = None

    if body.aprobar:
        salida_event_id = str(_uuid_admin.uuid4())
        try:
            db.execute(text(
                "INSERT INTO attendance_events "
                "(id, user_id, empresa_id, sucursal_id, event_date, event_ts, action, device_info, is_deleted) "
                "VALUES (:id, :uid, :emp, :suc, :edate, :ets, 'salida', :dev, 0)"
            ), {
                "id": salida_event_id, "uid": row[1], "emp": row[2], "suc": row[3],
                "edate": row[4], "ets": now_iso,
                "dev": f"autorizado_por:{uname}",
            })
        except Exception as _ie:
            _log_admin.error("[RH04] INSERT salida autorizada falló: %s", str(_ie))
            return JSONResponse({"ok": False, "error": "error_servidor"}, status_code=500)

    db.execute(text(
        "UPDATE attendance_authorizations SET status = :st, resolved_by = :by, "
        "resolved_at = :at, salida_event_id = :eid WHERE id = :id"
    ), {
        "st": "aprobada" if body.aprobar else "rechazada",
        "by": uname, "at": now_iso, "eid": salida_event_id, "id": auth_id,
    })
    db.commit()
    _log_admin.info("[RH04] Autorización %s %s por %s", auth_id,
                    "aprobada" if body.aprobar else "rechazada", uname)

    try:
        db.add(models.AuditLog(
            empresa_id=row[2], sucursal_id=row[3], user_id=uname,
            action=f"RELOJ_AUTORIZACION_{'APROBADA' if body.aprobar else 'RECHAZADA'}: "
                   f"salida temprana de user_id={row[1]} (auth_id={auth_id})",
            severity="WARNING",
        ))
        db.commit()
    except Exception:
        db.rollback()

    return JSONResponse({
        "ok": True,
        "status": "aprobada" if body.aprobar else "rechazada",
        "salida_ts": now_iso if body.aprobar else None,
        "salida_event_id": salida_event_id,
    })


@router.get("/api/notificaciones/reloj/autorizaciones")
def listar_autorizaciones_reloj(status: str = "pendiente", request: Request = None,
                                db: Session = Depends(get_db)):
    """Lista de autorizaciones de salida temprana para la campana del admin-shell."""
    uname, role, _uid = _reloj_actor_desde_jwt(request, db)
    if not uname:
        return JSONResponse({"ok": False, "error": "no_autenticado"}, status_code=401)
    if role not in RELOJ_ROLES_AUTORIZAN:
        return JSONResponse({"autorizaciones": [], "count": 0})

    _reloj_ensure_auth_table(db)
    try:
        pragma = db.execute(text("PRAGMA table_info(users)")).fetchall()
        cols = [r[1] for r in pragma]
        col_nombre = "nombre_completo" if "nombre_completo" in cols else "username"
    except Exception:
        col_nombre = "username"

    try:
        rows = db.execute(text(
            f"SELECT a.id, a.user_id, u.{col_nombre}, a.event_date, a.entrada_ts, "  # nosec B608 — col_nombre from PRAGMA whitelist
            f"a.intento_ts, a.horas_transcurridas, a.status, a.created_at, "
            f"a.resolved_by, a.resolved_at "
            f"FROM attendance_authorizations a "
            f"LEFT JOIN users u ON u.id = a.user_id "
            f"WHERE a.status = :st ORDER BY a.created_at DESC LIMIT 200"
        ), {"st": status}).fetchall()
    except Exception as _qe:
        _log_admin.error("[RH04] listar autorizaciones falló: %s", str(_qe))
        return JSONResponse({"autorizaciones": [], "count": 0, "error": "db_error"})

    items = [{
        "id": r[0], "user_id": r[1], "empleado": r[2] or f"user#{r[1]}",
        "event_date": r[3], "entrada_ts": r[4], "intento_ts": r[5],
        "horas_transcurridas": r[6], "horas_minimas": RELOJ_MIN_HORAS_JORNADA,
        "status": r[7], "created_at": r[8],
        "resolved_by": r[9], "resolved_at": r[10],
    } for r in rows]
    return JSONResponse({"autorizaciones": items, "count": len(items)})


# ══════════════════════════════════════════════════════════════════════════════
# Foto de empleado — depende de services.employee_photo_storage
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/api/rh/employees/{employee_id}/photo")
async def upload_employee_photo(
    employee_id: str,
    file: UploadFile = FastAPIFile(...),
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(_RH_ROLES)),
):
    empresa_id = tenant.get("empresa")
    if not empresa_id:
        raise HTTPException(status_code=401, detail="tenant_missing")
    employee = db.query(models.Employee).filter(
        models.Employee.id == employee_id,
        models.Employee.empresa_id == empresa_id,
        models.Employee.is_deleted == False,
    ).first()
    if not employee:
        raise HTTPException(status_code=404, detail="employee_not_found")

    content = await file.read(MAX_PHOTO_BYTES + 1)
    await file.close()
    try:
        new_filename = _employee_photo_storage.save(
            empresa_id, employee_id, content, file.content_type or ""
        )
    except PhotoStorageError as exc:
        status_code = 413 if str(exc) == "photo_too_large" else 400
        raise HTTPException(status_code=status_code, detail=str(exc))

    old_photo_url = employee.photo_url
    new_photo_url = f"/api/rh/employees/{employee_id}/photo/{new_filename}"
    try:
        employee.photo_url = new_photo_url
        db.commit()
        db.refresh(employee)
    except Exception:
        db.rollback()
        _employee_photo_storage.delete(empresa_id, employee_id, new_filename)
        raise HTTPException(status_code=500, detail="photo_persistence_failed")

    old_prefix = f"/api/rh/employees/{employee_id}/photo/"
    if old_photo_url and old_photo_url.startswith(old_prefix):
        old_filename = old_photo_url[len(old_prefix):]
        if old_filename and old_filename != new_filename:
            _employee_photo_storage.delete(empresa_id, employee_id, old_filename)
    return {"employee_id": employee_id, "photo_url": employee.photo_url}


@router.get("/api/rh/employees/{employee_id}/photo/{filename}")
def get_employee_photo(
    employee_id: str,
    filename: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(_RH_ROLES)),
):
    empresa_id = tenant.get("empresa")
    if not empresa_id:
        raise HTTPException(status_code=401, detail="tenant_missing")
    employee = db.query(models.Employee).filter(
        models.Employee.id == employee_id,
        models.Employee.empresa_id == empresa_id,
        models.Employee.is_deleted == False,
    ).first()
    expected_url = f"/api/rh/employees/{employee_id}/photo/{filename}"
    if not employee or employee.photo_url != expected_url:
        raise HTTPException(status_code=404, detail="photo_not_found")
    try:
        path, media_type = _employee_photo_storage.open(empresa_id, employee_id, filename)
    except (FileNotFoundError, PhotoStorageError):
        raise HTTPException(status_code=404, detail="photo_not_found")
    return FileResponse(path, media_type=media_type, filename=filename)


# ── Bodegas / Almacenes ──────────────────────────────────────────────────────

@router.get("/api/warehouses")
def list_warehouses(db: Session = Depends(get_db),
                    empresa_id: str = Depends(get_empresa_id)):
    whs = crud.get_warehouses(db, empresa_id)
    return [{"id": w.id, "name": w.name, "is_transit": w.is_transit,
             "sucursal_id": w.sucursal_id} for w in whs]


@router.post("/api/warehouses", status_code=201)
def create_warehouse(data: schemas.WarehouseCreate,
                     db: Session = Depends(get_db),
                     empresa_id: str = Depends(get_empresa_id),
                     payload: dict = Depends(role_guard(["ADMIN", "ALMACENISTA"]))):
    sucursal_id = payload.get("sucursal", "MATRIZ")
    try:
        w = crud.create_warehouse_op(db, empresa_id, sucursal_id, data)
        return {"id": w.id, "name": w.name, "is_transit": w.is_transit}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── KPIs e inventario (admin dashboard) ─────────────────────────────────────

@router.get("/api/inventario/kpis")
def get_inventario_kpis(db: Session = Depends(get_db),
                        empresa_id: str = Depends(get_empresa_id)):
    return crud.get_inventario_kpis(db, empresa_id)


@router.get("/api/inventario/sku-compromisos")
def get_sku_compromisos(db: Session = Depends(get_db),
                        empresa_id: str = Depends(get_empresa_id)):
    return crud.get_sku_compromisos(db, empresa_id)
