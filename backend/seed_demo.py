"""
seed_demo.py — Datos mínimos para verificar el swap frontend de CALEBSYS.

Ejecutar dentro del contenedor:
  docker exec calebsys_pos python /app/backend/seed_demo.py

O desde el host (si DEPLOYMENT_MODE=cloud en .env):
  cd backend && python seed_demo.py

Crea:
  - Empresa: DEMO_CORP
  - Usuario admin:  admin / Admin123!
  - Usuario cajero: cajero / Cajero123!
  - Bodega MATRIZ
  - 8 productos (materiales de construcción, temática Antonio Magdaleno)
  - Stock inicial en MATRIZ para cada producto
  - Cliente genérico "Público en General"
"""

import os, sys, uuid, bcrypt
from decimal import Decimal

# ── Asegurar que el path del backend esté en sys.path ─────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(SCRIPT_DIR, "../.env"))

from database import engine_cloud, engine_local, Base, DEPLOYMENT_MODE
from sqlalchemy.orm import sessionmaker
import models

# ── Elegir engine según DEPLOYMENT_MODE ───────────────────────────────────
engine = engine_cloud if DEPLOYMENT_MODE == "cloud" else engine_local
Session = sessionmaker(bind=engine)

print(f"[seed] DEPLOYMENT_MODE = {DEPLOYMENT_MODE}")
print(f"[seed] Engine URL      = {str(engine.url)[:60]}...")

# ── Garantizar tablas ──────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)

# ── Constantes del tenant demo ─────────────────────────────────────────────
EMPRESA_ID  = "DEMO_CORP"
SUCURSAL_ID = "MATRIZ"

def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def _id() -> str:
    return str(uuid.uuid4())

