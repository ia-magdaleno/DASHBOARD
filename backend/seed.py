"""seed.py — Datos iniciales para demo/desarrollo local (SQLite).

Crea:
  - Tablas completas (Base.metadata.create_all)
  - Columna sucursal_id en tablas legacy si aún no existe
  - Usuario administrador (MAG-001 / admin / admin123)
  - Clientes demo con RFC completo para pruebas de CFDI (8 clientes)
  - Catálogo demo de materiales de construcción (8 productos)

Uso:
  cd backend
  python seed.py
"""
# ── Garantizar que el directorio de este archivo esté en sys.path ────────────
# Necesario cuando se invoca con Python embeddable (no agrega CWD a sys.path)
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# ─────────────────────────────────────────────────────────────────────────────

import uuid
from decimal import Decimal
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import engine_local as engine, SessionLocal, Base
from models import User, Product, Branch, Supplier, Client, Warehouse, WarehouseStock, ProductPriceScale
import passlib.hash

EMPRESA_ID  = "MAG-001"
SUCURSAL_ID = "MATRIZ"

# ── 1. Crear todas las tablas ────────────────────────────────────────────────
print("Creando tablas en la base de datos...")
Base.metadata.create_all(bind=engine)
print("Tablas OK.")

# ── 2. Columna sucursal_id en tablas legacy ──────────────────────────────────
TABLAS_LEGACY = [
    "products", "clients", "sales", "sale_items", "transfer_logs",
    "accounts_receivable", "safekept_items", "kardex_deliveries",
    "parked_sales", "parked_sale_items", "parked_sale_comments",
    "customer_credit_ledger", "quotes", "quote_items", "deliveries"
]

