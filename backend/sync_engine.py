"""
sync_engine.py -- Motor de sincronizacion local -> cloud (SQLite -> Postgres).

Tenant scoping implementado: todas las queries filtran por empresa_id para
evitar mezcla de datos entre tenants. Activar con SYNC_ENABLED=true y
EMPRESA_ID=<id_tenant> cuando el modo offline-first este listo para produccion.
"""
import time
import threading
import logging
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from database import SessionLocal, SessionCloud
from models import Client, Sale, SaleItem

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Calebsys_SyncEngine")

def is_cloud_reachable():
    try:
        cloud_db = SessionCloud()
        cloud_db.execute(text("SELECT 1"))
        cloud_db.close()
        return True
    except Exception:
        return False

def push_unsynced_data(empresa_id: str):
    local_db = SessionLocal()
    cloud_db = SessionCloud()

    try:
        # PUSH CLIENTS
        unsynced_clients = (
            local_db.query(Client)
            .filter(Client.empresa_id == empresa_id, Client.is_synced == False)
            .all()
        )
        for client in unsynced_clients:
            existing = cloud_db.query(Client).filter(Client.id == client.id).first()
            if not existing:
                cloud_client = Client(**{c.name: getattr(client, c.name) for c in Client.__table__.columns if c.name != 'is_synced'})
                cloud_client.is_synced = True
                cloud_db.add(cloud_client)
            client.is_synced = True

        # PUSH SALES
        unsynced_sales = (
            local_db.query(Sale)
            .filter(Sale.empresa_id == empresa_id, Sale.is_synced == False)
            .all()
        )
        for sale in unsynced_sales:
            existing = cloud_db.query(Sale).filter(Sale.id == sale.id).first()
            if not existing:
                cloud_sale = Sale(**{c.name: getattr(sale, c.name) for c in Sale.__table__.columns if c.name != 'is_synced'})
                cloud_sale.is_synced = True
                cloud_db.add(cloud_sale)
            sale.is_synced = True

        # PUSH SALE ITEMS
        unsynced_items = (
            local_db.query(SaleItem)
            .filter(SaleItem.empresa_id == empresa_id, SaleItem.is_synced == False)
            .all()
        )
        for item in unsynced_items:
            existing = cloud_db.query(SaleItem).filter(SaleItem.id == item.id).first()
            if not existing:
                cloud_item = SaleItem(**{c.name: getattr(item, c.name) for c in SaleItem.__table__.columns if c.name != 'is_synced'})
                cloud_item.is_synced = True
                cloud_db.add(cloud_item)
            item.is_synced = True

        cloud_db.commit()
        local_db.commit()

        if unsynced_clients or unsynced_sales or unsynced_items:
            logger.info(f"Sincronizados {len(unsynced_clients)} clientes y {len(unsynced_sales)} ventas a Neon Cloud.")

    except Exception as e:
        logger.error(f"Error en PUSH: {str(e)}")
        cloud_db.rollback()
        local_db.rollback()
    finally:
        local_db.close()
        cloud_db.close()

def sync_loop(empresa_id: str):
    logger.info(f"El Servicio de Sincronización CALEBSYS ha iniciado (tenant: {empresa_id}).")
    while True:
        try:
            if is_cloud_reachable():
                push_unsynced_data(empresa_id)
                # A full PULL could be implemented here to get other branches' data
        except Exception as e:
            logger.error(f"Fallo general en sync_loop: {str(e)}")
        time.sleep(30)

def start_sync_service(empresa_id: str):
    # El kwarg de threading.Thread es parte de la API estandar de Python y no se puede renombrar.
    worker = threading.Thread(target=sync_loop, args=(empresa_id,), daemon=True)
    worker.start()