# ── Seed ───────────────────────────────────────────────────────────────────
with Session() as db:

    # 1. Empresa
    exists = db.query(models.Company).filter(models.Company.id == EMPRESA_ID).first()
    if not exists:
        db.add(models.Company(
            id        = EMPRESA_ID,
            name      = "Maderas y Materiales Demo",
            rfc       = "MMD000101AAA",
            status    = "ACTIVE",
            plan_name = "CalebSys MVP",
        ))
        print("[seed] Company creada")
    else:
        print("[seed] Company ya existe — omitida")

    # 2. Usuarios — lista canónica (los que NO estén aquí se eliminan)
    USERS_REQUIRED = [
        ("admin",       "Admin123!",        "ADMIN"),
        ("almacenista", "Almacenista123!",  "ALMACENISTA"),
        ("vendedor",    "Vendedor123!",     "VENDEDOR"),
    ]
    required_usernames = {u[0] for u in USERS_REQUIRED}

    # Borrar usuarios que no estén en la lista
    to_delete = db.query(models.User).filter(
        models.User.empresa_id == EMPRESA_ID,
        models.User.username.notin_(required_usernames),
    ).all()
    for u in to_delete:
        db.delete(u)
        print(f"[seed] Usuario '{u.username}' ELIMINADO (no está en lista canónica)")

    # Crear o actualizar usuarios requeridos
    for username, password, role in USERS_REQUIRED:
        exists = db.query(models.User).filter(
            models.User.empresa_id == EMPRESA_ID,
            models.User.username   == username,
        ).first()
        if not exists:
            db.add(models.User(
                id              = _id(),
                empresa_id      = EMPRESA_ID,
                sucursal_id     = SUCURSAL_ID,
                username        = username,
                hashed_password = _hash(password),
                role            = role,
                status          = "ACTIVE",
            ))
            print(f"[seed] Usuario '{username}' ({role}) CREADO — password: {password}")
        else:
            # Sincronizar password y role por si cambiaron
            exists.hashed_password = _hash(password)
            exists.role   = role
            exists.status = "ACTIVE"
            print(f"[seed] Usuario '{username}' ({role}) ACTUALIZADO — password: {password}")

    # 3. Bodega MATRIZ
    bodega = db.query(models.Warehouse).filter(
        models.Warehouse.empresa_id == EMPRESA_ID,
        models.Warehouse.name       == "MATRIZ",
    ).first()
    if not bodega:
        bodega = models.Warehouse(
            id          = _id(),
            empresa_id  = EMPRESA_ID,
            sucursal_id = SUCURSAL_ID,
            name        = "MATRIZ",
            is_transit  = False,
        )
        db.add(bodega)
        db.flush()
        print(f"[seed] Bodega MATRIZ creada id={bodega.id}")
    else:
        print(f"[seed] Bodega MATRIZ ya existe id={bodega.id}")

    # 4. Productos (8 SKUs de materiales de construcción)
    PRODUCTS = [
        ("TABLON-2X4-8",  "7501000001", "Tablón 2x4x8 pies",            "PIEZA",  "PIEZA",  1, 95.00,  140.00,  50),
        ("TRIPLAY-12MM",  "7501000002", "Triplay 12mm 122x244cm",        "HOJA",   "HOJA",   1, 280.00, 420.00,  30),
        ("CEMENTO-50KG",  "7501000003", "Cemento Portland 50kg",         "COSTAL", "COSTAL", 1, 180.00, 210.00, 100),
        ("VARILLA-3/8",   "7501000004", "Varilla corrugada 3/8\" x 6m",  "PIEZA",  "PIEZA",  1,  75.00,  95.00,  80),
        ("CLAVO-2.5",     "7501000005", "Clavo de acero 2.5\" 1kg",      "KG",     "KG",     1,  35.00,  55.00, 200),
        ("BLOCK-15X20",   "7501000006", "Block de concreto 15x20x40cm",  "PIEZA",  "PIEZA",  1,  12.50,  18.00, 500),
        ("TABLA-1X6-8",   "7501000007", "Tabla 1x6x8 pies",              "PIEZA",  "PIEZA",  1,  55.00,  85.00,  60),
        ("GRAVA-M3",      "7501000008", "Grava triturada (por metro\u00b3)", "M3", "M3",     1, 350.00, 480.00,  20),
    ]

    product_ids = {}
    for sku, barcode, name, pu, su, cf, cost, price, qty in PRODUCTS:
        p = db.query(models.Product).filter(
            models.Product.empresa_id == EMPRESA_ID,
            models.Product.sku        == sku,
        ).first()
        if not p:
            p = models.Product(
                id                = _id(),
                empresa_id        = EMPRESA_ID,
                sucursal_id       = SUCURSAL_ID,
                sku               = sku,
                barcode           = barcode,
                name              = name,
                description       = name,
                purchase_unit     = pu,
                sale_unit         = su,
                conversion_factor = Decimal(str(cf)),
                average_cost      = Decimal(str(cost)),
                price             = Decimal(str(price)),
                stock             = Decimal(str(qty)),
            )
            db.add(p)
            db.flush()
            product_ids[sku] = p.id
            print(f"[seed]   Producto '{sku}' creado id={p.id}")
        else:
            product_ids[sku] = p.id
            print(f"[seed]   Producto '{sku}' ya existe — omitido")

    # 5. WarehouseStock
    for sku, barcode, name, pu, su, cf, cost, price, qty in PRODUCTS:
        pid = product_ids.get(sku)
        if not pid:
            continue
        ws = db.query(models.WarehouseStock).filter(
            models.WarehouseStock.empresa_id   == EMPRESA_ID,
            models.WarehouseStock.product_id   == pid,
            models.WarehouseStock.warehouse_id == bodega.id,
        ).first()
        if not ws:
            db.add(models.WarehouseStock(
                id           = _id(),
                empresa_id   = EMPRESA_ID,
                product_id   = pid,
                warehouse_id = bodega.id,
                quantity     = Decimal(str(qty)),
            ))
            print(f"[seed]   WarehouseStock '{sku}' qty={qty}")
        else:
            print(f"[seed]   WarehouseStock '{sku}' ya existe — omitido")

    # 6. Cliente "Público en General"
    cliente = db.query(models.Client).filter(
        models.Client.empresa_id == EMPRESA_ID,
        models.Client.phone      == "0000000000",
    ).first()
    if not cliente:
        db.add(models.Client(
            id             = _id(),
            empresa_id     = EMPRESA_ID,
            sucursal_id    = SUCURSAL_ID,
            name           = "Público en General",
            phone          = "0000000000",
            rfc            = "XAXX010101000",
            limite_credito = Decimal("0.00"),
            saldo_actual   = Decimal("0.00"),
        ))
        print("[seed] Cliente 'Público en General' creado")
    else:
        print("[seed] Cliente 'Público en General' ya existe — omitido")

    db.commit()

print()
print("=" * 60)
print("  SEED COMPLETO")
print("  URL:          http://localhost:8010")
print("  Admin:        empresa=DEMO_CORP  user=admin       pass=Admin123!")
print("  Cajero:       empresa=DEMO_CORP  user=cajero      pass=Cajero123!")
print("  Almacenista:  empresa=DEMO_CORP  user=almacenista pass=Almacen123!")
print("  Contador:     empresa=DEMO_CORP  user=contador    pass=Contador123!")
print("=" * 60)
