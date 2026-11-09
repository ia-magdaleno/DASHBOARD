"""Módulo Ventas — endpoints extraídos de main.py (strangler fig, Fase 2).

Cubre: POS de venta (`/api/sales*`), devoluciones (`/api/sales/{id}/return*`,
`/api/returns*`, `/api/devoluciones/solicitud`), ventas apartadas (parked sales),
cotizaciones (quotes) y la cartera / cuentas por cobrar (CxC:
`/api/accounts-receivable*`, `/api/clients/{id}/ledger`). Resguardos y
notificaciones siguen en main.py hasta que se toque cada uno.
"""
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import crud
import models
import schemas
from database import get_db
from deps import get_empresa_id, get_tenant_context, role_guard

router = APIRouter(tags=["ventas"])

_log = logging.getLogger("calebsys.sales")


def _audit(db: Session, empresa_id: str, user_id: str, action: str,
           severity: str = "INFO", sucursal_id: str = "MATRIZ", details=None):
    """Registra un evento en AuditLog. Nunca debe tumbar la operación de
    negocio — si el propio audit falla, se ignora y se hace rollback SOLO de
    la fila de auditoría (la operación ya commiteó antes de llamar aquí)."""
    try:
        db.add(models.AuditLog(
            empresa_id=empresa_id or "DESCONOCIDA",
            sucursal_id=sucursal_id or "MATRIZ",
            user_id=user_id or "sistema",
            action=action,
            severity=severity,
            details=details,
        ))
        db.commit()
    except Exception:
        db.rollback()


# ── POS de venta ─────────────────────────────────────────────────────────

