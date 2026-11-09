"""Ítem 1: Programa de Fidelización de Puntos.

Configuración (AdminConfig keys):
  loyalty.config     = {"mode": "percent"|"fixed", "rate": N}
    percent: rate = % del total de la venta  → puntos = total * rate / 100
    fixed:   rate = puntos fijos por compra  → puntos = rate
  loyalty.redemption = {"modes": [...], "valor_punto": float}
    modes: lista de modos habilitados (pago_parcial, sorteo, regalo, etc.)
    valor_punto: MXN que equivale 1 punto (para pago_parcial)

Endpoints:
  Administración (admin):
    GET  /api/loyalty/config               — leer config de acumulación
    PUT  /api/loyalty/config               — actualizar config de acumulación
    GET  /api/loyalty/redemption-config    — leer config de modos de redención
    PUT  /api/loyalty/redemption-config    — actualizar modos + valor_punto

  Operación (staff + admin):
    GET  /api/loyalty/clients/{client_id}/points   — puntos actuales del cliente
    POST /api/loyalty/clients/{client_id}/redeem   — canjear puntos
    GET  /api/loyalty/clients/{client_id}/history  — historial de canjes

  Interno (llamado desde crud.create_sale tras commit):
    POST /api/loyalty/accrue               — acumular puntos por venta
"""

import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from deps import get_empresa_id, get_tenant_context, role_guard

router = APIRouter(tags=["lealtad"])

_ADMIN_GUARD = role_guard(["admin", "Administrador"])
_STAFF_GUARD = role_guard(["admin", "Administrador", "Gerente", "vendedor", "cajero", "vendedor_cajero"])

_LOYALTY_CONFIG_KEY     = "loyalty.config"
_LOYALTY_REDEMPTION_KEY = "loyalty.redemption"

_DEFAULT_CONFIG     = {"mode": "percent", "rate": 1.0}
_DEFAULT_REDEMPTION = {"modes": ["pago_parcial", "sorteo", "regalo"], "valor_punto": 1.0}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_config(db: Session, empresa_id: str, key: str, default: dict) -> dict:
    row = db.query(models.AdminConfig).filter(
        models.AdminConfig.empresa_id == empresa_id,
        models.AdminConfig.config_key == key,
    ).first()
    if not row:
        return default
    try:
        return json.loads(row.config_val)
    except (json.JSONDecodeError, TypeError):
        return default


def _set_config(db: Session, empresa_id: str, key: str, value: dict) -> None:
    row = db.query(models.AdminConfig).filter(
        models.AdminConfig.empresa_id == empresa_id,
        models.AdminConfig.config_key == key,
    ).first()
    val_str = json.dumps(value, ensure_ascii=False)
    if row:
        row.config_val = val_str
    else:
        db.add(models.AdminConfig(empresa_id=empresa_id, config_key=key, config_val=val_str))
    db.commit()


