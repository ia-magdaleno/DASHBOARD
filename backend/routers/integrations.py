"""Integraciones externas del tenant — extraído de main.py (strangler fig).

Por ahora: WhatsApp (Twilio). Config 100% por-tenant, capturada por el Admin del
Tenant desde Configuración. Sin credenciales embebidas: ver services/whatsapp.py.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from deps import role_guard
from services import whatsapp as _wa

router = APIRouter(tags=["integrations"])


@router.get("/api/admin/integrations/whatsapp")
def admin_wa_get(
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    cfg = _wa.get_config(db, tenant.get("empresa"))
    pub = _wa.public_config(cfg)
    ready, reason = _wa.is_configured(cfg)
    pub["configured"] = ready
    pub["config_status"] = reason
    return pub


@router.put("/api/admin/integrations/whatsapp")
def admin_wa_put(
    body: dict,
    db: Session = Depends(get_db),
    payload: dict = Depends(role_guard(["ADMIN", "admin", "SUPERADMIN"])),
):
    empresa_id = payload.get("empresa")
    saved = _wa.save_config(db, empresa_id, body,
                            updated_by=payload.get("user_id", "system"))
    db.commit()
    out = _wa.public_config(saved)
    ready, reason = _wa.is_configured(saved)
    out["ok"] = True
    out["configured"] = ready
    out["config_status"] = reason
    return out


@router.post("/api/admin/integrations/whatsapp/test")
def admin_wa_test(
    body: dict,
    db: Session = Depends(get_db),
    payload: dict = Depends(role_guard(["ADMIN", "admin", "SUPERADMIN"])),
):
    to = ((body or {}).get("to") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Falta 'to' (número destino)")
    msg = ((body or {}).get("body") or "").strip() or \
        "CalebSys: mensaje de prueba de la integración WhatsApp."
    # Opcional: probar una plantilla aprobada en vez de texto libre.
    content_sid = ((body or {}).get("content_sid") or "").strip() or None
    content_vars = (body or {}).get("content_variables") or None
    res = _wa.send_whatsapp(db, payload.get("empresa"), to, msg,
                            created_by=payload.get("user_id", "system"),
                            context="admin_test",
                            content_sid=content_sid, content_variables=content_vars)
    db.commit()
    return res


@router.get("/api/admin/integrations/whatsapp/log")
def admin_wa_log(
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    return _wa.list_recent(db, tenant.get("empresa"), limit=50)
