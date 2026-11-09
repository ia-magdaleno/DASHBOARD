"""services/cfdi_facturama.py — Timbrado CFDI 4.0 vía Facturama (CP2 · Fase 2 S5).

Igual que `services/whatsapp.py`, la configuración es 100 % por-tenant y la
captura MANUALMENTE el Admin del Tenant desde Configuración → «Integración
CFDI». Aquí no hay credenciales embebidas: un tenant sin configurar
simplemente no timbra (o timbra en modo `mock`, ver abajo).

La config vive en `AdminConfig`, clave ``integrations.cfdi``::

    {
      "enabled": true,
      "provider": "facturama",
      "environment": "sandbox",          # sandbox | production | mock
      "api_user": "CalebSys",
      "api_password": "xxxxxxxx",        # secreto — nunca vuelve al front
      "rfc_emisor": "MAMA840919AR1",
      "nombre_emisor": "MADERAS Y MATERIALES MAGDALENO",
      "regimen_fiscal_emisor": "612",
      "lugar_expedicion": "34000",       # CP del emisor
      "serie_default": "A",
      "folios_mode": "local"             # local | pac
    }

Se soportan las **dos modalidades** de Facturama (la anualidad incluye ambas);
cuál usa el tenant es su configuración `api_mode`, ver `API_PATHS` abajo:

    web          POST /api/3/cfdis          emisor implícito (RFC de la cuenta)
    multiemisor  POST /api-lite/3/cfdis     emisor explícito por petición (D8)

Contrato REST tomado del SDK oficial (github.com/Facturama/facturama-python-sdk)
y verificado contra el sandbox el 08-sep.

**Requisitos del lado del PAC** (no del código) para que un timbrado prospere:
1. el `ExpeditionPlace` debe estar dado de alta como Lugar de Expedición en el
   Perfil Fiscal de la cuenta — si no: *"El atributo 'ExpeditionPlace' debe
   existir como código postal en alguno de los Lugares de expedición"*;
2. el CSD del emisor debe estar cargado — si no: *"El certificado no puede ser
   nulo o estar vacío"* (modo web) o *"No se encuentra el CSD para el Emisor
   con RFC: ..."* (multiemisor).

Auth: HTTP Basic. Se usa `urllib` de la stdlib, sin dependencias nuevas (mismo
criterio que el cliente de Twilio).

**Modo `mock`**: cuando `environment == "mock"` o faltan credenciales, no se
toca la red — se genera un folio fiscal sintético y el CFDI queda TIMBRADO.
Sirve para que el QA y el desarrollo corran sin quemar folios ni depender del
sandbox. Los CFDI mock quedan marcados con `environment='mock'` para que nunca
se confundan con uno fiscal real.

Ninguna función de este módulo lanza excepción hacia el caller: todas devuelven
un dict con el resultado y dejan migaja en `AuditLog`.
"""
from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
import uuid as _uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

import cfdi_catalogs
import models

CONFIG_KEY = "integrations.cfdi"

HOSTS = {
    "sandbox":    "https://apisandbox.facturama.mx",
    "production": "https://api.facturama.mx",
}

# Facturama ofrece DOS modalidades y la anualidad incluye ambas. Cual usa cada
# tenant es configuracion suya (`api_mode`), no una constante del sistema:
#
#   web         — un solo RFC emisor: el de la cuenta. El emisor va IMPLICITO
#                 (no se manda bloque Issuer) y el CSD se carga desde el panel
#                 de Facturama (Perfil Fiscal). Es lo que usa un tenant que
#                 factura para si mismo.
#   multiemisor — N RFC emisores: el emisor viaja EXPLICITO en cada peticion y
#                 su CSD se sube por API. Es la via para revender timbrado a
#                 terceros (el escenario SaaS de Don Antonio).
#
# El `ExpeditionPlace` debe existir como Lugar de Expedicion en el perfil
# fiscal de la cuenta; si no, el PAC rechaza antes de siquiera sellar.
API_PATHS = {
    "web": {
        "create": "/api/3/cfdis",
        "detail": "/api/cfdi/{id}",
        "cancel": "/api/cfdi/{id}",
        "xml":    "/api/Cfdi/xml/issued/{id}",
        "pdf":    "/api/Cfdi/pdf/issued/{id}",
        "list":   "/api/cfdi",
    },
    "multiemisor": {
        "create": "/api-lite/3/cfdis",
        "detail": "/api-lite/2/cfdis/{id}",
        "cancel": "/api-lite/2/cfdis/{id}",
        "xml":    "/Cfdi/xml/IssuedLite/{id}",
        "pdf":    "/Cfdi/pdf/IssuedLite/{id}",
        "list":   "/api-lite/2/cfdis",
    },
}


