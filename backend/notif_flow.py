"""D6 — Notificaciones accionables (máquina de estados).

Diseño aprobado por Don Antonio (06-sep-2026). No requiere migración: el estado
del caso vive en `Notification.meta` (JSON). Ver _PLAN_MVP_9_SEMANAS.md sección D6.

Flujo F2 (devolución rápida):
  1. El vendedor levanta la solicitud -> se crean 2 notificaciones con el mismo
     `group_id`:
       - RETURN_CONDITION_CHECK  -> almacenista: "¿el artículo está en condiciones?"
       - RETURN_AUTHORIZE        -> admin + gerente (de la sede): "verificar compra
                                    y autorizar". Trae ya resuelto "¿compró aquí?"
                                    (decisión 2: lo resuelve el sistema).
  2. Almacenista resuelve la condición:
       - ok        -> habilita la autorización (check_result="ok").
       - rechazado -> bloquea la autorización y avisa a todos (informativa).
  3. Admin/gerente resuelve la autorización:
       - Si está bloqueada: solo `admin` puede pasar por encima, con nota
         (decisión 4). El `gerente` no.
       - Si el almacén aún no verifica: solo `admin` puede autorizar por encima.
       - autorizado -> caso resuelto + informativa "proceder en caja".
       - rechazado  -> caso resuelto + informativa "rechazada".
  4. El vendedor puede cancelar su propia solicitud mientras no esté autorizada
     (decisión 5) -> todo el caso queda `anulada` y se registra.

Escalamiento (decisión 3): si a los 5 min una notificación accionable sigue
`pendiente`, se marca escalada y se manda un recordatorio por WhatsApp a los
involucrados (si el tenant tiene WhatsApp configurado; si no, no pasa nada).
"""
import uuid as _uuid
from datetime import datetime, timedelta, timezone

import crud
import models
import schemas

# ── Constantes ─────────────────────────────────────────────────────────────
ACT_AUTHORIZE = "RETURN_AUTHORIZE"
ACT_CONDITION = "RETURN_CONDITION_CHECK"
ACT_PHYSICAL = "RETURN_PHYSICAL_CONFIRM"   # almacén confirma que el item entró físico
ACT_NONE = "NONE"

EST_PENDIENTE = "pendiente"
EST_RESUELTA = "resuelta"
EST_BLOQUEADA = "bloqueada"
EST_ANULADA = "anulada"

REF_TIPO = "devolucion_caso"
ESCALATE_MINUTES = 5

_ROLES_ALMACEN = ("almacenista",)
_ROLES_ADMIN = ("admin", "administrador", "superadmin")
_ROLES_AUTORIZA = ("admin", "administrador", "superadmin", "gerente")

# Roles destino (se listan variantes de mayúsculas porque roles_dest se compara
# case-insensitive contra el rol del token).
_DEST_ALMACEN  = ["ALMACENISTA", "Almacenista", "almacenista"]
_DEST_AUTORIZA = ["ADMIN", "admin", "Administrador", "SUPERADMIN", "Gerente", "gerente"]
_DEST_TODOS    = _DEST_AUTORIZA + ["VENDEDOR", "Vendedor", "vendedor",
                                   "CAJERO", "Cajero", "cajero",
                                   "vendedor_cajero", "vendedor_calle"]
_DEST_GERENCIA = ["GERENTE", "Gerente", "gerente", "ADMIN", "Administrador", "admin"]

# Tipo GPS
ACT_ROUTE_DEVIATION = "ROUTE_DEVIATION"


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _meta(n) -> dict:
    m = n.meta or {}
    return dict(m) if isinstance(m, dict) else {}


def _set_meta(n, **changes):
    """Reasigna n.meta (los JSON de SQLAlchemy no detectan mutación in-place)."""
    m = _meta(n)
    m.update(changes)
    n.meta = m


def _siblings(db, empresa_id: str, group_id: str):
    return (db.query(models.Notification)
              .filter(models.Notification.empresa_id == empresa_id)
              .filter(models.Notification.ref_tipo == REF_TIPO)
              .filter(models.Notification.ref_id == group_id)
              .all())


