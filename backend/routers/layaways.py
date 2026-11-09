"""routers/layaways.py — CRUD endpoints para Apartados (E-02b).

Flujo:
  POST   /api/layaways              → crear apartado + abono inicial
  GET    /api/layaways              → listar (filtro status, client_id)
  GET    /api/layaways/{id}         → detalle
  POST   /api/layaways/{id}/payments → registrar abono
  POST   /api/layaways/{id}/cancel   → cancelar (admin / cajero)
  POST   /api/layaways/expire        → marcar vencidos (llamado por cron o admin)

Reglas de negocio:
  - Vencimiento = 6 meses desde creación (configurable luego vía AdminConfig).
  - Al completar el último pago → status COMPLETADO, se genera una Sale normal.
  - Al cancelar → saldo abonado pasa a anticipo del cliente (saldo_favor).
  - Al vencer (cron) → igual que cancelar + stock devuelto al inventario.
"""
import uuid
import json
from datetime import datetime, timezone, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import crud
import models
import schemas
from database import SessionLocal
from deps import get_empresa_id, role_guard, require_module_access

router = APIRouter()

LAYAWAY_MONTHS = 6   # vencimiento por defecto


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _folio_layaway(db: Session, empresa_id: str) -> str:
    from sqlalchemy import func as sqlfunc
    count = (db.query(sqlfunc.count(models.Layaway.folio))
               .filter(models.Layaway.empresa_id == empresa_id,
                       models.Layaway.folio.ilike("AP-%"))
               .scalar() or 0)
    return f"AP-{count + 1:04d}"


def _serialize_layaway(lay) -> dict:
    items = [
        {"id": i.id, "product_sku": i.product_sku, "description": i.description,
         "quantity": float(i.quantity), "price": float(i.price), "subtotal": float(i.subtotal)}
        for i in (lay.items or [])
    ]
    payments = [
        {"id": p.id, "amount": float(p.amount), "payment_method": p.payment_method,
         "created_at": str(p.created_at or "")}
        for p in (lay.payments or [])
    ]
    return {
        "id": lay.id, "empresa_id": lay.empresa_id, "folio": lay.folio,
        "client_id": lay.client_id, "client_name": lay.client_name,
        "total_amount": float(lay.total_amount), "amount_paid": float(lay.amount_paid),
        "amount_pending": float(lay.amount_pending), "status": lay.status,
        "fecha_vencimiento": str(lay.fecha_vencimiento or ""),
        "nota": lay.nota, "created_at": str(lay.created_at or ""),
        "items": items, "payments": payments,
    }


# ── Crear apartado ─────────────────────────────────────────────────────────────

