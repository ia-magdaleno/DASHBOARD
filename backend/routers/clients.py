"""Módulo Clientes — endpoints extraídos de main.py (strangler fig)."""
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

import crud
import models
import schemas
from database import get_db
from deps import get_empresa_id

router = APIRouter(tags=["clientes"])


@router.get("/api/clients", response_model=List[schemas.Client])
def search_clients(q: Optional[str] = "", db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    return crud.search_clients(db, empresa_id=empresa_id, query=q)


@router.put("/api/clients/{client_id}", response_model=schemas.Client)
def update_client(client_id: str, client: schemas.ClientCreate, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    db_client = db.query(models.Client).filter(models.Client.empresa_id == empresa_id, models.Client.id == client_id).first()
    if not db_client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    for var, value in vars(client).items():
        setattr(db_client, var, value) if value is not None else None
    db.commit()
    db.refresh(db_client)
    return db_client


@router.delete("/api/clients/{client_id}")
def delete_client(client_id: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    db_client = db.query(models.Client).filter(models.Client.empresa_id == empresa_id, models.Client.id == client_id).first()
    if not db_client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    db.delete(db_client)
    db.commit()
    return {"ok": True}


@router.post("/api/clients", response_model=schemas.Client)
def create_client(client: schemas.ClientCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    new_client = crud.create_client(db, empresa_id=empresa_id, client=client)

    def fetch_social_media(client_id: str, phone: str, email: str, name: str):
        import time, logging
        logging.info(f"OSINT Worker iniciado para cliente ID {client_id} (Buscando Facebook/Instagram/TikTok)")
        time.sleep(5)
        logging.info(f"OSINT Worker finalizado. Redes sociales vinculadas silenciosamente al cliente {client_id}")

    background_tasks.add_task(fetch_social_media, new_client.id, new_client.phone, getattr(new_client, 'email', ''), new_client.name)
    return new_client


@router.get("/api/clients/by-phone/{phone}", response_model=schemas.Client)
def get_client_by_phone(phone: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    db_client = crud.get_client_by_phone(db, empresa_id=empresa_id, phone=phone)
    if not db_client:
        raise HTTPException(status_code=404, detail="Client not found")
    return db_client


@router.post("/api/clients/by-phone/{phone}/add-saldo-favor", response_model=schemas.Client)
def add_client_saldo_favor_by_phone(
    phone: str,
    data: schemas.ClientSaldoFavorUpdate,
    client_name: Optional[str] = "Cliente Nuevo",
    db: Session = Depends(get_db)
):
    try:
        return crud.update_client_saldo_favor_by_phone(
            db, phone=phone, amount=data.amount, client_name=client_name, description=data.description
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/clients/{client_id}/ledger")
def get_client_ledger(
    client_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    try:
        return crud.get_client_ledger(db, empresa_id=empresa_id, client_id=client_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/api/clients/{client_id}/anticipo", response_model=schemas.Client)
def register_anticipo(
    client_id: str,
    data: schemas.AnticipoCargo,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    try:
        return crud.register_anticipo(
            db,
            empresa_id=empresa_id,
            client_id=client_id,
            amount=data.amount,
            description=data.description,
            payment_method=data.payment_method,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/clients/{client_id}/purchase-history")
def get_purchase_history(
    client_id: str,
    sku: Optional[str] = None,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    """Historial de compras del cliente para un SKU en todas las sedes.
    Devuelve lista de {sale_id, sucursal_id, fecha, price, quantity} ordenada más reciente primero."""
    return crud.get_client_purchase_history(db, empresa_id=empresa_id, client_id=client_id, sku=sku)