# ── "¿compró aquí?" — lo resuelve el sistema (decisión 2) ───────────────────
def check_purchase_history(db, empresa_id: str, client_id, sku) -> dict:
    """Busca si ese cliente compró ese SKU en CUALQUIER sede del tenant."""
    if not client_id or not sku:
        return {"resolved": False, "found": None, "sedes": []}
    rows = (
        db.query(models.Sale.sucursal_id, models.Sale.id, models.Sale.created_at)
          .join(models.SaleItem, models.SaleItem.sale_id == models.Sale.id)
          .filter(models.Sale.empresa_id == empresa_id)
          .filter(models.Sale.client_id == str(client_id))
          .filter(models.SaleItem.product_sku == str(sku))
          .order_by(models.Sale.created_at.desc())
          .limit(10)
          .all()
    )
    sedes = [{"sucursal_id": r[0], "sale_id": r[1],
              "fecha": r[2].isoformat() if r[2] else None} for r in rows]
    return {"resolved": True, "found": bool(sedes), "sedes": sedes}


# ── Crear el caso ──────────────────────────────────────────────────────────
def _norm_items(items) -> list:
    """Normaliza a [{product_sku, quantity_returned}]. Acepta claves cortas
    (sku/qty) o largas del schema."""
    out = []
    for it in (items or []):
        if not isinstance(it, dict):
            continue
        sku = it.get("product_sku") or it.get("sku")
        qty = it.get("quantity_returned", it.get("qty", it.get("quantity")))
        try:
            qty = float(qty)
        except (TypeError, ValueError):
            continue
        if sku and qty > 0:
            out.append({"product_sku": str(sku), "quantity_returned": qty})
    return out


def create_return_case(db, empresa_id: str, sucursal_id: str, origin_user: str, *,
                       detalle: str = "", ticket_ref: str = "",
                       sale_id=None, client_id=None, sku=None,
                       items=None, restock_warehouse_id=None) -> dict:
    """Crea las 2 notificaciones accionables del caso. NO hace commit."""
    group_id = str(_uuid.uuid4())
    purchase = check_purchase_history(db, empresa_id, client_id, sku)
    norm_items = _norm_items(items)

    base_meta = {
        "group_id": group_id,
        "origin_user": origin_user,
        "detalle": detalle or None,
        "ticket_ref": ticket_ref or None,
        "sale_id": sale_id,
        "client_id": client_id,
        "sku": sku,
        "items": norm_items,
        "restock_warehouse_id": restock_warehouse_id,
        "sucursal_id": sucursal_id,
        "created_at": _now_iso(),
    }

    cuerpo_com = f"{origin_user} pide revisar una devolución."
    if ticket_ref:
        cuerpo_com += f" Ticket: {ticket_ref}."
    if detalle:
        cuerpo_com += f" {detalle}"

    n_cond = crud.push_notification(
        db, empresa_id,
        tipo="devolucion_condicion",
        titulo="Devolución — verificar condición del artículo",
        cuerpo=cuerpo_com + " Confirma si el artículo está en condiciones de recibirse.",
        roles_dest=_DEST_ALMACEN,
        sucursal_id=sucursal_id,
        severidad="WARNING",
        ref_tipo=REF_TIPO, ref_id=group_id,
        meta={**base_meta, "action_type": ACT_CONDITION, "estado": EST_PENDIENTE},
    )
    n_auth = crud.push_notification(
        db, empresa_id,
        tipo="devolucion_autorizar",
        titulo="Devolución — verificar compra y autorizar",
        cuerpo=cuerpo_com,
        roles_dest=_DEST_AUTORIZA,
        sucursal_id=sucursal_id,
        severidad="WARNING",
        ref_tipo=REF_TIPO, ref_id=group_id,
        meta={**base_meta, "action_type": ACT_AUTHORIZE, "estado": EST_PENDIENTE,
              "check_result": EST_PENDIENTE,
              "purchase_resolved": purchase["resolved"],
              "purchase_found": purchase["found"],
              "purchase_sedes": purchase["sedes"]},
    )
    db.flush()  # poblar los id (uuid) antes de devolverlos
    return {"group_id": group_id,
            "notification_ids": [n_cond.id, n_auth.id],
            "purchase_found": purchase["found"],
            "auto_exec": bool(sale_id and norm_items)}


# ── Errores de la máquina (el router los mapea a HTTP) ──────────────────────
class FlowError(Exception):
    def __init__(self, code: str, http: int = 409):
        super().__init__(code)
        self.code = code
        self.http = http