# Sales (Commits transaction, handles stock skips for safekept, registers credit debts)
@router.post("/api/sales", response_model=schemas.Sale)
def create_sale(sale: schemas.SaleCreate, db: Session = Depends(get_db),
                empresa_id: str = Depends(get_empresa_id),
                tenant: dict = Depends(get_tenant_context)):
    # ── Fix A-01: resolver cliente mostrador cuando client_id llega null ──
    # El POS sincroniza PUBLICO EN GENERAL al arrancar, pero si esa sync falla
    # (arranque en frío, red lenta, sesión nueva) persistedClientId() devuelve
    # null y el front lo envía tal cual.  En vez de rechazar con 422, buscamos
    # el cliente con RFC XAXX010101000 en el tenant y lo usamos automáticamente.
    if not sale.client_id:
        walk_in = (
            db.query(models.Client)
            .filter(models.Client.empresa_id == empresa_id)
            .filter(models.Client.rfc == "XAXX010101000")
            .first()
        )
        if not walk_in:
            raise HTTPException(
                status_code=400,
                detail="Cliente mostrador (XAXX010101000) no encontrado en el tenant. "
                       "Cree el cliente 'PUBLICO EN GENERAL' antes de registrar ventas."
            )
        # Reconstruir schema con el client_id resuelto para que crud.create_sale
        # reciba un objeto válido sin modificar su firma.
        sale_data = sale.model_dump()
        sale_data["client_id"] = walk_in.id
        sale = schemas.SaleCreate(**sale_data)

    # Validate client exists (fix C1, auditoria 2026-08-03: sales.client_id
    # ahora tiene FK real compuesta a 'clients'; sin este chequeo temprano,
    # un client_id inexistente tronaba como IntegrityError generico -> 500,
    # en vez de un 400 claro como ya se hace con el SKU de producto abajo).
    db_client = (
        db.query(models.Client)
        .filter(models.Client.empresa_id == empresa_id)
        .filter(models.Client.id == sale.client_id)
        .first()
    )
    if not db_client:
        raise HTTPException(status_code=400, detail=f"Client {sale.client_id} not found")

    # NOTA (fix A1, auditoria 2026-08-03): antes habia aqui un pre-check de
    # SKU por item (crud.get_product, SELECT plano sin lock) antes de llamar
    # a crud.create_sale. Se quito a proposito: era redundante (create_sale
    # ya valida el SKU y levanta el mismo ValueError -> 400 mas abajo) y,
    # mas grave, era la causa real de una sobreventa intermitente bajo
    # concurrencia -- precargaba el Product en el identity map de esta
    # misma sesion ANTES del SELECT...FOR UPDATE real en create_sale, y sin
    # populate_existing() (ya agregado alla) SQLAlchemy devolvia el objeto
    # cacheado con el stock viejo en vez del valor recien liberado por el
    # lock. Ver commit del fix y test_concurrent_sales_prevent_overselling.

    # ── NR-04: Art. 29-A fracción VIII CFF ──────────────────────────────────
    # Ventas en efectivo > $2,000 MXN se dividen automáticamente en
    # sub-facturas ≤ $2,000. Si un producto supera $2,000, se factura a
    # $1,900 + línea de servicio (NR04-EXCEDENTE) por la diferencia.
    # Complete sale insertion
    try:
        # NOTA: crud.create_sale ya hace su propio db.commit()/db.refresh()
        # internamente (necesario para el UNIQUE constraint de A3 -- el
        # IntegrityError solo se dispara al commitear). No duplicar el
        # commit aqui.
        db_sale = crud.create_sale_nr04_split(
            db,
            empresa_id=empresa_id,
            sale=sale,
            sucursal_id=tenant.get("sucursal", "MATRIZ"),
        )
        crud.attach_resguardos(db, empresa_id, db_sale)
        try:
            _sale_total = float(getattr(db_sale, "total", 0) or 0)
        except Exception:
            _sale_total = None
        _audit(db, empresa_id, tenant.get("sub", "sistema"),
               f"SALE_CREATE:{getattr(db_sale, 'id', '?')}", "INFO",
               tenant.get("sucursal", "MATRIZ"),
               {"total": _sale_total, "client_id": getattr(db_sale, "client_id", None)})
        return db_sale
    except ValueError as e:
        # Errores de negocio esperables (stock insuficiente, apartados aun
        # no soportados -- ver crud.create_sale): 400, no 500.
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except IntegrityError:
        # Fix A3: condicion de carrera real -- dos requests con la misma
        # idempotency_key llegaron casi al mismo tiempo, el chequeo
        # optimista de crud.create_sale no alcanzo a verlo, y el UNIQUE
        # constraint (uq_sale_idempotency) la atrapa aqui. No es un error:
        # es el reintento legitimo del mismo checkout. Devolvemos la venta
        # que sí se guardó, igual que hace /api/sync/offline-sales.
        db.rollback()
        if sale.idempotency_key:
            existing = (
                db.query(models.Sale)
                .filter(models.Sale.empresa_id == empresa_id)
                .filter(models.Sale.idempotency_key == sale.idempotency_key)
                .first()
            )
            if existing:
                return existing
        raise HTTPException(status_code=409, detail="Duplicate sale (idempotency conflict)")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Transaction failed: {str(e)}")