db: Session = SessionLocal()
try:
    for tabla in TABLAS_LEGACY:
        try:
            db.execute(text(
                f"ALTER TABLE {tabla} ADD COLUMN sucursal_id VARCHAR NOT NULL DEFAULT 'MATRIZ';"
            ))
            db.execute(text(
                f"CREATE INDEX ix_{tabla}_sucursal_id ON {tabla} (sucursal_id);"
            ))
            print(f"  sucursal_id agregada a {tabla}.")
        except Exception:
            db.rollback()   # columna ya existe o tabla no existe — ok

    db.commit()
    print("Columnas sucursal_id verificadas.")

    # ── 3. Usuarios Fase 1 — roles activos en esta fase ─────────────────────
    # Roles definidos:
    #   admin        — dueño/gerente general, ve TODAS las sucursales (sucursal_id="MATRIZ"
    #                  pero el backend lo trata con privilegio global por role=="admin")
    #   Gerente      — ve SOLO su sucursal; el sucursal_id en su JWT lo aísla automáticamente
    #   Vendedor     — genera la factura (POS), scoped a su sucursal
    #   Cajero       — cobra la factura (POS), scoped a su sucursal
    #   Almacenista  — módulo inventario/almacén, scoped a su sucursal
    #
    # Convención de nombres: <rol>_m = Matriz | <rol>_s2 = Sucursal 2
    # El sucursal_id queda grabado en el JWT al login → no hay selección manual de sede.
    # Roles fuera de alcance Fase 1 (NO incluir): Contador, Recursos Humanos
    SEED_USERS = [
        # (username,        password,        role,          sucursal_id)
        ("admin",           "admin123",      "admin",       "MATRIZ"),    # dueño — ve todo
        # ── Matriz (Maderas y Materiales Magdaleno) ──────────────────────────
        ("gerente_m",       "gerente123",    "Gerente",     "MATRIZ"),
        ("vendedor_m",      "vendedor123",   "Vendedor",    "MATRIZ"),
        ("cajero_m",        "cajero123",     "Cajero",      "MATRIZ"),
        ("almacenista_m",   "almacen123",    "Almacenista", "MATRIZ"),
        # ── Sucursal 2 (Maderas y Materiales Magdaleno 2) ───────────────────
        ("gerente_s2",      "gerente123",    "Gerente",     "SUC-MAG2"),
        ("vendedor_s2",     "vendedor123",   "Vendedor",    "SUC-MAG2"),
        ("cajero_s2",       "cajero123",     "Cajero",      "SUC-MAG2"),
        ("almacenista_s2",  "almacen123",    "Almacenista", "SUC-MAG2"),
    ]

    # Limpiar usuarios obsoletos de nombres anteriores (ejecuciones previas sin sufijo)
    USERNAMES_OBSOLETOS = ["gerente", "vendedor", "cajero", "almacenista"]
    obs_users = db.query(User).filter(
        User.empresa_id == EMPRESA_ID,
        User.username.in_(USERNAMES_OBSOLETOS),
    ).all()
    for u in obs_users:
        db.delete(u)
        print(f"  Usuario obsoleto eliminado: '{u.username}' ({u.role})")
    # Limpiar roles fuera de alcance Fase 1
    ROLES_FUERA_DE_FASE1 = ["Contador", "Recursos Humanos"]
    obsoletos = db.query(User).filter(
        User.empresa_id == EMPRESA_ID,
        User.role.in_(ROLES_FUERA_DE_FASE1),
    ).all()
    for u in obsoletos:
        db.delete(u)
        print(f"  Usuario '{u.username}' ({u.role}) ELIMINADO — fuera de alcance Fase 1.")
    if obs_users or obsoletos:
        db.commit()

    for username, password, role, suc_id in SEED_USERS:
        existing = db.query(User).filter(
            User.username   == username,
            User.empresa_id == EMPRESA_ID,
        ).first()
        if not existing:
            hashed_pw = passlib.hash.bcrypt.hash(password)
            db.add(User(
                id              = str(uuid.uuid4()),
                empresa_id      = EMPRESA_ID,
                sucursal_id     = suc_id,
                username        = username,
                hashed_password = hashed_pw,
                role            = role,
                status          = "ACTIVE",
            ))
            print(f"  Usuario '{username}' ({role}) creado — pass: {password}")
        else:
            print(f"  Usuario '{username}' ya existe — omitido.")

    db.commit()

    # ── 4. Sucursales demo ───────────────────────────────────────────────────
    DEMO_BRANCHES = [
        dict(id="MATRIZ",   name="Maderas y Materiales Magdaleno",
             address="CALLE Luis Donaldo Colosio MZ256 LT16",
             phone="(615) 157 2255", email="",
             is_main=True),
        dict(id="SUC-MAG2", name="Maderas y Materiales Magdaleno 2",
             address="Blvd. Emiliano Zapata (Col. Estado 30)",
             phone="(615) 121 0296", email="",
             is_main=False),
    ]
    desired_ids = {b["id"] for b in DEMO_BRANCHES}

    # Eliminar sucursales obsoletas (ejecuciones anteriores con datos distintos)
    obsolete = db.query(Branch).filter(
        Branch.empresa_id == EMPRESA_ID,
        Branch.id.notin_(desired_ids),
    ).all()
    for ob in obsolete:
        db.delete(ob)
        print(f"  Sucursal obsoleta eliminada: {ob.id} — {ob.name}")
    if obsolete:
        db.commit()

    # Upsert: actualizar si existe, insertar si no
    branches_upserted = 0
    for b in DEMO_BRANCHES:
        existing = db.query(Branch).filter(
            Branch.empresa_id == EMPRESA_ID,
            Branch.id == b["id"],
        ).first()
        if existing:
            existing.name    = b["name"]
            existing.address = b["address"]
            existing.phone   = b["phone"]
            existing.email   = b["email"]
            existing.is_main = b["is_main"]
            existing.status  = "ACTIVE"
        else:
            db.add(Branch(
                empresa_id = EMPRESA_ID,
                id         = b["id"],
                name       = b["name"],
                address    = b["address"],
                phone      = b["phone"],
                email      = b["email"],
                is_main    = b["is_main"],
                status     = "ACTIVE",
            ))
        branches_upserted += 1
    db.commit()
    print(f"  {branches_upserted} sucursal(es) sincronizadas (upsert).")

    # ── 5. Proveedores demo ──────────────────────────────────────────────────
    DEMO_SUPPLIERS = [
        dict(name="Cementos Guadalajara S.A. de C.V.",
             trade_name="CEMEX Distribuidor Autorizado",
             rfc="CGU830512HJ4",
             contact_name="Ing. Roberto Leal",
             phone="333-200-1111", email="ventas@cemgdl.com.mx",
             credit_days=30, credit_limit=Decimal("150000.00"),
             bank_account="012320001234567890",
             notes="Proveedor principal de cemento y concreto premezclado"),
        dict(name="Aceros del Bajío S.A. de C.V.",
             trade_name="ACERBAJ",
             rfc="ABA920315KL8",
             contact_name="Lic. Carmen Villaseñor",
             phone="333-200-2222", email="pedidos@acerbaj.mx",
             credit_days=15, credit_limit=Decimal("80000.00"),
             bank_account="014320009876543210",
             notes="Varilla, malla electrosoldada y perfiles de acero"),
        dict(name="Materiales y Áridos Jaliscienses S.A. de C.V.",
             trade_name="MAJAL",
             rfc="MAJ010820PP3",
             contact_name="Sr. Fortino Guzmán",
             phone="333-200-3333", email="fortino@majal.com.mx",
             credit_days=0, credit_limit=Decimal("0.00"),
             bank_account=None,
             notes="Arena, grava y material pétreo — pago de contado"),
        dict(name="Bloques y Ladrillos del Occidente S.A. de C.V.",
             trade_name="BLAOC",
             rfc="BLO980714RT5",
             contact_name="Sra. Patricia Moreno",
             phone="333-200-4444", email="ventas@blaoc.mx",
             credit_days=8, credit_limit=Decimal("40000.00"),
             bank_account="021320007654321098",
             notes="Block de concreto, ladrillo y tabique"),
    ]
    existing_rfcs = {s.rfc for s in
                     db.query(Supplier.rfc).filter(Supplier.empresa_id == EMPRESA_ID).all()}
    suppliers_added = 0
    for s in DEMO_SUPPLIERS:
        if s["rfc"] not in existing_rfcs:
            db.add(Supplier(
                id           = str(uuid.uuid4()),
                empresa_id   = EMPRESA_ID,
                sucursal_id  = None,          # global para todas las sucursales
                name         = s["name"],
                trade_name   = s["trade_name"],
                rfc          = s["rfc"],
                contact_name = s["contact_name"],
                phone        = s["phone"],
                email        = s["email"],
                credit_days  = s["credit_days"],
                credit_limit = s["credit_limit"],
                bank_account = s["bank_account"],
                notes        = s["notes"],
                status       = "ACTIVE",
            ))
            suppliers_added += 1
    db.commit()
    print(f"  {suppliers_added} proveedor(es) demo agregado(s)." if suppliers_added
          else "  Proveedores demo ya existían.")

    # ── 6. Clientes demo con RFC para pruebas de CFDI ───────────────────────
    # Escenarios cubiertos:
    #   PF  — Persona Física actividades empresariales (régimen 612)
    #   PF  — Persona Física con sueldos (régimen 605) — común en constructoras
    #   PM  — Persona Moral régimen general (601)
    #   PM  — Persona Moral sin fines de lucro (603)
    #   RESICO — PF Régimen Simplificado de Confianza (625)
    #   Sin RFC — Público general (XAXX010101000, CFDI Global)
    DEMO_CLIENTS = [
        # ── Personas Físicas ─────────────────────────────────────────────────
        dict(
            name="Jorge Armando Rivas Castellanos",
            client_type="Persona Física",
            client_code="CLI-001",
            rfc="RICJ850312HJ5",
            regimen_fiscal="612",          # PF actividades empresariales
            uso_cfdi="G03",                # Gastos en general
            cp="44100",
            direccion="Av. Chapultepec 1234",
            colonia="Americana",
            ciudad="Guadalajara",
            municipio="Guadalajara",
            estado="Jalisco",
            pais="México",
            phone="333-410-2200",
            email="jrivas@construfast.mx",
            limite_credito=Decimal("30000.00"),
            dias_credito=30,
        ),
        dict(
            name="María Fernanda Ochoa Villanueva",
            client_type="Persona Física",
            client_code="CLI-002",
            rfc="OOVM920718MK3",
            regimen_fiscal="605",          # Sueldos y salarios
            uso_cfdi="D10",                # Pagos por servicios educativos
            cp="45040",
            direccion="Calle Roble 78",
            colonia="Residencial Miraflores",
            ciudad="Zapopan",
            municipio="Zapopan",
            estado="Jalisco",
            pais="México",
            phone="333-920-5511",
            email="mfochoa@gmail.com",
            limite_credito=Decimal("0.00"),
            dias_credito=0,
        ),
        dict(
            name="Carlos Ibáñez Fuentes",
            client_type="Persona Física",
            client_code="CLI-003",
            rfc="IAFC780905NP8",
            regimen_fiscal="625",          # RESICO
            uso_cfdi="G01",                # Adquisición de mercancias
            cp="28000",
            direccion="Blvd. Costero 550",
            colonia="Los Fresnos",
            ciudad="Colima",
            municipio="Colima",
            estado="Colima",
            pais="México",
            phone="312-100-8800",
            email="carlosif@hotmail.com",
            limite_credito=Decimal("15000.00"),
            dias_credito=15,
        ),
        dict(
            name="Ana Lucía Mendoza Paredes",
            client_type="Persona Física",
            client_code="CLI-004",
            rfc="MEPA950210LR2",
            regimen_fiscal="612",
            uso_cfdi="G03",
            cp="44200",
            direccion="Priv. Lomas Verdes 12",
            colonia="Lomas del Country",
            ciudad="Guadalajara",
            municipio="Guadalajara",
            estado="Jalisco",
            pais="México",
            phone="333-501-7700",
            email="almendoza@arquimex.com.mx",
            limite_credito=Decimal("50000.00"),
            dias_credito=30,
        ),
        # ── Personas Morales ─────────────────────────────────────────────────
        dict(
            name="Constructora Noreste S.A. de C.V.",
            client_type="Persona Moral",
            client_code="CLI-005",
            rfc="CNO010315KP4",
            regimen_fiscal="601",          # Régimen general PM
            uso_cfdi="G01",
            cp="64000",
            direccion="Av. Constitución 800",
            colonia="Centro",
            ciudad="Monterrey",
            municipio="Monterrey",
            estado="Nuevo León",
            pais="México",
            phone="818-200-4400",
            email="compras@constructoranoreste.mx",
            limite_credito=Decimal("200000.00"),
            dias_credito=45,
        ),
        dict(
            name="Desarrollos Habitacionales del Pacífico S.A. de C.V.",
            client_type="Persona Moral",
            client_code="CLI-006",
            rfc="DHP991120RQ7",
            regimen_fiscal="601",
            uso_cfdi="G01",
            cp="82000",
            direccion="Blvd. Sinaloa 400",
            colonia="Guadalupe",
            ciudad="Culiacán",
            municipio="Culiacán",
            estado="Sinaloa",
            pais="México",
            phone="667-715-3300",
            email="pagos@dhpacifico.mx",
            limite_credito=Decimal("350000.00"),
            dias_credito=60,
        ),
        dict(
            name="Instituto de Formación Comunitaria A.C.",
            client_type="Persona Moral",
            client_code="CLI-007",
            rfc="IFC030620SS1",
            regimen_fiscal="603",          # PM sin fines de lucro
            uso_cfdi="D05",                # Intereses reales hipotecarios
            cp="44600",
            direccion="Calle Hidalgo 230",
            colonia="Analco",
            ciudad="Guadalajara",
            municipio="Guadalajara",
            estado="Jalisco",
            pais="México",
            phone="333-614-9900",
            email="administracion@ifc.org.mx",
            limite_credito=Decimal("0.00"),
            dias_credito=0,
        ),
        # ── Público en General (CFDI Global) ─────────────────────────────────
        dict(
            name="Público en General",
            client_type="Público General",
            client_code="CLI-PG",
            rfc="XAXX010101000",
            regimen_fiscal="616",          # Sin obligaciones fiscales
            uso_cfdi="S01",                # Sin efectos fiscales
            cp="00000",
            direccion=None,
            colonia=None,
            ciudad=None,
            municipio=None,
            estado=None,
            pais="México",
            phone=None,
            email=None,
            limite_credito=Decimal("0.00"),
            dias_credito=0,
        ),
    ]

    existing_client_rfcs = {
        c.rfc for c in db.query(Client.rfc).filter(Client.empresa_id == EMPRESA_ID).all()
        if c.rfc
    }
    clients_added = 0
    for cl in DEMO_CLIENTS:
        if cl["rfc"] not in existing_client_rfcs:
            db.add(Client(
                id             = str(uuid.uuid4()),
                empresa_id     = EMPRESA_ID,
                sucursal_id    = SUCURSAL_ID,
                name           = cl["name"],
                client_type    = cl["client_type"],
                client_code    = cl.get("client_code"),
                rfc            = cl["rfc"],
                regimen_fiscal = cl.get("regimen_fiscal"),
                cp             = cl.get("cp"),
                direccion      = cl.get("direccion"),
                colonia        = cl.get("colonia"),
                ciudad         = cl.get("ciudad"),
                municipio      = cl.get("municipio"),
                estado         = cl.get("estado"),
                pais           = cl.get("pais"),
                phone          = cl.get("phone"),
                email          = cl.get("email"),
                limite_credito = cl.get("limite_credito", Decimal("0.00")),
                dias_credito   = cl.get("dias_credito", 0),
                saldo_favor    = Decimal("0.00"),
                saldo_actual   = Decimal("0.00"),
                puntos         = 0,
                resguardos     = False,
                apartados      = Decimal("0.00"),
                ultima_compra  = "S/N",
                is_synced      = False,
            ))
            clients_added += 1
    db.commit()
    print(f"  {clients_added} cliente(s) demo agregado(s)." if clients_added
          else "  Clientes demo ya existían.")

    # ── 7. Catálogo demo — materiales de construcción ────────────────────────
    existing_skus = {p.sku for p in
                     db.query(Product.sku)
                       .filter(Product.empresa_id == EMPRESA_ID).all()}

    DEMO_PRODUCTS = [
        dict(sku="CEM-50K",   name="Cemento gris 50 kg",
             description="Bolsa de cemento Portland tipo I",
             purchase_unit="BOLSA", sale_unit="BOLSA",
             average_cost=Decimal("185.00"), price=Decimal("220.00"), stock=Decimal("150")),
        dict(sku="VAR-3/8",   name='Varilla corrugada 3/8"',
             description='Varilla de acero corrugado 3/8" x 12 m',
             purchase_unit="PIEZA", sale_unit="PIEZA",
             average_cost=Decimal("95.00"),  price=Decimal("115.00"), stock=Decimal("200")),
        dict(sku="BLO-15X20", name="Block de concreto 15x20x40",
             description="Block hueco estándar para muros",
             purchase_unit="PIEZA", sale_unit="PIEZA",
             average_cost=Decimal("9.50"),   price=Decimal("12.00"),  stock=Decimal("500")),
        dict(sku="ARN-M3",    name="Arena fina m³",
             description="Arena lavada para mezcla de mortero",
             purchase_unit="M3",   sale_unit="M3",
             average_cost=Decimal("320.00"), price=Decimal("400.00"), stock=Decimal("30")),
        dict(sku="GRA-M3",    name='Grava 3/4" m³',
             description='Grava triturada 3/4" para concreto',
             purchase_unit="M3",   sale_unit="M3",
             average_cost=Decimal("350.00"), price=Decimal("430.00"), stock=Decimal("25")),
        dict(sku="LAD-6P",    name="Ladrillo rojo 6 perforaciones",
             description="Ladrillo de barro cocido 6x12x24 cm",
             purchase_unit="MILLAR", sale_unit="PIEZA",
             conversion_factor=Decimal("1000"),
             average_cost=Decimal("4.50"),   price=Decimal("6.00"),   stock=Decimal("2000")),
        dict(sku="TUB-4PVC",  name='Tubo PVC hidráulico 4"',
             description='Tubo PVC presión 4" x 6 m',
             purchase_unit="PIEZA", sale_unit="PIEZA",
             average_cost=Decimal("210.00"), price=Decimal("265.00"), stock=Decimal("40")),
        dict(sku="YES-20K",   name="Yeso blanco 20 kg",
             description="Saco de yeso para aplanados interiores",
             purchase_unit="SACO",  sale_unit="SACO",
             average_cost=Decimal("68.00"),  price=Decimal("85.00"),  stock=Decimal("60")),
    ]

    added = 0
    for p in DEMO_PRODUCTS:
        if p["sku"] not in existing_skus:
            db.add(Product(
                id                = str(uuid.uuid4()),
                empresa_id        = EMPRESA_ID,
                sucursal_id       = SUCURSAL_ID,
                sku               = p["sku"],
                name              = p["name"],
                description       = p["description"],
                purchase_unit     = p["purchase_unit"],
                sale_unit         = p["sale_unit"],
                conversion_factor = p.get("conversion_factor", Decimal("1.0000")),
                average_cost      = p["average_cost"],
                price             = p["price"],
                stock             = p["stock"],
                is_synced         = False,
            ))
            added += 1

    db.commit()
    if added:
        print(f"  {added} productos demo agregados al catálogo.")
    else:
        print("  Catálogo demo ya existía, sin cambios.")

    # ── 8. Bodegas y stock inicial ───────────────────────────────────────────
    DEMO_WAREHOUSES = [
        dict(id="WH-MAT", sucursal_id="MATRIZ",   name="Bodega Principal Matriz"),
        dict(id="WH-S2",  sucursal_id="SUC-MAG2", name="Bodega Principal Sucursal 2"),
    ]

    wh_upserted = 0
    for w in DEMO_WAREHOUSES:
        existing_wh = db.query(Warehouse).filter(
            Warehouse.empresa_id == EMPRESA_ID,
            Warehouse.id         == w["id"],
        ).first()
        if existing_wh:
            existing_wh.name = w["name"]
        else:
            db.add(Warehouse(
                id          = w["id"],
                empresa_id  = EMPRESA_ID,
                sucursal_id = w["sucursal_id"],
                name        = w["name"],
            ))
        wh_upserted += 1
    db.commit()
    print(f"  {wh_upserted} bodega(s) sincronizadas.")

    # Stock inicial: todos los productos en la bodega de la Matriz
    # WarehouseStock usa product_id (UUID), no product_sku
    all_products = db.query(Product).filter(Product.empresa_id == EMPRESA_ID).all()
    stock_created = 0
    for wh in DEMO_WAREHOUSES:
        qty_base = Decimal("0") if wh["sucursal_id"] == "SUC-MAG2" else None  # Matriz usa stock del producto
        for prod in all_products:
            existing_stock = db.query(WarehouseStock).filter(
                WarehouseStock.empresa_id   == EMPRESA_ID,
                WarehouseStock.warehouse_id == wh["id"],
                WarehouseStock.product_id   == prod.id,
            ).first()
            if not existing_stock:
                qty = qty_base if qty_base is not None else prod.stock
                db.add(WarehouseStock(
                    id           = str(uuid.uuid4()),
                    empresa_id   = EMPRESA_ID,
                    warehouse_id = wh["id"],
                    product_id   = prod.id,
                    quantity     = qty,
                ))
                stock_created += 1
    db.commit()
    print(f"  {stock_created} registro(s) de stock inicial creados.")

    # ── 9. Escalas de precio por producto (NR-03) ────────────────────────────
    # scale_name debe coincidir exactamente con los data-scale del POS HTML:
    #   "Público General" | "Contratista" | "Distribuidor" | "Gobierno"
    # Márgenes de referencia Maderas y Materiales Magdaleno (ajustar por negocio):
    #   Público General : precio base (100%)
    #   Contratista     : ~10% descuento sobre precio público
    #   Distribuidor    : ~15% descuento sobre precio público
    #   Gobierno        : precio público (licitación maneja descuentos fuera del sistema)

    # Escalas por producto: (sku, scale_name, precio)
    fresh_products = {p.sku: p for p in
                      db.query(Product).filter(Product.empresa_id == EMPRESA_ID).all()}

    PRICE_SCALE_DATA = []
    for sku, prod in fresh_products.items():
        base = float(prod.price)
        PRICE_SCALE_DATA += [
            dict(product_id=prod.id, scale_name="Público General",
                 margin=Decimal("0.0000"), price=Decimal(str(round(base, 4)))),
            dict(product_id=prod.id, scale_name="Contratista",
                 margin=Decimal("-10.0000"), price=Decimal(str(round(base * 0.90, 4)))),
            dict(product_id=prod.id, scale_name="Distribuidor",
                 margin=Decimal("-15.0000"), price=Decimal(str(round(base * 0.85, 4)))),
            dict(product_id=prod.id, scale_name="Gobierno",
                 margin=Decimal("0.0000"),  price=Decimal(str(round(base, 4)))),
        ]

    scales_added = 0
    for entry in PRICE_SCALE_DATA:
        exists = db.query(ProductPriceScale).filter(
            ProductPriceScale.empresa_id  == EMPRESA_ID,
            ProductPriceScale.product_id  == entry["product_id"],
            ProductPriceScale.scale_name  == entry["scale_name"],
        ).first()
        if not exists:
            db.add(ProductPriceScale(
                id         = str(uuid.uuid4()),
                empresa_id = EMPRESA_ID,
                product_id = entry["product_id"],
                scale_name = entry["scale_name"],
                margin     = entry["margin"],
                price      = entry["price"],
            ))
            scales_added += 1
    db.commit()
    if scales_added:
        print(f"  {scales_added} escala(s) de precio agregadas (NR-03).")
    else:
        print("  Escalas de precio ya existían, sin cambios (NR-03).")

