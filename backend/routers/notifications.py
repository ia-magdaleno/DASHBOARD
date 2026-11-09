"""D6 — endpoints de notificaciones accionables.

- POST /api/notifications/{id}/resolve        — resolver una notificación con acción
- POST /api/devoluciones/caso/{group_id}/cancelar — el vendedor anula su solicitud

La máquina de estados vive en backend/notif_flow.py.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
import notif_flow
from database import get_db
from deps import get_tenant_context, role_guard

router = APIRouter(tags=["notifications"])


class ResolveIn(BaseModel):
    outcome: str                     # condición: ok|rechazado · autorización: autorizado|rechazado
    nota: Optional[str] = None       # obligatoria para rechazos y para override de admin


def _audit(db, empresa_id, sucursal_id, user_id, action, severity, details=None):
    try:
        db.add(models.AuditLog(
            empresa_id=empresa_id or "DESCONOCIDA",
            sucursal_id=sucursal_id or "MATRIZ",
            user_id=user_id or "sistema",
            action=action, severity=severity, details=details,
        ))
        db.commit()
    except Exception:
        db.rollback()


@router.post("/api/notifications/{notif_id}/resolve", status_code=200)
def resolve_notification(
    notif_id: str,
    body: ResolveIn,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
    payload: dict = Depends(role_guard([
        "ADMIN", "admin", "Administrador", "SUPERADMIN", "Gerente", "gerente",
        "ALMACENISTA", "Almacenista", "almacenista",
    ])),
):
    empresa_id = tenant["empresa"]
    actor_user = payload.get("sub", "sistema")
    actor_role = payload.get("role", "")
    try:
        res = notif_flow.resolve_notification(
            db, empresa_id, notif_id,
            actor_user=actor_user, actor_role=actor_role,
            outcome=(body.outcome or "").strip().lower(),
            nota=(body.nota or "").strip(),
        )
    except notif_flow.FlowError as e:
        raise HTTPException(status_code=e.http, detail=e.code)

    _audit(db, empresa_id, tenant.get("sucursal"), actor_user,
           f"NOTIF_RESOLVE:{notif_id}:{res.get('outcome') or res.get('action')}",
           "WARNING", {"group_id": res.get("group_id"), "override": res.get("override")})
    return res


@router.post("/api/devoluciones/caso/{group_id}/cancelar", status_code=200)
def cancelar_caso_devolucion(
    group_id: str,
    db: Session = Depends(get_db),
    tenant: dict = Depends(get_tenant_context),
    payload: dict = Depends(role_guard([
        "ADMIN", "admin", "Administrador", "SUPERADMIN", "Gerente", "gerente",
        "Cajero", "cajero", "CAJERO", "Vendedor", "vendedor", "VENDEDOR",
        "vendedor_cajero", "vendedor_calle",
    ])),
):
    empresa_id = tenant["empresa"]
    actor_user = payload.get("sub", "sistema")
    actor_role = payload.get("role", "")
    try:
        res = notif_flow.cancel_return_case(
            db, empresa_id, group_id,
            actor_user=actor_user, actor_role=actor_role,
        )
    except notif_flow.FlowError as e:
        raise HTTPException(status_code=e.http, detail=e.code)

    _audit(db, empresa_id, tenant.get("sucursal"), actor_user,
           f"RETURN_REQUEST_CANCELLED:{group_id}", "WARNING",
           {"anuladas": res.get("anuladas")})
    return res