@router.post("/api/layaways", status_code=201)
def create_layaway(
    req: schemas.LayawayCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    tenant: dict = Depends(role_guard(["cajero", "vendedor", "admin"])),
):
    if not req.items:
        raise HTTPException(status_code=422, detail="El apartado debe tener al menos un ítem")

    total = Decimal("0")
    for it in req.items:
        total += Decimal(str(it.price)) * Decimal(str(it.quantity))

    initial = Decimal(str(req.initial_payment))
    if initial <= 0:
        raise HTTPException(status_code=422, detail="El abono inicial debe ser mayor a cero")
    if initial > total:
        raise HTTPException(status_code=422, detail="El abono no puede superar el total")

    now = datetime.now(timezone.utc)
    vencimiento = now + timedelta(days=LAYAWAY_MONTHS * 30)

    lay = models.Layaway(
        id=str(uuid.uuid4()),
        empresa_id=empresa_id,
        sucursal_id=tenant.get("sucursal", "MATRIZ"),
        folio=_folio_layaway(db, empresa_id),
        client_id=req.client_id,
        client_name=req.client_name,
        seller_id=tenant.get("user_id"),
        total_amount=total,
        amount_paid=initial,
        amount_pending=total - initial,
        status="ACTIVO" if initial < total else "COMPLETADO",
        fecha_vencimiento=vencimiento,
        nota=req.nota,
        created_by=tenant.get("user_id"),
    )
    db.add(lay)
    db.flush()

    # Busca almacén principal del tenant (para reservas)
    _default_wh = (
        db.query(models.Warehouse)
          .filter(models.Warehouse.empresa_id == empresa_id,
                  models.Warehouse.sucursal_id == lay.sucursal_id,
                  models.Warehouse.is_transit == False)
          .first()
    ) or (
        db.query(models.Warehouse)
          .filter(models.Warehouse.empresa_id == empresa_id,
                  models.Warehouse.is_transit == False)
          .first()
    )

    for it in req.items:
        sub = Decimal(str(it.price)) * Decimal(str(it.quantity))
        # Resuelve product_id si vino vacío
        p_id = it.product_id
        if not p_id:
            _prod = (db.query(models.Product)
                       .filter(models.Product.empresa_id == empresa_id,
                               models.Product.sku == it.product_sku)
                       .first())
            p_id = _prod.id if _prod else None

        db.add(models.LayawayItem(
            id=str(uuid.uuid4()),
            empresa_id=empresa_id,
            layaway_id=lay.id,
            product_id=p_id,
            product_sku=it.product_sku,
            description=it.description or it.product_sku,
            quantity=Decimal(str(it.quantity)),
            price=Decimal(str(it.price)),
            subtotal=sub,
        ))

        # Reserva de inventario (best-effort: no bloquea si no hay stock)
        if _default_wh and p_id and lay.status == "ACTIVO":
            try:
                crud.reserve_stock(
                    db, empresa_id, lay.sucursal_id,
                    p_id, _default_wh.id, float(it.quantity),
                    "LAYAWAY", lay.id,
                    expires_minutes=180 * 24 * LAYAWAY_MONTHS,  # 6 meses aprox.
                    created_by=tenant.get("user_id"),
                )
            except ValueError:
                pass  # sin stock disponible para reservar; layaway se crea igual

    _pd = req.payment_details
    db.add(models.LayawayPayment(
        id=str(uuid.uuid4()),
        empresa_id=empresa_id,
        layaway_id=lay.id,
        amount=initial,
        payment_method=req.payment_method,
        payment_details=json.dumps(_pd, ensure_ascii=False) if _pd else None,
        created_by=tenant.get("user_id"),
    ))

    db.commit()
    db.refresh(lay)
    return _serialize_layaway(lay)


# ── Listar apartados ───────────────────────────────────────────────────────────

@router.get("/api/layaways")
def list_layaways(
    status: str | None = None,
    client_id: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    tenant: dict = Depends(role_guard(["cajero", "vendedor", "admin"])),
):
    q = db.query(models.Layaway).filter(models.Layaway.empresa_id == empresa_id)
    if status:
        q = q.filter(models.Layaway.status == status.upper())
    if client_id:
        q = q.filter(models.Layaway.client_id == client_id)
    layaways = q.order_by(models.Layaway.created_at.desc()).offset(skip).limit(limit).all()
    return [_serialize_layaway(l) for l in layaways]


# ── Detalle ────────────────────────────────────────────────────────────────────

@router.get("/api/layaways/{layaway_id}")
def get_layaway(
    layaway_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    tenant: dict = Depends(role_guard(["cajero", "vendedor", "admin"])),
):
    lay = db.query(models.Layaway).filter(
        models.Layaway.empresa_id == empresa_id,
        models.Layaway.id == layaway_id,
    ).first()
    if not lay:
        raise HTTPException(status_code=404, detail="Apartado no encontrado")
    return _serialize_layaway(lay)


# ── Registrar abono ────────────────────────────────────────────────────────────