def _paths(cfg: dict) -> dict:
    return API_PATHS.get((cfg or {}).get("api_mode") or "multiemisor",
                         API_PATHS["multiemisor"])
# CSD (Certificado de Sello Digital) del emisor. En API Multiemisor el PAC no
# puede timbrar para un RFC cuyo CSD no tenga cargado: devuelve
# "No se encuentra el CSD para el Emisor con RFC: ...". Es un requisito de
# configuracion del tenant, no del codigo.
PATH_CSD_LIST   = "/api-lite/csds"
PATH_CSD_UPLOAD = "/api-lite/csds"
PATH_CSD_DELETE = "/api-lite/csds/{rfc}"

_STR_FIELDS = ("pac_mode", "environment", "api_mode", "api_user", "rfc_emisor",
               "nombre_emisor", "regimen_fiscal_emisor", "lugar_expedicion",
               "serie_default", "folios_mode")
_PAC_FIELDS  = frozenset({"environment", "api_mode", "api_user"})
_PAC_MODES   = ("platform", "own", "other")
_SECRET_MASK = "••••••"


def _can_write_pac(pac_mode: str, is_superadmin: bool) -> bool:
    """SUPERADMIN siempre; tenant admin solo cuando gestiona su propia cuenta."""
    if is_superadmin:
        return True
    return (pac_mode or "platform") == "own"

TASA_IVA = Decimal("0.16")
_Q2 = Decimal("0.01")


# ───────────────────────── config (AdminConfig) ─────────────────────────
def get_config(db, empresa_id: str) -> dict:
    row = (db.query(models.AdminConfig)
             .filter(models.AdminConfig.empresa_id == empresa_id,
                     models.AdminConfig.config_key == CONFIG_KEY)
             .first())
    val = (row.config_val if row else None) or {}
    return dict(val) if isinstance(val, dict) else {}


def public_config(cfg: dict, *, is_superadmin: bool = True) -> dict:
    """Config apta para el frontend.

    pac_mode define quién gestiona el PAC y qué campos ve el tenant admin:
      platform → CalebSys/Don Antonio es el reseller; el tenant solo configura
                 datos fiscales + CSD; el SUPERADMIN administra las credenciales PAC.
      own      → el tenant tiene su propia cuenta Facturama; puede editar todos
                 los campos PAC él mismo.
      other    → PAC externo; el módulo CFDI de CalebSys está deshabilitado
                 para este tenant.
    """
    cfg = cfg or {}
    pac_mode = cfg.get("pac_mode") or "platform"
    if pac_mode not in _PAC_MODES:
        pac_mode = "platform"

    show_pac = _can_write_pac(pac_mode, is_superadmin)

    out: dict = {
        "enabled": bool(cfg.get("enabled")),
        "provider": cfg.get("provider") or "facturama",
        "pac_mode": pac_mode,
        "rfc_emisor": cfg.get("rfc_emisor") or "",
        "nombre_emisor": cfg.get("nombre_emisor") or "",
        "regimen_fiscal_emisor": cfg.get("regimen_fiscal_emisor") or "",
        "lugar_expedicion": cfg.get("lugar_expedicion") or "",
        "serie_default": cfg.get("serie_default") or "A",
        "folios_mode": cfg.get("folios_mode") or "local",
        "has_api_password": bool(cfg.get("api_password")),
        # true cuando el PAC lo gestiona el SUPERADMIN y el viewer es tenant admin.
        "pac_managed_by_superadmin": (pac_mode == "platform") and not is_superadmin,
    }
    if show_pac:
        out["environment"] = cfg.get("environment") or "sandbox"
        out["api_mode"] = cfg.get("api_mode") or "multiemisor"
        out["api_user"] = cfg.get("api_user") or ""
    return out


