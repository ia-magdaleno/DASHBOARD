import os
import urllib.parse
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# --- Carga de Entorno ---
env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.env"))
load_dotenv(dotenv_path=env_path)

# ─── NODO LOCAL (Escritorio - Offline First) ───
LOCAL_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "calebsys_local.db"))
SQLALCHEMY_LOCAL_URL = f"sqlite:///{LOCAL_DB_PATH}"

engine_local = create_engine(
    SQLALCHEMY_LOCAL_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_local)

# ─── NODO CLOUD (Supabase PostgreSQL) ───
DB_USER = os.getenv("DB_USER", "postgres").strip().strip('"').strip("'")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password").strip().strip('"').strip("'")
DB_HOST = os.getenv("DB_HOST", "localhost").strip().strip('"').strip("'")
DB_PORT = os.getenv("DB_PORT", "5432").strip().strip('"').strip("'")
DB_NAME = os.getenv("DB_NAME", "calebsys_prod").strip().strip('"').strip("'")
# sslmode: "require" por defecto (Supabase/producción lo exige). Para Postgres
# local de desarrollo/demo (sin certificado SSL propio) se sobreescribe a
# "disable" via variable de entorno, sin tocar el default de producción.
DB_SSLMODE = os.getenv("DB_SSLMODE", "require").strip().strip('"').strip("'")

encoded_password = urllib.parse.quote_plus(DB_PASSWORD)
SQLALCHEMY_CLOUD_URL = f"postgresql://{DB_USER}:{encoded_password}@{DB_HOST}:{DB_PORT}/{DB_NAME}?sslmode={DB_SSLMODE}"

engine_cloud = create_engine(
    SQLALCHEMY_CLOUD_URL,
    pool_size=5,            
    max_overflow=10,         
    pool_timeout=30,         
    pool_recycle=1800,       
    pool_pre_ping=True       
)
SessionCloud = sessionmaker(autocommit=False, autoflush=False, bind=engine_cloud)

Base = declarative_base()

# ─── Selección de nodo activo ───────────────────────────────────────────────
# Por defecto el sistema opera contra la BD Local (velocidad + offline guarantee),
# pensado para el escritorio de cada sucursal.
# En despliegues sin disco persistente por sucursal (Docker/servidor central),
# se activa DEPLOYMENT_MODE=cloud en el entorno para que get_db() sirva
# directamente contra PostgreSQL (Supabase), sin depender de SQLite local.
DEPLOYMENT_MODE = os.getenv("DEPLOYMENT_MODE", "local").strip().strip('"').strip("'").lower()


def get_db():
    db = SessionCloud() if DEPLOYMENT_MODE == "cloud" else SessionLocal()
    try:
        yield db
    finally:
        db.close()
