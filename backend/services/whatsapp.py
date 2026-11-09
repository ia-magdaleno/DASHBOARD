"""services/whatsapp.py — Canal saliente WhatsApp (Twilio) · Fase C / M-RS.

La configuración es 100 % por-tenant y la captura MANUALMENTE el Admin del
Tenant desde Configuración → «Integración WhatsApp». Aquí no hay credenciales
embebidas ni valores de cuenta por defecto.

La config vive en `AdminConfig`, clave ``integrations.whatsapp``::

    {
      "enabled": true,
      "provider": "twilio",
      "account_sid": "ACxxxxxxxx",
      "auth_token": "xxxxxxxx",              # secreto — nunca vuelve al front
      "from_number": "+52155XXXXXXXX",       # E.164 (sin el prefijo whatsapp:)
      "messaging_service_sid": "MGxxxxxxxx"   # opcional; si está, se usa en vez de From
    }

`send_whatsapp()` lee esa config y, si está completa y habilitada, hace la
llamada REST a Twilio con la librería estándar (``urllib``) — sin dependencias
nuevas. Nunca lanza excepción: devuelve un dict con el resultado y deja una
migaja en `AuditLog`. La cola/persistencia completa de mensajes (plantillas,
reintentos, historial dedicado) es trabajo de M-RS / Fase D.2.
"""
from __future__ import annotations

import base64
import json
import urllib.request
import urllib.error
import urllib.parse

import models

CONFIG_KEY = "integrations.whatsapp"
TWILIO_API = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"

# Campos de texto que se guardan tal cual (recortados)
_STR_FIELDS = ("provider", "account_sid", "from_number", "messaging_service_sid",
               "escalation_content_sid")
_TOKEN_MASK = "••••••"  # ••••••  (marcador de "sin cambio")


# ───────────────────────── config (AdminConfig) ─────────────────────────
def get_config(db, empresa_id: str) -> dict:
    row = (
        db.query(models.AdminConfig)
        .filter(models.AdminConfig.empresa_id == empresa_id)
        .filter(models.AdminConfig.config_key == CONFIG_KEY)
        .first()
    )
    val = (row.config_val if row else None) or {}
    return dict(val) if isinstance(val, dict) else {}


def public_config(cfg: dict) -> dict:
    """Config apta para el frontend: sin el `auth_token`, con `has_auth_token`."""
    cfg = cfg or {}
    return {
        "enabled": bool(cfg.get("enabled")),
        "provider": cfg.get("provider") or "twilio",
        "account_sid": cfg.get("account_sid") or "",
        "from_number": cfg.get("from_number") or "",
        "messaging_service_sid": cfg.get("messaging_service_sid") or "",
        "escalation_content_sid": cfg.get("escalation_content_sid") or "",
        "has_auth_token": bool(cfg.get("auth_token")),
    }


def save_config(db, empresa_id: str, body: dict, updated_by: str = "system") -> dict:
    """Upsert de la config. Semántica de mezcla para el secreto:
    si `auth_token` no viene, viene vacío o viene como el marcador de máscara,
    se conserva el que ya estaba guardado.
    """
    body = body or {}
    current = get_config(db, empresa_id)
    new_cfg = dict(current)

    new_cfg["enabled"] = bool(body.get("enabled", current.get("enabled", False)))
    new_cfg["provider"] = "twilio"
    for f in _STR_FIELDS:
        if f == "provider":
            continue
        if f in body:
            new_cfg[f] = (body.get(f) or "").strip()

    tok = body.get("auth_token", None)
    if tok is not None and tok.strip() and tok.strip() != _TOKEN_MASK:
        new_cfg["auth_token"] = tok.strip()
    # si no: se mantiene current["auth_token"] (ya copiado en new_cfg)

    row = (
        db.query(models.AdminConfig)
        .filter(models.AdminConfig.empresa_id == empresa_id)
        .filter(models.AdminConfig.config_key == CONFIG_KEY)
        .first()
    )
    if row:
        row.config_val = new_cfg
        row.updated_by = updated_by
    else:
        db.add(models.AdminConfig(
            empresa_id=empresa_id,
            config_key=CONFIG_KEY,
            config_val=new_cfg,
            updated_by=updated_by,
        ))
    _audit(db, empresa_id, "WHATSAPP_CONFIG_UPSERT", "INFO",
           {"enabled": new_cfg["enabled"], "has_token": bool(new_cfg.get("auth_token"))},
           user_id=updated_by)
    return new_cfg


