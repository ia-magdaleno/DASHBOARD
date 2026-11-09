"""Ítem 3: Vendedores categorizados — permisos de catálogo, comisiones y
autorización de cambio de escala de precio.

Endpoints:
  Permisos de catálogo (qué puede vender):
    GET    /api/sellers/{employee_id}/catalog-permissions
    POST   /api/sellers/{employee_id}/catalog-permissions
    DELETE /api/sellers/{employee_id}/catalog-permissions/{perm_id}

  Reglas de comisión:
    GET    /api/sellers/{employee_id}/commission-rules
    POST   /api/sellers/{employee_id}/commission-rules
    DELETE /api/sellers/{employee_id}/commission-rules/{rule_id}

  Autorización de escala de precio (flujo notificación):
    POST   /api/sellers/price-scale-requests          — vendedor solicita
    GET    /api/sellers/price-scale-requests           — admin lista pendientes
    PUT    /api/sellers/price-scale-requests/{req_id}  — admin aprueba/rechaza
    GET    /api/sellers/price-scale-requests/{req_id}  — POS consulta estado

  Utilidad:
    GET    /api/sellers/{employee_id}/can-sell/{category}
    GET    /api/sellers/{employee_id}/commission-rate   — tasa efectiva para una venta
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from deps import get_empresa_id, get_tenant_context, role_guard

router = APIRouter(tags=["vendedores"])

_ADMIN_GUARD  = role_guard(["admin", "Administrador"])
_STAFF_GUARD  = role_guard(["admin", "Administrador", "Gerente", "vendedor", "cajero", "vendedor_cajero"])


# ── Utilidad interna ─────────────────────────────────────────────────────────

def _get_employee_or_404(db: Session, empresa_id: str, employee_id: str):
    emp = (db.query(models.Employee)
             .filter(models.Employee.empresa_id == empresa_id,
                     models.Employee.id == employee_id,
                     models.Employee.is_deleted == False)
             .first())
    if not emp:
        raise HTTPException(status_code=404, detail="Empleado no encontrado")
    return emp


# ── Permisos de catálogo ─────────────────────────────────────────────────────

@router.get("/api/sellers/{employee_id}/catalog-permissions",
            response_model=List[schemas.SellerCatalogPermissionOut])
def list_catalog_permissions(
    employee_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    _get_employee_or_404(db, empresa_id, employee_id)
    rows = (db.query(models.SellerCatalogPermission)
              .filter(models.SellerCatalogPermission.empresa_id == empresa_id,
                      models.SellerCatalogPermission.employee_id == employee_id)
              .all())
    return rows


@router.post("/api/sellers/{employee_id}/catalog-permissions",
             response_model=schemas.SellerCatalogPermissionOut, status_code=201)
def set_catalog_permission(
    employee_id: str,
    data: schemas.SellerCatalogPermissionCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    _get_employee_or_404(db, empresa_id, employee_id)
    # Upsert: si ya existe la fila actualiza can_sell
    existing = (db.query(models.SellerCatalogPermission)
                  .filter(models.SellerCatalogPermission.empresa_id == empresa_id,
                          models.SellerCatalogPermission.employee_id == employee_id,
                          models.SellerCatalogPermission.category == data.category)
                  .first())
    if existing:
        existing.can_sell = data.can_sell
        db.commit()
        db.refresh(existing)
        return existing

    perm = models.SellerCatalogPermission(
        id=str(uuid.uuid4()), empresa_id=empresa_id,
        employee_id=employee_id, category=data.category, can_sell=data.can_sell,
    )
    db.add(perm)
    db.commit()
    db.refresh(perm)
    return perm


@router.delete("/api/sellers/{employee_id}/catalog-permissions/{perm_id}")
def delete_catalog_permission(
    employee_id: str, perm_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    row = (db.query(models.SellerCatalogPermission)
             .filter(models.SellerCatalogPermission.empresa_id == empresa_id,
                     models.SellerCatalogPermission.id == perm_id,
                     models.SellerCatalogPermission.employee_id == employee_id)
             .first())
    if not row:
        raise HTTPException(status_code=404, detail="Permiso no encontrado")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/api/sellers/{employee_id}/can-sell/{category}")
def can_sell_category(
    employee_id: str, category: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_STAFF_GUARD),
):
    """El POS lo llama para saber si mostrar la categoría al vendedor.
    Si no hay filas de permisos para este empleado → puede vender todo."""
    total_rules = (db.query(models.SellerCatalogPermission)
                     .filter(models.SellerCatalogPermission.empresa_id == empresa_id,
                             models.SellerCatalogPermission.employee_id == employee_id)
                     .count())
    if total_rules == 0:
        return {"can_sell": True, "reason": "sin_restricciones"}

    perm = (db.query(models.SellerCatalogPermission)
              .filter(models.SellerCatalogPermission.empresa_id == empresa_id,
                      models.SellerCatalogPermission.employee_id == employee_id,
                      models.SellerCatalogPermission.category == category)
              .first())
    if not perm:
        return {"can_sell": False, "reason": "categoria_no_permitida"}
    return {"can_sell": perm.can_sell, "reason": "regla_explicita"}


# ── Reglas de comisión ────────────────────────────────────────────────────────

@router.get("/api/sellers/{employee_id}/commission-rules",
            response_model=List[schemas.SellerCommissionRuleOut])
def list_commission_rules(
    employee_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    _get_employee_or_404(db, empresa_id, employee_id)
    return (db.query(models.SellerCommissionRule)
              .filter(models.SellerCommissionRule.empresa_id == empresa_id,
                      models.SellerCommissionRule.employee_id == employee_id)
              .all())


@router.post("/api/sellers/{employee_id}/commission-rules",
             response_model=schemas.SellerCommissionRuleOut, status_code=201)
def set_commission_rule(
    employee_id: str,
    data: schemas.SellerCommissionRuleCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    _get_employee_or_404(db, empresa_id, employee_id)
    if data.scope not in ("default", "category", "price_scale"):
        raise HTTPException(status_code=400, detail="scope debe ser: default, category o price_scale")

    existing = (db.query(models.SellerCommissionRule)
                  .filter(models.SellerCommissionRule.empresa_id == empresa_id,
                          models.SellerCommissionRule.employee_id == employee_id,
                          models.SellerCommissionRule.scope == data.scope,
                          models.SellerCommissionRule.scope_value == data.scope_value)
                  .first())
    if existing:
        existing.rate = data.rate
        db.commit()
        db.refresh(existing)
        return existing

    rule = models.SellerCommissionRule(
        id=str(uuid.uuid4()), empresa_id=empresa_id,
        employee_id=employee_id, scope=data.scope,
        scope_value=data.scope_value, rate=data.rate,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/api/sellers/{employee_id}/commission-rules/{rule_id}")
def delete_commission_rule(
    employee_id: str, rule_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    row = (db.query(models.SellerCommissionRule)
             .filter(models.SellerCommissionRule.empresa_id == empresa_id,
                     models.SellerCommissionRule.id == rule_id,
                     models.SellerCommissionRule.employee_id == employee_id)
             .first())
    if not row:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/api/sellers/{employee_id}/commission-rate")
def get_effective_commission_rate(
    employee_id: str,
    category: Optional[str] = None,
    price_scale: Optional[str] = None,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_STAFF_GUARD),
):
    """Devuelve la tasa efectiva de comisión para este vendedor en una venta.
    Jerarquía de aplicación (más específico gana):
      1. scope=price_scale + scope_value=<escala>
      2. scope=category  + scope_value=<categoría>
      3. scope=default
      4. Fallback: Employee.commission_factor
    """
    rules = (db.query(models.SellerCommissionRule)
               .filter(models.SellerCommissionRule.empresa_id == empresa_id,
                       models.SellerCommissionRule.employee_id == employee_id)
               .all())

    # Índice por (scope, scope_value)
    idx = {(r.scope, r.scope_value): float(r.rate) for r in rules}

    if price_scale and ("price_scale", price_scale) in idx:
        return {"rate": idx[("price_scale", price_scale)], "scope": "price_scale", "scope_value": price_scale}
    if category and ("category", category) in idx:
        return {"rate": idx[("category", category)], "scope": "category", "scope_value": category}
    if ("default", None) in idx:
        return {"rate": idx[("default", None)], "scope": "default", "scope_value": None}

    # Fallback a commission_factor del empleado
    emp = _get_employee_or_404(db, empresa_id, employee_id)
    return {"rate": float(emp.commission_factor or 0), "scope": "employee_factor", "scope_value": None}


# ── Autorización de escala de precio ─────────────────────────────────────────

@router.post("/api/sellers/price-scale-requests",
             response_model=schemas.PriceScaleAuthRequestOut, status_code=201)
def request_price_scale_change(
    data: schemas.PriceScaleAuthRequestCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_STAFF_GUARD),
):
    """El vendedor en POS solicita cambio de escala de precio para una venta puntual.
    Crea la solicitud y la deja en status=pending para que el admin la atienda.
    """
    employee_id = payload.get("employee_id") or payload.get("sub") or "unknown"

    req = models.PriceScaleAuthRequest(
        id=str(uuid.uuid4()),
        empresa_id=empresa_id,
        session_token=data.session_token,
        client_id=data.client_id,
        requested_scale=data.requested_scale,
        current_scale=data.current_scale,
        requested_by=employee_id,
        status="pending",
        notes=data.notes,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return _psar_out(req)


@router.get("/api/sellers/price-scale-requests",
            response_model=List[schemas.PriceScaleAuthRequestOut])
def list_price_scale_requests(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    """Admin ve las solicitudes pendientes (y el historial)."""
    q = db.query(models.PriceScaleAuthRequest).filter(
        models.PriceScaleAuthRequest.empresa_id == empresa_id
    )
    if status:
        q = q.filter(models.PriceScaleAuthRequest.status == status)
    return [_psar_out(r) for r in q.order_by(models.PriceScaleAuthRequest.created_at.desc()).all()]


@router.put("/api/sellers/price-scale-requests/{req_id}",
            response_model=schemas.PriceScaleAuthRequestOut)
def resolve_price_scale_request(
    req_id: str,
    body: schemas.PriceScaleAuthRequestResolve,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_ADMIN_GUARD),
):
    """Admin aprueba o rechaza la solicitud."""
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="status debe ser approved o rejected")

    req = (db.query(models.PriceScaleAuthRequest)
             .filter(models.PriceScaleAuthRequest.empresa_id == empresa_id,
                     models.PriceScaleAuthRequest.id == req_id)
             .first())
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"La solicitud ya fue resuelta: {req.status}")

    req.status       = body.status
    req.authorized_by = payload.get("sub") or payload.get("user_id") or "admin"
    req.notes        = body.notes or req.notes

    if body.status == "approved":
        if not body.expires_at:
            raise HTTPException(status_code=400, detail="expires_at requerido al aprobar")
        try:
            req.expires_at = datetime.fromisoformat(body.expires_at).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail="expires_at inválido. Usa ISO 8601")

    db.commit()
    db.refresh(req)
    return _psar_out(req)


@router.get("/api/sellers/price-scale-requests/{req_id}",
            response_model=schemas.PriceScaleAuthRequestOut)
def get_price_scale_request(
    req_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_STAFF_GUARD),
):
    """El POS hace polling aquí para saber si la solicitud fue aprobada."""
    req = (db.query(models.PriceScaleAuthRequest)
             .filter(models.PriceScaleAuthRequest.empresa_id == empresa_id,
                     models.PriceScaleAuthRequest.id == req_id)
             .first())
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    return _psar_out(req)


def _psar_out(r: models.PriceScaleAuthRequest) -> dict:
    return {
        "id":              r.id,
        "empresa_id":      r.empresa_id,
        "client_id":       r.client_id,
        "requested_scale": r.requested_scale,
        "current_scale":   r.current_scale,
        "requested_by":    r.requested_by,
        "status":          r.status,
        "authorized_by":   r.authorized_by,
        "expires_at":      r.expires_at.isoformat() if r.expires_at else None,
        "notes":           r.notes,
        "created_at":      r.created_at.isoformat() if r.created_at else None,
    }