# ── Resolver una notificación ──────────────────────────────────────────────
def resolve_notification(db, empresa_id: str, notif_id: str, *,
                         actor_user: str, actor_role: str,
                         outcome: str, nota: str = "") -> dict:
    n = (db.query(models.Notification)
           .filter(models.Notification.empresa_id == empresa_id)
           .filter(models.Notification.id == notif_id)
           .first())
    if not n:
        raise FlowError("notificacion_no_encontrada", 404)

    m = _meta(n)
    at = m.get("action_type")
    role = (actor_role or "").lower()
    group_id = m.get("group_id")
    origin_user = m.get("origin_user")

    if at == ACT_NONE or at is None:
        raise FlowError("notificacion_sin_accion", 400)
    if m.get("estado") == EST_ANULADA:
        raise FlowError("caso_cancelado", 409)

    # ── Verificación de condición (almacén) ────────────────────────────────
    if at == ACT_CONDITION:
        if role not in _ROLES_ALMACEN and role not in _ROLES_ADMIN:
            raise FlowError("rol_no_autorizado", 403)
        if m.get("estado") != EST_PENDIENTE:
            raise FlowError("ya_resuelta", 409)
        if outcome not in ("ok", "rechazado"):
            raise FlowError("outcome_invalido", 400)

        _set_meta(n, estado=EST_RESUELTA, outcome=outcome,
                  resolved_by=actor_user, resolved_at=_now_iso(),
                  nota=(nota or None))
        n.leida = True

        sibs = _siblings(db, empresa_id, group_id)
        if outcome == "ok":
            for s in sibs:
                if _meta(s).get("action_type") == ACT_AUTHORIZE and _meta(s).get("estado") == EST_PENDIENTE:
                    _set_meta(s, check_result="ok")
            action = "RETURN_CONDITION_OK"
        else:
            if not (nota or "").strip():
                raise FlowError("nota_requerida", 400)
            for s in sibs:
                if _meta(s).get("action_type") == ACT_AUTHORIZE:
                    _set_meta(s, estado=EST_BLOQUEADA, check_result="rechazado",
                              block_reason=nota)
            crud.push_notification(
                db, empresa_id,
                tipo="devolucion_bloqueada",
                titulo="Devolución bloqueada — artículo no apto",
                cuerpo=f"El almacén rechazó el artículo (motivo: {nota}). "
                       f"Solicitud de {origin_user}. La autorización queda bloqueada.",
                roles_dest=_DEST_TODOS,
                sucursal_id=n.sucursal_id,
                severidad="WARNING",
                ref_tipo=REF_TIPO, ref_id=group_id,
                meta={"group_id": group_id, "action_type": ACT_NONE,
                      "estado": EST_RESUELTA, "origin_user": origin_user,
                      "info": "bloqueada_por_almacen"},
            )
            action = "RETURN_CONDITION_REJECT"

        db.commit()
        return {"ok": True, "group_id": group_id, "action": action,
                "estado": _meta(n).get("estado")}

    # ── Autorización (admin / gerente) ────────────────────────────────────
    if at == ACT_AUTHORIZE:
        if role not in _ROLES_AUTORIZA:
            raise FlowError("rol_no_autorizado", 403)
        if outcome not in ("autorizado", "rechazado"):
            raise FlowError("outcome_invalido", 400)

        estado = m.get("estado")
        is_admin = role in _ROLES_ADMIN
        override = False

        if estado in (EST_RESUELTA,):
            raise FlowError("ya_resuelta", 409)

        if outcome == "autorizado":
            if estado == EST_BLOQUEADA:
                if not is_admin:
                    raise FlowError("bloqueada_por_almacen", 409)
                if not (nota or "").strip():
                    raise FlowError("nota_requerida_override", 400)
                override = True
            elif m.get("check_result") != "ok":
                # el almacén aún no verificó
                if not is_admin:
                    raise FlowError("espera_verificacion_almacen", 409)
                if not (nota or "").strip():
                    raise FlowError("nota_requerida_override", 400)
                override = True

        exec_res = None
        if outcome == "autorizado" and m.get("sale_id") and m.get("items"):
            # Ejecuta la devolución real: stock de vuelta + asiento inverso
            # (ajuste automático de la venta). Si falla una regla de negocio
            # (p.ej. se devuelve más de lo vendido) NO se cierra el caso.
            data = schemas.SaleReturnCreate(
                sale_id=m["sale_id"],
                items=[schemas.SaleReturnItem(product_sku=it["product_sku"],
                                              quantity_returned=it["quantity_returned"])
                       for it in m["items"]],
                restock_warehouse_id=m.get("restock_warehouse_id"),
                authorized_by=actor_user,
                idempotency_key=f"d6-{group_id}",
                notes=(nota or m.get("detalle") or None),
            )
            restock_suc = m.get("sucursal_id") or n.sucursal_id or "MATRIZ"
            try:
                exec_res = crud.process_sale_return(db, empresa_id, restock_suc,
                                                    data, created_by=actor_user)
            except ValueError as ve:
                raise FlowError(f"devolucion_fallo:{ve}", 422)

        if outcome == "rechazado" and not (nota or "").strip():
            raise FlowError("nota_requerida", 400)

        # Cerrar todo el caso
        for s in _siblings(db, empresa_id, group_id):
            sm = _meta(s)
            if sm.get("action_type") in (ACT_AUTHORIZE, ACT_CONDITION) and sm.get("estado") not in (EST_RESUELTA, EST_ANULADA):
                _set_meta(s, estado=EST_RESUELTA, resolved_by=actor_user,
                          resolved_at=_now_iso(),
                          outcome=outcome if sm.get("action_type") == ACT_AUTHORIZE else sm.get("outcome"))
                s.leida = True

        if outcome == "autorizado":
            titulo = "Devolución AUTORIZADA"
            if exec_res:
                cuerpo = (f"{actor_user} autorizó la devolución de {origin_user}. "
                          f"{exec_res.get('items_returned', 0)} artículo(s) regresaron a stock "
                          f"y la venta se ajustó automáticamente.")
            else:
                cuerpo = f"{actor_user} autorizó la devolución de {origin_user}. Proceder en caja."
            if override:
                cuerpo += f" (autorizada por encima del bloqueo — nota: {nota})"
            info = "autorizada_override" if override else "autorizada"
        else:
            titulo = "Devolución RECHAZADA"
            cuerpo = f"{actor_user} rechazó la devolución de {origin_user}. Motivo: {nota}"
            info = "rechazada"

        crud.push_notification(
            db, empresa_id, tipo="devolucion_resuelta", titulo=titulo, cuerpo=cuerpo,
            roles_dest=_DEST_TODOS, sucursal_id=n.sucursal_id, severidad="INFO",
            ref_tipo=REF_TIPO, ref_id=group_id,
            meta={"group_id": group_id, "action_type": ACT_NONE,
                  "estado": EST_RESUELTA, "origin_user": origin_user, "info": info,
                  "executed": bool(exec_res)},
        )

        # Confirmación de ingreso físico (decisión 1 de Don Antonio): el almacén
        # aprobó la CONDICIÓN antes; ahora confirma que el item entró físico.
        if exec_res:
            crud.push_notification(
                db, empresa_id, tipo="devolucion_confirmar_fisico",
                titulo="Confirmar ingreso físico — devolución",
                cuerpo=(f"Se registró la entrada a stock de {exec_res.get('items_returned', 0)} "
                        f"artículo(s) por la devolución de {origin_user}. Confirma que "
                        f"entraron físicamente a la bodega."),
                roles_dest=_DEST_ALMACEN,
                sucursal_id=n.sucursal_id, severidad="INFO",
                ref_tipo=REF_TIPO, ref_id=group_id,
                meta={"group_id": group_id, "action_type": ACT_PHYSICAL,
                      "estado": EST_PENDIENTE, "origin_user": origin_user,
                      "items": m.get("items"), "sale_id": m.get("sale_id")},
            )

        db.commit()
        return {"ok": True, "group_id": group_id, "outcome": outcome,
                "override": override, "estado": EST_RESUELTA,
                "executed": bool(exec_res),
                "items_returned": (exec_res or {}).get("items_returned")}

    # ── Confirmación de ingreso físico (almacén) ──────────────────────────
    if at == ACT_PHYSICAL:
        if role not in _ROLES_ALMACEN and role not in _ROLES_ADMIN:
            raise FlowError("rol_no_autorizado", 403)
        if m.get("estado") != EST_PENDIENTE:
            raise FlowError("ya_resuelta", 409)
        _set_meta(n, estado=EST_RESUELTA, outcome="confirmado",
                  resolved_by=actor_user, resolved_at=_now_iso(),
                  nota=(nota or None))
        n.leida = True
        db.commit()
        return {"ok": True, "group_id": group_id, "action": "RETURN_PHYSICAL_CONFIRMED",
                "estado": EST_RESUELTA}

    raise FlowError("action_type_desconocido", 400)