def _get_client_or_404(db: Session, empresa_id: str, client_id: str) -> models.Client:
    c = db.query(models.Client).filter(
        models.Client.empresa_id == empresa_id,
        models.Client.id == client_id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return c


def calc_points_for_sale(config: dict, total: float) -> int:
    """Calcula los puntos a acumular según la configuración del tenant."""
    mode = config.get("mode", "percent")
    rate = float(config.get("rate", 1.0))
    if mode == "percent":
        return int(Decimal(str(total)) * Decimal(str(rate)) / 100)
    return int(rate)  # fixed


# ── Configuración de acumulación ─────────────────────────────────────────────

@router.get("/api/loyalty/config")
def get_loyalty_config(
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    return _get_config(db, empresa_id, _LOYALTY_CONFIG_KEY, _DEFAULT_CONFIG)


@router.put("/api/loyalty/config")
def update_loyalty_config(
    body: dict,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    if body.get("mode") not in ("percent", "fixed"):
        raise HTTPException(status_code=400, detail="mode debe ser: percent o fixed")
    if not isinstance(body.get("rate"), (int, float)) or float(body["rate"]) < 0:
        raise HTTPException(status_code=400, detail="rate debe ser un número >= 0")
    _set_config(db, empresa_id, _LOYALTY_CONFIG_KEY, {"mode": body["mode"], "rate": float(body["rate"])})
    return {"ok": True, "config": {"mode": body["mode"], "rate": body["rate"]}}


# ── Configuración de modos de redención ──────────────────────────────────────

@router.get("/api/loyalty/redemption-config")
def get_redemption_config(
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    return _get_config(db, empresa_id, _LOYALTY_REDEMPTION_KEY, _DEFAULT_REDEMPTION)


@router.put("/api/loyalty/redemption-config")
def update_redemption_config(
    body: dict,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    modes = body.get("modes")
    if not isinstance(modes, list) or not modes:
        raise HTTPException(status_code=400, detail="modes debe ser una lista no vacía de strings")
    valor_punto = body.get("valor_punto", 1.0)
    if not isinstance(valor_punto, (int, float)) or float(valor_punto) <= 0:
        raise HTTPException(status_code=400, detail="valor_punto debe ser > 0")
    cfg = {"modes": modes, "valor_punto": float(valor_punto)}
    _set_config(db, empresa_id, _LOYALTY_REDEMPTION_KEY, cfg)
    return {"ok": True, "config": cfg}


# ── Puntos del cliente ────────────────────────────────────────────────────────

@router.get("/api/loyalty/clients/{client_id}/points")
def get_client_points(
    client_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_STAFF_GUARD),
):
    client = _get_client_or_404(db, empresa_id, client_id)
    redemption_cfg = _get_config(db, empresa_id, _LOYALTY_REDEMPTION_KEY, _DEFAULT_REDEMPTION)
    valor_punto = float(redemption_cfg.get("valor_punto", 1.0))
    puntos = int(client.puntos or 0)
    return {
        "client_id": client_id,
        "puntos": puntos,
        "valor_mxn": round(puntos * valor_punto, 2),
    }


# ── Acumulación (llamado tras commit de venta) ────────────────────────────────

@router.post("/api/loyalty/accrue")
def accrue_points(
    body: dict,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_STAFF_GUARD),
):
    """Acumula puntos para el cliente de una venta ya cerrada.
    body: {client_id, sale_total, sale_id}
    Retorna los puntos acumulados y el nuevo saldo.
    """
    client_id  = body.get("client_id")
    sale_total = float(body.get("sale_total", 0))
    sale_id    = body.get("sale_id")

    if not client_id:
        raise HTTPException(status_code=400, detail="client_id requerido")

    client = _get_client_or_404(db, empresa_id, client_id)
    config = _get_config(db, empresa_id, _LOYALTY_CONFIG_KEY, _DEFAULT_CONFIG)
    pts = calc_points_for_sale(config, sale_total)

    if pts > 0:
        client.puntos = (client.puntos or 0) + pts
        db.commit()

    return {"puntos_acumulados": pts, "puntos_total": int(client.puntos or 0)}


# ── Redención ─────────────────────────────────────────────────────────────────

@router.post("/api/loyalty/clients/{client_id}/redeem", status_code=201)
def redeem_points(
    client_id: str,
    data: schemas.PointsRedemptionCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_STAFF_GUARD),
):
    client = _get_client_or_404(db, empresa_id, client_id)
    redemption_cfg = _get_config(db, empresa_id, _LOYALTY_REDEMPTION_KEY, _DEFAULT_REDEMPTION)

    allowed_modes = redemption_cfg.get("modes", [])
    if data.redemption_mode not in allowed_modes:
        raise HTTPException(
            status_code=400,
            detail=f"Modo '{data.redemption_mode}' no está habilitado. Modos activos: {allowed_modes}",
        )

    puntos_disponibles = int(client.puntos or 0)
    if data.puntos_canjeados <= 0:
        raise HTTPException(status_code=400, detail="puntos_canjeados debe ser > 0")
    if data.puntos_canjeados > puntos_disponibles:
        raise HTTPException(
            status_code=400,
            detail=f"Puntos insuficientes: tiene {puntos_disponibles}, solicita {data.puntos_canjeados}",
        )

    valor_punto = float(redemption_cfg.get("valor_punto", 1.0))
    valor_aplicado = None
    if data.redemption_mode == "pago_parcial":
        valor_aplicado = round(data.puntos_canjeados * valor_punto, 4)

    client.puntos = puntos_disponibles - data.puntos_canjeados
    user_id = payload.get("sub") or payload.get("user_id") or "staff"

    redemption = models.PointsRedemption(
        id=str(uuid.uuid4()), empresa_id=empresa_id,
        client_id=client_id, redemption_mode=data.redemption_mode,
        puntos_canjeados=data.puntos_canjeados, valor_aplicado=valor_aplicado,
        sale_id=data.sale_id, notas=data.notas, registrado_por=user_id,
    )
    db.add(redemption)
    db.commit()
    db.refresh(redemption)

    return {
        "id": redemption.id,
        "client_id": client_id,
        "redemption_mode": data.redemption_mode,
        "puntos_canjeados": data.puntos_canjeados,
        "valor_aplicado": float(valor_aplicado) if valor_aplicado is not None else None,
        "puntos_restantes": int(client.puntos or 0),
        "created_at": redemption.created_at.isoformat() if redemption.created_at else None,
    }


@router.get("/api/loyalty/clients/{client_id}/history")
def get_redemption_history(
    client_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_STAFF_GUARD),
):
    _get_client_or_404(db, empresa_id, client_id)
    rows = (db.query(models.PointsRedemption)
              .filter(models.PointsRedemption.empresa_id == empresa_id,
                      models.PointsRedemption.client_id == client_id)
              .order_by(models.PointsRedemption.created_at.desc())
              .all())
    return [
        {
            "id": r.id, "redemption_mode": r.redemption_mode,
            "puntos_canjeados": r.puntos_canjeados,
            "valor_aplicado": float(r.valor_aplicado) if r.valor_aplicado else None,
            "sale_id": r.sale_id, "notas": r.notas,
            "registrado_por": r.registrado_por,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