def save_config(db, empresa_id: str, body: dict, updated_by: str = "system",
                *, is_superadmin: bool = True) -> dict:
    """Upsert de la config. El secreto nunca se devuelve al frontend; si llega
    vacío o como máscara se conserva el valor guardado.

    Regla de escritura de campos PAC (environment, api_mode, api_user, api_password):
      - SUPERADMIN → siempre puede escribirlos.
      - Tenant admin + pac_mode='own' → puede escribirlos (su propia cuenta).
      - Tenant admin + pac_mode='platform' o 'other' → se ignoran silenciosamente.
    """
    body = body or {}
    current = get_config(db, empresa_id)
    new_cfg = dict(current)

    new_cfg["enabled"] = bool(body.get("enabled", current.get("enabled", False)))
    new_cfg["provider"] = "facturama"

    # pac_mode: cualquier admin puede cambiarlo
    if "pac_mode" in body:
        pm = (body["pac_mode"] or "platform").strip().lower()
        new_cfg["pac_mode"] = pm if pm in _PAC_MODES else "platform"

    pac_mode = new_cfg.get("pac_mode") or "platform"
    can_pac = _can_write_pac(pac_mode, is_superadmin)

    for f in _STR_FIELDS:
        if f == "pac_mode":
            continue
        if f not in body:
            continue
        if f in _PAC_FIELDS and not can_pac:
            continue
        new_cfg[f] = (body.get(f) or "").strip()

    pw = body.get("api_password", None)
    if can_pac and pw is not None and pw.strip() and pw.strip() != _SECRET_MASK:
        new_cfg["api_password"] = pw.strip()

    if new_cfg.get("environment") not in ("sandbox", "production", "mock"):
        new_cfg["environment"] = "sandbox"
    if new_cfg.get("folios_mode") not in ("local", "pac"):
        new_cfg["folios_mode"] = "local"
    if new_cfg.get("api_mode") not in ("web", "multiemisor"):
        new_cfg["api_mode"] = "multiemisor"

    row = (db.query(models.AdminConfig)
             .filter(models.AdminConfig.empresa_id == empresa_id,
                     models.AdminConfig.config_key == CONFIG_KEY)
             .first())
    if row:
        row.config_val = new_cfg
        row.updated_by = updated_by
        db.add(row)
    else:
        db.add(models.AdminConfig(empresa_id=empresa_id, config_key=CONFIG_KEY,
                                  config_val=new_cfg, updated_by=updated_by))
    _audit(db, empresa_id, "CFDI_CONFIG_UPSERT", "INFO",
           {"enabled": new_cfg["enabled"], "pac_mode": pac_mode,
            "environment": new_cfg.get("environment"),
            "has_password": bool(new_cfg.get("api_password"))}, user_id=updated_by)
    return new_cfg


def is_configured(cfg: dict) -> tuple[bool, str]:
    """(listo, motivo). En modo mock siempre está listo. En other nunca lo está."""
    cfg = cfg or {}
    pac_mode = cfg.get("pac_mode") or "platform"
    if pac_mode == "other":
        return False, "PAC externo — el timbrado CFDI se gestiona fuera del sistema"
    if (cfg.get("environment") or "") == "mock":
        return True, "mock"
    if not cfg.get("enabled"):
        return False, "deshabilitado"
    if not cfg.get("api_user"):
        return False, "falta api_user"
    if not cfg.get("api_password"):
        return False, "falta api_password"
    if not cfg.get("rfc_emisor"):
        return False, "falta rfc_emisor"
    if not cfg.get("regimen_fiscal_emisor"):
        return False, "falta regimen_fiscal_emisor"
    if not cfg.get("lugar_expedicion"):
        return False, "falta lugar_expedicion (CP del emisor)"
    return True, "listo"