def is_configured(cfg: dict) -> tuple[bool, str]:
    """(listo, motivo). `motivo` describe qué falta cuando no está listo."""
    cfg = cfg or {}
    if not cfg.get("enabled"):
        return False, "deshabilitado"
    if not cfg.get("account_sid"):
        return False, "falta account_sid"
    if not cfg.get("auth_token"):
        return False, "falta auth_token"
    if not (cfg.get("from_number") or cfg.get("messaging_service_sid")):
        return False, "falta from_number o messaging_service_sid"
    return True, "listo"


# ───────────────────────── envío ─────────────────────────
def _normalize_to(raw: str) -> str:
    """Devuelve `whatsapp:+<digitos>` a partir de un número en texto libre."""
    s = (raw or "").strip()
    if s.lower().startswith("whatsapp:"):
        s = s[len("whatsapp:"):].strip()
    keep = "+" + "".join(ch for ch in s if ch.isdigit()) if not s.startswith("+") \
        else "+" + "".join(ch for ch in s[1:] if ch.isdigit())
    return "whatsapp:" + keep


def send_whatsapp(db, empresa_id: str, to: str, body: str,
                  *, created_by: str = "system", context: str | None = None,
                  content_sid: str | None = None,
                  content_variables: dict | str | None = None) -> dict:
    """Envía un WhatsApp saliente por Twilio usando la config del tenant.

    - Sin `content_sid`: mensaje de texto libre (`Body`). Solo se entrega dentro
      de la ventana de sesión de 24 h (o en el sandbox tras el `join`).
    - Con `content_sid`: mensaje de PLANTILLA aprobada (`ContentSid` +
      `ContentVariables`). Requerido para mensajes iniciados por el negocio
      fuera de la ventana de 24 h.

    Nunca lanza. Devuelve::
        {"ok": bool, "status": "SENT|FAILED|NO_CONFIG", ...}
    """
    cfg = get_config(db, empresa_id)
    ready, reason = is_configured(cfg)
    if not ready:
        _audit(db, empresa_id, "WHATSAPP_SKIP", "WARNING",
               {"reason": reason, "to": to, "context": context}, user_id=created_by)
        return {"ok": False, "status": "NO_CONFIG", "reason": reason}

    sid = cfg["account_sid"]
    token = cfg["auth_token"]
    fields = {"To": _normalize_to(to)}
    if content_sid:
        fields["ContentSid"] = content_sid
        if content_variables:
            fields["ContentVariables"] = (
                json.dumps(content_variables, ensure_ascii=False)
                if isinstance(content_variables, dict) else str(content_variables)
            )
    else:
        fields["Body"] = body or ""
    if cfg.get("messaging_service_sid"):
        fields["MessagingServiceSid"] = cfg["messaging_service_sid"]
    else:
        fields["From"] = _normalize_to(cfg["from_number"])

    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(TWILIO_API.format(sid=sid), data=data, method="POST")
    auth = base64.b64encode(f"{sid}:{token}".encode("utf-8")).decode("ascii")
    req.add_header("Authorization", "Basic " + auth)
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
        provider_sid = payload.get("sid")
        _audit(db, empresa_id, "WHATSAPP_SENT", "INFO",
               {"to": fields["To"], "provider_sid": provider_sid, "context": context},
               user_id=created_by)
        return {"ok": True, "status": "SENT", "provider_sid": provider_sid,
                "provider_status": payload.get("status")}
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8") or "{}")
            detail = err.get("message") or f"HTTP {e.code}"
        except Exception:
            detail = f"HTTP {e.code}"
        _audit(db, empresa_id, "WHATSAPP_FAILED", "WARNING",
               {"to": fields["To"], "error": detail, "http": e.code, "context": context},
               user_id=created_by)
        return {"ok": False, "status": "FAILED", "error": detail, "http": e.code}
    except Exception as e:  # timeout, DNS, TLS, JSON…
        _audit(db, empresa_id, "WHATSAPP_FAILED", "WARNING",
               {"to": fields["To"], "error": str(e), "context": context}, user_id=created_by)
        return {"ok": False, "status": "FAILED", "error": str(e)}


# ───────────────────────── log (sobre AuditLog, sin tabla nueva) ─────────
def list_recent(db, empresa_id: str, limit: int = 50) -> list:
    rows = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.empresa_id == empresa_id)
        .filter(models.AuditLog.action.like("WHATSAPP_%"))
        .order_by(models.AuditLog.created_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    return [
        {
            "at": r.created_at.isoformat() if r.created_at else None,
            "action": r.action,
            "severity": r.severity,
            "details": r.details or {},
        }
        for r in rows
    ]


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
