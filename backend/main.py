from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File as FastAPIFile, BackgroundTasks
import io
import re
from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response, Cookie
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date, text, case
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import datetime, date, timedelta, timezone
import os
from dotenv import load_dotenv
load_dotenv()  # carga .env desde el directorio raíz del proyecto
import jwt
import passlib.hash
import bcrypt as _bcrypt_native
import pdfplumber
from contextlib import asynccontextmanager

import models
import schemas
import crud
from database import engine_local, get_db
from sync_engine import start_sync_service
import logging as _logging_main
import uuid as _uuid
_log_main = _logging_main.getLogger("calebsys.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    env             = (os.environ.get("APP_ENV") or os.environ.get("ENV", "development")).lower()
    deployment_mode = os.environ.get("DEPLOYMENT_MODE", "local").lower()

    # En modo local/demo no necesitamos Redis ni el servicio de sincronización:
    # no hay PostgreSQL externo al que sincronizar y el rate-limiting
    # no aplica en mostrador de un solo usuario.
    if deployment_mode == "local":
        redis_client = None
        import logging as _logging
        _logging.getLogger("calebsys").info(
            "[INFO] DEPLOYMENT_MODE=local — Redis y servicio de sincronización desactivados (demo/offline)."
        )
        yield
        return

    # Modo cloud: intenta Redis y evalua el servicio de sincronización
    import logging as _logging
    _log = _logging.getLogger("calebsys")
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    try:
        import redis.asyncio as aioredis
        redis_client = aioredis.from_url(redis_url, encoding="utf-8", decode_responses=True)
        await redis_client.ping()  # from_url es lazy: forzamos el handshake real
        _log.info("[INFO] Redis conectado — rate limiting activo.")
    except Exception as e:
        redis_client = None
        if env == "production":
            _log.critical(
                f"[CRITICO] Redis no disponible en ENV=production. Rate limiting DESACTIVADO. Error: {e}"
            )
        else:
            _log.warning(
                f"[WARNING] Redis no disponible (ENV={env}). Rate limiting desactivado localmente."
            )
    # Servicio de sincronización local -> cloud.
    # Solo tiene sentido donde exista un SQLite local con datos que empujar.
    # En Render (filesystem efimero + get_db() apuntando a PostgreSQL) el nodo
    # local siempre esta vacio, asi que el ciclo correria en vacio cada 30s.
    # SYNC_ENABLED=true lo reactiva sin tocar codigo.
    if os.getenv("SYNC_ENABLED", "false").strip().lower() in ("1", "true", "yes"):
        _empresa_sync = os.getenv("EMPRESA_ID", "").strip()
        if _empresa_sync:
            start_sync_service(_empresa_sync)
        else:
            import logging as _logging_sync
            _logging_sync.getLogger("calebsys").warning(
                "[SYNC] SYNC_ENABLED=true pero EMPRESA_ID no configurado — sync no iniciado."
            )
    else:
        import logging as _logging
        _logging.getLogger("calebsys").info(
            "[INFO] Servicio de sincronización desactivado (SYNC_ENABLED no activo)."
        )
    yield
    if redis_client:
        await redis_client.close()

# Crea las tablas del nodo local SOLO cuando ese nodo se usa realmente.
# En DEPLOYMENT_MODE=cloud get_db() sirve contra PostgreSQL, y el filesystem
# es efimero (Render), asi que el SQLite seria un archivo vacio descartable.
if os.getenv("DEPLOYMENT_MODE", "local").strip().strip('"').strip("'").lower() != "cloud":
    models.Base.metadata.create_all(bind=engine_local)


def _sqlite_ensure_all_model_columns() -> None:
    """Garantiza que todas las columnas definidas en models.Base existan en el
    SQLite local, vincula ColumnDefault en Python para columnas con server_default
    (evita IntegrityError NOT NULL cuando SQLite carece de DEFAULT en la tabla legacy)
    y rellena NULLs existentes."""
    try:
        from datetime import datetime as _dt, timezone as _tz
        from decimal import Decimal as _Dec
        from sqlalchemy.schema import ColumnDefault as _ColDefault
        from sqlalchemy import Boolean as _SABool, Integer as _SAInt, Numeric as _SANum, Float as _SAFloat, DateTime as _SADt

        for _tname, _table in models.Base.metadata.tables.items():
            for _col in _table.columns:
                if _col.default is None and _col.server_default is not None:
                    _arg = _col.server_default.arg
                    _ctype = _col.type
                    if hasattr(_arg, "name") and str(getattr(_arg, "name", "")).lower() in ("now", "current_timestamp"):
                        _py_def = _ColDefault(lambda: _dt.now(_tz.utc))
                    elif isinstance(_ctype, _SABool):
                        _s = str(_arg).strip("'\"").lower()
                        _py_def = _ColDefault(_s in ("true", "1", "t", "yes"))
                    elif isinstance(_ctype, _SAInt):
                        try:
                            _py_def = _ColDefault(int(str(_arg).strip("'\"")))
                        except Exception:
                            _py_def = _ColDefault(0)
                    elif isinstance(_ctype, (_SANum, _SAFloat)):
                        try:
                            _py_def = _ColDefault(_Dec(str(_arg).strip("'\"")))
                        except Exception:
                            _py_def = _ColDefault(_Dec("0"))
                    elif isinstance(_ctype, _SADt):
                        _py_def = _ColDefault(lambda: _dt.now(_tz.utc))
                    else:
                        _py_def = _ColDefault(str(_arg).strip("'\""))
                    _col.default = _py_def
                    _py_def._set_parent_with_dispatch(_col)

        if engine_local.dialect.name != "sqlite":
            return
        from sqlalchemy import inspect as _sa_inspect, text as _sa_text
        insp = _sa_inspect(engine_local)
        existing_tables = set(insp.get_table_names())
        with engine_local.begin() as conn:
            for tname, table in models.Base.metadata.tables.items():
                if tname not in existing_tables:
                    continue
                existing_cols = {c["name"] for c in insp.get_columns(tname)}
                for col in table.columns:
                    if col.name not in existing_cols:
                        col_type = col.type.compile(dialect=engine_local.dialect)
                        conn.exec_driver_sql(f'ALTER TABLE "{tname}" ADD COLUMN "{col.name}" {col_type}')
                    if col.server_default is not None:
                        arg = col.server_default.arg
                        ctype = col.type
                        if hasattr(arg, "name") and str(getattr(arg, "name", "")).lower() in ("now", "current_timestamp"):
                            val = _dt.now(_tz.utc).isoformat()
                        elif isinstance(ctype, _SABool):
                            s = str(arg).strip("'\"").lower()
                            val = 1 if s in ("true", "1", "t", "yes") else 0
                        elif isinstance(ctype, _SAInt):
                            try:
                                val = int(str(arg).strip("'\""))
                            except Exception:
                                val = 0
                        elif isinstance(ctype, (_SANum, _SAFloat)):
                            try:
                                val = float(str(arg).strip("'\""))
                            except Exception:
                                val = 0.0
                        else:
                            val = str(arg).strip("'\"")
                        conn.execute(
                            _sa_text(f'UPDATE "{tname}" SET "{col.name}" = :v WHERE "{col.name}" IS NULL'),
                            {"v": val},
                        )
    except Exception as _e:
        import logging as _lg
        _lg.getLogger("calebsys").warning("[SQLite] ensure model cols: %s", _e)


_sqlite_ensure_all_model_columns()


def _sqlite_ensure_safekept_columns() -> None:
    """SQLite local: create_all() no hace ALTER. Añade en caliente las columnas
    de D.1 a safekept_items si faltan. En Postgres esto lo hace la migración
    Alembic d1a2b3c4e5f6."""
    try:
        if engine_local.dialect.name != "sqlite":
            return
        from sqlalchemy import text as _sql_text
        wanted = {
            "origen":         "TEXT NOT NULL DEFAULT 'sin_stock'",
            "costo_estimado": "NUMERIC",
            "eta_date":       "TEXT",
            "expira_at":      "DATETIME",
        }
        with engine_local.begin() as conn:
            have = {r[1] for r in conn.execute(_sql_text("PRAGMA table_info(safekept_items)"))}
            if not have:
                return  # la tabla aún no existe; create_all la hará con el modelo nuevo
            for col, ddl in wanted.items():
                if col not in have:
                    conn.execute(_sql_text(f"ALTER TABLE safekept_items ADD COLUMN {col} {ddl}"))
    except Exception as _e:  # nunca tumbar el arranque por esto
        import logging as _lg
        _lg.getLogger("calebsys").warning("[D.1] ensure safekept cols: %s", _e)


_sqlite_ensure_safekept_columns()

try:
    import payables_tracking as _ap_track
    _ap_track.ensure_ap_columns(engine_local)
except Exception as _e:  # nunca tumbar el arranque por esto
    import logging as _lg
    _lg.getLogger("calebsys").warning("[CxP] ensure columns: %s", _e)

app = FastAPI(title="CALEBSYS POS API", lifespan=lifespan)

# CORS: lista explícita de orígenes permitidos.
# allow_origin_regex=".*" + allow_credentials=True es la combinación que
# las guías de seguridad de FastAPI marcan como insegura (abre robo de
# sesión desde sitios de terceros). Se reemplaza por lista controlada.
# Para agregar un dominio nuevo: añadirlo aquí y en CORS_ORIGINS del .env.
_cors_env = os.environ.get("CORS_ORIGINS", "")
_cors_allowed = [o.strip() for o in _cors_env.split(",") if o.strip()]
if not _cors_allowed:
    # Fallback seguro para desarrollo local — nunca un comodín con credentials
    _cors_allowed = [
        "http://localhost:8000",
        "http://localhost:8010",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8010",
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allowed,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Idempotency-Key"],
)

# --- Hotfix: Escudos de Seguridad (Fase 4.0) ---
RATE_LIMIT_SECONDS = 60
MAX_REQUESTS_PER_MINUTE = 100
redis_client = None

@app.middleware("http")
async def security_and_rate_limiting_middleware(request: Request, call_next):
    # 1. Rate Limiting de Emergencia (Redis)
    client_ip = request.client.host if request.client else "127.0.0.1"
    
    if redis_client:
        try:
            key = f"rate_limit:{client_ip}"
            requests = await redis_client.incr(key)
            if requests == 1:
                await redis_client.expire(key, RATE_LIMIT_SECONDS)
            if requests > MAX_REQUESTS_PER_MINUTE:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too Many Requests. Rate limit exceeded."},
                    headers={"Retry-After": "60"}
                )
        except Exception:
            # Redis caído a mitad de vuelo → degradar a sin rate-limit,
            # nunca tumbar la petición con un 500.
            pass
    
    # Process request
    response = await call_next(request)
    
    # 2. CSP y Mitigación XSS
    # script-src 'self' — sin 'unsafe-inline': los on* attrs se migran a data-click/
    # data-input/data-submit y los <script> inline de admin a scripts/admin/page-inits.js.
    # style-src mantiene 'unsafe-inline' (riesgo bajo; CSS no ejecuta JS).
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self' blob: data:; object-src 'self' blob: data:; base-uri 'none'; form-action 'self'; frame-ancestors 'self';"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"

    # 3. Piloto: evitar que el navegador cachee JS/CSS del frontend.
    # StaticFiles (mount en "/") no manda Cache-Control por defecto, y ya
    # causo 3 veces confusion de "el fix no funciona" cuando en realidad
    # el navegador seguia corriendo una copia vieja del .js. /login ya
    # tenia este mismo tratamiento; esto lo extiende a /scripts y /styles.
    path = request.url.path
    if path.startswith(("/scripts/", "/styles/", "/pages/")) or path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    return response

# --- API Endpoints ---

# ── JWT + guards de tenant/rol: viven en deps.py (importable sin ciclo) ──────
# Se mantienen en el namespace de main por compatibilidad (tests y llamadas
# internas hacen `from main import get_db`, `main.get_tenant_context`, etc.).
from deps import (  # noqa: E402
    JWT_SECRET,
    JWT_ALGORITHM,
    JWT_EXPIRATION_HOURS,
    get_tenant_context,
    get_empresa_id,
    role_guard,
    require_module_access,
)

# ── Routers modulares (extracción incremental de main.py) ───────────────────
# Se incluyen aquí, antes del mount de StaticFiles al final del archivo, para
# que sus rutas /api/* tengan precedencia sobre el catch-all de estáticos.
from routers.admin import router as _admin_router, _reloj_ensure_auth_table  # noqa: E402
from routers.notifications import router as _notif_router  # noqa: E402
from routers.integrations import router as _integr_router  # noqa: E402
from routers.onboarding import router as _onboarding_router  # noqa: E402
from routers.superadmin import router as _superadmin_router  # noqa: E402
from routers.sales import router as _sales_router  # noqa: E402
from routers.cfdi import router as _cfdi_router  # noqa: E402
from routers.permissions import router as _permissions_router  # noqa: E402
from routers.sellers import router as _sellers_router  # noqa: E402
from routers.projects import router as _projects_router  # noqa: E402
from routers.loyalty import router as _loyalty_router  # noqa: E402
from routers.routes import router as _routes_router  # noqa: E402
from routers.products import router as _products_router  # noqa: E402
from routers.clients import router as _clients_router  # noqa: E402
from routers.comodato import router as _comodato_router  # noqa: E402
from routers.adhesion import router as _adhesion_router  # noqa: E402
from routers.layaways import router as _layaways_router  # noqa: E402
from routers.receptions import router as _receptions_router  # noqa: E402
from dashboard.router import router as _dashboard_erp_router  # noqa: E402
app.include_router(_admin_router)
app.include_router(_notif_router)
app.include_router(_integr_router)
app.include_router(_onboarding_router)
app.include_router(_superadmin_router)
app.include_router(_sales_router)
app.include_router(_cfdi_router)
app.include_router(_permissions_router)
app.include_router(_sellers_router)
app.include_router(_projects_router)
app.include_router(_loyalty_router)
app.include_router(_routes_router)
app.include_router(_products_router)
app.include_router(_clients_router)
app.include_router(_comodato_router)
app.include_router(_adhesion_router)
app.include_router(_layaways_router)
app.include_router(_receptions_router)
app.include_router(_dashboard_erp_router)

class LoginRequest(BaseModel):
    empresa_id: str
    usuario_id: str
    password: str
    terminal_id: Optional[str] = None  # D4: identidad de la terminal física (sede)

def _audit_login_attempt(db: Session, empresa_id: str, usuario_id: str, motivo: str, sucursal_id: str = "MATRIZ"):
    """Registra un intento de login fallido en AuditLog. Nunca debe tumbar el
    login — si el propio audit falla, se ignora (el 401 se devuelve igual)."""
    try:
        db.add(models.AuditLog(
            empresa_id=empresa_id or "DESCONOCIDA",
            sucursal_id=sucursal_id or "MATRIZ",
            user_id=usuario_id or "desconocido",
            action=f"LOGIN_FAILED: {motivo}",
            severity="WARNING",
        ))
        db.commit()
    except Exception:
        db.rollback()


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


