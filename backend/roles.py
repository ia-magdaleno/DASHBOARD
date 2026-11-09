"""Catálogo de roles genéricos del tenant (D2 — Don Antonio, 06-sep-2026).

No es un enum rígido (rompería el principio "todo configurable por el admin del
tenant", ver _PLAN_MVP_9_SEMANAS.md D1/D2). Es el catálogo por defecto que se
aplica a cualquier tenant que no haya definido el suyo. Un tenant puede
sobrescribirlo guardando su propia lista en AdminConfig, clave 'catalog.roles'
(mismo mecanismo que el resto de catálogos maestros — sin migración).

`superadmin` NO es rol de tenant: es el dueño del software. Se incluye en la
lista de slugs válidos pero marcado `is_system`.
"""

# Jerarquía descendente (1 = más alto). El admin del tenant ejecuta funciones
# de cualquier rol inferior — eso se resuelve en deps.role_guard, no aquí.
DEFAULT_ROLES = [
    {"slug": "admin",           "label": "Gerente General / Dueño",         "hierarchy": 1,  "is_system": False},
    {"slug": "admin_sucursal",  "label": "Administrador de sucursal",       "hierarchy": 2,  "is_system": False},
    {"slug": "gerente",         "label": "Gerente de sucursal / sede",      "hierarchy": 3,  "is_system": False},
    {"slug": "comprador",       "label": "Encargado de compras",            "hierarchy": 3,  "is_system": False},
    {"slug": "vendedor_cajero", "label": "Vendedor / Cajero",               "hierarchy": 4,  "is_system": False},
    {"slug": "vendedor",        "label": "Vendedor de mostrador / sede",    "hierarchy": 5,  "is_system": False},
    {"slug": "cajero",          "label": "Cajero (solo cobros / caja)",     "hierarchy": 6,  "is_system": False},
    {"slug": "vendedor_calle",  "label": "Vendedor externo (app móvil)",    "hierarchy": 7,  "is_system": False},
    {"slug": "almacenista",     "label": "Almacenista / Bodega",            "hierarchy": 8,  "is_system": False},
    {"slug": "transportista",   "label": "Transportista / Entregas",        "hierarchy": 9,  "is_system": False},
    {"slug": "auxiliar",        "label": "Auxiliar (solo reloj checador)",  "hierarchy": 10, "is_system": False},
]

# Roles con alcance restringido a su propia sucursal. El middleware de módulos
# bloquea RRHH/COMPRAS/CONFIGURACION para estos roles salvo permiso temporal.
SUCURSAL_SCOPED_ROLES = {"admin_sucursal"}

SUPERADMIN = {"slug": "superadmin", "label": "SuperAdmin (dueño del software)",
              "hierarchy": 0, "is_system": True}

# Valores heredados en la BD real → slug canónico. Mantiene compatibilidad con
# usuarios creados antes de este catálogo (roles en mayúsculas, en español, etc.).
_ALIASES = {
    "administrador":        "admin",
    "administrator":        "admin",
    "gerente_general":      "admin",
    "gerente general":      "admin",
    "duenio":               "admin",
    "dueño":                "admin",
    "admin_sucursal":       "admin_sucursal",
    "gerente_sucursal":     "admin_sucursal",
    "gerente de sucursal":  "admin_sucursal",
    "administrador_sucursal": "admin_sucursal",
    "almacen":           "almacenista",
    "bodega":            "almacenista",
    "vendedor/cajero":   "vendedor_cajero",
    "vendedor-cajero":   "vendedor_cajero",
    "cajero_vendedor":   "vendedor_cajero",
    "chofer":            "transportista",
    "conductor":         "transportista",
    "repartidor":        "transportista",
    "vendedor_externo":  "vendedor_calle",
    "vendedor de calle": "vendedor_calle",
}


def normalize_role(value: str) -> str:
    """Normaliza a slug canónico: minúsculas, sin acentos de espacios, aliases."""
    raw = (value or "").strip().lower()
    if raw in _ALIASES:
        return _ALIASES[raw]
    under = raw.replace(" ", "_").replace("-", "_")
    return _ALIASES.get(under, under)


def get_tenant_roles(db, empresa_id: str) -> list:
    """Roles vigentes para un tenant: los suyos si definió 'catalog.roles' en
    AdminConfig, o el catálogo por defecto (10 + superadmin)."""
    import models
    row = (db.query(models.AdminConfig)
             .filter(models.AdminConfig.empresa_id == empresa_id)
             .filter(models.AdminConfig.config_key == "catalog.roles")
             .first())
    val = row.config_val if row else None
    if isinstance(val, list) and val:
        return val
    return DEFAULT_ROLES + [SUPERADMIN]


def role_is_valid(db, empresa_id: str, value: str) -> bool:
    slug = normalize_role(value)
    valid = {normalize_role(r.get("slug", "")) for r in get_tenant_roles(db, empresa_id)}
    return bool(slug) and slug in valid