def _is_mock(cfg: dict) -> bool:
    """True cuando no hay timbrado real: modo simulación, sin credenciales, o PAC externo."""
    cfg = cfg or {}
    if (cfg.get("pac_mode") or "platform") == "other":
        return True
    if (cfg.get("environment") or "") == "mock":
        return True
    return not (cfg.get("api_user") and cfg.get("api_password"))


# ───────────────────────── receptor fiscal ─────────────────────────
def validar_receptor_fiscal(client) -> list:
    """Devuelve la lista de datos fiscales que le faltan al cliente para poder
    recibir un CFDI nominativo. Lista vacía = está completo."""
    faltan = []
    rfc = (getattr(client, "rfc", "") or "").strip().upper()
    if not rfc:
        faltan.append("rfc")
    elif rfc == "XAXX010101000":
        # El RFC genérico solo sirve para el CFDI GLOBAL (cfdi_batches), no
        # para una factura nominativa.
        faltan.append("rfc_generico_no_facturable")
    if not (getattr(client, "name", "") or "").strip():
        faltan.append("nombre_razon_social")
    if not (getattr(client, "regimen_fiscal", "") or "").strip():
        faltan.append("regimen_fiscal")
    if not (getattr(client, "cp", "") or "").strip():
        faltan.append("cp_domicilio_fiscal")
    return faltan


# ───────────────────────── folios ─────────────────────────
def next_folio(db, empresa_id: str, cfg: dict) -> tuple:
    """(serie, folio) según el modo configurado.

    `local` — el sistema lleva el consecutivo en AdminConfig `folio.cfdi`
              ({serie, siguiente}). Encaja con la pantalla D3 de folios.
    `pac`   — se deja que Facturama asigne serie/folio; devuelve (serie, None).

    NOTA: no se reutiliza `crud._next_folio` a propósito — ese helper cuenta
    filas SIN filtrar por `empresa_id`, así que en multitenant devolvería
    folios corridos entre empresas.
    """
    serie_cfg = (cfg.get("serie_default") or "").strip()
    if (cfg.get("folios_mode") or "local") == "pac":
        # Serie y folio los pone el PAC. Solo se le impone una serie si el
        # tenant la configuró explícitamente — y ojo: en modo `web` esa serie
        # debe existir dada de alta en la sucursal del perfil fiscal, o el PAC
        # rechaza con "El atributo 'Serie' debe existir en la sucursal".
        return (serie_cfg or None), None
    serie = serie_cfg or "A"

    key = "folio.cfdi"
    row = (db.query(models.AdminConfig)
             .filter(models.AdminConfig.empresa_id == empresa_id,
                     models.AdminConfig.config_key == key)
             .first())
    val = (row.config_val if row else None) or {}
    if not isinstance(val, dict):
        val = {}
    serie = (val.get("serie") or serie).strip() or "A"
    siguiente = int(val.get("siguiente") or 1)

    nuevo = {"serie": serie, "siguiente": siguiente + 1}
    if row:
        row.config_val = nuevo
        db.add(row)
    else:
        db.add(models.AdminConfig(empresa_id=empresa_id, config_key=key,
                                  config_val=nuevo, updated_by="sistema"))
    return serie, str(siguiente)


# ───────────────────────── payload CFDI ─────────────────────────
def _money(x) -> float:
    return float(Decimal(str(x or 0)).quantize(_Q2, rounding=ROUND_HALF_UP))