# ── Cancelar el caso (vendedor que lo originó, o admin) ─────────────────────
def cancel_return_case(db, empresa_id: str, group_id: str, *,
                       actor_user: str, actor_role: str) -> dict:
    sibs = _siblings(db, empresa_id, group_id)
    if not sibs:
        raise FlowError("caso_no_encontrado", 404)

    m0 = _meta(sibs[0])
    origin_user = m0.get("origin_user")
    role = (actor_role or "").lower()
    if actor_user != origin_user and role not in _ROLES_ADMIN:
        raise FlowError("solo_el_solicitante_o_admin", 403)

    for s in sibs:
        sm = _meta(s)
        if sm.get("action_type") == ACT_AUTHORIZE and sm.get("estado") == EST_RESUELTA \
           and sm.get("outcome") == "autorizado":
            raise FlowError("ya_autorizada", 409)

    for s in sibs:
        _set_meta(s, estado=EST_ANULADA, cancelled_by=actor_user, cancelled_at=_now_iso())
        s.leida = True

    db.commit()
    return {"ok": True, "group_id": group_id, "estado": EST_ANULADA,
            "anuladas": len(sibs)}


# ── Escalamiento a los 5 min (decisión 3) ──────────────────────────────────
def _phones_involucrados(db, empresa_id: str, sucursal_id: str, origin_user: str) -> list:
    phones = set()
    # admins + gerentes de la sede + el solicitante
    users = (db.query(models.User)
               .filter(models.User.empresa_id == empresa_id)
               .filter(models.User.status == "ACTIVE")
               .all())
    target_usernames = set()
    for u in users:
        r = (u.role or "").lower()
        if r in _ROLES_ADMIN or (r == "gerente" and u.sucursal_id == sucursal_id) or u.username == origin_user:
            target_usernames.add(u.username)
    if target_usernames:
        emps = (db.query(models.Employee)
                  .filter(models.Employee.empresa_id == empresa_id)
                  .filter(models.Employee.usuario_id.in_(target_usernames))
                  .all())
        for e in emps:
            if e.phone:
                phones.add(e.phone.strip())
    return [p for p in phones if p]


