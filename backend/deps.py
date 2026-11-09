"""Dependencias compartidas de FastAPI: configuración JWT y guards de tenant/rol.

Extraído de main.py (Fase 1 MVP — strangler fig). main.py y los routers de
backend/routers/ importan desde aquí. El comportamiento es idéntico al que
tenía main.py; esto solo mueve las definiciones a un módulo importable sin
ciclo de importación.
"""
import os
from datetime import datetime, timezone

import jwt
from fastapi import Cookie, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from roles import normalize_role

# ── JWT: leer desde .env (nunca hardcodeado en código) ──────────────────────
# Fail-fast en secretos críticos: si no están configurados el servidor no arranca.
# Nunca usar valores por defecto inseguros en JWT_SECRET — un secreto conocido
# permite firmar tokens válidos para cualquier usuario sin credenciales reales.
_JWT_SECRET_RAW = os.environ.get("JWT_SECRET", "")
if not _JWT_SECRET_RAW or _JWT_SECRET_RAW in ("SECRETO_NO_CONFIGURADO", "changeme", "secret"):
    raise RuntimeError(
        "[CALEBSYS] JWT_SECRET no configurado o usa un valor inseguro por defecto. "
        "Define JWT_SECRET en el archivo .env antes de arrancar el servidor."
    )
JWT_SECRET = _JWT_SECRET_RAW
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_HOURS = int(os.environ.get("JWT_EXPIRATION_HOURS", "24"))


def get_tenant_context(request: Request, access_token: str = Cookie(None)):
    if hasattr(request.state, "user"):
        return request.state.user
    # Fallback: Authorization header when cookie is absent (e.g. samesite/secure edge cases)
    if not access_token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            access_token = auth_header[7:]
    if not access_token:
        raise HTTPException(status_code=401, detail="Token no proporcionado")
    if access_token.startswith("Bearer "):
        access_token = access_token[7:]
    try:
        payload = jwt.decode(access_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        empresa_id = payload.get("empresa")
        sucursal_id = payload.get("sucursal")
        if not empresa_id or not sucursal_id:
            raise HTTPException(status_code=401, detail="Token carece de contexto multi-tenant seguro")
        request.state.user = payload
        return payload
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")


def get_empresa_id(tenant: dict = Depends(get_tenant_context)):
    return tenant.get("empresa")


def get_sucursal_id(tenant: dict = Depends(get_tenant_context)):
    return tenant.get("sucursal")


def role_guard(required_roles: list):
    """Guard de roles — comparacion case-insensitive: admin/ADMIN/Admin todos validos.

    D2 (06-sep-2026): el admin/dueño del tenant y el superadmin del software
    SIEMPRE pasan cualquier guard — "el admin puede y debe tener acceso a todas
    las funciones de todos los roles". Se incluye 'administrador' por ser el
    valor heredado en la BD real (ver roles.normalize_role).

    admin_sucursal también pasa los guards de rol (puede operar su sucursal).
    Las restricciones de módulo se aplican aparte vía require_module_access."""
    required_lower = {r.lower() for r in required_roles}
    required_lower |= {"admin", "administrador", "superadmin", "admin_sucursal"}

    def role_checker(payload: dict = Depends(get_tenant_context)):
        role = normalize_role(payload.get("role") or "")
        if role not in required_lower:
            raise HTTPException(status_code=403, detail="No tienes permisos suficientes")
        return payload

    return role_checker


def superadmin_only(payload: dict = Depends(get_tenant_context)):
    """Guard EXCLUSIVO del dueño del software. A diferencia de role_guard, el
    admin del tenant NO pasa: la provisión de tenants es solo del superadmin."""
    if (payload.get("role") or "").lower() != "superadmin":
        raise HTTPException(status_code=403, detail="Solo el superadmin")
    return payload


# ── Ítem 4: restricción de módulos para admin_sucursal ───────────────────────

def _get_db_for_guard():
    """Import lazy de get_db para evitar ciclo de importación."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _blocked_modules_for_tenant(db: Session, empresa_id: str) -> list:
    """Lee la lista de módulos bloqueados para admin_sucursal desde AdminConfig.
    Fallback al default si el tenant aún no tiene la clave."""
    import models
    row = (db.query(models.AdminConfig)
             .filter(models.AdminConfig.empresa_id == empresa_id,
                     models.AdminConfig.config_key == "roles.sucursal_blocked_modules")
             .first())
    if row and isinstance(row.config_val, list):
        return [m.upper() for m in row.config_val]
    return ["RRHH", "COMPRAS", "CONFIGURACION"]


def _has_temp_grant(db: Session, empresa_id: str, user_id: str, module: str) -> bool:
    """Verifica si existe un permiso temporal activo y no revocado."""
    import models
    now = datetime.now(timezone.utc)
    grant = (db.query(models.TempPermissionGrant)
               .filter(
                   models.TempPermissionGrant.empresa_id == empresa_id,
                   models.TempPermissionGrant.user_id == user_id,
                   models.TempPermissionGrant.module == module.upper(),
                   models.TempPermissionGrant.revoked == False,
                   models.TempPermissionGrant.valid_from <= now,
                   models.TempPermissionGrant.valid_until >= now,
               )
               .first())
    return grant is not None


def require_module_access(module: str):
    """Dependency que bloquea el endpoint si el usuario es admin_sucursal
    y el módulo está en la lista de bloqueados sin un permiso temporal activo.

    Uso:
        @router.get("/api/employees")
        def list_employees(
            _: None = Depends(require_module_access("RRHH")),
            ...
        ):
    """
    def checker(
        payload: dict = Depends(get_tenant_context),
        db: Session = Depends(_get_db_for_guard),
    ):
        role = (payload.get("role") or "").lower()
        # Solo aplica a admin_sucursal. admin y superadmin pasan siempre.
        if role not in ("admin_sucursal",):
            return

        empresa_id = payload.get("empresa")
        user_id    = payload.get("sub") or payload.get("user_id") or ""
        blocked    = _blocked_modules_for_tenant(db, empresa_id)

        if module.upper() not in blocked:
            return

        if _has_temp_grant(db, empresa_id, user_id, module):
            return

        raise HTTPException(
            status_code=403,
            detail=f"Módulo {module} restringido para tu rol. Solicita acceso temporal al administrador general.",
        )

    return checker