def build_cfdi_payload(db, empresa_id: str, sale, client, cfg: dict, *,
                       uso_cfdi: str, forma_pago: str, metodo_pago: str,
                       serie=None, folio=None, items=None) -> dict:
    """Arma el JSON de `POST /api-lite/3/cfdis` a partir de una venta.

    El precio del POS lleva IVA incluido (estándar de mostrador en México), así
    que cada renglón se desglosa hacia atrás igual que en `crud.create_sale`:
        base = precio / 1.16      iva = precio - base
    De ese modo Σ(Subtotal) + Σ(IVA) == el total que el cliente ya pagó, y el
    CFDI no discrepa del ticket.
    """
    items = items if items is not None else list(getattr(sale, "items", []) or [])

    conceptos = []
    subtotal_acum = Decimal("0")
    iva_acum = Decimal("0")

    for it in items:
        cantidad = Decimal(str(getattr(it, "quantity", 0) or 0))
        importe_con_iva = Decimal(str(getattr(it, "subtotal", 0) or 0))
        if cantidad <= 0:
            continue
        base_renglon = (importe_con_iva / (1 + TASA_IVA)).quantize(_Q2, rounding=ROUND_HALF_UP)
        iva_renglon = (importe_con_iva - base_renglon).quantize(_Q2, rounding=ROUND_HALF_UP)
        precio_unit = (base_renglon / cantidad).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

        prod = None
        try:
            prod = (db.query(models.Product)
                      .filter(models.Product.empresa_id == empresa_id,
                              models.Product.id == getattr(it, "product_id", None))
                      .first())
        except Exception:
            prod = None

        descripcion = (getattr(prod, "name", None)
                       or getattr(it, "product_sku", None) or "Venta de mostrador")
        unidad = (getattr(prod, "sale_unit", None) or "").strip() or cfdi_catalogs.UNIDAD_DEFAULT
        # `sale_unit` es texto libre ("Pieza", "Saco"); si no es una clave SAT
        # válida del catálogo del tenant, se cae a la unidad genérica.
        if not cfdi_catalogs.is_valid_code(db, empresa_id, "unidades", unidad):
            unidad = cfdi_catalogs.UNIDAD_DEFAULT
        clave_prod = (getattr(prod, "clave_prod_serv", None)
                      or cfdi_catalogs.CLAVE_PROD_SERV_GENERICA)

        conceptos.append({
            "ProductCode": clave_prod,
            "Description": descripcion,
            "UnitCode": unidad,
            "Quantity": float(cantidad),
            "UnitPrice": float(precio_unit),
            "Subtotal": _money(base_renglon),
            "TaxObject": "02",
            "Taxes": [{
                "Name": "IVA",
                "Base": _money(base_renglon),
                "Rate": float(TASA_IVA),
                "Total": _money(iva_renglon),
                "IsRetention": False,
                "IsFederalTax": True,
            }],
            "Total": _money(base_renglon + iva_renglon),
        })
        subtotal_acum += base_renglon
        iva_acum += iva_renglon

    payload = {
        "Currency": "MXN",
        "ExpeditionPlace": (cfg.get("lugar_expedicion") or "").strip(),
        "CfdiType": "I",
        "PaymentForm": forma_pago,
        "PaymentMethod": metodo_pago,
        "Receiver": {
            "Rfc": (getattr(client, "rfc", "") or "").strip().upper(),
            "Name": (getattr(client, "name", "") or "").strip(),
            "CfdiUse": uso_cfdi,
            "FiscalRegime": (getattr(client, "regimen_fiscal", "") or "").strip(),
            "TaxZipCode": (getattr(client, "cp", "") or "").strip(),
        },
        "Items": conceptos,
    }
    # En modo `web` el emisor es la propia cuenta del PAC y va implícito: mandar
    # un bloque Issuer ahí es un error. En `multiemisor` es obligatorio, porque
    # una misma cuenta puede timbrar para muchos RFC distintos.
    if (cfg.get("api_mode") or "multiemisor") == "multiemisor":
        payload["Issuer"] = {
            "Rfc": (cfg.get("rfc_emisor") or "").strip().upper(),
            "Name": (cfg.get("nombre_emisor") or "").strip(),
            "FiscalRegime": (cfg.get("regimen_fiscal_emisor") or "").strip(),
        }
    if serie:
        payload["Serie"] = serie
    if folio:
        payload["Folio"] = str(folio)

    payload["_totales"] = {
        "subtotal": _money(subtotal_acum),
        "iva": _money(iva_acum),
        "total": _money(subtotal_acum + iva_acum),
    }
    return payload