@router.post("/api/layaways/{layaway_id}/payments", status_code=201)
def add_layaway_payment(
    layaway_id: str,
    req: schemas.LayawayPaymentCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    tenant: dict = Depends(role_guard(["cajero", "vendedor", "admin"])),
):
    lay = db.query(models.Layaway).filter(
        models.Layaway.empresa_id == empresa_id,
        models.Layaway.id == layaway_id,
    ).first()
    if not lay:
        raise HTTPException(status_code=404, detail="Apartado no encontrado")
    if lay.status not in ("ACTIVO",):
        raise HTTPException(status_code=400,
                            detail=f"No se puede abonar a un apartado en estado {lay.status}")

    amount = Decimal(str(req.amount))
    if amount <= 0:
        raise HTTPException(status_code=422, detail="El monto debe ser mayor a cero")

    pending = Decimal(str(lay.amount_pending))
    if amount > pending + Decimal("0.01"):
        raise HTTPException(status_code=422,
                            detail=f"El abono excede el saldo pendiente (${float(pending):.2f})")

    _pd = req.payment_details
    db.add(models.LayawayPayment(
        id=str(uuid.uuid4()),
        empresa_id=empresa_id,
        layaway_id=lay.id,
        amount=amount,
        payment_method=req.payment_method,
        payment_details=json.dumps(_pd, ensure_ascii=False) if _pd else None,
        created_by=tenant.get("user_id"),
    ))

    lay.amount_paid    = Decimal(str(lay.amount_paid)) + amount
    lay.amount_pending = max(Decimal("0"), pending - amount)
    if lay.amount_pending <= Decimal("0.01"):
        lay.status = "COMPLETADO"
        crud.consume_reservations(db, empresa_id, "LAYAWAY", lay.id)
    lay.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(lay)
    return _serialize_layaway(lay)


# ── Cancelar apartado ──────────────────────────────────────────────────────────

@router.post("/api/layaways/{layaway_id}/cancel")
def cancel_layaway(
    layaway_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    tenant: dict = Depends(role_guard(["admin"])),
):
    lay = db.query(models.Layaway).filter(
        models.Layaway.empresa_id == empresa_id,
        models.Layaway.id == layaway_id,
    ).first()
    if not lay:
        raise HTTPException(status_code=404, detail="Apartado no encontrado")
    if lay.status not in ("ACTIVO",):
        raise HTTPException(status_code=400,
                            detail=f"No se puede cancelar un apartado en estado {lay.status}")

    lay.status     = "CANCELADO"
    lay.updated_at = datetime.now(timezone.utc)

    # Libera reservas de inventario asociadas al apartado
    _reserv = (
        db.query(models.StockReservation)
          .filter(
              models.StockReservation.empresa_id == empresa_id,
              models.StockReservation.reference_type == "LAYAWAY",
              models.StockReservation.reference_id == lay.id,
              models.StockReservation.status == "ACTIVE",
          )
          .all()
    )
    for _r in _reserv:
        _r.status = "RELEASED"

    # Saldo abonado → anticipo del cliente (saldo_favor)
    paid = float(lay.amount_paid)
    if paid > 0:
        client = db.query(models.Client).filter(
            models.Client.empresa_id == empresa_id,
            models.Client.id == lay.client_id,
        ).first()
        if client:
            current = float(client.saldo_favor or 0)
            client.saldo_favor = current + paid

    db.commit()
    db.refresh(lay)
    return _serialize_layaway(lay)


# ── Procesar vencimientos (admin / cron) ───────────────────────────────────────

@router.post("/api/layaways/expire")
def expire_layaways(
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    tenant: dict = Depends(role_guard(["admin"])),
):
    """Marca como VENCIDO los apartados ACTIVOS cuya fecha_vencimiento ya pasó.
    El saldo abonado se transfiere a saldo_favor del cliente.
    Llamar desde cron o manualmente desde el panel admin."""
    now = datetime.now(timezone.utc)
    expired = db.query(models.Layaway).filter(
        models.Layaway.empresa_id == empresa_id,
        models.Layaway.status == "ACTIVO",
        models.Layaway.fecha_vencimiento <= now,
    ).all()

    count = 0
    for lay in expired:
        lay.status     = "VENCIDO"
        lay.updated_at = now
        paid = float(lay.amount_paid)
        if paid > 0:
            client = db.query(models.Client).filter(
                models.Client.empresa_id == empresa_id,
                models.Client.id == lay.client_id,
            ).first()
            if client:
                current = float(client.saldo_favor or 0)
                client.saldo_favor = current + paid
        count += 1

    db.commit()
    return {"expired": count}
