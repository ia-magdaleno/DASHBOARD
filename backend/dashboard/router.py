"""Router FastAPI del Dashboard Principal ERP CALEBSYS (Secciones 11, 14, 16, 17, 19, 25, 26)."""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import json
import time
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from database import get_db
from deps import get_tenant_context
import models
from roles import normalize_role

from dashboard.metrics import DEFAULT_CURRENCY, DEFAULT_TIMEZONE, METRIC_DEFINITIONS
from dashboard.permissions import (
    ALL_DASHBOARD_CAPABILITIES,
    check_widget_permission,
    resolve_branch_scope,
    resolve_user_permissions,
)
from dashboard.providers import compute_widget_data
from dashboard.schemas import (
    LayoutCloneRequest,
    LayoutCreateRequest,
    LayoutPayloadSchema,
    LayoutResetRequest,
    LayoutUpdateRequest,
    SnapshotRequestSchema,
)
from dashboard.widget_registry import (
    DASHBOARD_TEMPLATES,
    WIDGET_CATALOG,
    WIDGET_CATEGORIES,
    WINDOWS_PARAMETERS_DIRECTORY,
    filter_layout_widgets_by_permission,
    get_merged_windows_directory,
    register_external_module_window,
    register_external_widget,
)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard-erp"])


def _ensure_custom_modules_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS dashboard_custom_modules (
                id TEXT PRIMARY KEY,
                empresa_id TEXT NOT NULL DEFAULT 'DEFAULT',
                window_id TEXT NOT NULL,
                window_name TEXT NOT NULL,
                section TEXT NOT NULL DEFAULT 'MÓDULOS CONECTADOS',
                route_path TEXT NOT NULL,
                route_url TEXT NOT NULL,
                page TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT 'fa-industry',
                accent TEXT NOT NULL DEFAULT 'blue',
                source_table TEXT DEFAULT '',
                options_json TEXT NOT NULL DEFAULT '[]',
                created_by TEXT DEFAULT '',
                created_at_utc TEXT NOT NULL,
                updated_at_utc TEXT NOT NULL
            )
            """
        )
    )
    db.commit()


def _load_db_custom_modules(db: Session, empresa_id: Optional[str]) -> List[dict]:
    try:
        _ensure_custom_modules_table(db)
        rows = db.execute(
            text(
                """
                SELECT window_id, window_name, section, route_path, route_url, page,
                       icon, accent, source_table, options_json
                FROM dashboard_custom_modules
                WHERE empresa_id IN (:emp, 'DEFAULT')
                ORDER BY updated_at_utc DESC
                """
            ),
            {"emp": str(empresa_id or "DEFAULT")},
        ).fetchall()
        out = []
        for r in rows:
            try:
                opts = json.loads(r[9] or "[]")
            except Exception:
                opts = []
            out.append(
                {
                    "windowId": r[0],
                    "windowName": r[1],
                    "section": r[2],
                    "routePath": r[3],
                    "routeUrl": r[4],
                    "page": r[5],
                    "icon": r[6] or "fa-industry",
                    "accent": r[7] or "blue",
                    "sourceTable": r[8] or "",
                    "isOpenConnector": True,
                    "isCustom": True,
                    "options": opts,
                }
            )
        return out
    except Exception:
        return []

# ── Cache en memoria de corto plazo por (empresa_id, sucursal, widget, filtros) (Sección 25) ──
_SNAPSHOT_CACHE: Dict[str, tuple] = {}
_CACHE_TTL_SECONDS = 12.0


def _cache_get(key: str) -> Optional[dict]:
    entry = _SNAPSHOT_CACHE.get(key)
    if not entry:
        return None
    ts, val = entry
    if (time.time() - ts) > _CACHE_TTL_SECONDS:
        _SNAPSHOT_CACHE.pop(key, None)
        return None
    return val


def _cache_set(key: str, val: dict) -> None:
    if len(_SNAPSHOT_CACHE) > 500:
        _SNAPSHOT_CACHE.clear()
    _SNAPSHOT_CACHE[key] = (time.time(), val)


def invalidate_dashboard_cache(empresa_id: Optional[str] = None) -> None:
    if not empresa_id:
        _SNAPSHOT_CACHE.clear()
        return
    prefix = f"{empresa_id}:"
    for k in list(_SNAPSHOT_CACHE.keys()):
        if k.startswith(prefix):
            _SNAPSHOT_CACHE.pop(k, None)


def _record_layout_audit(
    db: Session,
    empresa_id: str,
    layout_id: str,
    user_id: str,
    action: str,
    prev_version: Optional[int],
    new_version: Optional[int],
    ip_address: Optional[str],
    summary: str,
) -> None:
    db.add(
        models.DashboardLayoutAudit(
            id=str(uuid.uuid4()),
            empresa_id=empresa_id,
            layout_id=layout_id,
            user_id=user_id,
            action=action,
            prev_version=prev_version,
            new_version=new_version,
            ip_address=ip_address or "127.0.0.1",
            summary=summary,
        )
    )


def _serialize_layout_row(
    row: models.DashboardLayout,
    user_perms: set,
    role_slug: str,
    source_hierarchy: str = "user",
) -> dict:
    raw_layout = row.layout_json if isinstance(row.layout_json, dict) else {}
    filtered_layout = filter_layout_widgets_by_permission(raw_layout, user_perms, role_slug)
    if row.theme_json and isinstance(row.theme_json, dict):
        filtered_layout["theme"] = row.theme_json
    if row.filters_json and isinstance(row.filters_json, dict):
        filtered_layout["globalFilters"] = row.filters_json
    filtered_layout["name"] = row.name

    return {
        "id": row.id,
        "empresaId": row.empresa_id,
        "sucursalId": row.sucursal_id,
        "userId": row.user_id,
        "roleId": row.role_id,
        "dashboardKey": row.dashboard_key,
        "name": row.name,
        "scopeType": row.scope_type,
        "scopeId": row.scope_id,
        "isDefault": bool(row.is_default),
        "isLocked": bool(row.is_locked),
        "version": int(row.version or 1),
        "sourceHierarchy": source_hierarchy,
        "createdBy": row.created_by,
        "updatedBy": row.updated_by,
        "createdAtUtc": row.created_at_utc.isoformat() if row.created_at_utc else None,
        "updatedAtUtc": row.updated_at_utc.isoformat() if row.updated_at_utc else None,
        "layout": filtered_layout,
    }


def _resolve_hierarchical_active_layout(
    db: Session,
    empresa_id: str,
    sucursal_id: str,
    user_id: str,
    role_slug: str,
    user_perms: set,
    dashboard_key: str = "erp_main",
    requested_layout_id: Optional[str] = None,
) -> dict:
    """Jerarquía de configuración (Sección 11):
    5. Configuración personal del usuario (`scope_type='user'`)
    4. Plantilla asignada a la sucursal (`scope_type='branch'`)
    3. Plantilla asignada al rol (`scope_type='role'`)
    2. Plantilla predeterminada de la empresa (`scope_type='company'`)
    1. Plantilla predeterminada del sistema (`DASHBOARD_TEMPLATES['executive']`)
    """
    base_q = db.query(models.DashboardLayout).filter(
        models.DashboardLayout.empresa_id == empresa_id,
        models.DashboardLayout.dashboard_key == dashboard_key,
        models.DashboardLayout.deleted_at_utc.is_(None),
    )

    if requested_layout_id:
        specific = base_q.filter(models.DashboardLayout.id == requested_layout_id).first()
        if specific:
            return _serialize_layout_row(specific, user_perms, role_slug, source_hierarchy=specific.scope_type)

    # 5. Configuración personal del usuario (si la empresa no bloqueó un layout obligatorio)
    company_locked = (
        base_q.filter(
            models.DashboardLayout.scope_type == "company",
            models.DashboardLayout.is_default == True,
            models.DashboardLayout.is_locked == True,
        )
        .order_by(models.DashboardLayout.updated_at_utc.desc())
        .first()
    )
    if company_locked and role_slug not in ("admin", "superadmin"):
        return _serialize_layout_row(company_locked, user_perms, role_slug, source_hierarchy="company_locked")

    user_row = (
        base_q.filter(
            models.DashboardLayout.scope_type == "user",
            models.DashboardLayout.user_id == user_id,
        )
        .order_by(models.DashboardLayout.is_default.desc(), models.DashboardLayout.updated_at_utc.desc())
        .first()
    )
    if user_row:
        return _serialize_layout_row(user_row, user_perms, role_slug, source_hierarchy="user")

    # 4. Plantilla asignada a la sucursal
    branch_row = (
        base_q.filter(
            models.DashboardLayout.scope_type == "branch",
            or_(
                models.DashboardLayout.sucursal_id == sucursal_id,
                models.DashboardLayout.scope_id == sucursal_id,
            ),
        )
        .order_by(models.DashboardLayout.is_default.desc(), models.DashboardLayout.updated_at_utc.desc())
        .first()
    )
    if branch_row:
        return _serialize_layout_row(branch_row, user_perms, role_slug, source_hierarchy="branch")

    # 3. Plantilla asignada al rol
    role_row = (
        base_q.filter(
            models.DashboardLayout.scope_type == "role",
            or_(
                models.DashboardLayout.role_id == role_slug,
                models.DashboardLayout.scope_id == role_slug,
            ),
        )
        .order_by(models.DashboardLayout.is_default.desc(), models.DashboardLayout.updated_at_utc.desc())
        .first()
    )
    if role_row:
        return _serialize_layout_row(role_row, user_perms, role_slug, source_hierarchy="role")

    # 2. Plantilla predeterminada de la empresa
    company_row = (
        base_q.filter(models.DashboardLayout.scope_type == "company")
        .order_by(models.DashboardLayout.is_default.desc(), models.DashboardLayout.updated_at_utc.desc())
        .first()
    )
    if company_row:
        return _serialize_layout_row(company_row, user_perms, role_slug, source_hierarchy="company")

    # 1. Plantilla predeterminada del sistema según el rol
    default_tpl_key = "executive"
    if role_slug in ("vendedor", "vendedor_cajero", "vendedor_calle"):
        default_tpl_key = "seller"
    elif role_slug in ("almacenista", "comprador"):
        default_tpl_key = "operations"
    elif role_slug == "contador":
        default_tpl_key = "finance"
    elif role_slug in ("admin_sucursal", "gerente"):
        default_tpl_key = "executive"

    tpl = DASHBOARD_TEMPLATES.get(default_tpl_key, DASHBOARD_TEMPLATES["executive"])
    filtered_layout = filter_layout_widgets_by_permission(tpl["layout"], user_perms, role_slug)
    if "dashboard.view_consolidated" not in user_perms:
        filtered_layout.setdefault("globalFilters", {})["branchMode"] = sucursal_id

    return {
        "id": "system_default",
        "empresaId": empresa_id,
        "sucursalId": sucursal_id,
        "userId": user_id,
        "roleId": role_slug,
        "dashboardKey": dashboard_key,
        "name": filtered_layout.get("name", "DASHBOARD EJECUTIVO"),
        "scopeType": "system",
        "scopeId": default_tpl_key,
        "isDefault": True,
        "isLocked": False,
        "version": 1,
        "sourceHierarchy": "system",
        "createdBy": "system",
        "updatedBy": "system",
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "updatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "layout": filtered_layout,
    }


# ── 1. CONTEXTO DEL DASHBOARD ────────────────────────────────────────────────
@router.get("/context")
def get_dashboard_context(
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    sucursal_id = tenant.get("sucursal") or "MATRIZ"
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    username = str(tenant.get("usuario") or tenant.get("sub") or "ADMINISTRADOR")
    raw_role = str(tenant.get("role") or tenant.get("rol") or "Administrador")
    role_slug = normalize_role(raw_role)

    user_perms = resolve_user_permissions(db, tenant)
    if "dashboard.view" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para visualizar el Dashboard.")

    _, scope_label, auth_branches = resolve_branch_scope(db, tenant, user_perms, requested_branch=None)

    # Nombre de empresa
    comp = db.query(models.Company).filter(models.Company.id == empresa_id).first()
    empresa_nombre = comp.name if comp and comp.name else "Maderas y Materiales Magdaleno"

    # Almacenes disponibles
    whs_q = db.query(models.Warehouse).filter(models.Warehouse.empresa_id == empresa_id)
    if "dashboard.view_consolidated" not in user_perms:
        whs_q = whs_q.filter(models.Warehouse.sucursal_id == sucursal_id)
    warehouses = [
        {"id": w.id, "name": w.name, "sucursalId": w.sucursal_id}
        for w in whs_q.all()
    ]

    # Vendedores disponibles para filtro
    sellers_q = (
        db.query(models.User.username, models.User.id)
        .filter(models.User.empresa_id == empresa_id)
        .limit(50)
        .all()
    )
    sellers = [{"id": u.username, "name": (u.username or "").upper()} for u in sellers_q]

    return {
        "user": {
            "id": user_id,
            "username": username,
            "displayName": username.capitalize() if username.isupper() else username,
            "role": raw_role,
            "roleSlug": role_slug,
        },
        "company": {
            "id": empresa_id,
            "name": empresa_nombre,
            "activeSucursalId": sucursal_id,
            "canViewConsolidated": "dashboard.view_consolidated" in user_perms,
            "authorizedBranches": auth_branches,
            "warehouses": warehouses,
            "sellers": sellers,
        },
        "permissions": sorted(list(user_perms)),
        "capabilities": {cap: (cap in user_perms) for cap in ALL_DASHBOARD_CAPABILITIES},
        "timezone": DEFAULT_TIMEZONE,
        "currency": DEFAULT_CURRENCY,
        "serverTimeUtc": datetime.now(timezone.utc).isoformat(),
    }


# ── 2. CATÁLOGO DE WIDGETS Y PLANTILLAS ──────────────────────────────────────
@router.get("/widgets/catalog")
def get_widgets_catalog(
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    raw_role = str(tenant.get("role") or tenant.get("rol") or "")
    role_slug = normalize_role(raw_role)
    user_perms = resolve_user_permissions(db, tenant)

    catalog_list = []
    for wkey, wdef in WIDGET_CATALOG.items():
        authorized = check_widget_permission(user_perms, wdef, role_slug)
        mdef = METRIC_DEFINITIONS.get(wkey, {})
        catalog_list.append(
            {
                **wdef,
                "authorized": authorized,
                "metricDefinition": mdef.get("definition", wdef.get("description", "")),
                "metricSource": mdef.get("source", "erp"),
            }
        )

    empresa_id = tenant.get("empresa")
    db_custom_modules = _load_db_custom_modules(db, empresa_id)
    merged_windows = get_merged_windows_directory(db_custom_modules)

    return {
        "categories": WIDGET_CATEGORIES,
        "widgets": catalog_list,
        "windowsDirectory": merged_windows,
        "templates": [
            {
                "id": t["id"],
                "name": t["name"],
                "description": t["description"],
                "icon": t["icon"],
                "recommendedRoles": t["recommendedRoles"],
                "widgetCount": len(t["layout"].get("widgets") or []),
            }
            for t in DASHBOARD_TEMPLATES.values()
        ],
    }


@router.get("/templates")
def list_dashboard_templates(
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    raw_role = str(tenant.get("role") or tenant.get("rol") or "")
    role_slug = normalize_role(raw_role)
    user_perms = resolve_user_permissions(db, tenant)

    out = []
    for tid, tpl in DASHBOARD_TEMPLATES.items():
        filtered = filter_layout_widgets_by_permission(tpl["layout"], user_perms, role_slug)
        out.append(
            {
                "id": tid,
                "name": tpl["name"],
                "description": tpl["description"],
                "icon": tpl["icon"],
                "recommendedRoles": tpl["recommendedRoles"],
                "layout": filtered,
            }
        )
    return {"templates": out}


# ── 3. LISTAR LAYOUTS Y OBTENER LAYOUT ACTIVO ────────────────────────────────
@router.get("/layouts")
def list_layouts(
    dashboard_key: str = Query("erp_main", alias="dashboardKey"),
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    sucursal_id = tenant.get("sucursal") or "MATRIZ"
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    role_slug = normalize_role(tenant.get("role") or "")
    user_perms = resolve_user_permissions(db, tenant)

    q = db.query(models.DashboardLayout).filter(
        models.DashboardLayout.empresa_id == empresa_id,
        models.DashboardLayout.dashboard_key == dashboard_key,
        models.DashboardLayout.deleted_at_utc.is_(None),
    )

    if role_slug not in ("admin", "superadmin"):
        q = q.filter(
            or_(
                models.DashboardLayout.user_id == user_id,
                models.DashboardLayout.scope_type == "company",
                (models.DashboardLayout.scope_type == "branch") & (models.DashboardLayout.sucursal_id == sucursal_id),
                (models.DashboardLayout.scope_type == "role") & (models.DashboardLayout.role_id == role_slug),
            )
        )

    rows = q.order_by(models.DashboardLayout.is_default.desc(), models.DashboardLayout.updated_at_utc.desc()).all()
    items = [_serialize_layout_row(r, user_perms, role_slug, r.scope_type) for r in rows]

    return {"items": items}


@router.get("/layouts/active")
def get_active_layout(
    dashboard_key: str = Query("erp_main", alias="dashboardKey"),
    layout_id: Optional[str] = Query(None, alias="layoutId"),
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    sucursal_id = tenant.get("sucursal") or "MATRIZ"
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    role_slug = normalize_role(tenant.get("role") or "")
    user_perms = resolve_user_permissions(db, tenant)

    active = _resolve_hierarchical_active_layout(
        db=db,
        empresa_id=empresa_id,
        sucursal_id=sucursal_id,
        user_id=user_id,
        role_slug=role_slug,
        user_perms=user_perms,
        dashboard_key=dashboard_key,
        requested_layout_id=layout_id,
    )
    return active


# ── 4. CREAR, ACTUALIZAR, CLONAR, ACTIVAR, RESTABLECER, IMPORTAR/EXPORTAR ────
@router.post("/layouts", status_code=201)
def create_layout(
    req: LayoutCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    sucursal_id = tenant.get("sucursal") or "MATRIZ"
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    role_slug = normalize_role(tenant.get("role") or "")
    user_perms = resolve_user_permissions(db, tenant)

    if "dashboard.edit_self" not in user_perms and "dashboard.create_layout" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para crear o personalizar dashboards.")

    if req.scopeType == "company" and "dashboard.edit_company" not in user_perms:
        raise HTTPException(status_code=403, detail="Solo el administrador puede guardar plantillas de empresa.")
    if req.scopeType == "role" and "dashboard.edit_role" not in user_perms:
        raise HTTPException(status_code=403, detail="Solo el administrador puede asignar plantillas a roles.")
    if req.isLocked and "dashboard.lock_widgets" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para bloquear layouts.")

    if req.layout:
        layout_dict = req.layout.model_dump()
    else:
        tpl_id = req.templateId or "executive"
        tpl = DASHBOARD_TEMPLATES.get(tpl_id, DASHBOARD_TEMPLATES["executive"])
        layout_dict = deepcopy(tpl["layout"])

    # Validar que el usuario tenga permiso para cada widget incluido
    for w in layout_dict.get("widgets") or []:
        wdef = WIDGET_CATALOG.get(w["widgetKey"])
        if not wdef or not check_widget_permission(user_perms, wdef, role_slug):
            raise HTTPException(
                status_code=403,
                detail=f"No tienes permiso para agregar el widget '{w.get('widgetKey')}'.",
            )

    layout_dict["name"] = req.name
    now = datetime.now(timezone.utc)

    if req.isDefault:
        # Desmarcar otros defaults del mismo alcance
        q_def = db.query(models.DashboardLayout).filter(
            models.DashboardLayout.empresa_id == empresa_id,
            models.DashboardLayout.dashboard_key == req.dashboardKey,
            models.DashboardLayout.scope_type == req.scopeType,
        )
        if req.scopeType == "user":
            q_def = q_def.filter(models.DashboardLayout.user_id == user_id)
        for old_d in q_def.all():
            old_d.is_default = False

    new_row = models.DashboardLayout(
        id=str(uuid.uuid4()),
        empresa_id=empresa_id,
        sucursal_id=req.scopeId if req.scopeType == "branch" else sucursal_id,
        user_id=user_id if req.scopeType == "user" else None,
        role_id=req.scopeId if req.scopeType == "role" else role_slug,
        dashboard_key=req.dashboardKey,
        name=req.name,
        scope_type=req.scopeType,
        scope_id=req.scopeId or (user_id if req.scopeType == "user" else None),
        is_default=req.isDefault,
        is_locked=req.isLocked,
        layout_json=layout_dict,
        theme_json=layout_dict.get("theme"),
        filters_json=layout_dict.get("globalFilters"),
        version=1,
        created_by=user_id,
        updated_by=user_id,
        created_at_utc=now,
        updated_at_utc=now,
    )
    db.add(new_row)
    _record_layout_audit(
        db=db,
        empresa_id=empresa_id,
        layout_id=new_row.id,
        user_id=user_id,
        action="CREATE",
        prev_version=None,
        new_version=1,
        ip_address=request.client.host if request.client else "127.0.0.1",
        summary=f"Creado layout '{req.name}' (alcance={req.scopeType}, widgets={len(layout_dict.get('widgets') or [])})",
    )
    db.commit()
    db.refresh(new_row)
    return _serialize_layout_row(new_row, user_perms, role_slug, new_row.scope_type)


@router.put("/layouts/{layout_id}")
def update_layout(
    layout_id: str,
    req: LayoutUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    sucursal_id = tenant.get("sucursal") or "MATRIZ"
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    role_slug = normalize_role(tenant.get("role") or "")
    user_perms = resolve_user_permissions(db, tenant)

    if "dashboard.edit_self" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para modificar el dashboard.")

    layout_dict = req.layout.model_dump()
    for w in layout_dict.get("widgets") or []:
        wdef = WIDGET_CATALOG.get(w["widgetKey"])
        if not wdef or not check_widget_permission(user_perms, wdef, role_slug):
            raise HTTPException(
                status_code=403,
                detail=f"No tienes permiso para incluir el widget '{w.get('widgetKey')}'.",
            )

    # Si layout_id es "system_default", crear o actualizar el layout personal del usuario automáticamente
    if layout_id == "system_default":
        existing_user = (
            db.query(models.DashboardLayout)
            .filter(
                models.DashboardLayout.empresa_id == empresa_id,
                models.DashboardLayout.dashboard_key == layout_dict.get("dashboardKey", "erp_main"),
                models.DashboardLayout.scope_type == "user",
                models.DashboardLayout.user_id == user_id,
                models.DashboardLayout.deleted_at_utc.is_(None),
            )
            .first()
        )
        if not existing_user:
            now = datetime.now(timezone.utc)
            new_name = (req.name or layout_dict.get("name") or "MI DASHBOARD EJECUTIVO").strip().upper()
            layout_dict["name"] = new_name
            new_row = models.DashboardLayout(
                id=str(uuid.uuid4()),
                empresa_id=empresa_id,
                sucursal_id=sucursal_id,
                user_id=user_id,
                role_id=role_slug,
                dashboard_key=layout_dict.get("dashboardKey", "erp_main"),
                name=new_name,
                scope_type="user",
                scope_id=user_id,
                is_default=True,
                is_locked=False,
                layout_json=layout_dict,
                theme_json=layout_dict.get("theme"),
                filters_json=layout_dict.get("globalFilters"),
                version=1,
                created_by=user_id,
                updated_by=user_id,
                created_at_utc=now,
                updated_at_utc=now,
            )
            db.add(new_row)
            _record_layout_audit(
                db=db,
                empresa_id=empresa_id,
                layout_id=new_row.id,
                user_id=user_id,
                action="CREATE_FROM_DEFAULT",
                prev_version=0,
                new_version=1,
                ip_address=request.client.host if request.client else "127.0.0.1",
                summary=f"Personalización inicial guardada ({len(layout_dict.get('widgets') or [])} widgets)",
            )
            db.commit()
            db.refresh(new_row)
            return _serialize_layout_row(new_row, user_perms, role_slug, "user")
        row = existing_user
    else:
        row = (
            db.query(models.DashboardLayout)
            .filter(
                models.DashboardLayout.id == layout_id,
                models.DashboardLayout.empresa_id == empresa_id,
                models.DashboardLayout.deleted_at_utc.is_(None),
            )
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Layout no encontrado para esta empresa.")

    # Verificar permisos sobre el alcance del layout
    if row.scope_type == "company" and "dashboard.edit_company" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para modificar la plantilla de empresa.")
    if row.scope_type == "role" and "dashboard.edit_role" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para modificar una plantilla de rol.")
    if row.scope_type == "user" and row.user_id != user_id and role_slug not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="No puedes modificar el layout privado de otro usuario.")
    if row.is_locked and "dashboard.lock_widgets" not in user_perms:
        raise HTTPException(status_code=403, detail="Este layout está bloqueado por el administrador.")

    # Optimistic Locking (Sección 16 y 32 — Concurrencia)
    current_ver = int(row.version or 1)
    if req.version != current_ver:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "VERSION_CONFLICT",
                "message": f"Conflicto de versión: enviaste v{req.version}, pero en el servidor ya existe v{current_ver}.",
                "serverVersion": current_ver,
                "clientVersion": req.version,
                "serverUpdatedBy": row.updated_by,
                "serverUpdatedAtUtc": row.updated_at_utc.isoformat() if row.updated_at_utc else None,
            },
        )

    new_ver = current_ver + 1
    if req.name:
        row.name = req.name.strip().upper()
        layout_dict["name"] = row.name
    else:
        row.name = layout_dict.get("name", row.name).strip().upper()

    if req.isDefault is not None:
        row.is_default = bool(req.isDefault)
    if req.isLocked is not None and "dashboard.lock_widgets" in user_perms:
        row.is_locked = bool(req.isLocked)

    row.layout_json = layout_dict
    row.theme_json = layout_dict.get("theme")
    row.filters_json = layout_dict.get("globalFilters")
    row.version = new_ver
    row.updated_by = user_id
    row.updated_at_utc = datetime.now(timezone.utc)

    _record_layout_audit(
        db=db,
        empresa_id=empresa_id,
        layout_id=row.id,
        user_id=user_id,
        action="UPDATE",
        prev_version=current_ver,
        new_version=new_ver,
        ip_address=request.client.host if request.client else "127.0.0.1",
        summary=f"Actualizado layout '{row.name}' a v{new_ver} ({len(layout_dict.get('widgets') or [])} widgets)",
    )
    db.commit()
    db.refresh(row)
    return _serialize_layout_row(row, user_perms, role_slug, row.scope_type)


@router.delete("/layouts/{layout_id}")
def delete_layout(
    layout_id: str,
    request: Request,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    role_slug = normalize_role(tenant.get("role") or "")
    user_perms = resolve_user_permissions(db, tenant)

    if "dashboard.delete_layout" not in user_perms and "dashboard.edit_self" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para eliminar layouts.")

    row = (
        db.query(models.DashboardLayout)
        .filter(
            models.DashboardLayout.id == layout_id,
            models.DashboardLayout.empresa_id == empresa_id,
            models.DashboardLayout.deleted_at_utc.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Layout no encontrado.")
    if row.scope_type == "user" and row.user_id != user_id and role_slug not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="No puedes eliminar el layout de otro usuario.")
    if row.scope_type in ("company", "role") and role_slug not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Solo el administrador puede eliminar plantillas corporativas.")

    row.deleted_at_utc = datetime.now(timezone.utc)
    row.updated_by = user_id
    _record_layout_audit(
        db=db,
        empresa_id=empresa_id,
        layout_id=row.id,
        user_id=user_id,
        action="DELETE",
        prev_version=row.version,
        new_version=row.version,
        ip_address=request.client.host if request.client else "127.0.0.1",
        summary=f"Eliminado lógico de layout '{row.name}'",
    )
    db.commit()
    return {"ok": True, "deletedId": layout_id}


@router.post("/layouts/{layout_id}/clone", status_code=201)
def clone_layout(
    layout_id: str,
    req: LayoutCloneRequest,
    request: Request,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    sucursal_id = tenant.get("sucursal") or "MATRIZ"
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    role_slug = normalize_role(tenant.get("role") or "")
    user_perms = resolve_user_permissions(db, tenant)

    if "dashboard.create_layout" not in user_perms and "dashboard.edit_self" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para duplicar layouts.")

    if layout_id in DASHBOARD_TEMPLATES or layout_id == "system_default":
        tpl_key = "executive" if layout_id == "system_default" else layout_id
        base_layout = deepcopy(DASHBOARD_TEMPLATES[tpl_key]["layout"])
    else:
        src = (
            db.query(models.DashboardLayout)
            .filter(
                models.DashboardLayout.id == layout_id,
                models.DashboardLayout.empresa_id == empresa_id,
                models.DashboardLayout.deleted_at_utc.is_(None),
            )
            .first()
        )
        if not src:
            raise HTTPException(status_code=404, detail="Layout origen no encontrado.")
        base_layout = deepcopy(src.layout_json or {})

    base_layout["name"] = req.name
    now = datetime.now(timezone.utc)
    cloned = models.DashboardLayout(
        id=str(uuid.uuid4()),
        empresa_id=empresa_id,
        sucursal_id=sucursal_id,
        user_id=user_id if req.scopeType == "user" else None,
        role_id=req.scopeId if req.scopeType == "role" else role_slug,
        dashboard_key=base_layout.get("dashboardKey", "erp_main"),
        name=req.name,
        scope_type=req.scopeType,
        scope_id=req.scopeId or user_id,
        is_default=False,
        is_locked=False,
        layout_json=base_layout,
        theme_json=base_layout.get("theme"),
        filters_json=base_layout.get("globalFilters"),
        version=1,
        created_by=user_id,
        updated_by=user_id,
        created_at_utc=now,
        updated_at_utc=now,
    )
    db.add(cloned)
    _record_layout_audit(
        db=db,
        empresa_id=empresa_id,
        layout_id=cloned.id,
        user_id=user_id,
        action="CLONE",
        prev_version=None,
        new_version=1,
        ip_address=request.client.host if request.client else "127.0.0.1",
        summary=f"Clonado desde '{layout_id}' como '{req.name}'",
    )
    db.commit()
    db.refresh(cloned)
    return _serialize_layout_row(cloned, user_perms, role_slug, cloned.scope_type)


@router.post("/layouts/{layout_id}/activate")
@router.post("/layouts/{layout_id}/set-default")
def set_default_layout(
    layout_id: str,
    request: Request,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    role_slug = normalize_role(tenant.get("role") or "")
    user_perms = resolve_user_permissions(db, tenant)

    row = (
        db.query(models.DashboardLayout)
        .filter(
            models.DashboardLayout.id == layout_id,
            models.DashboardLayout.empresa_id == empresa_id,
            models.DashboardLayout.deleted_at_utc.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Layout no encontrado.")

    siblings = (
        db.query(models.DashboardLayout)
        .filter(
            models.DashboardLayout.empresa_id == empresa_id,
            models.DashboardLayout.dashboard_key == row.dashboard_key,
            models.DashboardLayout.scope_type == row.scope_type,
            models.DashboardLayout.deleted_at_utc.is_(None),
        )
    )
    if row.scope_type == "user":
        siblings = siblings.filter(models.DashboardLayout.user_id == user_id)
    for s in siblings.all():
        s.is_default = (s.id == row.id)

    row.updated_at_utc = datetime.now(timezone.utc)
    _record_layout_audit(
        db=db,
        empresa_id=empresa_id,
        layout_id=row.id,
        user_id=user_id,
        action="SET_DEFAULT",
        prev_version=row.version,
        new_version=row.version,
        ip_address=request.client.host if request.client else "127.0.0.1",
        summary=f"Definido '{row.name}' como dashboard principal ({row.scope_type})",
    )
    db.commit()
    db.refresh(row)
    return _serialize_layout_row(row, user_perms, role_slug, row.scope_type)


@router.post("/layouts/{layout_id}/reset")
def reset_layout_to_template(
    layout_id: str,
    request: Request,
    req: LayoutResetRequest = Body(default=LayoutResetRequest()),
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    sucursal_id = tenant.get("sucursal") or "MATRIZ"
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    role_slug = normalize_role(tenant.get("role") or "")
    user_perms = resolve_user_permissions(db, tenant)

    tpl_id = req.templateId if req.templateId in DASHBOARD_TEMPLATES else "executive"
    tpl_layout = filter_layout_widgets_by_permission(
        deepcopy(DASHBOARD_TEMPLATES[tpl_id]["layout"]), user_perms, role_slug
    )

    row = None
    if layout_id != "system_default":
        row = (
            db.query(models.DashboardLayout)
            .filter(
                models.DashboardLayout.id == layout_id,
                models.DashboardLayout.empresa_id == empresa_id,
                models.DashboardLayout.deleted_at_utc.is_(None),
            )
            .first()
        )
    if not row:
        row = (
            db.query(models.DashboardLayout)
            .filter(
                models.DashboardLayout.empresa_id == empresa_id,
                models.DashboardLayout.scope_type == "user",
                models.DashboardLayout.user_id == user_id,
                models.DashboardLayout.deleted_at_utc.is_(None),
            )
            .first()
        )

    if row:
        prev_v = int(row.version or 1)
        row.layout_json = tpl_layout
        row.theme_json = tpl_layout.get("theme")
        row.filters_json = tpl_layout.get("globalFilters")
        row.name = tpl_layout.get("name", "DASHBOARD EJECUTIVO")
        row.version = prev_v + 1
        row.updated_by = user_id
        row.updated_at_utc = datetime.now(timezone.utc)
        _record_layout_audit(
            db=db,
            empresa_id=empresa_id,
            layout_id=row.id,
            user_id=user_id,
            action="RESET",
            prev_version=prev_v,
            new_version=row.version,
            ip_address=request.client.host if request.client else "127.0.0.1",
            summary=f"Restaurado layout a plantilla '{tpl_id}'",
        )
        db.commit()
        db.refresh(row)
        return _serialize_layout_row(row, user_perms, role_slug, row.scope_type)

    return _resolve_hierarchical_active_layout(
        db=db,
        empresa_id=empresa_id,
        sucursal_id=sucursal_id,
        user_id=user_id,
        role_slug=role_slug,
        user_perms=user_perms,
    )


@router.get("/layouts/{layout_id}/export")
def export_layout_json(
    layout_id: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    sucursal_id = tenant.get("sucursal") or "MATRIZ"
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    role_slug = normalize_role(tenant.get("role") or "")
    user_perms = resolve_user_permissions(db, tenant)

    if "dashboard.export_layout" not in user_perms and "dashboard.edit_self" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para exportar configuraciones de dashboard.")

    active = _resolve_hierarchical_active_layout(
        db=db,
        empresa_id=empresa_id,
        sucursal_id=sucursal_id,
        user_id=user_id,
        role_slug=role_slug,
        user_perms=user_perms,
        requested_layout_id=None if layout_id == "system_default" else layout_id,
    )
    return {
        "exportedAtUtc": datetime.now(timezone.utc).isoformat(),
        "system": "CALEBSYS_ERP_DASHBOARD",
        "schemaVersion": 1,
        "layout": active["layout"],
    }


@router.post("/layouts/import", status_code=201)
def import_layout_json(
    request: Request,
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    sucursal_id = tenant.get("sucursal") or "MATRIZ"
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")
    role_slug = normalize_role(tenant.get("role") or "")
    user_perms = resolve_user_permissions(db, tenant)

    if "dashboard.import_layout" not in user_perms and "dashboard.edit_self" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para importar configuraciones de dashboard.")

    raw_layout = payload.get("layout") if isinstance(payload.get("layout"), dict) else payload
    try:
        validated = LayoutPayloadSchema.model_validate(raw_layout)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"JSON de layout inválido: {exc}")

    layout_dict = validated.model_dump()
    for w in layout_dict.get("widgets") or []:
        wdef = WIDGET_CATALOG.get(w["widgetKey"])
        if not wdef or not check_widget_permission(user_perms, wdef, role_slug):
            raise HTTPException(
                status_code=403,
                detail=f"El layout importado contiene el widget '{w.get('widgetKey')}' para el cual no tienes permiso.",
            )

    now = datetime.now(timezone.utc)
    imported_row = models.DashboardLayout(
        id=str(uuid.uuid4()),
        empresa_id=empresa_id,
        sucursal_id=sucursal_id,
        user_id=user_id,
        role_id=role_slug,
        dashboard_key=layout_dict.get("dashboardKey", "erp_main"),
        name=layout_dict.get("name", "DASHBOARD IMPORTADO"),
        scope_type="user",
        scope_id=user_id,
        is_default=True,
        is_locked=False,
        layout_json=layout_dict,
        theme_json=layout_dict.get("theme"),
        filters_json=layout_dict.get("globalFilters"),
        version=1,
        created_by=user_id,
        updated_by=user_id,
        created_at_utc=now,
        updated_at_utc=now,
    )
    db.add(imported_row)
    _record_layout_audit(
        db=db,
        empresa_id=empresa_id,
        layout_id=imported_row.id,
        user_id=user_id,
        action="IMPORT",
        prev_version=None,
        new_version=1,
        ip_address=request.client.host if request.client else "127.0.0.1",
        summary=f"Importado layout '{imported_row.name}' ({len(layout_dict.get('widgets') or [])} widgets)",
    )
    db.commit()
    db.refresh(imported_row)
    return _serialize_layout_row(imported_row, user_perms, role_slug, "user")


# ── 5. CARGA DE DATOS EN LOTE (/snapshot) E INDIVIDUAL (/widgets/{key}/data) ──
@router.post("/snapshot")
def get_dashboard_snapshot(
    req: SnapshotRequestSchema,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    raw_role = str(tenant.get("role") or tenant.get("rol") or "")
    role_slug = normalize_role(raw_role)
    user_perms = resolve_user_permissions(db, tenant)

    if "dashboard.view" not in user_perms:
        raise HTTPException(status_code=403, detail="No tienes permiso para consultar el dashboard.")

    gf = req.globalFilters.model_dump()
    eff_branch, scope_label, auth_branches = resolve_branch_scope(
        db, tenant, user_perms, requested_branch=gf.get("branchMode")
    )

    results: Dict[str, Any] = {}
    for wreq in req.widgetRequests:
        wkey = wreq.widgetKey
        wdef = WIDGET_CATALOG.get(wkey)
        if not wdef:
            results[wreq.instanceId] = {
                "status": "error",
                "error": f"Widget '{wkey}' no existe en el catálogo.",
                "meta": {"widgetKey": wkey},
            }
            continue

        if not check_widget_permission(user_perms, wdef, role_slug):
            results[wreq.instanceId] = {
                "status": "forbidden",
                "error": "No tienes permisos suficientes para visualizar este indicador.",
                "meta": {"widgetKey": wkey},
            }
            continue

        # Si el widget define su propio branchMode en filters, validarlo contra permisos
        w_branch_req = (wreq.filters or {}).get("branchMode")
        if w_branch_req:
            w_eff_branch, w_scope_lbl, _ = resolve_branch_scope(
                db, tenant, user_perms, requested_branch=w_branch_req
            )
        else:
            w_eff_branch, w_scope_lbl = eff_branch, scope_label

        cache_key = (
            f"{empresa_id}:{w_scope_lbl}:{wkey}:"
            f"{json.dumps(gf, sort_keys=True)}:"
            f"{json.dumps(wreq.filters or {}, sort_keys=True)}:"
            f"{json.dumps(wreq.settings or {}, sort_keys=True)}"
        )
        cached = _cache_get(cache_key)
        if cached:
            results[wreq.instanceId] = cached
            continue

        try:
            res = compute_widget_data(
                db=db,
                widget_key=wkey,
                empresa_id=empresa_id,
                effective_sucursal_id=w_eff_branch,
                scope_label=w_scope_lbl,
                authorized_branches=auth_branches,
                user_perms=user_perms,
                global_filters=gf,
                widget_filters=wreq.filters,
                widget_settings=wreq.settings,
            )
            _cache_set(cache_key, res)
            results[wreq.instanceId] = res
        except HTTPException:
            raise
        except Exception as exc:
            results[wreq.instanceId] = {
                "status": "error",
                "error": f"Error al consultar '{wkey}': {exc}",
                "meta": {"widgetKey": wkey, "updatedAt": datetime.now(timezone.utc).isoformat()},
            }

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "timezone": DEFAULT_TIMEZONE,
        "currency": DEFAULT_CURRENCY,
        "empresaId": empresa_id,
        "scope": scope_label,
        "widgets": results,
    }


@router.get("/widgets/{widget_key}/data")
def get_single_widget_data(
    widget_key: str,
    date_preset: str = Query("today", alias="datePreset"),
    branch_mode: Optional[str] = Query(None, alias="branchMode"),
    comparison: str = Query("previous_period"),
    range_tab: Optional[str] = Query(None, alias="rangeTab"),
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    raw_role = str(tenant.get("role") or tenant.get("rol") or "")
    role_slug = normalize_role(raw_role)
    user_perms = resolve_user_permissions(db, tenant)

    wdef = WIDGET_CATALOG.get(widget_key)
    if not wdef:
        raise HTTPException(status_code=404, detail=f"El widget '{widget_key}' no existe.")

    if not check_widget_permission(user_perms, wdef, role_slug):
        raise HTTPException(
            status_code=403,
            detail=f"No tienes permiso para consultar el indicador '{wdef.get('name', widget_key)}'.",
        )

    eff_branch, scope_label, auth_branches = resolve_branch_scope(
        db, tenant, user_perms, requested_branch=branch_mode
    )
    gf = {
        "datePreset": date_preset,
        "branchMode": branch_mode or scope_label,
        "comparison": comparison,
    }
    ws = {"rangeTab": range_tab} if range_tab else {}
    return compute_widget_data(
        db=db,
        widget_key=widget_key,
        empresa_id=empresa_id,
        effective_sucursal_id=eff_branch,
        scope_label=scope_label,
        authorized_branches=auth_branches,
        user_perms=user_perms,
        global_filters=gf,
        widget_filters={},
        widget_settings=ws,
    )


# ── 6. BUSCADOR GLOBAL DEL DASHBOARD (Sección 4.1) ───────────────────────────
@router.get("/search")
def global_dashboard_search(
    q: str = Query(..., min_length=1, max_length=80),
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    term = f"%{q.strip()}%"
    results: List[dict] = []
    q_low = q.strip().lower()

    # 1. Ventanas, Rutas y Parámetros del sistema + Módulos Conectados Dinámicamente
    merged_windows = get_merged_windows_directory(_load_db_custom_modules(db, empresa_id))
    for win in merged_windows:
        win_haystack = f"{win['windowName']} {win['routePath']} {win['routeUrl']} {win['section']}".lower()
        matching_opts = []
        for opt in win.get("options") or []:
            opt_haystack = f"{opt['title']} {opt['description']} {opt['paramId']}".lower()
            if q_low in ("*", "todo", "rutas", "ventanas") or q_low in win_haystack or q_low in opt_haystack:
                matching_opts.append(opt)

        if q_low in ("*", "todo", "rutas", "ventanas") or q_low in win_haystack or matching_opts:
            opts_to_show = matching_opts if matching_opts else (win.get("options") or [])
            results.append(
                {
                    "title": win["windowName"],
                    "subtitle": f"Ruta: {win['routePath']} ({win['routeUrl']})",
                    "routePath": win["routePath"],
                    "routeUrl": win["routeUrl"],
                    "type": "Ventana / Parámetros",
                    "icon": win.get("icon", "fa-window-maximize"),
                    "page": win.get("page", ""),
                    "href": win.get("href", ""),
                    "options": opts_to_show,
                }
            )

    # 2. Productos
    prods = (
        db.query(models.Product)
        .filter(
            models.Product.empresa_id == empresa_id,
            or_(
                models.Product.sku.ilike(term),
                models.Product.description.ilike(term),
                models.Product.name.ilike(term),
            ),
        )
        .limit(5)
        .all()
    )
    for p in prods:
        results.append(
            {
                "title": f"{p.sku} — {p.name or p.description}",
                "subtitle": f"Stock: {float(p.stock or 0):g} · Precio: ${float(p.price or 0):,.2f}",
                "type": "Producto",
                "icon": "fa-cube",
                "page": "productos",
            }
        )

    # 3. Clientes
    clients = (
        db.query(models.Client)
        .filter(
            models.Client.empresa_id == empresa_id,
            or_(models.Client.name.ilike(term), models.Client.rfc.ilike(term)),
        )
        .limit(5)
        .all()
    )
    for c in clients:
        results.append(
            {
                "title": c.name,
                "subtitle": f"RFC: {c.rfc or '—'} · Tel: {c.phone or '—'}",
                "type": "Cliente",
                "icon": "fa-user",
                "page": "clientes",
            }
        )

    # 4. Proveedores
    suppliers = (
        db.query(models.Supplier)
        .filter(
            models.Supplier.empresa_id == empresa_id,
            or_(models.Supplier.name.ilike(term), models.Supplier.rfc.ilike(term)),
        )
        .limit(4)
        .all()
    )
    for s in suppliers:
        results.append(
            {
                "title": s.name,
                "subtitle": f"RFC: {s.rfc or '—'}",
                "type": "Proveedor",
                "icon": "fa-truck-fast",
                "page": "proveedores",
            }
        )

    # 5. Empleados
    emps = (
        db.query(models.Employee)
        .filter(
            models.Employee.empresa_id == empresa_id,
            models.Employee.is_deleted == False,
            models.Employee.full_name.ilike(term),
        )
        .limit(4)
        .all()
    )
    for e in emps:
        results.append(
            {
                "title": e.full_name,
                "subtitle": f"Puesto: {e.position or '—'} · {e.sucursal_id or 'MATRIZ'}",
                "type": "Empleado",
                "icon": "fa-id-badge",
                "page": "recursos-humanos",
            }
        )

    return {"query": q, "results": results[:18]}


# ── 7. STREAM SSE PARA TIEMPO REAL CONTROLADO (Sección 19) ───────────────────
@router.get("/stream")
async def dashboard_sse_stream(
    request: Request,
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")

    async def _event_generator():
        yield f"data: {json.dumps({'type': 'connected', 'empresaId': empresa_id, 'ts': datetime.now(timezone.utc).isoformat()})}\n\n"
        for _ in range(12):
            if await request.is_disconnected():
                break
            await asyncio.sleep(30)
            payload = {
                "type": "heartbeat",
                "empresaId": empresa_id,
                "ts": datetime.now(timezone.utc).isoformat(),
            }
            yield f"data: {json.dumps(payload)}\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── 8. CONECTOR ABIERTO DE NUEVOS MÓDULOS Y WIDGETS (EJ. PRODUCCIÓN, MANTENIMIENTO, CALIDAD) ──
@router.get("/modules/open-registry")
def get_open_modules_registry(
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = tenant.get("empresa")
    db_custom_modules = _load_db_custom_modules(db, empresa_id)
    merged = get_merged_windows_directory(db_custom_modules)
    return {
        "status": "open",
        "totalWindows": len(merged),
        "customModulesCount": len(db_custom_modules),
        "windowsDirectory": merged,
    }


@router.post("/modules/register", status_code=201)
def register_new_module_or_widget(
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    """
    Conexión abierta para sumar cualquier módulo nuevo (ej. PRODUCCIÓN, MANTENIMIENTO, FLOTILLA)
    y crear su widget/parámetro en caliente desde la interfaz o desde un módulo nuevo.
    Regla CALEBSYS AGENTS.md: Normaliza a MAYÚSCULAS los campos de negocio capturados.
    """
    import re

    empresa_id = str(tenant.get("empresa") or "DEFAULT")
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "admin")

    raw_win_id = str(payload.get("windowId") or payload.get("page") or payload.get("windowName") or "").strip().lower()
    win_id = re.sub(r"[^a-z0-9_-]", "-", raw_win_id).strip("-")
    if not win_id:
        raise HTTPException(status_code=400, detail="Identificador o nombre del módulo es obligatorio.")

    win_name = str(payload.get("windowName") or win_id).strip().upper()
    section = str(payload.get("section") or "OPERACIONES Y MÓDULOS CONECTADOS").strip().upper()
    route_path = str(payload.get("routePath") or f"OPERACIONES > {win_name}").strip().upper()
    route_url = str(payload.get("routeUrl") or f"/admin#{win_id}").strip()
    page_slug = str(payload.get("page") or win_id).strip()
    icon = str(payload.get("icon") or "fa-industry").strip()
    accent = str(payload.get("accent") or "blue").strip().lower()
    source_table = re.sub(r"[^a-zA-Z0-9_]", "", str(payload.get("sourceTable") or "").strip())

    # Soportar tanto lista de options como un parámetro individual enviado desde el formulario rápido
    new_options: List[dict] = []
    if isinstance(payload.get("options"), list) and payload["options"]:
        for opt in payload["options"]:
            p_title = str(opt.get("title") or "INDICADOR DE MÓDULO").strip().upper()
            p_desc = str(opt.get("description") or f"INDICADOR CONECTADO DE {win_name}").strip().upper()
            p_slug = re.sub(r"[^a-z0-9_]", "_", p_title.lower()).strip("_")[:32] or "indicador"
            p_id = str(opt.get("paramId") or f"{win_id}.{p_slug}").strip()
            new_options.append(
                {
                    "paramId": p_id,
                    "title": p_title,
                    "description": p_desc,
                    "widgetKey": str(opt.get("widgetKey") or "window_parameter_card"),
                    "accent": str(opt.get("accent") or accent),
                    "sourceTable": source_table,
                }
            )
    else:
        param_title = str(payload.get("paramTitle") or f"INDICADOR DE {win_name}").strip().upper()
        param_desc = str(
            payload.get("paramDescription") or f"PARÁMETRO Y ESTADO OPERATIVO DE {win_name}"
        ).strip().upper()
        param_slug = re.sub(r"[^a-z0-9_]", "_", param_title.lower()).strip("_")[:32] or "resumen"
        param_id = str(payload.get("paramId") or f"{win_id}.{param_slug}").strip()
        new_options.append(
            {
                "paramId": param_id,
                "title": param_title,
                "description": param_desc,
                "widgetKey": "window_parameter_card",
                "accent": accent,
                "sourceTable": source_table,
            }
        )

    _ensure_custom_modules_table(db)
    existing = db.execute(
        text(
            "SELECT id, options_json FROM dashboard_custom_modules WHERE empresa_id = :emp AND window_id = :wid LIMIT 1"
        ),
        {"emp": empresa_id, "wid": win_id},
    ).fetchone()

    now_iso = datetime.now(timezone.utc).isoformat()
    if existing:
        try:
            prev_opts = json.loads(existing[1] or "[]")
        except Exception:
            prev_opts = []
        opts_by_id = {o["paramId"]: o for o in prev_opts if isinstance(o, dict) and o.get("paramId")}
        for no in new_options:
            opts_by_id[no["paramId"]] = no
        merged_opts = list(opts_by_id.values())
        db.execute(
            text(
                """
                UPDATE dashboard_custom_modules
                SET window_name = :wname,
                    section = :sec,
                    route_path = :rpath,
                    route_url = :rurl,
                    page = :pg,
                    icon = :ic,
                    accent = :acc,
                    source_table = :stbl,
                    options_json = :ojson,
                    updated_at_utc = :now
                WHERE id = :rid
                """
            ),
            {
                "wname": win_name,
                "sec": section,
                "rpath": route_path,
                "rurl": route_url,
                "pg": page_slug,
                "ic": icon,
                "acc": accent,
                "stbl": source_table,
                "ojson": json.dumps(merged_opts, ensure_ascii=False),
                "now": now_iso,
                "rid": existing[0],
            },
        )
    else:
        merged_opts = new_options
        db.execute(
            text(
                """
                INSERT INTO dashboard_custom_modules (
                    id, empresa_id, window_id, window_name, section, route_path, route_url,
                    page, icon, accent, source_table, options_json, created_by, created_at_utc, updated_at_utc
                ) VALUES (
                    :id, :emp, :wid, :wname, :sec, :rpath, :rurl,
                    :pg, :ic, :acc, :stbl, :ojson, :usr, :now, :now
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "emp": empresa_id,
                "wid": win_id,
                "wname": win_name,
                "sec": section,
                "rpath": route_path,
                "rurl": route_url,
                "pg": page_slug,
                "ic": icon,
                "acc": accent,
                "stbl": source_table,
                "ojson": json.dumps(merged_opts, ensure_ascii=False),
                "usr": user_id,
                "now": now_iso,
            },
        )
    db.commit()

    module_entry = register_external_module_window(
        {
            "windowId": win_id,
            "windowName": win_name,
            "section": section,
            "routePath": route_path,
            "routeUrl": route_url,
            "page": page_slug,
            "icon": icon,
            "accent": accent,
            "sourceTable": source_table,
            "options": merged_opts,
        }
    )
    invalidate_dashboard_cache(empresa_id)

    return {
        "ok": True,
        "module": module_entry,
        "createdOption": new_options[-1],
        "windowsDirectory": get_merged_windows_directory(_load_db_custom_modules(db, empresa_id)),
    }


@router.delete("/modules/register/{window_id}")
def delete_custom_module(
    window_id: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    empresa_id = str(tenant.get("empresa") or "DEFAULT")
    _ensure_custom_modules_table(db)
    db.execute(
        text("DELETE FROM dashboard_custom_modules WHERE empresa_id = :emp AND window_id = :wid"),
        {"emp": empresa_id, "wid": window_id.strip().lower()},
    )
    db.commit()
    invalidate_dashboard_cache(empresa_id)
    return {
        "ok": True,
        "deletedWindowId": window_id,
        "windowsDirectory": get_merged_windows_directory(_load_db_custom_modules(db, empresa_id)),
    }