except Exception as e:
    db.rollback()
    print(f"Error durante el seeding: {e}")
    raise
finally:
    db.close()

print("\n✓ Base de datos lista.")
print(f"  Empresa  : {EMPRESA_ID}")
print(f"  Puerto   : http://127.0.0.1:8010/login")
print()
print("  USUARIOS FASE 1 (empresa: MAG-001):")
print("  ┌──────────────────┬──────────────────┬──────────────┬─────────────────────────────────────┐")
print("  │ Username         │ Password         │ Sucursal     │ Acceso                              │")
print("  ├──────────────────┼──────────────────┼──────────────┼─────────────────────────────────────┤")
print("  │ admin            │ admin123         │ (todas)      │ /os — dueño, ve todo                │")
print("  ├──────────────────┼──────────────────┼──────────────┼─────────────────────────────────────┤")
print("  │ gerente_m        │ gerente123       │ MATRIZ       │ /os — su sucursal, read-only        │")
print("  │ vendedor_m       │ vendedor123      │ MATRIZ       │ /   — POS: genera factura           │")
print("  │ cajero_m         │ cajero123        │ MATRIZ       │ /   — POS: cobra factura            │")
print("  │ almacenista_m    │ almacen123       │ MATRIZ       │ /admin_shell.html#inventario        │")
print("  ├──────────────────┼──────────────────┼──────────────┼─────────────────────────────────────┤")
print("  │ gerente_s2       │ gerente123       │ SUC-MAG2     │ /os — su sucursal, read-only        │")
print("  │ vendedor_s2      │ vendedor123      │ SUC-MAG2     │ /   — POS: genera factura           │")
print("  │ cajero_s2        │ cajero123        │ SUC-MAG2     │ /   — POS: cobra factura            │")
print("  │ almacenista_s2   │ almacen123       │ SUC-MAG2     │ /admin_shell.html#inventario        │")
print("  └──────────────────┴──────────────────┴──────────────┴─────────────────────────────────────┘")