# ───────────────────────── HTTP ─────────────────────────
def _base_url(cfg: dict) -> str:
    return HOSTS.get(cfg.get("environment") or "sandbox", HOSTS["sandbox"])


def _request(cfg: dict, method: str, path: str, body=None, timeout: int = 30):
    """Llamada REST autenticada. Devuelve (ok, status, data|texto)."""
    url = _base_url(cfg) + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    cred = "{}:{}".format(cfg.get("api_user") or "", cfg.get("api_password") or "")
    req.add_header("Authorization",
                   "Basic " + base64.b64encode(cred.encode("utf-8")).decode("ascii"))
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                return True, resp.status, json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return True, resp.status, raw
    except urllib.error.HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        try:
            return False, e.code, json.loads(raw) if raw else {"error": str(e)}
        except json.JSONDecodeError:
            return False, e.code, raw or str(e)
    except Exception as e:                       # timeout, DNS, TLS...
        return False, 0, {"error": f"{type(e).__name__}: {e}"}


def _error_texto(data) -> str:
    """Aplana el cuerpo de error del PAC a algo legible para el usuario."""
    if isinstance(data, str):
        return data[:1000]
    if isinstance(data, dict):
        for k in ("Message", "message", "error", "Error"):
            if data.get(k):
                base = str(data[k])
                det = data.get("ModelState") or data.get("Details")
                return (base + " | " + json.dumps(det, ensure_ascii=False))[:1000] if det else base[:1000]
        return json.dumps(data, ensure_ascii=False)[:1000]
    return str(data)[:1000]


# ───────────────────────── CSD del emisor ─────────────────────────
def list_csds(cfg: dict) -> dict:
    """Certificados de Sello Digital cargados en la cuenta del PAC.

    Sin un CSD para el RFC emisor, Facturama rechaza todo timbrado. Este
    listado es lo que la pantalla de Configuracion muestra para que el admin
    sepa si ya puede facturar o le falta subir su sello.
    """
    if _is_mock(cfg):
        return {"ok": True, "mode": "mock", "csds": [],
                "nota": "En modo mock no se consulta al PAC."}
    ok, status, data = _request(cfg, "GET", PATH_CSD_LIST)
    if not ok:
        if status == 401:
            return {"ok": False, "http": 401, "csds": [],
                    "error": ("Credenciales de Facturama inválidas — "
                              "verifica api_user y api_password en Configuración → CFDI.")}
        return {"ok": False, "http": status, "error": _error_texto(data), "csds": []}
    return {"ok": True, "mode": cfg.get("environment"),
            "csds": data if isinstance(data, list) else []}


def upload_csd(db, empresa_id: str, cfg: dict, rfc: str, cer_bytes: bytes,
               key_bytes: bytes, password: str, *, created_by: str = "sistema") -> dict:
    """Sube el CSD (.cer + .key + contrasena) del emisor al PAC.

    Los archivos viajan en base64 y NO se guardan en nuestra BD: la llave
    privada del sello es material criptografico del contribuyente y su
    custodia queda del lado del PAC. Aqui solo se hace de puente.
    """
    if _is_mock(cfg):
        return {"ok": True, "mode": "mock",
                "nota": "En modo mock no se sube nada al PAC."}
    body = {
        "Rfc": (rfc or "").strip().upper(),
        "Certificate": base64.b64encode(cer_bytes).decode("ascii"),
        "PrivateKey": base64.b64encode(key_bytes).decode("ascii"),
        "PrivateKeyPassword": password or "",
    }
    ok, status, data = _request(cfg, "POST", PATH_CSD_UPLOAD, body, timeout=60)
    if not ok:
        if status == 401:
            err = ("Credenciales de Facturama inválidas — "
                   "verifica api_user y api_password en Configuración → CFDI.")
        else:
            err = f"HTTP {status}: {_error_texto(data)}"
        _audit(db, empresa_id, "CFDI_CSD_UPLOAD_ERROR", "WARNING",
               {"rfc": body["Rfc"], "error": err[:400]}, user_id=created_by)
        return {"ok": False, "http": status, "error": err}
    _audit(db, empresa_id, "CFDI_CSD_UPLOAD", "WARNING",
           {"rfc": body["Rfc"], "environment": cfg.get("environment")},
           user_id=created_by)
    return {"ok": True, "mode": cfg.get("environment"), "rfc": body["Rfc"],
            "respuesta": data}