@app.post("/api/auth/login")
def login(req: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(
        models.User.empresa_id == req.empresa_id,
        models.User.username == req.usuario_id
    ).first()

    if not user:
        _audit_login_attempt(db, req.empresa_id, req.usuario_id, "usuario_no_encontrado")
        raise HTTPException(status_code=401, detail="Usuario no encontrado o credenciales inválidas")

    # S-2: tenant suspendido por el superadmin → nadie entra (salvo el superadmin,
    # cuyo pseudo-tenant SYS-000 nunca se suspende).
    _company = db.query(models.Company).filter(models.Company.id == req.empresa_id).first()
    if _company is not None and (_company.status or "ACTIVE").upper() == "SUSPENDED":
        _audit_login_attempt(db, req.empresa_id, req.usuario_id, "tenant_suspendido",
                             sucursal_id=user.sucursal_id)
        raise HTTPException(status_code=403, detail="Tenant suspendido — contacta al proveedor del sistema")

    try:
        _pw_bytes = req.password.encode("utf-8")
        _hash_bytes = user.hashed_password.encode("utf-8") if isinstance(user.hashed_password, str) else user.hashed_password
        if not _bcrypt_native.checkpw(_pw_bytes, _hash_bytes):
            raise ValueError()
    except ValueError:
        _audit_login_attempt(db, req.empresa_id, req.usuario_id, "password_incorrecto", sucursal_id=user.sucursal_id)
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    except Exception as _e:
        _audit_login_attempt(db, req.empresa_id, req.usuario_id, "error_verificando_credenciales", sucursal_id=user.sucursal_id)
        raise HTTPException(status_code=401, detail="Error verificando credenciales")

    # ── D4: terminales autorizadas por sede ────────────────────────────────
    # Modelo (Don Antonio, 07-sep): la SEDE de la sesión la fija la TERMINAL
    # física, no el usuario. Un solo usuario/clave por persona; llega a la sede
    # donde le toca el turno, se loguea en la terminal de ahí y el sistema lo
    # ata a esa sede (y le bloquea las demás). No hay lista de asignación por
    # usuario: estar físicamente en la terminal ES la autorización.
    # Solo actúa si el tenant activó `multisucursal.enforce`. Por defecto OFF:
    # los tenants que no lo configuraron se loguean igual que antes.
    session_sucursal = user.sucursal_id
    _is_owner = (user.role or "").lower() in ("admin", "administrador", "superadmin")
    try:
        from routers.admin import check_terminal_autorizada
        term = check_terminal_autorizada(db, user.empresa_id, req.terminal_id)
    except Exception:
        term = {"enforced": False, "authorized": False, "sucursal_id": None}
    # El admin/dueño del tenant está EXENTO del candado de terminal: entra desde
    # cualquier lado (oficina, casa, celular) y conserva su sede, rotando entre
    # sedes con ?sucursal_id=ALL. El enforcement aplica de `gerente` hacia abajo.
    if term.get("enforced") and not _is_owner:
        if not term.get("authorized"):
            _audit(db, user.empresa_id, user.username, "LOGIN_BLOCKED_TERMINAL",
                   "SECURITY", user.sucursal_id, {"terminal_id": req.terminal_id})
            raise HTTPException(
                status_code=403,
                detail="Login permitido solo desde una terminal autorizada de la sede",
            )
        # La sesión se ata a la sede de la terminal.
        session_sucursal = term.get("sucursal_id") or user.sucursal_id

    _audit(db, user.empresa_id, user.username, "LOGIN_SUCCESS", severity="INFO", sucursal_id=session_sucursal)

    payload = {
        "sub": user.username,
        "empresa": user.empresa_id,
        "sucursal": session_sucursal,
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    is_production = (os.environ.get("APP_ENV") or os.environ.get("ENV", "")).lower() == "production"

    response.set_cookie(
        key="access_token",
        value=f"Bearer {token}",
        httponly=True,
        secure=is_production,
        samesite="strict",
        max_age=JWT_EXPIRATION_HOURS * 3600,
    )

    return {"role": user.role, "sucursal": session_sucursal, "message": "Autenticacion exitosa", "token": token}


# ── AUTH ME ─────────────────────────────────────────────────────────────────
@app.get("/api/auth/me")
def get_me(db: Session = Depends(get_db), tenant: dict = Depends(get_tenant_context)):
    """Info del usuario autenticado: tenant + sede EFECTIVA de la sesión.

    `empresa_nombre` = nombre del tenant (la empresa), NO de una sucursal.
    `sucursal_id` / `sucursal_nombre` = la sede en la que quedó la sesión (la
    fija la terminal en login — ver D4); `sucursal_id` sale del JWT, no de
    `user.sucursal_id` (que es solo la sede de casa / default del usuario).
    """
    empresa_id  = tenant.get("empresa")
    username    = tenant.get("sub")
    role        = tenant.get("role", "")
    sucursal_id = tenant.get("sucursal")

    # Nombre humano del tenant: 1) AdminConfig params.empresa_nombre
    #                           2) Company.name
    #                           3) empresa_id como fallback
    # (NO se usa el nombre de la sucursal matriz — eso etiquetaba mal el tenant.)
    empresa_nombre = empresa_id  # fallback
    try:
        cfg = db.query(models.AdminConfig).filter(
            models.AdminConfig.empresa_id == empresa_id,
            models.AdminConfig.config_key == "params.empresa_nombre"
        ).first()
        if cfg and cfg.config_val:
            empresa_nombre = str(cfg.config_val).strip('"')
        else:
            company = db.query(models.Company).filter(
                models.Company.id == empresa_id
            ).first()
            if company and company.name:
                empresa_nombre = company.name
    except Exception:
        pass  # fallback a empresa_id ya asignado

    # Nombre de la sede efectiva de la sesión.
    sucursal_nombre = sucursal_id
    try:
        branch = db.query(models.Branch).filter(
            models.Branch.empresa_id == empresa_id,
            models.Branch.id == sucursal_id
        ).first()
        if branch and branch.name:
            sucursal_nombre = branch.name
    except Exception:
        pass

    return {
        "username":       username,
        "name":           username,
        "role":           role,
        "empresa_id":     empresa_id,
        "empresa_nombre": empresa_nombre,
        "sucursal_id":    sucursal_id,
        "sucursal_nombre": sucursal_nombre,
    }


# ── DASHBOARD STATS ─────────────────────────────────────────────────────────
@app.get("/api/dashboard/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
    role_data: dict = Depends(role_guard(["Administrador", "Gerente", "admin"])),
    sucursal_filter: Optional[str] = Query(None, alias="sucursal_id"),
):
    """Returns real-time KPIs for the OS dashboard.

    FASE 5.1E-R — Hardening de Compatibilidad Read-Only
    Ruta de ejecucion determinada por dialecto de BD activo:

    - postgresql : _dashboard_stats_postgresql()
                   Ruta oficial SaaS. Errores propagados normalmente.
                   Nunca oculta datos financieros con fallback silencioso.

    - sqlite     : _dashboard_stats_sqlite_compat()
                   SQLITE LEGACY COMPAT — temporal, no usar como ruta SaaS oficial
                   TICKET-BACKEND-03 — Retirar cuando Admin conecte a PostgreSQL.
                   Solo retorna datos que pueden calcularse con el schema legacy
                   (sin columna 'status' en sales, sin func.date_trunc).
                   Emite WARNING de log en cada llamada para rastreabilidad.
    """
    import logging as _logging
    _dash_log = _logging.getLogger("calebsys.dashboard")

    empresa_id = tenant["empresa"]
    sucursal_id = tenant["sucursal"]
    # M-1/M-2: ADMIN (dueño/gerente general) puede sobreescribir sucursal_id
    # via ?sucursal_id=XXX, o pedir el agregado de TODAS las sucursales del
    # tenant via ?sucursal_id=ALL (sucursal_id=None => sin filtro de sucursal
    # en las queries, solo empresa_id). Gerente de sucursal siempre queda
    # scoped a su propia sucursal (seguridad) — no puede ver otras ni el
    # agregado total, sin importar qué mande en el query param.
    role_name = role_data.get("role", "")
    is_owner_admin = role_name in ("admin", "Administrador")
    view_all_sucursales = False
    if is_owner_admin and sucursal_filter:
        if sucursal_filter.upper() == "ALL":
            sucursal_id = None
            view_all_sucursales = True
        else:
            sucursal_id = sucursal_filter
    dialect = db.bind.dialect.name  # 'sqlite' | 'postgresql'

    now_utc = datetime.now(timezone.utc)
    today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    yesterday_start = today_start - timedelta(days=1)
    this_month_start = today_start.replace(day=1)
    this_year_start = today_start.replace(month=1, day=1)

    if dialect == "postgresql":
        # ── RUTA OFICIAL SAAS ───────────────────────────────────────────────────
        # En PostgreSQL TODOS los errores se propagan. Ningun fallback silencioso.
        # Si una query financiera falla, el endpoint retorna 500 (no datos falsos).

        def _sc(model):
            """Filtro de sucursal condicional: si sucursal_id es None (modo
            'ver todas las sucursales' del admin dueño/gerente general),
            no se aplica — la query queda agregada a nivel tenant."""
            return [model.sucursal_id == sucursal_id] if sucursal_id else []

        today_sales = db.query(
            func.coalesce(func.sum(models.Sale.total), 0),
            func.count(models.Sale.id)
        ).filter(
            models.Sale.empresa_id == empresa_id,
            *_sc(models.Sale),
            models.Sale.created_at >= today_start,
            models.Sale.created_at < today_end,
            models.Sale.status == "completed"
        ).first()
        total_hoy = float(today_sales[0] or 0)
        tickets_hoy = int(today_sales[1] or 0)

        by_sucursal = []
        if view_all_sucursales:
            by_sucursal_q = db.query(
                models.Sale.sucursal_id.label("sucursal_id"),
                func.coalesce(func.sum(models.Sale.total), 0).label("total"),
                func.count(models.Sale.id).label("tickets"),
            ).filter(
                models.Sale.empresa_id == empresa_id,
                models.Sale.created_at >= today_start,
                models.Sale.created_at < today_end,
                models.Sale.status == "completed"
            ).group_by(models.Sale.sucursal_id).order_by(func.sum(models.Sale.total).desc()).all()
            by_sucursal = [
                {"sucursal_id": r.sucursal_id, "ventas_hoy": float(r.total or 0), "tickets_hoy": int(r.tickets or 0)}
                for r in by_sucursal_q
            ]

        yesterday_sales = db.query(
            func.coalesce(func.sum(models.Sale.total), 0)
        ).filter(
            models.Sale.empresa_id == empresa_id,
            *_sc(models.Sale),
            models.Sale.created_at >= yesterday_start,
            models.Sale.created_at < today_start,
            models.Sale.status == "completed"
        ).scalar() or 0

        delta_ventas = 0
        if yesterday_sales > 0:
            delta_ventas = round(((total_hoy - float(yesterday_sales)) / float(yesterday_sales)) * 100, 1)
        elif total_hoy > 0:
            delta_ventas = 100

        cxc = db.query(func.coalesce(func.sum(models.AccountsReceivable.current_balance), 0)).filter(
            models.AccountsReceivable.empresa_id == empresa_id,
            *_sc(models.AccountsReceivable),
            models.AccountsReceivable.status == "Pendiente"
        ).scalar() or 0

        if view_all_sucursales:
            # Fusiona el desglose de CxC dentro de by_sucursal (misma fila por
            # sucursal_id) — una sucursal puede tener CxC pendiente sin haber
            # vendido hoy, o viceversa, así que se hace un merge por clave.
            by_sucursal_map = {row["sucursal_id"]: row for row in by_sucursal}
            cxc_by_sucursal_q = db.query(
                models.AccountsReceivable.sucursal_id.label("sucursal_id"),
                func.coalesce(func.sum(models.AccountsReceivable.current_balance), 0).label("cxc"),
            ).filter(
                models.AccountsReceivable.empresa_id == empresa_id,
                models.AccountsReceivable.status == "Pendiente"
            ).group_by(models.AccountsReceivable.sucursal_id).all()
            for r in cxc_by_sucursal_q:
                row = by_sucursal_map.get(r.sucursal_id)
                if row is None:
                    row = {"sucursal_id": r.sucursal_id, "ventas_hoy": 0.0, "tickets_hoy": 0}
                    by_sucursal_map[r.sucursal_id] = row
                    by_sucursal.append(row)
                row["cxc_pendiente"] = float(r.cxc or 0)
            for row in by_sucursal:
                row.setdefault("cxc_pendiente", 0.0)

        top_products_q = db.query(
            models.SaleItem.product_sku.label("sku"),
            func.sum(models.SaleItem.quantity).label("qty"),
            func.sum(models.SaleItem.subtotal).label("revenue")
        ).join(models.Sale, models.SaleItem.sale_id == models.Sale.id).filter(
            models.Sale.empresa_id == empresa_id,
            *_sc(models.Sale),
            models.Sale.created_at >= today_start,
            models.Sale.created_at < today_end,
            models.Sale.status == "completed"
        ).group_by(models.SaleItem.product_sku).order_by(func.sum(models.SaleItem.quantity).desc()).limit(5).all()
        top_products = [{"sku": p.sku, "qty": float(p.qty or 0), "revenue": float(p.revenue or 0)} for p in top_products_q]

        recent_sales_q = db.query(models.Sale).filter(
            models.Sale.empresa_id == empresa_id,
            *_sc(models.Sale),
            models.Sale.created_at >= today_start,
            models.Sale.created_at < today_end,
            models.Sale.status == "completed"
        ).order_by(models.Sale.created_at.desc()).limit(5).all()
        recent_sales = [{
            "id": s.id,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "payment_method": s.payment_method,
            "total": float(s.total),
            "sucursal_id": s.sucursal_id,
        } for s in recent_sales_q]

        hourly_sales_q = db.query(
            func.date_trunc('hour', models.Sale.created_at).label("hour"),
            func.sum(models.Sale.total).label("total")
        ).filter(
            models.Sale.empresa_id == empresa_id,
            *_sc(models.Sale),
            models.Sale.created_at >= today_start,
            models.Sale.created_at < today_end,
            models.Sale.status == "completed"
        ).group_by("hour").order_by("hour").all()
        hourly_sales = [{"hour": h.hour.isoformat(), "total": float(h.total)} for h in hourly_sales_q]

        daily_sales_q = db.query(
            func.date_trunc('day', models.Sale.created_at).label("day"),
            func.sum(models.Sale.total).label("total")
        ).filter(
            models.Sale.empresa_id == empresa_id,
            *_sc(models.Sale),
            models.Sale.created_at >= this_month_start,
            models.Sale.created_at < today_end,
            models.Sale.status == "completed"
        ).group_by("day").order_by("day").all()
        daily_sales = [{"day": d.day.isoformat(), "total": float(d.total)} for d in daily_sales_q]

        monthly_sales_q = db.query(
            func.date_trunc('month', models.Sale.created_at).label("month"),
            func.sum(models.Sale.total).label("total")
        ).filter(
            models.Sale.empresa_id == empresa_id,
            *_sc(models.Sale),
            models.Sale.created_at >= this_year_start,
            models.Sale.created_at < today_end,
            models.Sale.status == "completed"
        ).group_by("month").order_by("month").all()
        monthly_sales = [{"month": m.month.isoformat(), "total": float(m.total)} for m in monthly_sales_q]

        return JSONResponse({
            "_dialect": "postgresql",
            "_compat_mode": False,
            "scope": "ALL" if view_all_sucursales else (sucursal_id or ""),
            "by_sucursal": by_sucursal,
            "ventas_hoy": total_hoy,
            "tickets_hoy": tickets_hoy,
            "delta_ventas": delta_ventas,
            "cuentas_por_cobrar": float(cxc),
            "top_products": top_products,
            "recent_sales": recent_sales,
            "hourly_sales": hourly_sales,
            "daily_sales": daily_sales,
            "monthly_sales": monthly_sales
        })

    # ── SQLITE LEGACY COMPAT — temporal, no usar como ruta SaaS oficial ────────
    # TICKET-BACKEND-03 — Retirar cuando Admin conecte a PostgreSQL.
    # Solo se ejecuta en dialecto SQLite (desarrollo local / POS offline).
    # Emite WARNING obligatorio para rastreabilidad en logs.
    _dash_log.warning(
        "[COMPAT-SQLITE] get_dashboard_stats usando ruta legacy SQLite. "
        "Schema local carece de: sales.status, func.date_trunc. "
        "Datos financieros disponibles son parciales (solo los que "
        "el schema legacy soporta). empresa_id=%s sucursal_id=%s "
        "today=%s",
        empresa_id, sucursal_id, today_start.date()
    )

    # Filtro de sucursal condicional (SQLite): en modo 'ALL' (dueño/gerente
    # general viendo el tenant completo) sucursal_id es None y se omite del
    # WHERE — las queries quedan agregadas a nivel empresa_id.
    _p = {"eid": empresa_id, "sid": sucursal_id}

    # En SQLite: ventas sin filtro de status (columna ausente en schema legacy)
    today_sales_row = db.execute(
        text(
            "SELECT COALESCE(SUM(total), 0) AS total_sum, COUNT(id) AS cnt "
            "FROM sales WHERE empresa_id = :eid "
            "AND (:sid IS NULL OR sucursal_id = :sid) "
            "AND created_at >= :ts AND created_at < :te"
        ),
        {**_p, "ts": str(today_start), "te": str(today_end)}
    ).mappings().first()
    total_hoy = float(today_sales_row["total_sum"] or 0) if today_sales_row else 0.0
    tickets_hoy = int(today_sales_row["cnt"] or 0) if today_sales_row else 0

    by_sucursal = []
    if view_all_sucursales:
        by_sucursal_rows = db.execute(
            text(
                "SELECT sucursal_id, COALESCE(SUM(total), 0) AS total_sum, COUNT(id) AS cnt "
                "FROM sales WHERE empresa_id = :eid "
                "AND created_at >= :ts AND created_at < :te "
                "GROUP BY sucursal_id ORDER BY total_sum DESC"
            ),
            {"eid": empresa_id, "ts": str(today_start), "te": str(today_end)}
        ).mappings().all()
        by_sucursal = [
            {"sucursal_id": r["sucursal_id"], "ventas_hoy": float(r["total_sum"] or 0), "tickets_hoy": int(r["cnt"] or 0)}
            for r in by_sucursal_rows
        ]

    yesterday_row = db.execute(
        text(
            "SELECT COALESCE(SUM(total), 0) AS total_sum "
            "FROM sales WHERE empresa_id = :eid "
            "AND (:sid IS NULL OR sucursal_id = :sid) "
            "AND created_at >= :ys AND created_at < :ts"
        ),
        {**_p, "ys": str(yesterday_start), "ts": str(today_start)}
    ).mappings().first()
    yesterday_sales = float(yesterday_row["total_sum"] or 0) if yesterday_row else 0.0

    delta_ventas = 0
    if yesterday_sales > 0:
        delta_ventas = round(((total_hoy - yesterday_sales) / yesterday_sales) * 100, 1)
    elif total_hoy > 0:
        delta_ventas = 100

    # CxC: accounts_receivable existe en SQLite con columnas current_balance y status.
    # Bug preexistente corregido aquí: esta query nunca filtraba por sucursal_id
    # (a diferencia de la ruta postgresql), así que en modo detalle de UNA
    # sucursal mostraba el CxC de TODO el tenant. Ahora respeta el mismo
    # filtro condicional que el resto de las queries de esta ruta.
    cxc_row = db.execute(
        text(
            "SELECT COALESCE(SUM(current_balance), 0) AS cxc "
            "FROM accounts_receivable WHERE empresa_id = :eid "
            "AND (:sid IS NULL OR sucursal_id = :sid) "
            "AND status = 'Pendiente'"
        ),
        _p
    ).mappings().first()
    cxc = float(cxc_row["cxc"] or 0) if cxc_row else 0.0

    if view_all_sucursales:
        # Fusiona el desglose de CxC dentro de by_sucursal (misma fila por
        # sucursal_id) — igual que en la ruta postgresql.
        by_sucursal_map = {row["sucursal_id"]: row for row in by_sucursal}
        cxc_by_sucursal_rows = db.execute(
            text(
                "SELECT sucursal_id, COALESCE(SUM(current_balance), 0) AS cxc "
                "FROM accounts_receivable WHERE empresa_id = :eid AND status = 'Pendiente' "
                "GROUP BY sucursal_id"
            ),
            {"eid": empresa_id}
        ).mappings().all()
        for r in cxc_by_sucursal_rows:
            row = by_sucursal_map.get(r["sucursal_id"])
            if row is None:
                row = {"sucursal_id": r["sucursal_id"], "ventas_hoy": 0.0, "tickets_hoy": 0}
                by_sucursal_map[r["sucursal_id"]] = row
                by_sucursal.append(row)
            row["cxc_pendiente"] = float(r["cxc"] or 0)
        for row in by_sucursal:
            row.setdefault("cxc_pendiente", 0.0)

    # Top products: sin filtro status (columna ausente)
    top_rows = db.execute(
        text(
            "SELECT si.product_sku AS sku, "
            "SUM(si.quantity) AS qty, SUM(si.subtotal) AS revenue "
            "FROM sale_items si "
            "JOIN sales s ON si.sale_id = s.id "
            "WHERE s.empresa_id = :eid "
            "AND (:sid IS NULL OR s.sucursal_id = :sid) "
            "AND s.created_at >= :ts AND s.created_at < :te "
            "GROUP BY si.product_sku "
            "ORDER BY SUM(si.quantity) DESC LIMIT 5"
        ),
        {**_p, "ts": str(today_start), "te": str(today_end)}
    ).mappings().all()
    top_products = [{"sku": r["sku"], "qty": float(r["qty"] or 0), "revenue": float(r["revenue"] or 0)} for r in top_rows]

    # Recent sales: sin filtro status
    recent_rows = db.execute(
        text(
            "SELECT id, created_at, payment_method, total, sucursal_id "
            "FROM sales WHERE empresa_id = :eid "
            "AND (:sid IS NULL OR sucursal_id = :sid) "
            "AND created_at >= :ts AND created_at < :te "
            "ORDER BY created_at DESC LIMIT 5"
        ),
        {**_p, "ts": str(today_start), "te": str(today_end)}
    ).mappings().all()
    recent_sales = [{
        "id": r["id"],
        "created_at": r["created_at"],
        "payment_method": r["payment_method"],
        "total": float(r["total"] or 0),
        "sucursal_id": r["sucursal_id"],
    } for r in recent_rows]

    # Hourly sales: usando strftime (SQLite-compatible, no date_trunc)
    hourly_rows = db.execute(
        text(
            "SELECT strftime('%H', created_at) AS hour_label, "
            "SUM(total) AS total "
            "FROM sales WHERE empresa_id = :eid "
            "AND (:sid IS NULL OR sucursal_id = :sid) "
            "AND created_at >= :ts AND created_at < :te "
            "GROUP BY hour_label ORDER BY hour_label"
        ),
        {**_p, "ts": str(today_start), "te": str(today_end)}
    ).mappings().all()
    hourly_sales = [{"hour": r["hour_label"] + ":00", "total": float(r["total"] or 0)} for r in hourly_rows]

    # Daily sales this month: usando strftime
    daily_rows = db.execute(
        text(
            "SELECT strftime('%Y-%m-%d', created_at) AS day_label, "
            "SUM(total) AS total "
            "FROM sales WHERE empresa_id = :eid "
            "AND (:sid IS NULL OR sucursal_id = :sid) "
            "AND created_at >= :ms AND created_at < :te "
            "GROUP BY day_label ORDER BY day_label"
        ),
        {**_p, "ms": str(this_month_start), "te": str(today_end)}
    ).mappings().all()
    daily_sales = [{"day": r["day_label"], "total": float(r["total"] or 0)} for r in daily_rows]

    # Monthly sales this year: usando strftime
    monthly_rows = db.execute(
        text(
            "SELECT strftime('%Y-%m', created_at) AS month_label, "
            "SUM(total) AS total "
            "FROM sales WHERE empresa_id = :eid "
            "AND (:sid IS NULL OR sucursal_id = :sid) "
            "AND created_at >= :ys AND created_at < :te "
            "GROUP BY month_label ORDER BY month_label"
        ),
        {**_p, "ys": str(this_year_start), "te": str(today_end)}
    ).mappings().all()
    monthly_sales = [{"month": r["month_label"], "total": float(r["total"] or 0)} for r in monthly_rows]

    return JSONResponse({
        "_dialect": "sqlite",
        "_compat_mode": True,
        "_compat_note": "SQLITE LEGACY COMPAT activo. Datos sin filtro status. TICKET-BACKEND-03.",
        "scope": "ALL" if view_all_sucursales else (sucursal_id or ""),
        "by_sucursal": by_sucursal,
        "ventas_hoy": total_hoy,
        "tickets_hoy": tickets_hoy,
        "delta_ventas": delta_ventas,
        "cuentas_por_cobrar": cxc,
        "top_products": top_products,
        "recent_sales": recent_sales,
        "hourly_sales": hourly_sales,
        "daily_sales": daily_sales,
        "monthly_sales": monthly_sales
    })

# ── DASHBOARD ACTIVITY FEED ──────────────────────────────────────────────────
@app.get("/api/dashboard/activity")
def get_dashboard_activity(
    limit: int = Query(15, ge=1, le=50),
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
    role_data: dict = Depends(role_guard(["Administrador", "Gerente", "admin"]))
):
    """Feed unificado de actividad reciente para el Dashboard del módulo
    Administración (Fase 2, ver 'Alcance Modulo Administracion - Fase2.md',
    sección 1: "Actividad reciente: últimos eventos relevantes del
    audit_log").

    Combina dos fuentes con contexto de tenant propio, no una sola query:

    - audit_log: eventos de sistema (hoy solo SYNC_OFFLINE_SALES emite
      registros reales; el modelo ya soporta cualquier action/severity
      futuro sin cambios de schema). Filtrado SOLO por empresa_id -- a
      diferencia de Sale, un evento de auditoría no es necesariamente de
      una sola sucursal (ej. una sincronización offline puede traer
      ventas de varias sucursales en un mismo lote) y
      AuditLog.sucursal_id solo tiene un server_default genérico
      ("MATRIZ") que no siempre refleja dónde ocurrió el evento --
      filtrar por sucursal aquí ocultaría actividad real del tenant sin
      ninguna ganancia real de aislamiento (empresa_id ya aísla el
      tenant, que es la garantía multi-tenant que importa).
    - sales: ventas completadas recientes, con el mismo filtro
      empresa+sucursal que ya usa /api/dashboard/stats, para que el feed
      sea consistente con los KPIs que el usuario ve en la misma
      pantalla.

    Se mezclan en Python (no UNION SQL) porque son shapes de datos
    distintos y el volumen es mínimo (limit<=50) -- no amerita la
    complejidad de tipar un UNION entre dos tablas con columnas
    distintas.
    """
    empresa_id = tenant["empresa"]
    sucursal_id = tenant["sucursal"]

    # Traemos mas registros de los que se van a mostrar al final (fetch_n)
    # de CADA fuente por separado, para que al mezclar y truncar a `limit`
    # no desaparezca una fuente completa solo porque la otra tiene mas
    # volumen en la ventana de tiempo reciente.
    fetch_n = max(limit, 10)

    audit_rows = db.query(models.AuditLog).filter(
        models.AuditLog.empresa_id == empresa_id
    ).order_by(models.AuditLog.created_at.desc()).limit(fetch_n).all()

    sales_rows = db.query(models.Sale, models.Client.name).outerjoin(
        models.Client, models.Sale.client_id == models.Client.id
    ).filter(
        models.Sale.empresa_id == empresa_id,
        models.Sale.sucursal_id == sucursal_id,
        models.Sale.status == "completed"
    ).order_by(models.Sale.created_at.desc()).limit(fetch_n).all()

    feed = []
    for a in audit_rows:
        feed.append({
            "type": "audit",
            "action": a.action,
            "severity": a.severity,
            "user": a.user_id,
            # a.details puede ser texto libre (como lo escribe hoy el
            # sync offline) o un JSON estructurado a futuro -- se manda
            # tal cual, el frontend decide como mostrarlo.
            "details": a.details,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        })
    for sale, client_name in sales_rows:
        feed.append({
            "type": "sale",
            "action": "sale_created",
            "sale_id": sale.id,
            "client_name": client_name or "Público General",
            "total": float(sale.total),
            "payment_method": sale.payment_method,
            "created_at": sale.created_at.isoformat() if sale.created_at else None,
        })

    # Orden final por fecha real, no por fuente. created_at nulo (fila
    # legacy corrupta) se manda al final en vez de tronar el sort.
    feed.sort(key=lambda x: x["created_at"] or "", reverse=True)

    return JSONResponse({"activity": feed[:limit]})


class SyncPayload(BaseModel):
    sales: list

@app.post("/api/sync/offline-sales")
def sync_offline_sales(
    payload: SyncPayload,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    role_data: dict = Depends(role_guard(["Administrador", "Gerente", "Cajero", "admin"]))
):
    """Syncs offline sales to the cloud with Data-Layer Idempotency Shield."""
    
    synced_count = 0
    ignored_count = 0
    
    for sale_data in payload.sales:
        sale_id = sale_data.get("id")
        if not sale_id:
            continue
            
        try:
            # Fix C1 (auditoria 2026-08-03): sales.client_id ahora tiene FK
            # real compuesta a 'clients' (antes apuntaba a 'customers',
            # tabla muerta). El default de este endpoint ('PUBLIC', cliente
            # generico de mostrador) nunca se sembraba en ninguna tabla de
            # clientes -- con la FK real, cada sync sin cliente explicito
            # tronaria con ForeignKeyViolation. Get-or-create minimo para no
            # romper el unico flujo de ventas que hoy funciona de verdad.
            client_id = sale_data.get("client_id", "PUBLIC")
            existing_client = (
                db.query(models.Client)
                .filter(models.Client.empresa_id == empresa_id)
                .filter(models.Client.id == client_id)
                .first()
            )
            if not existing_client:
                db.add(models.Client(
                    empresa_id=empresa_id,
                    id=client_id,
                    name="Público General" if client_id == "PUBLIC" else client_id,
                ))
                db.flush()

            # Intentar la Inserción Directa (Dejamos que la BD maneje la Race Condition)
            new_sale = models.Sale(
                id=sale_id,
                empresa_id=empresa_id,
                sucursal_id=role_data.get("sucursal", "MATRIZ"),
                client_id=client_id,
                total=sale_data.get("total", 0.0),
                payment_method=sale_data.get("payment_method", "EFECTIVO"),
                amount_paid=sale_data.get("amount_paid", 0.0),
                change_returned=sale_data.get("change_returned", 0.0),
                status="completed"
            )
            db.add(new_sale)
            db.commit() # Flush per row to isolate errors
            synced_count += 1
            
        except IntegrityError:
            # Race condition / Duplicate detected by UNIQUE constraint
            db.rollback()
            ignored_count += 1
            continue
    
    if synced_count > 0:
        audit_log = models.AuditLog(
            empresa_id=empresa_id,
            user_id=role_data.get("sub"),
            action="SYNC_OFFLINE_SALES",
            details=f"Sincronizados: {synced_count}. Ignorados (Idempotencia DB): {ignored_count}.",
            ip_address="127.0.0.1"
        )
        db.add(audit_log)
        # Bug real de produccion: faltaba este commit. Sin el, el audit_log
        # quedaba agregado a la sesion pero nunca persistido - al cerrarse
        # la sesion (fin del request) el registro de auditoria de la
        # sincronizacion offline se perdia en silencio, sin error visible.
        db.commit()
    
    return {"message": "Sincronización procesada.", "synced": synced_count, "ignored": ignored_count}


# Safekeeping (Resguardos) & Kardex Deliveries
@app.get("/api/safekept", response_model=List[schemas.SafekeptItem])
def list_safekept_items(client_id: Optional[int] = None, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    return crud.get_safekept_items(db, empresa_id=empresa_id, client_id=client_id)

@app.post("/api/deliveries")
def create_delivery(delivery: schemas.KardexDeliveryCreate, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    try:
        db_delivery = crud.create_kardex_delivery(db, empresa_id=empresa_id, delivery=delivery)
        return {"message": "Delivery registered in Kardex successfully", "id": db_delivery.id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── RESGUARDOS — ciclo de vida (D.1: T-4d/T-4g/T-4h) ───────────────────────
_RESGUARDO_ROLES = ["ADMIN", "Administrador", "admin", "ALMACENISTA", "Almacenista", "Gerente"]


@app.get("/api/resguardos")
def list_resguardos(
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    abiertos: bool = False,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    return crud.get_resguardos(db, empresa_id, status=status,
                               client_id=client_id, abiertos=abiertos)


@app.put("/api/resguardos/{resguardo_id}/eta")
def set_resguardo_eta(
    resguardo_id: str,
    body: dict,
    db: Session = Depends(get_db),
    payload: dict = Depends(role_guard(_RESGUARDO_ROLES)),
):
    eta = ((body or {}).get("eta_date") or "").strip()
    if not eta:
        raise HTTPException(status_code=400, detail="Falta 'eta_date' (YYYY-MM-DD)")
    try:
        return crud.set_resguardo_eta(
            db, payload.get("empresa"), resguardo_id, eta,
            expira_at=(body or {}).get("expira_at"),
            actor=payload.get("user_id", "sistema"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/resguardos/{resguardo_id}/ajustar")
def ajustar_resguardo(
    resguardo_id: str,
    body: dict,
    db: Session = Depends(get_db),
    payload: dict = Depends(role_guard(["ADMIN", "Administrador", "admin", "ALMACENISTA", "Almacenista"])),
):
    motivo = ((body or {}).get("motivo") or "").strip() or "Ajuste de resguardo no entregado"
    try:
        return crud.ajustar_resguardo(db, payload.get("empresa"), resguardo_id,
                                      motivo, actor=payload.get("user_id", "sistema"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/resguardos/vencimiento/scan")
def scan_resguardos_vencimiento(
    dias_aviso: int = 3,
    db: Session = Depends(get_db),
    payload: dict = Depends(role_guard(_RESGUARDO_ROLES)),
):
    """T-4g / N-05: barre resguardos por vencer. Ejecutable por cron o a mano."""
    return crud.escanear_vencimientos_resguardo(db, payload.get("empresa"),
                                                dias_aviso=max(0, dias_aviso))


@app.post("/api/resguardos/vencidos/scan")
def scan_resguardos_vencidos(
    db: Session = Depends(get_db),
    payload: dict = Depends(role_guard(_RESGUARDO_ROLES)),
):
    """E-03b: cierra como VENCIDO los resguardos cuyo expira_at ya pasó.
    Acredita el valor pendiente al saldo_favor del cliente. Ejecutable por cron o admin.
    """
    return crud.vencer_resguardos_expirados(db, payload.get("empresa"))


@app.post("/api/resguardos/{resguardo_id}/prorroga")
def prorrogar_resguardo(
    resguardo_id: str,
    body: dict,
    db: Session = Depends(get_db),
    payload: dict = Depends(role_guard(["ADMIN", "Administrador", "admin"])),
):
    """E-03b: extiende el expira_at de un resguardo abierto.
    Body: { "days": int, "motivo": "..." }
    """
    days = int((body or {}).get("days") or 0)
    motivo = ((body or {}).get("motivo") or "").strip()
    if days <= 0:
        raise HTTPException(status_code=422, detail="'days' debe ser mayor a cero")
    try:
        return crud.prorrogar_resguardo(
            db, payload.get("empresa"), resguardo_id, days, motivo,
            actor=payload.get("user_id", "sistema"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/safekept/{safekept_id}/withdraw")
def withdraw_safekept(
    safekept_id: str,
    body: dict,
    db: Session = Depends(get_db),
    payload: dict = Depends(role_guard(_RESGUARDO_ROLES)),
):
    """E-03a: retiro parcial o total de un resguardo.
    Body: { "quantity": float, "notes": "..." }
    """
    quantity = float((body or {}).get("quantity") or 0)
    if quantity <= 0:
        raise HTTPException(status_code=422, detail="'quantity' debe ser mayor a cero")
    notes = ((body or {}).get("notes") or "").strip()
    try:
        return crud.partial_withdraw_safekept(
            db, payload.get("empresa"), safekept_id, quantity, notes,
            actor=payload.get("user_id", "sistema"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Simulated Pending Online Orders
@app.get("/api/online-orders")
def list_online_orders():
    # Return 3 mock online orders to load into POS cart
    return [
        {
            "id": 1001,
            "client_name": "Ing. Roberto Diaz",
            "items": [
                {"product_sku": "000002", "description": "CEMENTO GALLO 50 KG", "quantity": 10.0, "price": 390.0}
            ]
        },
        {
            "id": 1002,
            "client_name": "Constructora del Cabo",
            "items": [
                {"product_sku": "000001", "description": "MANGUERA DE NIVEL 1/2\"", "quantity": 25.0, "price": 250.20},
                {"product_sku": "1002", "description": "Martillo de uña curva 16oz Truper", "quantity": 3.0, "price": 185.0}
            ]
        },
        {
            "id": 1003,
            "client_name": "Maderería del Estero",
            "items": [
                {"product_sku": "1010", "description": "Yeso constructor saco 25kg", "quantity": 15.0, "price": 95.0}
            ]
        }
    ]

# Branch Warehouse Transfers
@app.post("/api/transfers")
def register_transfer(transfer: schemas.TransferLogCreate, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    try:
        db_log = crud.create_transfer(db, empresa_id=empresa_id, transfer=transfer)
        return {"message": "Transfer registered successfully", "id": db_log.id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/transfers")
def list_transfers(limit: int = 50, offset: int = 0, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    # Fix C2 (auditoria 2026-08-03): la rama "oficial" de este endpoint
    # dependia de models.TransferLog, clase que nunca existio en models.py
    # -- el guard hasattr(models, "TransferLog") era siempre False, asi que
    # ESTE endpoint SIEMPRE caia en la rama "legacy SQLite" de abajo, aunque
    # corriera contra Postgres oficial, ejecutando raw SQL contra una tabla
    # 'transfer_logs' que tampoco existe ahi (fallaba con UndefinedTable en
    # cuanto alguien lo invocara contra el tenant real). crud.get_transfers
    # ahora lee InventoryMovement (TRASPASO_ENTRADA), que si existe en
    # ambos dialectos, asi que ya no hace falta ninguna rama por dialecto.
    return crud.get_transfers(db, empresa_id=empresa_id, limit=min(limit, 200), offset=offset)


# Unified Inventory Kardex Logs
@app.get("/api/kardex")
def get_kardex_logs(db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    # ── KARDEX UNIFICADO, RUTA ORM UNICA ─────────────────────────────────────
    # Fix 2026-08-10: esta funcion tenia una rama "oficial SAAS" (ORM) y una
    # rama "SQLITE LEGACY COMPAT" (raw SQL) seleccionadas por
    # `_dialect_kx == "postgresql" and hasattr(models, "TransferLog")`.
    # TransferLog nunca existio (se descarto en el fix C2, reemplazado por
    # InventoryMovement) asi que ese guard era SIEMPRE False -- ningun
    # tenant, en ningun dialecto, tomo jamas la rama ORM; todos cayeron en
    # la rama legacy, que hacia raw SQL contra 'kardex_deliveries'/
    # 'safekept_items', tablas que hasta esta sesion tampoco existian como
    # modelo ORM (ver SESSION_STATE 2026-08-07) -- de ahi el 500 reportado.
    # Con SafekeptItem/KardexDelivery restaurados en models.py, la rama ORM
    # funciona en ambos dialectos: se elimina el guard y la rama legacy
    # duplicada por completo.
    #
    # De paso, dos bugs reales encontrados en la propia rama ORM (nunca
    # ejercitados en produccion porque el guard nunca dejaba entrar):
    # las consultas de `deliveries` y `sales_items` no filtraban por
    # empresa_id -- un tenant real habria visto el Kardex de TODOS los
    # tenants mezclado. Se agrega el filtro que faltaba a ambas.
    logs = []

    # Fix C2 (auditoria 2026-08-03): igual que en list_transfers, esta
    # rama dependia de models.TransferLog (nunca existio) via un guard
    # hasattr() siempre False -- los traspasos en el Kardex de un tenant
    # Postgres real siempre cayeron en la rama legacy de abajo, que
    # apuntaba a una tabla 'transfer_logs' tambien inexistente en Postgres.
    # crud.get_transfers ya funciona en ambos dialectos (lee
    # InventoryMovement), asi que se resuelve una sola vez para los dos.
    for t in crud.get_transfers(db, empresa_id=empresa_id, limit=50)["items"]:
        ts = t["created_at"]
        logs.append({
            "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S") if hasattr(ts, "strftime") else str(ts),
            "product_sku": t["product_sku"],
            "movement": "TRASPASO",
            "quantity": -t["quantity"],
            "details": f"A bodega: {t['destination_warehouse_name'] or t['destination_warehouse_id']}"
        })

    # 2. Deliveries via ORM (fix: faltaba filtro empresa_id -- ver nota arriba)
    deliveries = (
        db.query(models.KardexDelivery)
        .join(models.SafekeptItem)
        .filter(models.KardexDelivery.empresa_id == empresa_id)
        .order_by(models.KardexDelivery.delivery_date.desc())
        .limit(50)
        .all()
    )
    for d in deliveries:
        logs.append({
            "timestamp": d.delivery_date.strftime("%Y-%m-%d %H:%M:%S"),
            "product_sku": d.safekept_item.product_sku,
            "movement": "ENTREGA RESG.",
            "quantity": -d.quantity_delivered,
            "details": f"Nota: {d.notes or 'Sin notas'}"
        })
    # 3. Sales items via ORM (fix: faltaba filtro empresa_id -- ver nota arriba)
    sales_items = (
        db.query(models.SaleItem)
        .join(models.Sale)
        .filter(models.SaleItem.empresa_id == empresa_id)
        .order_by(models.Sale.created_at.desc())
        .limit(50)
        .all()
    )
    for item in sales_items:
        logs.append({
            "timestamp": item.sale.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "product_sku": item.product_sku,
            "movement": "VENTA",
            "quantity": -item.quantity,
            "details": f"Venta #{item.sale_id}"
        })
    # 4. Returns via ORM
    returns = db.query(models.SaleItem).join(models.Sale).filter(
        models.SaleItem.empresa_id == empresa_id,
        models.Sale.empresa_id == empresa_id,
        models.SaleItem.returned_quantity > 0
    ).order_by(models.Sale.created_at.desc()).limit(50).all()
    for r in returns:
        logs.append({
            "timestamp": r.sale.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "product_sku": r.product_sku,
            "movement": "DEVOLUCION",
            "quantity": r.returned_quantity,
            "details": f"Devuelto de Venta #{r.sale_id}"
        })

    # Sort all logs by timestamp desc
    logs.sort(key=lambda x: x["timestamp"], reverse=True)
    return logs[:100]


# =============================================================================
# MÓDULO ALMACÉN — Endpoints (Fase 2)
# =============================================================================

# --- Bodegas ---
# /api/warehouses → routers/admin.py

# --- Stock por bodega ---
@app.get("/api/warehouse-stock")
def get_warehouse_stock(warehouse_id: str | None = None,
                        product_sku: str | None = None,
                        db: Session = Depends(get_db),
                        empresa_id: str = Depends(get_empresa_id)):
    return crud.get_stock_by_warehouse(db, empresa_id,
                                       warehouse_id=warehouse_id,
                                       product_sku=product_sku)

# /api/inventario/kpis + /api/inventario/sku-compromisos → routers/admin.py
# (duplicado eliminado 2026-09-18: esta ruta ya vive en routers/admin.py y era
# código muerto aquí — Starlette resuelve la de admin.py primero por orden de
# include_router)

# --- Kardex completo con filtros ---
@app.get("/api/kardex/v2")
def get_kardex_v2(product_sku: str | None = None,
                  warehouse_id: str | None = None,
                  movement_type: str | None = None,
                  limit: int = 200,
                  offset: int = 0,
                  db: Session = Depends(get_db),
                  empresa_id: str = Depends(get_empresa_id)):
    return crud.get_kardex_full(db, empresa_id,
                                product_sku=product_sku,
                                warehouse_id=warehouse_id,
                                movement_type=movement_type,
                                limit=min(limit, 500),
                                offset=offset)

# --- Entradas de mercancía ---
@app.post("/api/warehouse/purchase-receipt", status_code=201)
def receive_purchase(data: schemas.PurchaseReceiptCreate,
                     db: Session = Depends(get_db),
                     empresa_id: str = Depends(get_empresa_id),
                     payload: dict = Depends(role_guard(["ADMIN", "ALMACENISTA"]))):
    sucursal_id = payload.get("sucursal", "MATRIZ")
    created_by  = payload.get("sub", "sistema")
    try:
        return crud.receive_purchase(db, empresa_id, sucursal_id, data,
                                     created_by=created_by)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Notificaciones unificadas (NR-01 + M-2) ─────────────────────────────────
@app.get("/api/notifications", status_code=200)
def get_notifications(
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
    payload: dict = Depends(role_guard(["ADMIN", "Administrador", "Gerente", "ALMACENISTA", "Cajero", "Vendedor", "admin"])),
):
    """Centro unificado de alertas para la campana de notificaciones.

    Devuelve:
    - returns_pending  : devoluciones cross-sucursal PENDIENTE (Gerente/ADMIN)
    - low_stock        : productos bajo stock mínimo (Gerente/ADMIN/ALMACENISTA)
    """
    empresa_id  = tenant["empresa"]
    sucursal_id = tenant["sucursal"]
    role_name   = payload.get("role", "").lower()

    # D6: escalar casos accionables pendientes de más de 5 min (best-effort).
    try:
        import notif_flow
        notif_flow.escalate_stale(db, empresa_id)
    except Exception:
        pass
    is_admin    = role_name in ("admin", "administrador")
    is_gerente  = role_name == "gerente"
    is_almacen  = role_name in ("almacenista",)

    returns_pending = []
    low_stock_alerts = []

    # ── Devoluciones PENDIENTE (Gerente / ADMIN / Almacén) ──
    if is_admin or is_gerente or is_almacen:
        q = (
            db.query(models.SaleReturn)
            .filter(models.SaleReturn.empresa_id == empresa_id)
            .filter(models.SaleReturn.estado == "PENDIENTE")
        )
        if not is_admin:
            q = q.filter(
                (models.SaleReturn.sucursal_restock == sucursal_id) |
                (models.SaleReturn.sucursal_origen  == sucursal_id)
            )
        rows = q.order_by(models.SaleReturn.created_at.desc()).limit(20).all()
        returns_pending = [
            {
                "type": "return",
                "id": r.id,
                "sale_id": r.sale_id,
                "sucursal_origen":  r.sucursal_origen,
                "sucursal_restock": r.sucursal_restock,
                "created_by":  r.created_by,
                "created_at":  r.created_at,
                "notes": r.notes,
                "title": f"Devolución pendiente — Venta {r.sale_id[:8]}…",
                "body":  f"De {r.sucursal_origen} → restock en {r.sucursal_restock} · Iniciada por {r.created_by}",
            }
            for r in rows
        ]

    # ── Alertas de stock mínimo (Gerente/ADMIN/ALMACENISTA) ──
    if is_admin or is_gerente or is_almacen:
        filtro = None if is_admin else sucursal_id
        try:
            alerts = crud.get_low_stock_alerts(db, empresa_id, filtro)
            low_stock_alerts = [
                {
                    "type": "low_stock",
                    "sku":  a.get("sku"),
                    "name": a.get("name"),
                    "stock":         a.get("stock", 0),
                    "stock_minimo":  a.get("stock_minimo", 0),
                    "sucursal_id":   a.get("sucursal_id"),
                    "title": f"Stock bajo — {a.get('name', a.get('sku'))}",
                    "body":  f"Stock actual: {a.get('stock', 0)} (mínimo: {a.get('stock_minimo', 0)})",
                }
                for a in (alerts if isinstance(alerts, list) else [])
            ]
        except Exception:
            low_stock_alerts = []

    # ── Notificaciones por evento discreto (tabla notifications, enfoque
    #    híbrido D.3): N-01 resguardo solicitado, etc. Se filtran por rol. ──
    events = []
    try:
        role_raw = payload.get("role", "") or ""
        q = (
            db.query(models.Notification)
            .filter(models.Notification.empresa_id == empresa_id)
            .filter(models.Notification.leida == False)  # noqa: E712
            .order_by(models.Notification.created_at.desc())
            .limit(50)
        )
        for n in q.all():
            dest = [str(r).lower() for r in (n.roles_dest or [])]
            if dest and role_raw.lower() not in dest:
                continue
            # D6 / decisión 1: de gerente hacia abajo solo se ven las de la
            # propia sede. El admin/dueño ve todas. sucursal_id nulo = aviso
            # de tenant (visible para todos).
            if not is_admin and n.sucursal_id and n.sucursal_id != sucursal_id:
                continue
            m = n.meta or {}
            # No mostrar casos ya cerrados/anulados como pendientes accionables.
            if m.get("estado") in ("anulada",):
                continue
            events.append({
                "type": "event",
                "id": n.id,
                "tipo": n.tipo,
                "severidad": n.severidad,
                "title": n.titulo,
                "body": n.cuerpo,
                "ref_tipo": n.ref_tipo,
                "ref_id": n.ref_id,
                "meta": m,
                "created_at": n.created_at,
            })
    except Exception:
        events = []

    total = len(returns_pending) + len(low_stock_alerts) + len(events)
    return {
        "total": total,
        "returns_pending": returns_pending,
        "low_stock": low_stock_alerts,
        "events": events,
        "notifications": events + returns_pending + low_stock_alerts,  # lista unificada para el panel
    }


@app.post("/api/notifications/{notif_id}/leida", status_code=200)
def mark_notification_read(
    notif_id: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
):
    """Marca una Notification (evento discreto) como leída."""
    n = (
        db.query(models.Notification)
        .filter(models.Notification.empresa_id == tenant["empresa"])
        .filter(models.Notification.id == notif_id)
        .first()
    )
    if not n:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    n.leida = True
    db.add(n)
    db.commit()
    return {"ok": True, "id": notif_id}


# ── M-2: alertas de stock mínimo ────────────────────────────────────────────
@app.get("/api/warehouse/low-stock", status_code=200)
def low_stock_alerts(
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
    payload: dict = Depends(role_guard(["ADMIN", "Administrador", "Gerente", "ALMACENISTA", "admin"])),
):
    """M-2: devuelve productos con stock ≤ stock_minimo.
    ADMIN ve todas las sucursales; Gerente/Almacenista ven solo la suya.
    """
    empresa_id  = tenant["empresa"]
    sucursal_id = tenant["sucursal"]
    role_name   = payload.get("role", "")
    filtro_sucursal = None if role_name.lower() in ("admin", "administrador") else sucursal_id
    try:
        return crud.get_low_stock_alerts(db, empresa_id, filtro_sucursal)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Ajustes de inventario ---
@app.post("/api/warehouse/adjust", status_code=201)
def adjust_inventory(data: schemas.InventoryAdjustCreate,
                     db: Session = Depends(get_db),
                     empresa_id: str = Depends(get_empresa_id),
                     payload: dict = Depends(role_guard(["ADMIN", "ALMACENISTA"]))):
    sucursal_id = payload.get("sucursal", "MATRIZ")
    try:
        return crud.adjust_inventory(db, empresa_id, sucursal_id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Traslados entre bodegas (versión enriquecida) ---
@app.post("/api/warehouse/transfer", status_code=201)
def warehouse_transfer(data: schemas.WarehouseTransferCreate,
                       db: Session = Depends(get_db),
                       empresa_id: str = Depends(get_empresa_id),
                       payload: dict = Depends(role_guard(["ADMIN", "ALMACENISTA", "GERENTE", "Gerente"]))):
    sucursal_id = payload.get("sucursal", "MATRIZ")
    try:
        return crud.transfer_between_warehouses(db, empresa_id, sucursal_id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TraspasoPendingIn(BaseModel):
    product_sku: str
    quantity: float
    source_warehouse_id: str
    destination_warehouse_id: str
    delivery_mode: Optional[str] = None
    notes: Optional[str] = None

# ── Pre-reservas de inventario (C-04) ─────────────────────────────────────

class StockReserveIn(BaseModel):
    product_id: str
    warehouse_id: str
    quantity: float
    reference_type: str          # LAYAWAY | POS_SESSION | PRESALE
    reference_id: str
    expires_minutes: Optional[int] = 180

@app.post("/api/stock/reserve", status_code=201)
def api_reserve_stock(
    data: StockReserveIn,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(role_guard([
        "ADMIN", "ALMACENISTA", "GERENTE", "Gerente",
        "CAJERO", "Cajero", "VENDEDOR", "Vendedor",
    ]))
):
    sucursal_id = payload.get("sucursal", "MATRIZ")
    created_by  = payload.get("sub", "operador")
    try:
        res = crud.reserve_stock(
            db, empresa_id, sucursal_id,
            data.product_id, data.warehouse_id, data.quantity,
            data.reference_type, data.reference_id,
            data.expires_minutes, created_by,
        )
        db.commit()
        return {"id": res.id, "status": res.status,
                "expires_at": res.expires_at.isoformat()}
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.delete("/api/stock/reserve/{reservation_id}", status_code=200)
def api_release_reservation(
    reservation_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(role_guard(["ADMIN", "ALMACENISTA", "GERENTE", "Gerente"]))
):
    ok = crud.release_reservation(db, empresa_id, reservation_id)
    if not ok:
        raise HTTPException(status_code=404,
                            detail="Reserva no encontrada o ya no está activa")
    db.commit()
    return {"ok": True}


@app.post("/api/stock/expire", status_code=200)
def api_expire_reservations(
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(role_guard(["ADMIN", "ALMACENISTA"]))
):
    count = crud.expire_old_reservations(db, empresa_id)
    db.commit()
    return {"expired": count}


@app.get("/api/stock/available")
def api_available_stock(
    product_id: str,
    warehouse_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
):
    crud.expire_old_reservations(db, empresa_id)
    info = crud.get_available_stock_reserved(db, empresa_id, product_id, warehouse_id)
    db.commit()
    return info


@app.post("/api/traspasos/solicitud", status_code=201)
def solicitar_traspaso(
    data: TraspasoPendingIn,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(role_guard([
        "ADMIN", "ALMACENISTA", "GERENTE", "Gerente",
        "CAJERO", "Cajero", "VENDEDOR", "Vendedor", "Mostrador", "MOSTRADOR",
    ]))
):
    quien = payload.get("sub", "operador")
    sucursal_id = payload.get("sucursal", "MATRIZ")
    _audit(db, empresa_id, quien, "TRANSFER_REQUEST", "INFO", sucursal_id, {
        "product_sku": data.product_sku,
        "quantity": data.quantity,
        "source_warehouse_id": data.source_warehouse_id,
        "destination_warehouse_id": data.destination_warehouse_id,
        "delivery_mode": data.delivery_mode,
        "notes": data.notes,
        "status": "pending",
    })
    db.commit()
    return {"ok": True, "message": "Solicitud de traspaso registrada. El almacenista la procesará."}


# Asistente IA (Lightweight semantic database parser)
@app.get("/api/ai/query")
def query_ai(q: str, db: Session = Depends(get_db), empresa_id: str = Depends(get_empresa_id)):
    query_text = q.lower().strip()
    
    # Check 1: Cement search
    if "cemento" in query_text:
        # Search cement items in SQLite
        products = db.query(models.Product).filter(models.Product.empresa_id == empresa_id, models.Product.description.like("%CEMENTO%")).limit(3).all()
        if products:
            reply = "Encontré los siguientes cementos en la base de datos:<br>"
            for p in products:
                reply += f"- <b>{p.description}</b> (SKU: {p.sku}): Precio <b>${p.price:.2f}</b>, Stock: {p.stock} unidades.<br>"
            return {"reply": reply}
        return {"reply": "No encontré cementos registrados en el catálogo."}
        
    # Check 2: Customer debt checks
    elif "deuda" in query_text or "deben" in query_text or "cuentas" in query_text or "cxc" in query_text:
        # Get active accounts receivables
        debts = db.query(models.AccountsReceivable).filter(models.AccountsReceivable.empresa_id == empresa_id, models.AccountsReceivable.status == "Pendiente").limit(5).all()
        if debts:
            reply = "Aquí tienes las cuentas por cobrar pendientes más recientes:<br>"
            for d in debts:
                client_name = d.client.name if d.client else f"Cliente #{d.client_id}"
                reply += f"- <b>{client_name}</b> (Venta #{d.sale_id}): Saldo pendiente: <b>${d.current_balance:.2f}</b> (Original: ${d.original_amount:.2f}).<br>"
            return {"reply": reply}
            
        return {"reply": "No hay cuentas por cobrar pendientes en el sistema actualmente."}
        
    # Check 3: General inventory query
    elif "stock" in query_text or "inventario" in query_text:
        total_products = db.query(models.Product).count()
        low_stock = db.query(models.Product).filter(models.Product.empresa_id == empresa_id, models.Product.stock <= 0.0).count()
        return {"reply": f"El inventario cuenta actualmente con <b>{total_products} productos</b> catalogados.<br>De los cuales, {low_stock} están con stock agotado o negativo."}

    # Default reply
    return {
        "reply": "Hola, soy el <b>Asistente IA de Magdaleno</b>. Puedo ayudarte con consultas rápidas en el mostrador. Prueba preguntándome:<br>- <i>'¿Cuánto stock de cemento tenemos?'</i><br>- <i>'¿Qué cuentas por cobrar están pendientes?'</i><br>- <i>'Resumen de inventario'</i>"
    }


from fastapi.responses import RedirectResponse, FileResponse

# Serve frontend index.html explicitly at root URL
@app.get("/")
def get_index():
    index_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/index.html"))
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "CALEBSYS POS API running. Frontend index.html not found."}

# Healthcheck — sin base de datos, solo confirma que FastAPI está vivo
@app.get("/health")
def health_check():
    return {"ok": True, "service": "calebsys", "status": "running"}

# Serve login page
@app.get("/login")
def get_login():
    login_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/login.html"))
    if os.path.exists(login_path):
        return FileResponse(
            login_path,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            }
        )
    return {"message": "login.html not found."}

# Serve main menu dashboard
@app.get("/dashboard")
def get_dashboard():
    dash_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/dashboard.html"))
    if os.path.exists(dash_path):
        return FileResponse(dash_path)
    return {"message": "dashboard.html not found."}

@app.get("/admin")
def get_admin():
    # ARQUITECTURA: /admin es el Admin Shell nuevo (oficial).
    # El admin anterior queda preservado en /admin_legacy.
    admin_shell_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/admin_shell.html"))
    if os.path.exists(admin_shell_path):
        return FileResponse(
            admin_shell_path,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    return {"message": "admin_shell.html not found."}

@app.get("/home")
def get_home():
    """Landing page con dashboard por rol (Vendedor, Cajero, Almacenista)."""
    home_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/home.html"))
    if os.path.exists(home_path):
        return FileResponse(
            home_path,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    return {"message": "home.html not found."}

@app.get("/admin_legacy")
def get_admin_legacy():
    # LEGACY: Panel administrativo anterior. Preservado como respaldo.
    # No expuesto en el OS ni en rutas de usuario activo.
    admin_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/admin.html"))
    if os.path.exists(admin_path):
        return FileResponse(admin_path)
    return {"message": "admin.html (legacy) not found."}

# ── FASE 7.1A — Reloj Checador (ruta standalone) ───────────────
# Desktop (>1024px): se abre como modal desde OS con F7 o click.
# Tablet/mobile: accede directo por /asistencia/reloj.
# Desktop directo: redirige a /os (ver asistencia-reloj.html).
@app.get("/asistencia/reloj")
def get_asistencia_reloj():
    """Sirve el Reloj Checador como página standalone.
    En desktop normal se abre como modal desde el OS (F7 o click).
    Esta ruta es el punto de entrada para tablet/mobile y kiosk físico futuro.
    No requiere autenticación — la identidad se valida por NIP.
    TICKET-RH-02: Agregar device_token cuando se autoricen terminales.
    """
    reloj_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../frontend/asistencia-reloj.html")
    )
    if os.path.exists(reloj_path):
        return FileResponse(reloj_path, headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        })
    return {"message": "asistencia-reloj.html not found."}


# ══════════════════════════════════════════════════════════════
#  FASE 7.1B / RH03 — Motor de secuencia real de attendance_events
# ══════════════════════════════════════════════════════════════

VALID_ACTIONS   = {"entrada", "salida", "inicio_descanso", "fin_descanso", "auto"}
MAX_DESCANSOS   = 5
TZ_DEFAULT      = "America/Mexico_City"

# Mapa de auto-detección (estado actual → acción que se ejecuta automáticamente)
# Don Antonio: "el primer registro es entrada, el siguiente es salida, sólo son esas 2 opciones"
AUTO_ACTION_MAP = {
    "sin_jornada":     "entrada",
    "jornada_activa":  "salida",
    "descanso_activo": "fin_descanso",   # finaliza descanso antes de salida
    "jornada_cerrada": None,             # bloqueado
}

# Acciones permitidas por estado
STATE_ALLOWED = {
    "sin_jornada":     {"entrada"},
    "jornada_activa":  {"inicio_descanso", "salida"},
    "descanso_activo": {"fin_descanso"},
    "jornada_cerrada": set(),
}

# Mapa (estado, accion) -> codigo de error
SEQUENCE_ERRORS = {
    ("sin_jornada",     "salida"):           "no_hay_jornada_activa",
    ("sin_jornada",     "inicio_descanso"): "no_hay_jornada_activa",
    ("sin_jornada",     "fin_descanso"):    "no_hay_descanso_activo",
    ("jornada_activa",  "entrada"):          "jornada_ya_iniciada",
    ("jornada_activa",  "fin_descanso"):     "no_hay_descanso_activo",
    ("descanso_activo", "entrada"):          "jornada_ya_iniciada",
    ("descanso_activo", "salida"):           "descanso_activo_no_cerrado",
    ("descanso_activo", "inicio_descanso"): "descanso_ya_iniciado",
    ("jornada_cerrada", "entrada"):          "jornada_ya_cerrada",
    ("jornada_cerrada", "salida"):           "jornada_ya_cerrada",
    ("jornada_cerrada", "inicio_descanso"): "jornada_ya_cerrada",
    ("jornada_cerrada", "fin_descanso"):    "jornada_ya_cerrada",
}


def _get_local_date_str(empresa_id=None) -> str:
    """Retorna la fecha local YYYY-MM-DD en la TZ de la empresa.
    Por ahora usa America/Mexico_City para todas las empresas.
    TICKET-RH-05: Parametrizar por empresa/sucursal.
    """
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(TZ_DEFAULT)
        now_local = datetime.now(tz)
    except Exception:
        # Fallback si zoneinfo no disponible (Python <3.9)
        now_local = datetime.now()
    return now_local.strftime("%Y-%m-%d")


def _compute_jornada_state(db: Session, user_id: int, event_date: str) -> dict:
    """
    Motor de secuencia RH03.
    Lee attendance_events del usuario en event_date, ignora is_deleted=1,
    ordena por event_ts ASC y calcula:
      - current_state: sin_jornada | jornada_activa | descanso_activo | jornada_cerrada
      - descansos_completos: int (ciclos inicio_descanso/fin_descanso cerrados)
      - allowed_actions: list[str]
    """
    try:
        rows = db.execute(
            text(
                "SELECT action, event_ts FROM attendance_events "
                "WHERE user_id = :uid AND event_date = :edate AND is_deleted = 0 "
                "ORDER BY event_ts ASC"
            ),
            {"uid": user_id, "edate": event_date}
        ).fetchall()
    except Exception as _e:
        _log_main.error("[RH03] Error leyendo attendance_events: %s", str(_e))
        rows = []

    events = [r[0] for r in rows]  # lista de actions en orden cronologico

    # Calcular estado lineal
    has_entrada        = False
    has_salida         = False
    descanso_abierto   = False
    descansos_completos = 0

    for ev in events:
        if ev == "entrada":
            has_entrada = True
        elif ev == "salida":
            has_salida = True
        elif ev == "inicio_descanso":
            descanso_abierto = True
        elif ev == "fin_descanso" and descanso_abierto:
            descanso_abierto = False
            descansos_completos += 1

    # Determinar estado
    if not has_entrada:
        state = "sin_jornada"
    elif has_salida:
        state = "jornada_cerrada"
    elif descanso_abierto:
        state = "descanso_activo"
    else:
        state = "jornada_activa"

    # allowed_actions con restriccion de limite de descansos
    allowed = list(STATE_ALLOWED.get(state, set()))
    if "inicio_descanso" in allowed and descansos_completos >= MAX_DESCANSOS:
        allowed.remove("inicio_descanso")

    return {
        "state": state,
        "descansos_completos": descansos_completos,
        "descanso_abierto": descanso_abierto,
        "allowed_actions": sorted(allowed),
        "event_count": len(events),
    }


# ══════════════════════════════════════════════════════════════
#  RH-04 — Reloj con confirmación + regla de 4h + autorización admin
#  Don Antonio (02-09-2026):
#    - Al login se dispara el reloj; el usuario confirma con un botón
#      ACEPTAR (no auto-fichado). La leyenda muestra la acción detectada.
#    - Alternancia simple: entrada → salida → entrada → salida … (sin
#      estado terminal; se permiten varios turnos por día).
#    - Entre entrada y salida deben pasar ≥ 4 h. Si es menor, la salida
#      NO se registra: se crea una autorización pendiente y el admin/
#      gerente la aprueba (la hora de salida será la hora de aprobación).
#    - superadmin (dueño del software) y admin (dueño del Tenant) están
#      exentos del reloj; gerente (admin de sede) SÍ checa.
# ══════════════════════════════════════════════════════════════

RELOJ_ROLES_EXENTOS      = {"admin", "superadmin"}
RELOJ_ROLES_AUTORIZAN    = {"admin", "gerente", "superadmin"}
RELOJ_MIN_HORAS_JORNADA  = 4.0
RELOJ_ACTION_LABELS      = {"entrada": "Hora de Ingreso", "salida": "Hora de Salida"}


def _reloj_ficho_en_control_de_acceso(db, user_id, empresa_id: str) -> bool:
    """RH-06 — ¿el usuario ya registró su ingreso en un dispositivo/servicio
    externo de control de acceso (torniquete, biométrico, RFID)?

    Integración configurable por Tenant en AdminConfig, clave
    ``integrations.control_acceso``::

        {"enabled": true,
         "url": "https://.../estado?user={user_id}&date={date}",
         "auth_header": "Bearer xxx",              # opcional
         "true_values": ["1","true","dentro"]}     # opcional

    Se hace un GET; la respuesta puede ser texto plano o JSON
    ``{"inside": true}``. Sin config / error / timeout → False (mismo
    comportamiento que el stub anterior). El equipo físico se enchufa aquí
    sin tocar el resto del flujo del reloj.
    """
    try:
        if not (db is not None and empresa_id):
            return False
        row = (
            db.query(models.AdminConfig)
            .filter(models.AdminConfig.empresa_id == empresa_id)
            .filter(models.AdminConfig.config_key == "integrations.control_acceso")
            .first()
        )
        cfg = (row.config_val if row else None) or {}
        if not (isinstance(cfg, dict) and cfg.get("enabled") and cfg.get("url")):
            return False
        import urllib.request as _rq
        import json as _json
        url = (str(cfg["url"])
               .replace("{user_id}", str(user_id))
               .replace("{date}", _get_local_date_str(empresa_id)))
        if not url.startswith("https://"):
            return False
        req = _rq.Request(url, method="GET")
        if cfg.get("auth_header"):
            req.add_header("Authorization", str(cfg["auth_header"]))
        with _rq.urlopen(req, timeout=6) as resp:
            body = resp.read().decode("utf-8", "ignore").strip()
        try:
            data = _json.loads(body)
            if isinstance(data, dict):
                return bool(data.get("inside") or data.get("dentro") or data.get("ya_ficho"))
        except Exception:
            pass
        trues = [str(x).lower() for x in (cfg.get("true_values") or ["1", "true", "yes", "dentro"])]
        return body.lower() in trues
    except Exception:
        return False


def _reloj_next_action_alternada(db: Session, user_id: int, event_date: str) -> str:
    """RH-04: acción alternada simple. Cuenta entrada/salida del día (ignora
    descanso). #entradas > #salidas ⇒ hay turno abierto ⇒ próxima 'salida';
    en cualquier otro caso ⇒ 'entrada'. Sin estado terminal."""
    try:
        rows = db.execute(
            text("SELECT action FROM attendance_events "
                 "WHERE user_id = :uid AND event_date = :edate AND is_deleted = 0 "
                 "AND action IN ('entrada','salida') ORDER BY event_ts ASC"),
            {"uid": user_id, "edate": event_date}
        ).fetchall()
    except Exception as _e:
        _log_main.warning("[RH04] next_action: %s — asumo 'entrada'", str(_e))
        return "entrada"
    n_ent = sum(1 for r in rows if r[0] == "entrada")
    n_sal = sum(1 for r in rows if r[0] == "salida")
    return "salida" if n_ent > n_sal else "entrada"


def _reloj_ultima_entrada_abierta_ts(db: Session, user_id: int, event_date: str):
    """event_ts (str ISO) de la última 'entrada' sin 'salida' posterior, o None."""
    try:
        rows = db.execute(
            text("SELECT action, event_ts FROM attendance_events "
                 "WHERE user_id = :uid AND event_date = :edate AND is_deleted = 0 "
                 "AND action IN ('entrada','salida') ORDER BY event_ts ASC"),
            {"uid": user_id, "edate": event_date}
        ).fetchall()
    except Exception:
        return None
    last_entrada = None
    for action, ts in rows:
        if action == "entrada":
            last_entrada = ts
        elif action == "salida":
            last_entrada = None
    return last_entrada


def _reloj_horas_desde(ts_iso: str) -> float:
    """Horas transcurridas desde un timestamp ISO hasta ahora (UTC)."""
    try:
        t0 = datetime.fromisoformat(str(ts_iso).replace("Z", "+00:00"))
        if t0.tzinfo is None:
            t0 = t0.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t0).total_seconds() / 3600.0
    except Exception:
        return 999.0


# ── Validación de NIP + registro de checada (RH03) ─────────────
class RelojNipRequest(BaseModel):
    nip: str
    action: str  # entrada | salida | inicio_descanso | fin_descanso


@app.post("/api/asistencia/reloj/validar-nip")
def validar_nip_reloj(
    req: RelojNipRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    FASE 7.1B / RH03 — Valida NIP y registra checada con validación de secuencia.

    Flujo:
      1. Validar action y formato NIP.
      2. Detectar columnas DB (compatibilidad con schema actual).
      3. Verificar bcrypt contra users.pin_hash.
      4. Detectar si attendance_events existe (mode=live vs mode=prototype).
      5. Si mode=live: calcular estado actual, validar secuencia.
         - Si rompe secuencia: ok=false, saved=false, error=codigo. NO insertar.
         - Si válida: insertar evento, recalcular estado, devolver ok=true.
      6. Si mode=prototype: ok=true, saved=false (sin attendance_events).

    Regla de secuencia oficial (aprobada 2026-06-29):
      sin_jornada    -> solo entrada
      jornada_activa -> inicio_descanso | salida
      descanso_activo-> solo fin_descanso
      jornada_cerrada-> ninguna
      Max 5 descansos por jornada.
      Si rompe secuencia: NO se guarda (rechazado guardar con warning).
    """
    import bcrypt as _bcrypt

    # -- 1. Validar action ------------------------------------------
    # "auto" es válido — se resuelve después de verificar el estado de jornada
    if req.action not in VALID_ACTIONS:
        return JSONResponse({"ok": False, "saved": False, "error": "accion_invalida"})

    # -- 2. Validar NIP ---------------------------------------------
    nip = req.nip.strip()
    if len(nip) != 4 or not nip.isdigit():
        return JSONResponse({"ok": False, "saved": False, "error": "nip_invalido"})

    # -- 3. Contexto de sesión (empresa/sucursal) ------------------
    empresa_id  = None
    sucursal_id = None
    try:
        _raw_tok = request.cookies.get("access_token") or \
                   request.headers.get("Authorization", "")
        _tok = _raw_tok.strip().strip('"').strip("'")
        if _tok.lower().startswith("bearer "):
            _tok = _tok[7:]
        if _tok:
            payload = jwt.decode(
                _tok,
                JWT_SECRET,
                algorithms=[JWT_ALGORITHM]
            )
            empresa_id  = payload.get("empresa")
            sucursal_id = payload.get("sucursal")
    except Exception:
        pass

    # -- 4. Detectar columnas DB -----------------------------------
    try:
        pragma_result = db.execute(text("PRAGMA table_info(users)")).fetchall()
        col_names = [row[1] for row in pragma_result]
    except Exception as _perr:
        _log_main.error("[RH03] PRAGMA error: %s", str(_perr))
        return JSONResponse({"ok": False, "saved": False, "error": "error_servidor"})

    if "pin_hash" not in col_names:
        _log_main.warning("[RH03] pin_hash column not found in users table (DB not migrated?)")
        return JSONResponse({
            "ok": False, "saved": False,
            "error": "nip_no_configurado",
            "_info": "pin_hash column not in DB yet"
        })

    col_usuario = "usuario_id"      if "usuario_id"      in col_names else "username"
    col_activo  = "is_active"       if "is_active"        in col_names else None
    col_status  = "status"          if "status"           in col_names else None
    col_nombre  = "nombre_completo" if "nombre_completo"  in col_names else col_usuario

    if col_activo:
        where_active = f"{col_activo} = 1"
    elif col_status:
        where_active = f"{col_status} = 'ACTIVE'"
    else:
        where_active = "1=1"

    # -- 5. Query y verificación bcrypt ----------------------------
    sql_parts = [
        f"SELECT id, {col_usuario}, {col_nombre}, role, empresa_id, sucursal_id, pin_hash",  # nosec B608 — cols from PRAGMA whitelist, never user input
        "FROM users",
        f"WHERE {where_active} AND pin_hash IS NOT NULL",  # nosec B608
    ]
    params = {}
    if empresa_id:
        sql_parts.append("AND empresa_id = :empresa_id")
        params["empresa_id"] = empresa_id

    try:
        rows = db.execute(text(" ".join(sql_parts)), params).fetchall()
    except Exception as _qerr:
        _log_main.error("[RH03] Query error: %s", str(_qerr))
        return JSONResponse({"ok": False, "saved": False, "error": "error_servidor"})

    if not rows:
        return JSONResponse({"ok": False, "saved": False, "error": "nip_no_configurado"})

    matched = None
    for row in rows:
        try:
            pin_bytes  = nip.encode("utf-8")
            hash_val   = row[-1]  # pin_hash es el último campo seleccionado
            hash_bytes = hash_val.encode("utf-8") if isinstance(hash_val, str) else hash_val
            if _bcrypt.checkpw(pin_bytes, hash_bytes):
                matched = row
                break
        except Exception:
            continue

    if matched is None:
        return JSONResponse({"ok": False, "error": "nip_invalido"})

    # Usuario encontrado — construir respuesta
    ts = datetime.now(timezone.utc).isoformat()

    # Extraer campos por posición (id, usuario_id/username, nombre, role, empresa_id, sucursal_id, pin_hash)
    u_id       = matched[0]
    u_username = matched[1]
    u_nombre   = matched[2]
    u_role     = matched[3]
    u_empresa  = matched[4]
    u_sucursal = matched[5]

    # -- 6. Resolver action="auto" ----------------------------------
    # Don Antonio (20-08-2026): "el primer registro es entrada, el siguiente
    # es salida, sólo son esas 2 opciones" — sin botones manuales.
    resolved_action = req.action
    jornada_state_info = None
    if req.action == "auto":
        event_date = _get_local_date_str()
        try:
            jornada_state_info = _compute_jornada_state(db, u_id, event_date)
            auto_act = AUTO_ACTION_MAP.get(jornada_state_info["state"])
            if auto_act is None:
                return JSONResponse({
                    "ok":    False,
                    "saved": False,
                    "error": "jornada_cerrada",
                    "state": jornada_state_info["state"]
                })
            resolved_action = auto_act
        except Exception as _ae:
            _log_main.warning("[RELOJ-AUTO] attendance_events no disponible: %s — usando 'entrada' por defecto", str(_ae))
            resolved_action = "entrada"   # modo prototipo: asume primera checada

    _log_main.info(
        "[RELOJ-S4] NIP OK: user=%s empresa=%s original_action=%s resolved=%s",
        u_username, u_empresa, req.action, resolved_action
    )

    # ── S4: Para acciones explícitas (no-auto), validar secuencia ──
    if req.action != "auto":
        event_date_for_seq = _get_local_date_str()
        try:
            jornada_state_info = _compute_jornada_state(db, u_id, event_date_for_seq)
            cur_state = jornada_state_info["state"]
            if resolved_action not in STATE_ALLOWED.get(cur_state, set()):
                err_key = SEQUENCE_ERRORS.get((cur_state, resolved_action), "secuencia_invalida")
                return JSONResponse({
                    "ok": False, "saved": False,
                    "error": err_key, "state": cur_state
                })
        except Exception as _seq_err:
            _log_main.warning("[RELOJ-S4] No pudo validar secuencia: %s", str(_seq_err))
            jornada_state_info = None

    # ── S4: INSERT en attendance_events ───────────────────────────
    saved = False
    mode  = "prototype"
    event_id         = str(_uuid.uuid4())
    event_date_str   = _get_local_date_str()
    event_ts_str     = datetime.now(timezone.utc).isoformat()
    u_empresa_final  = u_empresa  or (empresa_id  or "DEMO")
    u_sucursal_final = u_sucursal or (sucursal_id or "MATRIZ")

    try:
        db.execute(
            text(
                "INSERT INTO attendance_events "
                "(id, user_id, empresa_id, sucursal_id, event_date, event_ts, action, device_info, is_deleted) "
                "VALUES (:id, :uid, :emp, :suc, :edate, :ets, :act, :dev, 0)"
            ),
            {
                "id":    event_id,
                "uid":   u_id,
                "emp":   u_empresa_final,
                "suc":   u_sucursal_final,
                "edate": event_date_str,
                "ets":   event_ts_str,
                "act":   resolved_action,
                "dev":   request.client.host if request.client else None,
            }
        )
        db.commit()
        saved = True
        mode  = "live"
        _log_main.info(
            "[RELOJ-S4] Checada guardada: id=%s user=%s action=%s date=%s",
            event_id, u_username, resolved_action, event_date_str
        )
    except Exception as _ins_err:
        _log_main.error("[RELOJ-S4] INSERT attendance_events falló: %s", str(_ins_err))

    # ── Recalcular estado post-insert ──────────────────────────────
    state_to_return = None
    try:
        post_state = _compute_jornada_state(db, u_id, event_date_str)
        state_to_return = post_state.get("state")
    except Exception:
        if jornada_state_info:
            state_to_return = jornada_state_info.get("state")

    return JSONResponse({
        "ok":    True,
        "mode":  mode,
        "saved": saved,
        "user": {
            "id":           u_id,
            "username":     u_username,
            "display_name": u_nombre,
            "role":         u_role,
            "empresa_id":   u_empresa_final,
            "sucursal_id":  u_sucursal_final
        },
        "action":       resolved_action,
        "action_input": req.action,
        "state":        state_to_return,
        "timestamp":    event_ts_str,
        "event_id":     event_id if saved else None,
    })
# ── FIN SESIÓN 4 — live mode con INSERT real ──────────────────


# ══════════════════════════════════════════════════════════════
# SESIÓN 5 — Fichar sin NIP (JWT identity)
# POST /api/asistencia/reloj/fichar
# El usuario ya está autenticado; se extrae identidad del JWT,
# se resuelve la acción automáticamente y se registra la checada.
# Reemplaza el flujo validar-nip para todos los clientes web.
# ══════════════════════════════════════════════════════════════
@app.post("/api/asistencia/reloj/fichar")
def fichar_reloj_jwt(request: Request, db: Session = Depends(get_db)):
    """
    Registra una checada (entrada/salida) usando la identidad del JWT activo.
    No requiere NIP — el usuario ya está autenticado en la sesión web.

    Flujo:
      1. Extraer y decodificar JWT (Authorization header o cookie).
      2. Resolver user_id desde users.username == JWT.sub.
      3. Detectar si attendance_events existe (live vs prototype).
      4. Calcular estado de jornada actual.
      5. Resolver acción via AUTO_ACTION_MAP.
      6. Si jornada_cerrada → rechazar con error.
      7. INSERT en attendance_events.
      8. Recalcular estado post-insert y devolver respuesta.

    Devuelve el mismo shape que validar-nip para reutilizar el
    frontend de éxito (showSuccessView, toast, auto-close).
    """
    import uuid as _uuid2

    # -- 1. Extraer JWT -------------------------------------------
    _raw_tok = request.cookies.get("access_token") or \
               request.headers.get("Authorization", "")
    token = _raw_tok.strip().strip('"').strip("'")
    if token.lower().startswith("bearer "):
        token = token[7:]

    if not token:
        return JSONResponse({"ok": False, "saved": False, "error": "no_autenticado"}, status_code=401)

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username_jwt = payload.get("sub") or payload.get("user_id") or payload.get("username")
        empresa_id   = payload.get("empresa")
        sucursal_id  = payload.get("sucursal")
    except Exception:
        return JSONResponse({"ok": False, "saved": False, "error": "token_invalido"}, status_code=401)

    if not username_jwt:
        return JSONResponse({"ok": False, "saved": False, "error": "no_autenticado"}, status_code=401)

    # -- 2. Resolver usuario en DB --------------------------------
    try:
        pragma_result = db.execute(text("PRAGMA table_info(users)")).fetchall()
        col_names     = [row[1] for row in pragma_result]
    except Exception as _perr:
        _log_main.error("[FICHAR] PRAGMA error: %s", str(_perr))
        return JSONResponse({"ok": False, "saved": False, "error": "error_servidor"})

    col_nombre  = "nombre_completo" if "nombre_completo" in col_names else "username"
    col_photo   = "photo_url"       if "photo_url"       in col_names else None
    col_empcode = "employee_code"   if "employee_code"   in col_names else None

    select_extra = ""
    if col_photo:   select_extra += f", {col_photo}"
    if col_empcode: select_extra += f", {col_empcode}"

    try:
        row = db.execute(
            text(f"SELECT id, username, {col_nombre}, role, empresa_id, sucursal_id{select_extra} "  # nosec B608 — cols from PRAGMA whitelist
                 f"FROM users WHERE username = :u LIMIT 1"),
            {"u": username_jwt}
        ).fetchone()
    except Exception as _qerr:
        _log_main.error("[FICHAR] Query error: %s", str(_qerr))
        return JSONResponse({"ok": False, "saved": False, "error": "error_servidor"})

    if not row:
        return JSONResponse({"ok": False, "saved": False, "error": "usuario_no_encontrado"}, status_code=404)

    u_id       = row[0]
    u_username = row[1]
    u_nombre   = row[2]
    u_role     = row[3]
    u_empresa  = row[4] or empresa_id  or "DEMO"
    u_sucursal = row[5] or sucursal_id or "MATRIZ"
    u_photo    = row[6] if col_photo   else None
    u_empcode  = row[7 if col_photo else 6] if col_empcode else None

    # -- 3. Detectar modo (live vs prototype) ---------------------
    try:
        tbl_check = db.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='attendance_events'")
        ).fetchone()
        mode = "live" if tbl_check else "prototype"
    except Exception:
        mode = "prototype"

    event_date_str  = _get_local_date_str(u_empresa)
    event_ts_str    = datetime.now(timezone.utc).isoformat()
    resolved_action = "entrada"
    jornada_info    = None

    # -- RH-04/RH-06: ¿ya fichó en dispositivo externo de control de acceso? --
    if _reloj_ficho_en_control_de_acceso(db, u_id, u_empresa):
        return JSONResponse({
            "ok": False, "saved": False,
            "error": "ya_ficho_control_acceso",
            "message": "Ya registraste tu ingreso en el control de acceso.",
        })

    if mode == "live":
        _reloj_ensure_auth_table(db)

    # -- 4-5. Resolver acción — RH-04: alternancia entrada/salida ------
    if mode == "live":
        try:
            resolved_action = _reloj_next_action_alternada(db, u_id, event_date_str)
        except Exception as _se:
            _log_main.warning("[FICHAR] next_action falló: %s — asumiendo 'entrada'", str(_se))
            resolved_action = "entrada"

    # -- RH-04: regla de 4h — salida temprana requiere autorización ----
    if mode == "live" and resolved_action == "salida":
        entrada_ts = _reloj_ultima_entrada_abierta_ts(db, u_id, event_date_str)
        if entrada_ts:
            horas = _reloj_horas_desde(entrada_ts)
            if horas < RELOJ_MIN_HORAS_JORNADA:
                try:
                    existing = db.execute(text(
                        "SELECT id FROM attendance_authorizations "
                        "WHERE user_id = :uid AND event_date = :edate AND entrada_ts = :ets "
                        "AND status = 'pendiente' ORDER BY id DESC LIMIT 1"
                    ), {"uid": u_id, "edate": event_date_str, "ets": entrada_ts}).fetchone()
                    if existing:
                        auth_id = existing[0]
                    else:
                        res = db.execute(text(
                            "INSERT INTO attendance_authorizations "
                            "(user_id, empresa_id, sucursal_id, event_date, entrada_ts, "
                            " intento_ts, horas_transcurridas, status) "
                            "VALUES (:uid, :emp, :suc, :edate, :ent, :intento, :horas, 'pendiente')"
                        ), {
                            "uid": u_id, "emp": u_empresa, "suc": u_sucursal,
                            "edate": event_date_str, "ent": entrada_ts,
                            "intento": event_ts_str, "horas": round(horas, 2),
                        })
                        db.commit()
                        auth_id = res.lastrowid
                except Exception as _ae:
                    _log_main.error("[RH04] No pudo crear autorización: %s", str(_ae))
                    auth_id = None
                return JSONResponse({
                    "ok": False, "saved": False,
                    "error": "requiere_autorizacion",
                    "action": "salida",
                    "horas": round(horas, 2),
                    "horas_minimas": RELOJ_MIN_HORAS_JORNADA,
                    "authorization_id": auth_id,
                    "message": (
                        f"Tu salida requiere autorización del administrador "
                        f"(llevas {horas:.1f} h desde la entrada, mínimo "
                        f"{int(RELOJ_MIN_HORAS_JORNADA)} h)."
                    ),
                })

    # -- 6. INSERT ------------------------------------------------
    saved    = False
    event_id = str(_uuid2.uuid4())

    if mode == "live":
        try:
            db.execute(
                text(
                    "INSERT INTO attendance_events "
                    "(id, user_id, empresa_id, sucursal_id, event_date, event_ts, action, device_info, is_deleted) "
                    "VALUES (:id, :uid, :emp, :suc, :edate, :ets, :act, :dev, 0)"
                ),
                {
                    "id":    event_id,
                    "uid":   u_id,
                    "emp":   u_empresa,
                    "suc":   u_sucursal,
                    "edate": event_date_str,
                    "ets":   event_ts_str,
                    "act":   resolved_action,
                    "dev":   request.client.host if request.client else None,
                }
            )
            db.commit()
            saved = True
            _log_main.info(
                "[FICHAR] Checada JWT: id=%s user=%s action=%s date=%s",
                event_id, u_username, resolved_action, event_date_str
            )
            try:
                db.add(models.AuditLog(
                    empresa_id=u_empresa, sucursal_id=u_sucursal, user_id=u_username,
                    action=f"RELOJ_FICHAR: {resolved_action}", severity="INFO",
                ))
                db.commit()
            except Exception:
                db.rollback()
        except Exception as _ins_err:
            _log_main.error("[FICHAR] INSERT falló: %s", str(_ins_err))

    # -- 7. Recalcular estado post-insert -------------------------
    state_final = None
    next_action_final = None
    if mode == "live" and saved:
        try:
            post = _compute_jornada_state(db, u_id, event_date_str)
            state_final = post.get("state")
        except Exception:
            state_final = jornada_info.get("state") if jornada_info else None
        try:
            next_action_final = _reloj_next_action_alternada(db, u_id, event_date_str)
        except Exception:
            next_action_final = None
    elif jornada_info:
        state_final = jornada_info.get("state")

    return JSONResponse({
        "ok":    True,
        "mode":  mode,
        "saved": saved,
        "user": {
            "id":           u_id,
            "username":     u_username,
            "display_name": u_nombre,
            "role":         u_role,
            "empresa_id":   u_empresa,
            "sucursal_id":  u_sucursal,
            "photo_url":    u_photo,
            "employee_code": u_empcode,
        },
        "action":    resolved_action,
        "state":     state_final,
        "next_action":       next_action_final,
        "next_action_label": RELOJ_ACTION_LABELS.get(next_action_final) if next_action_final else None,
        "timestamp": event_ts_str,
        "event_id":  event_id if saved else None,
    })
# ── FIN SESIÓN 5 — fichar sin NIP ─────────────────────────────


# ── SESIÓN 4 — Estado de jornada hoy (para auto-show en home) ─
@app.get("/api/asistencia/reloj/estado-hoy")
def get_estado_hoy(request: Request, db: Session = Depends(get_db)):
    """
    Devuelve el estado de jornada del usuario autenticado para hoy.
    El frontend lo consulta al cargar para decidir si abre el modal del Reloj.
    """
    try:
        _raw = request.cookies.get("access_token") or \
               request.headers.get("Authorization", "")
        token = _raw.strip().strip('"').strip("'")
        if token.lower().startswith("bearer "):
            token = token[7:]
        if not token:
            return JSONResponse({"fichado_hoy": False, "state": "sin_jornada", "reason": "no_token"})
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username_from_token = payload.get("sub") or payload.get("user_id")
    except Exception:
        return JSONResponse({"fichado_hoy": False, "state": "sin_jornada", "reason": "token_error"})

    if not username_from_token:
        return JSONResponse({"fichado_hoy": False, "state": "sin_jornada", "reason": "no_user_id"})

    try:
        row = db.execute(
            text("SELECT id FROM users WHERE username = :u LIMIT 1"),
            {"u": username_from_token}
        ).fetchone()
        if not row:
            return JSONResponse({"fichado_hoy": False, "state": "sin_jornada", "reason": "user_not_found"})
        real_user_id = row[0]
    except Exception as _ue:
        _log_main.warning("[ESTADO-HOY] No pudo resolver user_id: %s", str(_ue))
        return JSONResponse({"fichado_hoy": False, "state": "sin_jornada", "reason": "db_error"})

    event_date = _get_local_date_str()
    try:
        info  = _compute_jornada_state(db, real_user_id, event_date)
        state = info.get("state", "sin_jornada")
    except Exception as _e:
        _log_main.warning("[ESTADO-HOY] Error: %s", str(_e))
        return JSONResponse({"fichado_hoy": False, "state": "sin_jornada", "reason": "db_error"})

    # RH-04: acción alternada + leyenda para el botón ACEPTAR
    try:
        next_act = _reloj_next_action_alternada(db, real_user_id, event_date)
    except Exception:
        next_act = "entrada"

    return JSONResponse({
        "fichado_hoy":       state != "sin_jornada",
        "state":             state,
        "event_date":        event_date,
        "next_action":       next_act,
        "next_action_label": RELOJ_ACTION_LABELS.get(next_act, "Registrar checada"),
        "already_external":  _reloj_ficho_en_control_de_acceso(db, real_user_id, payload.get("empresa") or ""),
    })


# Serve enterprise OS desktop
@app.get("/os")
def get_os():
    os_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/os.html"))
    if os.path.exists(os_path):
        return FileResponse(os_path, headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        })
    return {"message": "os.html not found."}

@app.get("/inicio")
def get_inicio():
    inicio_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/inicio.html"))
    if os.path.exists(inicio_path):
        return FileResponse(inicio_path, headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        })
    return {"message": "inicio.html not found."}

# Real SAT Constancia Parser
@app.post("/api/constancia")
async def parse_constancia_sat(file: UploadFile = FastAPIFile(...)):
    content_bytes = await file.read()
    extracted = {}
    is_pdf = file.filename.lower().endswith(".pdf") or (file.content_type or "").startswith("application/pdf")
    if is_pdf:
        try:
            import pdfplumber, re as re2
            with pdfplumber.open(io.BytesIO(content_bytes)) as pdf:
                # x_tolerance=2 ayuda a preservar los espacios en la direccion
                raw_pages = [p.extract_text(x_tolerance=2) or "" for p in pdf.pages]
                full_text = "".join(raw_pages)
                # Normalizar algunas etiquetas comunes que pueden separarse para las regex
                labels_to_fix = [
                    ("Nombre de Vialidad:", "NombredeVialidad:"),
                    ("Número Exterior:", "NúmeroExterior:"),
                    ("N[uú]mero Exterior:", "NúmeroExterior:"),
                    ("Número Interior:", "NúmeroInterior:"),
                    ("N[uú]mero Interior:", "NúmeroInterior:"),
                    ("Nombre de la Colonia:", "NombredelaColonia:"),
                    ("Nombre del Municipio o Demarcación Territorial:", "NombredelMunicipiooDemarcaciónTerritorial:"),
                    ("Nombre de la Entidad Federativa:", "NombredelaEntidadFederativa:"),
                    ("Nombre de la Localidad:", "NombredelaLocalidad:"),
                    ("Código Postal:", "CódigoPostal:"),
                    ("C[oó]digo Postal:", "CódigoPostal:"),
                ]
                for old, new in labels_to_fix:
                    full_text = re2.sub(old, new, full_text, flags=re2.IGNORECASE)
                
                # Quitar espacios extraños en las etiquetas
                full_text = re2.sub(r"Nombre\s+de\s+Vialidad", "NombredeVialidad", full_text)
                full_text = re2.sub(r"N[uú]mero\s+Exterior", "NúmeroExterior", full_text)
                full_text = re2.sub(r"N[uú]mero\s+Interior", "NúmeroInterior", full_text)
                full_text = re2.sub(r"Nombre\s+de\s+la\s+Colonia", "NombredelaColonia", full_text)
                full_text = re2.sub(r"Nombre\s+del\s+Municipio\s+o\s+Demarcaci[oó]n\s+Territorial", "NombredelMunicipiooDemarcaciónTerritorial", full_text)
                full_text = re2.sub(r"Nombre\s+de\s+la\s+Entidad\s+Federativa", "NombredelaEntidadFederativa", full_text)
                full_text = re2.sub(r"Nombre\s+de\s+la\s+Localidad", "NombredelaLocalidad", full_text)
                
                _log_main.debug("PDF text extracted: %s", full_text[:500])
                
            # RFC - busca "RFC: XXXX" primero, luego patron generico
            rfc_m = re2.search(r"RFC:\s*([A-Z&\u00d1]{3,4}\d{6}[A-Z\d]{2,3})", full_text)
            if not rfc_m:
                rfc_m = re2.search(r"\b([A-Z&\u00d1]{3,4}\d{6}[A-Z\d]{2,3})\b", full_text)
            if rfc_m:
                extracted["rfc"] = rfc_m.group(1)

            # CURP
            curp_m = re2.search(r"CURP:\s*([A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]{2})", full_text)
            if curp_m:
                extracted["curp"] = curp_m.group(1)

            # Nombre: persona fisica
            # Intentar extraer el nombre con espacios desde el encabezado
            header_name_m = re2.search(r'Registro Federal de Contribuyentes\n([^\n]+)\nLugar y Fecha de Emisi[oó\ufffd]n\n([^\n]+)', full_text)
            if header_name_m:
                nombres = header_name_m.group(1).strip()
                apellidos = header_name_m.group(2).strip()
                extracted["nombre"] = f"{nombres} {apellidos}".strip()
            else:
                # Intento super robusto para nombre
                # Busca 'Nombre, denominaci[oó]n o raz[oó]n social:\n' y la l[ií]nea que le sigue, si no es una etiqueta conocida
                alt_name_m = re2.search(r'raz[oó\ufffd]n social:?\n(.*?)\n', full_text, re2.IGNORECASE)
                if alt_name_m:
                    extracted["nombre"] = alt_name_m.group(1).strip()
                else:
                    # En la constancia a veces el nombre aparece justo antes de RFC si es persona fisica
                    if extracted.get("rfc"):
                        parts = full_text.split(extracted["rfc"])
                        if parts and len(parts) > 0:
                            lines_before_rfc = parts[0].strip().split('\n')
                            if len(lines_before_rfc) > 0:
                                maybe_name = lines_before_rfc[-1].strip()
                                if len(maybe_name) > 5 and 'RFC' not in maybe_name and 'Registro' not in maybe_name:
                                    extracted["nombre"] = maybe_name

            if not extracted.get("nombre"):
                nom_m = re2.search(r"Nombre\(s\):\s*([A-Z\s]+)", full_text)
                ap1_m = re2.search(r"PrimerApellido:\s*([A-Z\s]+)", full_text)
                ap2_m = re2.search(r"SegundoApellido:\s*([A-Z\s]+)", full_text)
                if nom_m and ap1_m:
                    nombres = nom_m.group(1).strip().split("\n")[0]
                    ap1 = ap1_m.group(1).strip().split("\n")[0]
                    ap2 = ap2_m.group(1).strip().split("\n")[0] if ap2_m else ""
                    extracted["nombre"] = f"{nombres} {ap1} {ap2}".strip()
                else:
                    # Persona moral
                    dm_m = re2.search(r"(?:Denominaci[o\u00f3\ufffd]n|raz[o\u00f3\ufffd]n\s+social)[^\n]*\n\s*(.+)", full_text, re2.IGNORECASE)
                    if dm_m:
                        extracted["nombre"] = dm_m.group(1).strip()

            # Nombre comercial
            nc_m = re2.search(r"NombreComercial:\s*([A-Z\s]+)", full_text)
            if nc_m:
                extracted["nombre_comercial"] = nc_m.group(1).strip().split("\n")[0]

            # Codigo postal
            cp_m = re2.search(r"CódigoPostal:\s*(\d{5})", full_text)
            if cp_m:
                extracted["cp"] = cp_m.group(1)

            # Regimen fiscal
            reg_raw = ""
            reg_m = re2.search(r"R[e\u00e9\ufffd]gimen Fecha Inicio Fecha Fin\n([^\n]+)", full_text)
            if reg_m:
                reg_raw = reg_m.group(1).strip()
            else:
                reg_m = re2.search(r"R[e\u00e9\ufffd]gimen(?:es)?:\s*\n*(.+)", full_text)
                if not reg_m:
                    reg_m = re2.search(r"R[e\u00e9\ufffd]gimen(?:\s+Fiscal)?[:\s]+([^\n]+)", full_text, re2.IGNORECASE)
                if reg_m:
                    reg_raw = reg_m.group(1).strip()
                    
            if not reg_raw:
                # Alternate search
                for line in full_text.split('\n'):
                    if 'Régimen' in line or 'Rgimen' in line:
                        reg_raw = line
                        break
            
            if reg_raw:
                r_lower = reg_raw.lower()
                reg_code = ""
                if "general de ley personas morales" in r_lower: reg_code = "601"
                elif "simplificado de ley personas morales" in r_lower: reg_code = "602"
                elif "fines no lucrativos" in r_lower: reg_code = "603"
                elif "pequeños contribuyentes" in r_lower or "pequeos contribuyentes" in r_lower: reg_code = "604"
                elif "sueldos y salarios" in r_lower: reg_code = "605"
                elif "arrendamiento" in r_lower: reg_code = "606"
                elif "enajenación" in r_lower or "enajenacion" in r_lower: reg_code = "607"
                elif "demás ingresos" in r_lower or "demas ingresos" in r_lower: reg_code = "608"
                elif "consolidación" in r_lower or "consolidacion" in r_lower: reg_code = "609"
                elif "residentes en el extranjero" in r_lower: reg_code = "610"
                elif "dividendos" in r_lower: reg_code = "611"
                elif "actividades empresariales y profesionales" in r_lower: reg_code = "612"
                elif "intermedio" in r_lower and "actividades empresariales" in r_lower: reg_code = "613"
                elif "intereses" in r_lower: reg_code = "614"
                elif "premios" in r_lower: reg_code = "615"
                elif "sin obligaciones" in r_lower: reg_code = "616"
                elif "pemex" in r_lower: reg_code = "617"
                elif "simplificado de ley personas" in r_lower and "físicas" in r_lower: reg_code = "618"
                elif "préstamos" in r_lower or "prestamos" in r_lower: reg_code = "619"
                elif "sociedades cooperativas" in r_lower: reg_code = "620"
                elif "incorporación fiscal" in r_lower or "incorporacion fiscal" in r_lower: reg_code = "621"
                elif "agrícolas" in r_lower or "agricolas" in r_lower: reg_code = "622"
                elif "opcional para grupos" in r_lower: reg_code = "623"
                elif "coordinados" in r_lower: reg_code = "624"
                elif "plataformas tecnológicas" in r_lower or "plataformas tecnologicas" in r_lower: reg_code = "625"
                elif "simplificado de confianza" in r_lower: reg_code = "626"
                
                extracted["regimen"] = reg_code if reg_code else reg_raw

            # Estado
            estado_m = re2.search(r"NombredelaEntidadFederativa:\s*([A-Z\s]+)", full_text)
            if estado_m:
                extracted["estado"] = estado_m.group(1).strip().split("\n")[0]

            # Municipio
            mun_m = re2.search(r"NombredelMunicipiooDemarcaciónTerritorial:\s*([A-Z\s]+)", full_text)
            if mun_m:
                extracted["municipio"] = mun_m.group(1).strip().split("\n")[0]

            # Localidad
            loc_m = re2.search(r"NombredelaLocalidad:\s*([A-Z\s]+)", full_text)
            if loc_m:
                extracted["localidad"] = loc_m.group(1).strip().split("\n")[0]

            # Colonia
            colonia_m = re2.search(r"NombredelaColonia:\s*([A-Z\s\d]+)", full_text)
            if colonia_m:
                extracted["colonia"] = colonia_m.group(1).strip().split("\n")[0]

            # Direccion, Numero Exterior e Interior
            calle_m = re2.search(r"NombredeVialidad:\s*([A-Z\s\d]+)", full_text)
            num_ext_m = re2.search(r"NúmeroExterior:\s*([A-Z\d\s]+)", full_text)
            num_int_m = re2.search(r"NúmeroInterior:\s*([A-Z\d\s]+)", full_text)
            
            if calle_m:
                calle = calle_m.group(1).strip().split("\n")[0]
                num_ext = num_ext_m.group(1).strip().split("\n")[0] if num_ext_m else ""
                num_int = num_int_m.group(1).strip().split("\n")[0] if num_int_m else ""
                
                extracted["direccion"] = calle
                if num_ext: extracted["numero_ext"] = num_ext
                if num_int: extracted["numero_int"] = num_int

            # Estatus
            est_m = re2.search(r"Estatusenel(?:padr[o\u00f3]n|RFC):\s*([A-Z]+)", full_text, re2.IGNORECASE)
            if est_m:
                extracted["estatus"] = est_m.group(1).strip()

            def unmush(t):
                if not t: return t
                t = t.replace("BAJACALIFORNIASUR", "BAJA CALIFORNIA SUR")
                t = t.replace("GUERRERONEGRO", "GUERRERO NEGRO")
                # Eliminar ruido como " E" o " N" al final (Entidad, Nombre, etc)
                t = re2.sub(r'\s+[A-Z]$', '', t).strip()
                return t
                
            if "estado" in extracted: extracted["estado"] = unmush(extracted["estado"])
            if "localidad" in extracted: extracted["localidad"] = unmush(extracted["localidad"])
            if "municipio" in extracted: extracted["municipio"] = unmush(extracted["municipio"])
            if "direccion" in extracted: extracted["direccion"] = unmush(extracted["direccion"])
            if "colonia" in extracted: extracted["colonia"] = unmush(extracted["colonia"])

            extracted["success"] = True
        except Exception as e:
            extracted["success"] = False
            extracted["error"] = str(e)
    else:
        extracted["success"] = True
        extracted["is_image"] = True
    return extracted

frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend"))
if os.path.exists(frontend_dir):
    @app.get("/")
    async def get_index():
        from fastapi.responses import FileResponse
        response = FileResponse(os.path.join(frontend_dir, "index.html"))
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    # =========================================================================
    # MÓDULO COMPRAS
    # =========================================================================

    # ── PROVEEDORES ──────────────────────────────────────────────────────────

    @app.get("/api/suppliers")
    def list_suppliers(
        status: str | None = None, skip: int = 0, limit: int = 50,
        db=Depends(get_db), tenant=Depends(role_guard(["admin", "comprador", "Gerente", "Almacenista"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id = tenant["empresa"]
        suppliers = crud.get_suppliers(db, empresa_id, status=status, skip=skip, limit=limit)
        return [
            {"id": s.id, "name": s.name, "trade_name": s.trade_name,
             "rfc": s.rfc, "phone": s.phone, "email": s.email,
             "credit_days": s.credit_days, "credit_limit": float(s.credit_limit or 0),
             "status": s.status, "contact_name": s.contact_name}
            for s in suppliers
        ]

    @app.post("/api/suppliers", status_code=201)
    def create_supplier(
        req: schemas.SupplierCreate,
        db=Depends(get_db), tenant=Depends(role_guard(["admin"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id = tenant["empresa"]
        data = req.model_dump()
        supplier = crud.create_supplier(db, empresa_id, data)
        db.add(models.AuditLog(
            empresa_id=empresa_id, user_id=tenant.get("user_id", "system"),
            action=f"SUPPLIER_CREATE:{supplier.id}", severity="INFO",
        ))
        db.commit()
        return {"id": supplier.id, "folio": supplier.name}

    @app.put("/api/suppliers/{supplier_id}")
    def update_supplier(
        supplier_id: str, req: schemas.SupplierUpdate,
        db=Depends(get_db), tenant=Depends(role_guard(["admin"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id = tenant["empresa"]
        data = {k: v for k, v in req.model_dump().items() if v is not None}
        supplier = crud.update_supplier(db, empresa_id, supplier_id, data)
        if not supplier:
            raise HTTPException(status_code=404, detail="Proveedor no encontrado")
        return {"ok": True}

    @app.get("/api/suppliers/{supplier_id}")
    def get_supplier(
        supplier_id: str,
        db=Depends(get_db), tenant=Depends(role_guard(["admin", "comprador", "Gerente", "Almacenista"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id = tenant["empresa"]
        s = crud.get_supplier(db, empresa_id, supplier_id)
        if not s:
            raise HTTPException(status_code=404, detail="Proveedor no encontrado")
        orders = crud.get_purchase_orders(db, empresa_id, supplier_id=supplier_id, limit=10)
        return {
            "id": s.id, "name": s.name, "trade_name": s.trade_name,
            "rfc": s.rfc, "phone": s.phone, "email": s.email,
            "credit_days": s.credit_days, "credit_limit": float(s.credit_limit or 0),
            "bank_account": s.bank_account, "status": s.status,
            "contact_name": s.contact_name, "notes": s.notes,
            "recent_orders": [
                {"id": o.id, "folio": o.folio, "status": o.status,
                 "total": float(o.total), "issue_date": str(o.issue_date)}
                for o in orders
            ],
        }

    # ── ÓRDENES DE COMPRA ────────────────────────────────────────────────────

    @app.get("/api/purchase-orders")
    def list_purchase_orders(
        status: str | None = None, supplier_id: str | None = None,
        skip: int = 0, limit: int = 50,
        db=Depends(get_db),
        tenant=Depends(role_guard(["admin", "comprador", "Gerente", "Almacenista"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id = tenant["empresa"]
        orders = crud.get_purchase_orders(
            db, empresa_id, status=status, supplier_id=supplier_id,
            skip=skip, limit=limit,
        )
        return [
            {"id": o.id, "folio": o.folio, "supplier_id": o.supplier_id,
             "status": o.status, "total": float(o.total),
             "issue_date": str(o.issue_date), "expected_date": str(o.expected_date or "")}
            for o in orders
        ]

    @app.post("/api/purchase-orders", status_code=201)
    def create_purchase_order(
        req: schemas.PurchaseOrderCreate,
        db=Depends(get_db),
        tenant=Depends(role_guard(["admin", "comprador", "Almacenista"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id  = tenant["empresa"]
        sucursal_id = tenant.get("sucursal", "MATRIZ")
        data = req.model_dump()
        po = crud.create_purchase_order(db, empresa_id, sucursal_id, data)
        db.add(models.AuditLog(
            empresa_id=empresa_id, user_id=tenant.get("user_id", "system"),
            action=f"PO_CREATE:{po.id}", severity="INFO",
        ))
        db.commit()
        return {"id": po.id, "folio": po.folio, "status": po.status}

    @app.get("/api/purchase-orders/{po_id}")
    def get_purchase_order(
        po_id: str,
        db=Depends(get_db),
        tenant=Depends(role_guard(["admin", "comprador", "Gerente", "Almacenista"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id = tenant["empresa"]
        po = crud.get_purchase_order(db, empresa_id, po_id)
        if not po:
            raise HTTPException(status_code=404, detail="OC no encontrada")
        return {
            "id": po.id, "folio": po.folio, "supplier_id": po.supplier_id,
            "status": po.status, "subtotal": float(po.subtotal),
            "tax_amount": float(po.tax_amount), "total": float(po.total),
            "issue_date": str(po.issue_date), "expected_date": str(po.expected_date or ""),
            "notes": po.notes, "authorized_by": po.authorized_by,
            "items": [
                {"id": i.id, "sku": i.sku, "description": i.description,
                 "quantity_ordered": float(i.quantity_ordered),
                 "quantity_received": float(i.quantity_received),
                 "unit_cost": float(i.unit_cost), "status": i.status}
                for i in (po.items or [])
            ],
        }

    @app.post("/api/purchase-orders/{po_id}/send")
    def send_purchase_order(
        po_id: str,
        db=Depends(get_db), tenant=Depends(role_guard(["admin", "comprador"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id = tenant["empresa"]
        user_id    = tenant.get("user_id", "system")
        po = crud.send_purchase_order(db, empresa_id, po_id, authorized_by=user_id)
        if not po:
            raise HTTPException(status_code=400, detail="OC no encontrada o no está en DRAFT")
        db.add(models.AuditLog(
            empresa_id=empresa_id, user_id=user_id,
            action=f"PO_SEND:{po_id}", severity="INFO",
        ))
        db.commit()
        return {"ok": True, "status": po.status}

    @app.put("/api/purchase-orders/{po_id}")
    def update_purchase_order(
        po_id: str,
        data: dict,
        db=Depends(get_db), tenant=Depends(role_guard(["admin", "comprador"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        """Edita cabecera e ítems de una OC en estado DRAFT."""
        empresa_id = tenant["empresa"]
        po = crud.update_purchase_order(db, empresa_id, po_id, data)
        if not po:
            raise HTTPException(status_code=400, detail="OC no encontrada o no está en DRAFT")
        db.add(models.AuditLog(
            empresa_id=empresa_id, user_id=tenant.get("user_id", "system"),
            action=f"PO_UPDATE:{po_id}", severity="INFO",
        ))
        db.commit()
        return po

    @app.post("/api/purchase-orders/{po_id}/cancel")
    def cancel_purchase_order(
        po_id: str,
        db=Depends(get_db), tenant=Depends(role_guard(["admin", "comprador"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id = tenant["empresa"]
        try:
            po = crud.cancel_purchase_order(db, empresa_id, po_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if not po:
            raise HTTPException(status_code=400, detail="OC no encontrada o ya finalizada")
        db.add(models.AuditLog(
            empresa_id=empresa_id, user_id=tenant.get("user_id", "system"),
            action=f"PO_CANCEL:{po_id}", severity="WARNING",
        ))
        db.commit()
        return {"ok": True, "status": po.status}

    # ── RECEPCIONES ──────────────────────────────────────────────────────────

    @app.post("/api/purchase-receipts", status_code=201)
    def create_purchase_receipt(
        req: schemas.PurchaseReceiptCreate,
        db=Depends(get_db),
        tenant=Depends(role_guard(["admin", "Almacenista"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id  = tenant["empresa"]
        sucursal_id = tenant.get("sucursal", "MATRIZ")
        user_id     = tenant.get("user_id", "system")
        try:
            result = crud.receive_purchase(
                db, empresa_id, sucursal_id,
                received_by=user_id, data=req.model_dump(),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        db.add(models.AuditLog(
            empresa_id=empresa_id, user_id=user_id,
            action=f"PURCHASE_RECEIPT:{result.get('receipt_id')}", severity="INFO",
        ))
        db.commit()
        return result

    @app.get("/api/purchase-receipts")
    def list_purchase_receipts(
        supplier_id: str | None = None, skip: int = 0, limit: int = 50,
        db=Depends(get_db),
        tenant=Depends(role_guard(["admin", "Gerente", "Almacenista"])),
        _m=Depends(require_module_access("COMPRAS")),
    ):
        empresa_id = tenant["empresa"]
        receipts = crud.get_purchase_receipts(
            db, empresa_id, supplier_id=supplier_id, skip=skip, limit=limit)
        return [
            {"id": r.id, "folio": r.folio, "supplier_id": r.supplier_id,
             "warehouse_id": r.warehouse_id, "payment_type": r.payment_type,
             "total": float(r.total), "receipt_date": str(r.receipt_date)}
            for r in receipts
        ]

    # ── CUENTAS POR PAGAR ────────────────────────────────────────────────────

    @app.get("/api/accounts-payable")
    def list_accounts_payable(
        status: str | None = None, supplier_id: str | None = None,
        skip: int = 0, limit: int = 50,
        db=Depends(get_db),
        tenant=Depends(role_guard(["admin", "Gerente", "Cajero"])),
    ):
        """Listado de CxP con sus datos de seguimiento: folio de la cuenta, folio fiscal (UUID),
        fechas de recepción / emisión / vencimiento, proveedor y expediente de origen."""
        import payables_tracking as _apt
        return _apt.list_payables(db, tenant["empresa"], status, supplier_id, skip, limit)

    @app.get("/api/accounts-payable/{ap_id}")
    def get_accounts_payable_detail(
        ap_id: str,
        db=Depends(get_db),
        tenant=Depends(role_guard(["admin", "Gerente", "Cajero"])),
    ):
        import payables_tracking as _apt
        d = _apt.payable_detail(db, tenant["empresa"], ap_id)
        if not d:
            raise HTTPException(status_code=404, detail="CxP no encontrada")
        return d

    @app.get("/api/accounts-payable/{ap_id}/files/{file_id}")
    def get_accounts_payable_file(
        ap_id: str, file_id: str, download: bool = False,
        db=Depends(get_db),
        tenant=Depends(role_guard(["admin", "Gerente", "Cajero"])),
    ):
        """XML/PDF de la factura que originó la CxP (solo documentos del expediente de esa cuenta)."""
        import base64 as _b64
        import payables_tracking as _apt
        from fastapi.responses import Response as _Resp
        f = _apt.payable_file(db, tenant["empresa"], ap_id, file_id)
        if not f:
            raise HTTPException(status_code=404, detail="Archivo no encontrado para esta CxP")
        disp = "attachment" if download else "inline"
        return _Resp(content=_b64.b64decode(f.content_b64), media_type=f.mime or "application/octet-stream",
                     headers={"Content-Disposition": f'{disp}; filename="{f.filename}"',
                              "Cache-Control": "private, max-age=300"})

    @app.post("/api/accounts-payable/{ap_id}/pay")
    def pay_accounts_payable(
        ap_id: str, req: schemas.SupplierPaymentCreate,
        db=Depends(get_db),
        tenant=Depends(role_guard(["admin", "Cajero"])),
    ):
        empresa_id = tenant["empresa"]
        user_id    = tenant.get("user_id", "system")
        try:
            result = crud.pay_accounts_payable(
                db, empresa_id, ap_id,
                registered_by=user_id, data=req.model_dump(),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        db.add(models.AuditLog(
            empresa_id=empresa_id, user_id=user_id,
            action=f"CXP_PAYMENT:{ap_id}:{req.amount}", severity="INFO",
        ))
        db.commit()
        return result

    # ─────────────────────────────────────────────────────────────────────────
    # CAJA Y CORTES — CashShift MVP
    # Flujo: Abrir turno → ventas del día → Corte Ciego (cajero reporta) → Autorizar (admin)
    # ─────────────────────────────────────────────────────────────────────────

    @app.post("/api/caja/abrir", response_model=schemas.CashShiftOut, status_code=201)
    def caja_abrir(
        req: schemas.CashShiftOpen,
        db: Session = Depends(get_db),
        tenant: dict = Depends(role_guard(["admin", "Cajero", "Gerente"])),
    ):
        """Abre un nuevo turno de caja. Solo se permite uno OPEN por sucursal."""
        empresa_id  = tenant["empresa"]
        sucursal_id = tenant.get("sucursal", "MATRIZ")
        user_id     = tenant.get("sub", "cajero")
        # Verificar que no haya turno abierto en esta sucursal
        open_shift = db.query(models.CashShift).filter(
            models.CashShift.empresa_id  == empresa_id,
            models.CashShift.sucursal_id == sucursal_id,
            models.CashShift.status      == "OPEN",
        ).first()
        if open_shift:
            raise HTTPException(status_code=409, detail="Ya hay un turno abierto en esta sucursal")
        shift = models.CashShift(
            empresa_id      = empresa_id,
            sucursal_id     = sucursal_id,
            opened_by_id    = user_id,
            opening_amount  = req.opening_amount,
            expected_amount = req.opening_amount,
            status          = "OPEN",
        )
        db.add(shift)
        db.add(models.AuditLog(
            empresa_id=empresa_id, sucursal_id=sucursal_id, user_id=user_id,
            action=f"CAJA_ABRIR: fondo={req.opening_amount}", severity="INFO",
        ))
        db.commit()
        db.refresh(shift)
        return shift

    @app.get("/api/caja/turno-activo", response_model=schemas.CashShiftOut)
    def caja_turno_activo(
        db: Session = Depends(get_db),
        tenant: dict = Depends(role_guard(["admin", "Cajero", "Gerente"])),
    ):
        """Devuelve el turno actualmente OPEN para la sucursal, o 404."""
        empresa_id  = tenant["empresa"]
        sucursal_id = tenant.get("sucursal", "MATRIZ")
        shift = db.query(models.CashShift).filter(
            models.CashShift.empresa_id  == empresa_id,
            models.CashShift.sucursal_id == sucursal_id,
            models.CashShift.status      == "OPEN",
        ).first()
        if not shift:
            raise HTTPException(status_code=404, detail="Sin turno activo")
        # Recalcular expected_amount sumando ventas en efectivo desde apertura
        from sqlalchemy import func as sqlfunc
        ventas_efectivo = db.query(sqlfunc.coalesce(sqlfunc.sum(models.Sale.total), 0)).filter(
            models.Sale.empresa_id  == empresa_id,
            models.Sale.sucursal_id == sucursal_id,
            models.Sale.payment_method.in_(["Efectivo", "CASH", "efectivo"]),
            models.Sale.created_at  >= shift.created_at,
            models.Sale.status      != "cancelled",
        ).scalar() or 0
        shift.expected_amount = float(shift.opening_amount) + float(ventas_efectivo)
        db.commit()
        return shift

    @app.post("/api/caja/cerrar/{shift_id}", response_model=schemas.CashShiftOut)
    def caja_cerrar(
        shift_id: str,
        req: schemas.CashShiftClose,
        db: Session = Depends(get_db),
        tenant: dict = Depends(role_guard(["admin", "Cajero", "Gerente"])),
    ):
        """Corte ciego: cajero reporta lo que cuenta, sin ver el esperado."""
        empresa_id = tenant["empresa"]
        user_id    = tenant.get("sub", "cajero")
        shift = db.query(models.CashShift).filter(
            models.CashShift.empresa_id == empresa_id,
            models.CashShift.id         == shift_id,
            models.CashShift.status     == "OPEN",
        ).first()
        if not shift:
            raise HTTPException(status_code=404, detail="Turno no encontrado o ya cerrado")
        diff = float(req.reported_amount) - float(shift.expected_amount)
        shift.reported_amount = req.reported_amount
        shift.difference      = diff
        shift.closed_by_id    = user_id
        shift.status          = "DISCREPANCY" if abs(diff) > 0.01 else "CLOSED"
        db.add(models.AuditLog(
            empresa_id=empresa_id, sucursal_id=shift.sucursal_id, user_id=user_id,
            action=f"CAJA_CERRAR: reportado={req.reported_amount} esperado={shift.expected_amount} diff={diff:.2f}",
            severity="WARNING" if abs(diff) > 0.01 else "INFO",
        ))
        db.commit()
        db.refresh(shift)
        return shift

    @app.post("/api/caja/autorizar/{shift_id}", response_model=schemas.CashShiftOut)
    def caja_autorizar(
        shift_id: str,
        req: schemas.CashShiftAuthorize,
        db: Session = Depends(get_db),
        tenant: dict = Depends(role_guard(["admin", "Gerente"])),
    ):
        """Admin/Gerente autoriza el cierre con diferencia."""
        empresa_id = tenant["empresa"]
        user_id    = tenant.get("sub", "admin")
        shift = db.query(models.CashShift).filter(
            models.CashShift.empresa_id == empresa_id,
            models.CashShift.id         == shift_id,
            models.CashShift.status     == "DISCREPANCY",
        ).first()
        if not shift:
            raise HTTPException(status_code=404, detail="Turno no encontrado o no requiere autorización")
        shift.status          = "CLOSED"
        shift.authorized_by_id = user_id
        db.add(models.AuditLog(
            empresa_id=empresa_id, sucursal_id=shift.sucursal_id, user_id=user_id,
            action=f"CAJA_AUTORIZAR: diff={shift.difference:.2f} autorizado={req.authorize}",
            severity="INFO",
        ))
        db.commit()
        db.refresh(shift)
        return shift

    @app.get("/api/caja/historial")
    def caja_historial(
        limit: int = 30,
        sucursal_filter: Optional[str] = Query(None, alias="sucursal_id"),
        db: Session = Depends(get_db),
        tenant: dict = Depends(role_guard(["admin", "Administrador", "Gerente"])),
    ):
        """Historial de turnos de caja (admin/gerente).

        M-2: mismo patrón de drill-down del dashboard — el admin dueño/
        gerente general puede pedir ?sucursal_id=ALL (todas las sucursales,
        con desglose por sede) o una sucursal puntual; Gerente de sucursal
        siempre queda scoped a su propia sede, sin poder escalar.
        """
        empresa_id   = tenant["empresa"]
        sucursal_id  = tenant.get("sucursal", "MATRIZ")
        role_name    = tenant.get("role", "")
        is_owner_admin = role_name.lower() in ("admin", "administrador")
        view_all = False
        if is_owner_admin and sucursal_filter:
            if sucursal_filter.upper() == "ALL":
                sucursal_id = None
                view_all = True
            else:
                sucursal_id = sucursal_filter

        q = db.query(models.CashShift).filter(models.CashShift.empresa_id == empresa_id)
        if sucursal_id:
            q = q.filter(models.CashShift.sucursal_id == sucursal_id)
        shifts = q.order_by(models.CashShift.created_at.desc()).limit(limit).all()

        by_sucursal = []
        if view_all:
            # Desglose por sucursal: cuántos turnos hay, cuántos siguen
            # abiertos y cuántos tienen una diferencia pendiente de
            # autorizar — no limitado por "limit" (es sobre el histórico
            # completo, para que el dueño vea el pulso real de cada sede).
            rows = db.query(
                models.CashShift.sucursal_id.label("sucursal_id"),
                func.count(models.CashShift.id).label("total"),
                func.sum(case((models.CashShift.status == "OPEN", 1), else_=0)).label("abiertos"),
                func.sum(case((models.CashShift.status == "DISCREPANCY", 1), else_=0)).label("con_diferencia"),
            ).filter(
                models.CashShift.empresa_id == empresa_id
            ).group_by(models.CashShift.sucursal_id).order_by(func.count(models.CashShift.id).desc()).all()
            by_sucursal = [
                {
                    "sucursal_id": r.sucursal_id,
                    "total": int(r.total or 0),
                    "abiertos": int(r.abiertos or 0),
                    "con_diferencia": int(r.con_diferencia or 0),
                }
                for r in rows
            ]

        return {
            "scope": "ALL" if view_all else (sucursal_id or ""),
            "by_sucursal": by_sucursal,
            "items": [
                {
                    "id": s.id, "status": s.status,
                    "sucursal_id": s.sucursal_id,
                    "opened_by_id": s.opened_by_id, "closed_by_id": s.closed_by_id,
                    "opening_amount": float(s.opening_amount or 0),
                    "expected_amount": float(s.expected_amount or 0),
                    "reported_amount": float(s.reported_amount or 0) if s.reported_amount is not None else None,
                    "difference": float(s.difference or 0) if s.difference is not None else None,
                    "authorized_by_id": s.authorized_by_id,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in shifts
            ],
        }

    # ─────────────────────────────────────────────────────────────────────────

    app.mount("/", StaticFiles(directory=frontend_dir), name="frontend_static")
