"""Sistema de permisos y aislamiento multiempresa/multisucursal del Dashboard ERP.

Integra el catálogo de roles de CALEBSYS (`roles.normalize_role`), las políticas
personalizadas por tenant en `AdminConfig` (`dashboard.permissions`) y los
permisos temporales (`TempPermissionGrant`).
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple
from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from roles import normalize_role

# Capacidades granulares del Dashboard ERP (Sección 12)
ALL_DASHBOARD_CAPABILITIES = [
    "dashboard.view",
    "dashboard.edit_self",
    "dashboard.create_layout",
    "dashboard.delete_layout",
    "dashboard.share_layout",
    "dashboard.edit_company",
    "dashboard.edit_role",
    "dashboard.lock_widgets",
    "dashboard.view_consolidated",
    "dashboard.view_financial",
    "dashboard.view_profit",
    "dashboard.view_hr",
    "dashboard.view_crm",
    "dashboard.export_layout",
    "dashboard.import_layout",
    # Permisos por dominio de widgets
    "dashboard.sales.view",
    "dashboard.inventory.view",
    "dashboard.purchases.view",
    "dashboard.cash.view",
    "dashboard.cxc.view",
    "dashboard.finance.view",
    "dashboard.crm.view",
    "dashboard.hr.view",
    "dashboard.logistics.view",
    "dashboard.system.view",
]

# Mapa base por rol normalizado (puede extenderse/restringirse en AdminConfig por empresa)
ROLE_CAPABILITIES_MAP: Dict[str, Set[str]] = {
    "admin": set(ALL_DASHBOARD_CAPABILITIES),
    "superadmin": set(ALL_DASHBOARD_CAPABILITIES),
    "contador": {
        "dashboard.view",
        "dashboard.edit_self",
        "dashboard.create_layout",
        "dashboard.delete_layout",
        "dashboard.export_layout",
        "dashboard.import_layout",
        "dashboard.view_consolidated",
        "dashboard.view_financial",
        "dashboard.view_profit",
        "dashboard.sales.view",
        "dashboard.purchases.view",
        "dashboard.cash.view",
        "dashboard.cxc.view",
        "dashboard.finance.view",
    },
    "admin_sucursal": {
        "dashboard.view",
        "dashboard.edit_self",
        "dashboard.create_layout",
        "dashboard.delete_layout",
        "dashboard.export_layout",
        "dashboard.import_layout",
        "dashboard.view_hr",
        "dashboard.view_crm",
        "dashboard.sales.view",
        "dashboard.inventory.view",
        "dashboard.purchases.view",
        "dashboard.cash.view",
        "dashboard.cxc.view",
        "dashboard.crm.view",
        "dashboard.hr.view",
        "dashboard.logistics.view",
        "dashboard.system.view",
    },
    "gerente": {
        "dashboard.view",
        "dashboard.edit_self",
        "dashboard.create_layout",
        "dashboard.delete_layout",
        "dashboard.export_layout",
        "dashboard.import_layout",
        "dashboard.view_hr",
        "dashboard.view_crm",
        "dashboard.sales.view",
        "dashboard.inventory.view",
        "dashboard.purchases.view",
        "dashboard.cash.view",
        "dashboard.cxc.view",
        "dashboard.crm.view",
        "dashboard.hr.view",
        "dashboard.logistics.view",
        "dashboard.system.view",
    },
    "comprador": {
        "dashboard.view",
        "dashboard.edit_self",
        "dashboard.create_layout",
        "dashboard.inventory.view",
        "dashboard.purchases.view",
        "dashboard.logistics.view",
    },
    "almacenista": {
        "dashboard.view",
        "dashboard.edit_self",
        "dashboard.inventory.view",
        "dashboard.purchases.view",
        "dashboard.logistics.view",
    },
    "vendedor_cajero": {
        "dashboard.view",
        "dashboard.edit_self",
        "dashboard.view_crm",
        "dashboard.sales.view",
        "dashboard.cash.view",
        "dashboard.cxc.view",
        "dashboard.crm.view",
    },
    "vendedor": {
        "dashboard.view",
        "dashboard.edit_self",
        "dashboard.view_crm",
        "dashboard.sales.view",
        "dashboard.crm.view",
    },
    "vendedor_calle": {
        "dashboard.view",
        "dashboard.edit_self",
        "dashboard.view_crm",
        "dashboard.sales.view",
        "dashboard.crm.view",
        "dashboard.logistics.view",
    },
    "cajero": {
        "dashboard.view",
        "dashboard.edit_self",
        "dashboard.sales.view",
        "dashboard.cash.view",
        "dashboard.cxc.view",
    },
    "transportista": {
        "dashboard.view",
        "dashboard.logistics.view",
    },
    "recursos_humanos": {
        "dashboard.view",
        "dashboard.edit_self",
        "dashboard.view_hr",
        "dashboard.hr.view",
    },
}


def resolve_user_permissions(db: Session, tenant: dict) -> Set[str]:
    """Calcula el conjunto efectivo de permisos de dashboard para el usuario actual."""
    empresa_id = tenant.get("empresa") or ""
    raw_role = tenant.get("role") or tenant.get("rol") or ""
    role_slug = normalize_role(raw_role)
    user_id = str(tenant.get("user_id") or tenant.get("sub") or "")

    # 1. Base por rol canónico
    perms: Set[str] = set(ROLE_CAPABILITIES_MAP.get(role_slug, {"dashboard.view"}))

    # Si es dueño/admin/superadmin siempre tiene todos los permisos
    if role_slug in ("admin", "superadmin"):
        return set(ALL_DASHBOARD_CAPABILITIES)

    # 2. Overrides configurados por la empresa en AdminConfig ('dashboard.permissions')
    try:
        cfg_row = (
            db.query(models.AdminConfig)
            .filter(
                models.AdminConfig.empresa_id == empresa_id,
                models.AdminConfig.config_key == "dashboard.permissions",
            )
            .first()
        )
        if cfg_row and isinstance(cfg_row.config_val, dict):
            role_cfg = cfg_row.config_val.get("roles", {}).get(role_slug)
            if isinstance(role_cfg, list):
                perms = set(role_cfg)
            user_cfg = cfg_row.config_val.get("users", {}).get(user_id)
            if isinstance(user_cfg, dict):
                grant = set(user_cfg.get("grant") or [])
                revoke = set(user_cfg.get("revoke") or [])
                perms = (perms | grant) - revoke
            # Política empresarial: bloquear edición individual si la empresa lo definió
            if cfg_row.config_val.get("allow_user_customization") is False:
                perms.discard("dashboard.edit_self")
                perms.discard("dashboard.create_layout")
    except Exception:
        pass

    # 3. Permisos temporales vigentes (TempPermissionGrant)
    try:
        now = datetime.now(timezone.utc)
        grants = (
            db.query(models.TempPermissionGrant)
            .filter(
                models.TempPermissionGrant.empresa_id == empresa_id,
                models.TempPermissionGrant.user_id == user_id,
                models.TempPermissionGrant.revoked == False,
            )
            .all()
        )
        for g in grants:
            exp = g.expires_at
            if exp and exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if not exp or exp > now:
                mod = (g.module_key or "").upper()
                if mod in ("FINANZAS", "CONTABILIDAD"):
                    perms.add("dashboard.view_financial")
                    perms.add("dashboard.view_profit")
                    perms.add("dashboard.finance.view")
                elif mod in ("RRHH", "RH"):
                    perms.add("dashboard.view_hr")
                    perms.add("dashboard.hr.view")
                elif mod == "CONSOLIDADO":
                    perms.add("dashboard.view_consolidated")
    except Exception:
        pass

    return perms


def check_widget_permission(user_perms: Set[str], widget_def: dict, role_slug: str) -> bool:
    """Verifica si el usuario cumple todos los permisos y roles requeridos por un widget."""
    if role_slug in ("admin", "superadmin"):
        return True
    req_perms = widget_def.get("permissions") or []
    for p in req_perms:
        if p not in user_perms:
            return False
    allowed_roles = widget_def.get("allowedRoles") or []
    if allowed_roles:
        norm_allowed = {normalize_role(r) for r in allowed_roles}
        if role_slug not in norm_allowed:
            return False
    return True


def resolve_branch_scope(
    db: Session,
    tenant: dict,
    user_perms: Set[str],
    requested_branch: Optional[str] = None,
) -> Tuple[Optional[str], str, List[dict]]:
    """Valida el alcance de sucursal solicitado contra los permisos del usuario.

    Retorna:
      (effective_sucursal_id, scope_label, authorized_branches)
      - Si effective_sucursal_id es None => consulta consolidada de toda la empresa (ALL).
      - Si el usuario pide una sucursal no autorizada o consolidado sin permiso => 403.
    """
    empresa_id = tenant.get("empresa")
    user_branch = tenant.get("sucursal") or "MATRIZ"
    can_consolidated = "dashboard.view_consolidated" in user_perms

    # Obtener sucursales registradas de la empresa
    branches_q = (
        db.query(models.Branch)
        .filter(models.Branch.empresa_id == empresa_id)
        .order_by(models.Branch.is_main.desc(), models.Branch.name.asc())
        .all()
    )
    branch_list = [
        {
            "id": b.name if b.name else b.id,
            "branch_uuid": b.id,
            "name": b.name or b.id,
            "is_main": bool(b.is_main),
            "status": b.status or "ACTIVE",
        }
        for b in branches_q
    ]
    known_ids = {b["id"].upper() for b in branch_list} | {b["branch_uuid"].upper() for b in branch_list}
    if user_branch.upper() not in known_ids:
        branch_list.insert(
            0,
            {
                "id": user_branch,
                "branch_uuid": user_branch,
                "name": user_branch,
                "is_main": user_branch.upper() == "MATRIZ",
                "status": "ACTIVE",
            },
        )
        known_ids.add(user_branch.upper())

    if not can_consolidated:
        # Usuario restringido a su propia sucursal
        if requested_branch and requested_branch.upper() not in (user_branch.upper(), "CURRENT", ""):
            raise HTTPException(
                status_code=403,
                detail=f"No tienes permiso para consultar la sucursal '{requested_branch}' ni el consolidado.",
            )
        auth_branches = [b for b in branch_list if b["id"].upper() == user_branch.upper() or b["name"].upper() == user_branch.upper()]
        if not auth_branches:
            auth_branches = [{"id": user_branch, "name": user_branch, "is_main": False, "status": "ACTIVE"}]
        return user_branch, user_branch, auth_branches

    # Usuario con permiso consolidado (admin / contador)
    req = (requested_branch or "ALL").strip()
    if req.upper() in ("ALL", "CONSOLIDATED", "TODAS", ""):
        return None, "ALL", branch_list
    if req.upper() == "CURRENT":
        return user_branch, user_branch, branch_list

    # Verificar que la sucursal solicitada pertenezca a la misma empresa
    # También aceptamos sucursales que existan en ventas de la misma empresa
    if req.upper() not in known_ids:
        # Verificar si existe en sales/warehouses de esta empresa
        exists_in_sales = (
            db.query(models.Sale.sucursal_id)
            .filter(models.Sale.empresa_id == empresa_id, models.Sale.sucursal_id == req)
            .first()
        )
        if not exists_in_sales:
            raise HTTPException(
                status_code=403,
                detail=f"La sucursal '{req}' no pertenece a la empresa activa o no está autorizada.",
            )

    return req, req, branch_list