def delete_csd(db, empresa_id: str, cfg: dict, rfc: str,
               *, created_by: str = "sistema") -> dict:
    """Retira el CSD de un RFC emisor de la cuenta del PAC."""
    if _is_mock(cfg):
        return {"ok": True, "mode": "mock"}
    ok, status, data = _request(cfg, "DELETE", PATH_CSD_DELETE.format(rfc=(rfc or "").upper()))
    if not ok:
        return {"ok": False, "http": status, "error": _error_texto(data)}
    _audit(db, empresa_id, "CFDI_CSD_DELETE", "WARNING", {"rfc": rfc}, user_id=created_by)
    return {"ok": True}


# ───────────────────────── timbrado ─────────────────────────
def timbrar(db, empresa_id: str, doc, payload: dict, cfg: dict,
            *, created_by: str = "sistema") -> dict:
    """Timbra el CFDI y actualiza `doc` en sitio. No hace commit ni lanza."""
    totales = payload.pop("_totales", {}) if isinstance(payload, dict) else {}
    doc.total = Decimal(str(totales.get("total", doc.total or 0)))

    if _is_mock(cfg):
        doc.environment = "mock"
        doc.pac_id = "MOCK-" + _uuid.uuid4().hex[:12].upper()
        doc.uuid_fiscal = str(_uuid.uuid4()).upper()
        doc.status = "TIMBRADO"
        doc.timbrado_at = datetime.now(timezone.utc)
        doc.error = None
        doc.xml = ("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                   f"<!-- CFDI SIMULADO (modo mock, sin valor fiscal) uuid={doc.uuid_fiscal} -->")
        db.add(doc)
        _audit(db, empresa_id, f"CFDI_STAMP_MOCK:{doc.id}", "INFO",
               {"uuid": doc.uuid_fiscal, "total": float(doc.total)}, user_id=created_by)
        return {"ok": True, "mode": "mock", "uuid": doc.uuid_fiscal,
                "status": doc.status, "cfdi_id": doc.id}

    doc.environment = cfg.get("environment") or "sandbox"
    ok, status, data = _request(cfg, "POST", _paths(cfg)["create"], payload)

    if not ok:
        if status == 401:
            doc.error = ("Credenciales de Facturama inválidas — "
                         "verifica api_user y api_password en Configuración → CFDI.")
        else:
            doc.error = f"HTTP {status}: {_error_texto(data)}"
        doc.status = "ERROR"
        db.add(doc)
        _audit(db, empresa_id, f"CFDI_STAMP_ERROR:{doc.id}", "WARNING",
               {"http": status, "error": doc.error[:400]}, user_id=created_by)
        return {"ok": False, "mode": doc.environment, "http": status,
                "error": doc.error, "status": doc.status, "cfdi_id": doc.id}

    data = data if isinstance(data, dict) else {}
    complemento = data.get("Complement") or {}
    timbre = complemento.get("TaxStamp") or complemento.get("TaxStamps") or {}
    if isinstance(timbre, list):
        timbre = timbre[0] if timbre else {}

    doc.pac_id = data.get("Id") or data.get("id")
    doc.uuid_fiscal = (timbre.get("Uuid") or timbre.get("uuid")
                       or data.get("Uuid") or data.get("Folio"))
    doc.serie = data.get("Serie") or doc.serie
    doc.folio = str(data.get("Folio")) if data.get("Folio") is not None else doc.folio
    doc.status = "TIMBRADO"
    doc.timbrado_at = datetime.now(timezone.utc)
    doc.error = None
    db.add(doc)

    # XML/PDF son un extra: si fallan, el CFDI ya está timbrado igual y no se
    # debe revertir nada — solo queda sin copia local.
    if doc.pac_id:
        for path, campo in ((_paths(cfg)["xml"], "xml"), (_paths(cfg)["pdf"], "pdf_base64")):
            ok_f, _s, d = _request(cfg, "GET", path.format(id=doc.pac_id))
            if not ok_f:
                continue
            contenido = d.get("Content") if isinstance(d, dict) else d
            if not contenido:
                continue
            if campo == "xml":
                try:
                    doc.xml = base64.b64decode(contenido).decode("utf-8", "replace")
                except Exception:
                    doc.xml = str(contenido)
            else:
                doc.pdf_base64 = contenido if isinstance(contenido, str) else None
        db.add(doc)

    _audit(db, empresa_id, f"CFDI_STAMP:{doc.id}", "INFO",
           {"uuid": doc.uuid_fiscal, "pac_id": doc.pac_id,
            "total": float(doc.total or 0), "environment": doc.environment},
           user_id=created_by)
    return {"ok": True, "mode": doc.environment, "uuid": doc.uuid_fiscal,
            "status": doc.status, "cfdi_id": doc.id, "pac_id": doc.pac_id}


def cancelar(db, empresa_id: str, doc, cfg: dict, *, motivo: str = "02",
             uuid_replacement=None, created_by: str = "sistema") -> dict:
    """Cancela un CFDI timbrado. No hace commit ni lanza.

    Motivos SAT: 01 comprobante con errores CON relación · 02 comprobante con
    errores SIN relación · 03 no se llevó a cabo la operación · 04 operación
    nominativa relacionada en la factura global. El 01 exige `uuid_replacement`.
    """
    if doc.status == "CANCELADO":
        return {"ok": True, "ya_cancelado": True, "status": doc.status}
    if doc.status != "TIMBRADO":
        return {"ok": False, "error": f"Solo se puede cancelar un CFDI TIMBRADO (está {doc.status})."}
    if motivo == "01" and not uuid_replacement:
        return {"ok": False, "error": "El motivo 01 exige el UUID del comprobante que sustituye."}

    if (doc.environment or "") == "mock" or _is_mock(cfg):
        doc.status = "CANCELADO"
        doc.cancelado_at = datetime.now(timezone.utc)
        doc.motivo_cancelacion = motivo
        db.add(doc)
        _audit(db, empresa_id, f"CFDI_CANCEL_MOCK:{doc.id}", "WARNING",
               {"uuid": doc.uuid_fiscal, "motivo": motivo}, user_id=created_by)
        return {"ok": True, "mode": "mock", "status": doc.status}

    qs = {"motive": motivo}
    if uuid_replacement:
        qs["uuidReplacement"] = uuid_replacement
    path = _paths(cfg)["cancel"].format(id=doc.pac_id) + "?" + urllib.parse.urlencode(qs)
    ok, status, data = _request(cfg, "DELETE", path)
    if not ok:
        err = f"HTTP {status}: {_error_texto(data)}"
        _audit(db, empresa_id, f"CFDI_CANCEL_ERROR:{doc.id}", "WARNING",
               {"http": status, "error": err[:400]}, user_id=created_by)
        return {"ok": False, "http": status, "error": err, "status": doc.status}

    doc.status = "CANCELADO"
    doc.cancelado_at = datetime.now(timezone.utc)
    doc.motivo_cancelacion = motivo
    db.add(doc)
    _audit(db, empresa_id, f"CFDI_CANCEL:{doc.id}", "WARNING",
           {"uuid": doc.uuid_fiscal, "motivo": motivo}, user_id=created_by)
    return {"ok": True, "mode": doc.environment, "status": doc.status}


# ───────────────────────── auditoría ─────────────────────────
def _audit(db, empresa_id: str, action: str, severity: str, details: dict,
           user_id: str = "system", sucursal_id: str = "MATRIZ") -> None:
    try:
        db.add(models.AuditLog(
            empresa_id=empresa_id,
            sucursal_id=sucursal_id or "MATRIZ",
            user_id=user_id or "system",
            action=action,
            severity=severity,
            details=details,
        ))
    except Exception:
        pass  # el log jamás debe tumbar el flujo de negocio