def escalate_stale(db, empresa_id: str) -> int:
    """Recorre las notificaciones accionables pendientes de más de 5 min sin
    escalar, las marca y manda recordatorio WhatsApp a los involucrados.
    Best-effort: nunca lanza. Pensado para llamarse on-poll desde
    /api/notifications."""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=ESCALATE_MINUTES)
        rows = (db.query(models.Notification)
                  .filter(models.Notification.empresa_id == empresa_id)
                  .filter(models.Notification.ref_tipo == REF_TIPO)
                  .filter(models.Notification.leida == False)  # noqa: E712
                  .filter(models.Notification.created_at < cutoff)
                  .limit(50)
                  .all())
    except Exception:
        return 0

    escalated = 0
    for n in rows:
        m = _meta(n)
        if m.get("action_type") not in (ACT_AUTHORIZE, ACT_CONDITION):
            continue
        if m.get("estado") != EST_PENDIENTE or m.get("escalated_at"):
            continue
        _set_meta(n, escalated_at=_now_iso())
        escalated += 1
        try:
            phones = _phones_involucrados(db, empresa_id, n.sucursal_id, m.get("origin_user"))
            from services import whatsapp as _wa
            wcfg = _wa.get_config(db, empresa_id)
            # Si el tenant aprobó una plantilla WhatsApp para el escalamiento
            # (clave 'escalation_content_sid'), se usa — obligatorio fuera de la
            # ventana de 24 h. Si no, texto libre (sirve en sandbox / <24 h).
            tpl = (wcfg or {}).get("escalation_content_sid")
            origin = m.get("origin_user")
            for ph in phones:
                if tpl:
                    _wa.send_whatsapp(
                        db, empresa_id, ph, "", created_by="sistema",
                        context="devolucion_escalada",
                        content_sid=tpl,
                        content_variables={"1": str(origin), "2": str(ESCALATE_MINUTES)},
                    )
                else:
                    _wa.send_whatsapp(
                        db, empresa_id, ph,
                        f"CALEBSYS: devolución sin atender hace {ESCALATE_MINUTES}+ min. "
                        f"Solicitud de {origin}. Entra al sistema a resolverla.",
                        created_by="sistema", context="devolucion_escalada",
                    )
        except Exception:
            pass
    if escalated:
        try:
            db.commit()
        except Exception:
            db.rollback()
    return escalated