@router.get("/api/sales", response_model=List[schemas.Sale])
def list_sales(skip: int = 0, limit: int = 50, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    return crud.get_sales(db, empresa_id=empresa_id, skip=skip, limit=limit)


# Specific Sale by ID
@router.get("/api/sales/{sale_id}", response_model=schemas.Sale)
def get_sale(sale_id: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    db_sale = crud.get_sale(db, empresa_id=empresa_id, sale_id=sale_id)
    if not db_sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    crud.attach_resguardos(db, empresa_id, db_sale)
    return db_sale


# Register a product return — LEGACY (un solo SKU por llamada).
# Mantenido por compatibilidad con el frontend existente.
# El nuevo endpoint /api/sales/{sale_id}/return (POST, multi-SKU) lo reemplaza
# con lógica completa: stock, Kardex, asiento contable e idempotencia.
# Este endpoint se eliminará en Fase 3 cuando el frontend esté migrado.
@router.post("/api/sales/{sale_id}/returns")
def register_return_batch(sale_id: str, batch: schemas.SaleReturnBatch, db: Session = Depends(get_db),
                          empresa_id: str = Depends(get_empresa_id),
                          tenant: dict = Depends(get_tenant_context)):
    try:
        result = crud.register_return_batch(db, empresa_id=empresa_id, sale_id=sale_id, batch=batch)
        _audit(db, empresa_id, tenant.get("sub", "sistema"),
               f"SALE_RETURN_LEGACY:{sale_id}", "WARNING",
               tenant.get("sucursal", "MATRIZ"))
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Devoluciones de venta ─────────────────────────────────────────────────

@router.post("/api/sales/{sale_id}/return", status_code=201)
def return_sale_items(sale_id: str,
                      data: schemas.SaleReturnCreate,
                      db: Session = Depends(get_db),
                      empresa_id: str = Depends(get_empresa_id),
                      payload: dict = Depends(role_guard(["ADMIN", "ALMACENISTA", "Gerente", "admin"]))):
    # NR-guard: solo Admin/Gerente/Almacenista autorizan devoluciones — Cajero queda fuera.
    data.sale_id    = sale_id
    sucursal_id     = payload.get("sucursal", "MATRIZ")
    created_by      = payload.get("sub", "sistema")
    try:
        result = crud.process_sale_return(db, empresa_id, sucursal_id, data,
                                          created_by=created_by)
        _audit(db, empresa_id, created_by, f"SALE_RETURN:{sale_id}", "WARNING", sucursal_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── NR-01: devolución cross-sucursal ────────────────────────────────────────
@router.post("/api/sales/{sale_id}/cross-return", status_code=201)
def cross_return_sale(
    sale_id: str,
    data: schemas.SaleReturnCreate,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(role_guard(["ADMIN", "Administrador", "Gerente", "Cajero", "admin"])),
):
    """NR-01: inicia devolución cross-sucursal (Admin/Gerente/Cajero).
    ADMIN → aprobación automática + movimientos inmediatos.
    Gerente/Cajero → queda PENDIENTE hasta aprobación (se notifica a
    Gerente, Admin y Almacén). El Vendedor no procesa aquí: usa
    POST /api/devoluciones/solicitud (solo levanta la solicitud).
    """
    data.sale_id   = sale_id
    sucursal_restock = payload.get("sucursal", "MATRIZ")
    created_by       = payload.get("sub", "sistema")
    role_name        = payload.get("role", "")
    try:
        result = crud.create_cross_return(db, empresa_id, sucursal_restock,
                                          role_name, data, created_by)
        _audit(db, empresa_id, created_by, f"SALE_CROSS_RETURN:{sale_id}", "WARNING",
               sucursal_restock, {"role": role_name})
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/returns/{return_id}/approve", status_code=200)
def approve_return(
    return_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(role_guard(["ADMIN", "Administrador", "Gerente", "admin"])),
):
    """NR-01: aprueba una devolución PENDIENTE → ejecuta stock + asiento."""
    approved_by = payload.get("sub", "sistema")
    try:
        result = crud.approve_cross_return(db, empresa_id, return_id, approved_by)
        _audit(db, empresa_id, approved_by, f"RETURN_APPROVED:{return_id}", "WARNING",
               payload.get("sucursal", "MATRIZ"))
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/returns/{return_id}/reject", status_code=200)
def reject_return(
    return_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(role_guard(["ADMIN", "Administrador", "Gerente", "admin"])),
    reason: Optional[str] = Query(None, description="Motivo del rechazo (opcional)"),
):
    """NR-01: rechaza una devolución PENDIENTE (sin stock ni asiento)."""
    rejected_by = payload.get("sub", "sistema")
    try:
        result = crud.reject_cross_return(db, empresa_id, return_id, rejected_by, reason)
        _audit(db, empresa_id, rejected_by, f"RETURN_REJECTED:{return_id}", "WARNING",
               payload.get("sucursal", "MATRIZ"), {"reason": reason})
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/returns", status_code=200)
def list_returns(
    estado: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
    payload: dict = Depends(role_guard(["ADMIN", "Administrador", "Gerente", "admin"])),
):
    """Lista devoluciones cross-sucursal. ADMIN ve todas; Gerente ve las de su sucursal."""
    empresa_id  = tenant["empresa"]
    sucursal_id = tenant["sucursal"]
    role_name   = payload.get("role", "")
    q = (
        db.query(models.SaleReturn)
        .filter(models.SaleReturn.empresa_id == empresa_id)
    )
    if role_name.lower() not in ("admin", "administrador"):
        q = q.filter(
            (models.SaleReturn.sucursal_origen == sucursal_id) |
            (models.SaleReturn.sucursal_restock == sucursal_id)
        )
    if estado:
        q = q.filter(models.SaleReturn.estado == estado.upper())
    rows = q.order_by(models.SaleReturn.created_at.desc()).limit(200).all()
    return [
        {
            "return_id": r.id, "sale_id": r.sale_id,
            "sucursal_origen": r.sucursal_origen,
            "sucursal_restock": r.sucursal_restock,
            "estado": r.estado, "authorized_by": r.authorized_by,
            "created_by": r.created_by, "created_at": r.created_at,
            "notes": r.notes,
        }
        for r in rows
    ]


# ── Devolución rápida (F2): el vendedor levanta la mano ─────────────────────
# D6: abre un "caso" con 2 notificaciones accionables (verificar condición /
# autorizar) enlazadas por group_id. La máquina de estados vive en notif_flow.
# sale_id/client_id/sku son opcionales: si vienen, el sistema resuelve solo
# "¿el cliente compró este SKU en alguna sede?" (decisión 2 de Don Antonio).
class DevolucionSolicitudIn(BaseModel):
    detalle: Optional[str] = None
    ticket_ref: Optional[str] = None
    sale_id: Optional[str] = None
    client_id: Optional[str] = None
    sku: Optional[str] = None
    # items a devolver: [{"sku": "...", "qty": 1}]. Si vienen junto con sale_id,
    # al autorizar se ejecuta la devolución completa (stock + ajuste de la venta).
    items: Optional[list] = None
    restock_warehouse_id: Optional[str] = None


@router.post("/api/devoluciones/solicitud", status_code=201)
def solicitar_devolucion_rapida(
    data: DevolucionSolicitudIn,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
    payload: dict = Depends(role_guard([
        "ADMIN", "Administrador", "admin", "Gerente",
        "Cajero", "CAJERO", "Vendedor", "VENDEDOR", "Mostrador", "MOSTRADOR",
    ])),
):
    """D6: abre el caso de devolución (no toca stock). Notifica a almacén
    (verificar condición) y a admin/gerente de la sede (autorizar)."""
    import notif_flow
    empresa_id  = tenant["empresa"]
    sucursal_id = tenant.get("sucursal", "MATRIZ")
    quien       = payload.get("sub", "operador")
    detalle     = (data.detalle or "").strip()
    ticket      = (data.ticket_ref or "").strip()

    try:
        res = notif_flow.create_return_case(
            db, empresa_id, sucursal_id, quien,
            detalle=detalle, ticket_ref=ticket,
            sale_id=data.sale_id, client_id=data.client_id, sku=data.sku,
            items=data.items, restock_warehouse_id=data.restock_warehouse_id,
        )
        db.commit()
        _audit(db, empresa_id, quien, "RETURN_REQUEST", "INFO", sucursal_id,
               {"group_id": res["group_id"], "ticket_ref": ticket or None,
                "purchase_found": res.get("purchase_found"),
                "auto_exec": res.get("auto_exec")})
        return {"ok": True, "group_id": res["group_id"],
                "notification_ids": res["notification_ids"],
                "purchase_found": res.get("purchase_found"),
                "auto_exec": res.get("auto_exec"),
                "message": "Solicitud enviada — almacén y gerencia la revisarán."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ── Ventas apartadas (Cuentas en la Nube) ─────────────────────────────────

@router.get("/api/parked-sales", response_model=List[schemas.ParkedSale])
def get_parked_sales(
    branch: Optional[str] = None,
    seller: Optional[str] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    return crud.get_parked_sales(db, empresa_id=empresa_id, branch=branch, seller=seller, query=q)


@router.get("/api/parked-sales/{parked_id}", response_model=schemas.ParkedSale)
def get_parked_sale(parked_id: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    db_sale = crud.get_parked_sale(db, empresa_id=empresa_id, parked_id=parked_id)
    if not db_sale:
        raise HTTPException(status_code=404, detail="Parked sale not found")
    return db_sale


@router.post("/api/parked-sales", response_model=schemas.ParkedSale)
def create_parked_sale(sale: schemas.ParkedSaleCreate, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    try:
        return crud.create_parked_sale(db, empresa_id=empresa_id, sale=sale)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/api/parked-sales/{parked_id}/rename", response_model=schemas.ParkedSale)
def rename_parked_sale(parked_id: str, data: schemas.ParkedSaleRename, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    try:
        return crud.update_parked_sale_name(db, empresa_id=empresa_id, parked_id=parked_id, new_name=data.client_name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/api/parked-sales/delete-bulk")
def delete_parked_sales(data: List[str], db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    crud.delete_parked_sales(db, empresa_id=empresa_id, ids=data)
    return {"message": "Parked sales deleted successfully"}


@router.post("/api/parked-sales/transfer-bulk")
def transfer_parked_sales(data: schemas.ParkedSaleTransfer, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    crud.transfer_parked_sales(db, empresa_id=empresa_id, ids=data.account_ids, destination_branch=data.destination_branch)
    return {"message": "Parked sales transferred successfully"}


@router.post("/api/parked-sales/merge", response_model=schemas.ParkedSale)
def merge_parked_sales(data: schemas.ParkedSaleMerge, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    try:
        return crud.merge_parked_sales(db, empresa_id=empresa_id, ids=data.account_ids, new_client_name=data.new_client_name, seller=data.seller, branch=data.branch)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/parked-sales/{parked_id}/split")
def split_parked_sale(parked_id: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    try:
        crud.split_parked_sale(db, empresa_id=empresa_id, parked_id=parked_id)
        return {"message": "Master parked sale split back successfully"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/parked-sales/{parked_id}/split-merged")
def split_merged_parked_sale(parked_id: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    try:
        crud.split_merged_parked_sale(db, empresa_id=empresa_id, parked_id=parked_id)
        return {"message": "Merged parked sale split successfully"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/parked-sales/{parked_id}/comments", response_model=schemas.ParkedSaleComment)
def add_parked_sale_comment(parked_id: str, data: schemas.ParkedSaleCommentAdd, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    try:
        return crud.add_parked_sale_comment(db, empresa_id=empresa_id, parked_id=parked_id, author=data.author, comment_text=data.comment_text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Cotizaciones ─────────────────────────────────────────────────────────

@router.post("/api/quotes", response_model=schemas.Quote)
def create_quote(quote: schemas.QuoteCreate, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    try:
        return crud.create_quote(db, empresa_id=empresa_id, quote=quote)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/quotes", response_model=List[schemas.Quote])
def get_all_quotes(
    client_id: Optional[str] = None,
    client_name: Optional[str] = None,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    if client_id or client_name:
        return crud.get_filtered_quotes(db, empresa_id=empresa_id, client_id=client_id, client_name=client_name)
    # Bug pre-existente corregido al extraer (06-sep): main.py llamaba
    # crud.get_all_quotes(db) sin empresa_id -> 500 en /api/quotes sin filtro.
    return crud.get_all_quotes(db, empresa_id=empresa_id)


@router.get("/api/clients/{client_id}/quotes", response_model=List[schemas.Quote])
def get_client_quotes(client_id: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    return crud.get_client_quotes(db, empresa_id=empresa_id, client_id=client_id)


@router.get("/api/quotes/{quote_id}", response_model=schemas.Quote)
def get_quote(quote_id: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    db_quote = crud.get_quote(db, empresa_id=empresa_id, quote_id=quote_id)
    if not db_quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    return db_quote


@router.put("/api/quotes/{quote_id}/close", response_model=schemas.Quote)
def close_quote(quote_id: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    try:
        return crud.close_quote(db, empresa_id=empresa_id, quote_id=quote_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Cartera / Cuentas por Cobrar (CxC) ───────────────────────────────────

@router.get("/api/clients/{client_id}/ledger", response_model=List[schemas.CustomerCreditLedger])
def get_client_ledger(client_id: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    db_client = crud.get_client(db, empresa_id=empresa_id, client_id=client_id)
    if not db_client:
        raise HTTPException(status_code=404, detail="Client not found")
    return crud.get_client_ledger(db, empresa_id=empresa_id, client_id=client_id)


@router.get("/api/accounts-receivable/aging")
def ar_aging(
    sucursal_id: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None),
    as_of: Optional[str] = Query(None, description="Fecha de corte ISO (default: hoy)"),
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(role_guard([
        "ADMIN", "Administrador", "admin", "Gerente", "gerente",
        "Cajero", "CAJERO", "cajero", "vendedor_cajero",
    ])),
):
    """CP2 — reporte de antiguedad de saldos de la cartera.

    Reparte el saldo vivo de cada cliente en los cortes por_vencer / 1-30 /
    31-60 / 61-90 / 90+ segun `due_date` contra la fecha de corte.
    """
    _as_of = None
    if as_of:
        try:
            _as_of = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"as_of no es una fecha ISO valida: {as_of}")
    # Gerente hacia abajo ve solo su sede; el admin/dueno ve todo el tenant
    # salvo que pida una sede puntual (mismo criterio que el dashboard M-2).
    role = (payload.get("role") or "").strip().lower()
    if role not in ("admin", "administrador", "superadmin"):
        sucursal_id = payload.get("sucursal", "MATRIZ")
    try:
        return crud.get_ar_aging(db, empresa_id=empresa_id, sucursal_id=sucursal_id,
                                 client_id=client_id, as_of=_as_of)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/accounts-receivable")
def list_accounts_receivable(client_id: Optional[str] = None,
                             status: Optional[str] = Query(None, description="Pendiente|Liquidado"),
                             db: Session = Depends(get_db),
                             empresa_id: str = Depends(get_empresa_id)):
    """Cartera del tenant.

    CP2: la respuesta trae ya `client_name`, `sale_folio`, `due_date` y
    `anticipo_aplicado` — campos que la pantalla de Cuentas por Cobrar
    (`frontend/pages/admin/cuentas-cobrar.html`) ya pintaba pero que el
    backend nunca mandaba, por lo que la columna "Dias Vencido" salia
    siempre vacia.
    """
    rows = crud.get_accounts_receivable(db, empresa_id=empresa_id,
                                        client_id=client_id, status=status)
    # Nombres de cliente en un solo SELECT (sin N+1 sobre la cartera).
    nombres = {}
    ids = {r.client_id for r in rows}
    if ids:
        for cid, nombre in (db.query(models.Client.id, models.Client.name)
                              .filter(models.Client.empresa_id == empresa_id,
                                      models.Client.id.in_(ids)).all()):
            nombres[cid] = nombre
    out = []
    for r in rows:
        saldo = float(r.current_balance or 0)
        out.append({
            "id": r.id,
            "client_id": r.client_id,
            "client_name": nombres.get(r.client_id) or r.client_id,
            "sale_id": r.sale_id,
            "sale_folio": r.sale_folio,
            "original_amount": float(r.original_amount or 0),
            "anticipo_aplicado": float(r.anticipo_aplicado or 0),
            "current_balance": saldo,
            # amount_due/balance/amount: alias que consumen distintas vistas
            # del frontend (cxc.js y cuentas-cobrar.html no coinciden).
            "amount_due": saldo,
            "balance": saldo,
            "amount": saldo,
            "status": r.status,
            "is_paid": bool(r.is_paid),
            "sucursal_id": r.sucursal_id,
            "due_date": r.due_date.isoformat() if r.due_date else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return out


@router.get("/api/accounts-receivable/{ar_id}/payments", response_model=List[schemas.ARPayment])
def list_ar_payments(ar_id: str, db: Session = Depends(get_db),
                     empresa_id: str = Depends(get_empresa_id)):
    """CP2 — historial de abonos de una cuenta (estado de cuenta)."""
    if not crud.get_account_receivable(db, empresa_id, ar_id):
        raise HTTPException(status_code=404, detail="Cuenta por cobrar no encontrada")
    return crud.get_ar_payments(db, empresa_id=empresa_id, ar_id=ar_id)


@router.post("/api/accounts-receivable/{ar_id}/payments",
             response_model=schemas.ARPayment, status_code=201)
def create_ar_payment(ar_id: str, payment: schemas.ARPaymentCreate,
                      db: Session = Depends(get_db),
                      tenant: dict = Depends(get_tenant_context),
                      payload: dict = Depends(role_guard([
                          "ADMIN", "Administrador", "admin", "Gerente", "gerente",
                          "Cajero", "CAJERO", "cajero", "vendedor_cajero",
                      ]))):
    """CP2 — registra un abono con historial.

    `applied_from`: `efectivo` (caja), `saldo_favor` (se descuenta del saldo a
    favor del cliente) o `anticipo`. Valida sobrepago, liquida la cuenta al
    llegar a cero y genera el asiento contable del cobro.
    """
    empresa_id  = tenant["empresa"]
    sucursal_id = tenant.get("sucursal", "MATRIZ")
    quien       = payload.get("sub", "sistema")
    try:
        pago = crud.register_ar_payment(
            db, empresa_id, ar_id, payment.amount,
            method=payment.method, reference=payment.reference,
            applied_from=payment.applied_from, notes=payment.notes,
            created_by=quien, idempotency_key=payment.idempotency_key,
            sucursal_id=sucursal_id,
        )
    except ValueError as e:
        db.rollback()
        msg = str(e)
        # "no encontrado" es 404; el resto son reglas de negocio → 400.
        if "not found" in msg.lower() or "no encontrad" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except IntegrityError:
        # Carrera real con la misma idempotency_key: el UNIQUE la atrapa aqui.
        # No es error — es el reintento del mismo cobro.
        db.rollback()
        if payment.idempotency_key:
            prev = (db.query(models.AccountReceivablePayment)
                      .filter(models.AccountReceivablePayment.empresa_id == empresa_id,
                              models.AccountReceivablePayment.idempotency_key == payment.idempotency_key)
                      .first())
            if prev:
                return prev
        raise HTTPException(status_code=409, detail="Abono duplicado (idempotency conflict)")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    cuenta = crud.get_account_receivable(db, empresa_id, ar_id)
    liquidada = bool(cuenta and cuenta.status == "Liquidado")
    _audit(db, empresa_id, quien,
           f"{'AR_LIQUIDATED' if liquidada else 'AR_PAYMENT'}:{ar_id}",
           "INFO", sucursal_id,
           {"amount": float(payment.amount), "applied_from": payment.applied_from,
            "balance_after": float(pago.balance_after or 0)})
    return pago


@router.post("/api/accounts-receivable/{debt_id}/pay", response_model=schemas.AccountsReceivable)
def pay_debt(debt_id: str, payment: schemas.AccountsReceivablePayment,
             db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    """COMPAT — endpoint previo a CP2 (abono en efectivo, sin historial rico).

    Se conserva porque el frontend viejo lo llama; delega en el mismo
    `register_ar_payment` que el endpoint nuevo, asi que ya deja rastro en
    el historial de abonos. Preferir `POST .../payments`.
    """
    try:
        return crud.pay_account_receivable(db, empresa_id=empresa_id, debt_id=debt_id,
                                           payment_amount=payment.amount)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg.lower() or "no encontrad" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
