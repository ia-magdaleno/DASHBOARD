"""Módulo GPS Rutas — App Móvil D5.

Endpoints:
  Admin/Gerente:
    POST   /api/routes                     crear ruta + paradas
    GET    /api/routes                     listar rutas por fecha/sucursal/usuario
    GET    /api/routes/{route_id}          detalle + paradas + último ping
    GET    /api/routes/{route_id}/live     último ping + trail reciente + is_deviated

  Repartidor/Vendedor de calle (dueño de la ruta):
    PATCH  /api/routes/{route_id}/stops/{stop_id}   marcar arrived/delivered/skipped

  Roles GPS:
    POST   /api/gps/ping                   enviar ping GPS (calcula desviación)
"""

import math
import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from deps import get_empresa_id, role_guard

router = APIRouter(tags=["gps-rutas"])

_ADMIN_GUARD  = role_guard(["admin", "Administrador", "Gerente", "gerente"])
_GPS_GUARD    = role_guard(["admin", "Administrador", "Gerente", "gerente",
                             "vendedor_calle", "Repartidor", "transportista",
                             "Chofer", "Operador reparto"])

_GPS_PING_TRAIL = 200


# ── Algoritmo de desviación sin dependencias externas ────────────────────────

def _point_segment_dist(p_lat, p_lng, a_lat, a_lng, b_lat, b_lng) -> float:
    cos_lat = math.cos(math.radians((float(a_lat) + float(b_lat)) / 2.0))
    M = 111320.0

    ax = float(a_lng) * cos_lat * M;  ay = float(a_lat) * M
    bx = float(b_lng) * cos_lat * M;  by = float(b_lat) * M
    px = float(p_lng) * cos_lat * M;  py = float(p_lat) * M

    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)

    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _deviation_from_route(p_lat, p_lng, stops: list) -> Optional[float]:
    ordered = sorted(stops, key=lambda s: s.seq)
    if not ordered:
        return None
    if len(ordered) == 1:
        s = ordered[0]
        cos_lat = math.cos(math.radians(float(s.lat)))
        return math.hypot(
            (p_lng - float(s.lng)) * cos_lat * 111320.0,
            (p_lat - float(s.lat)) * 111320.0,
        )
    min_dist = float("inf")
    for i in range(len(ordered) - 1):
        a, b = ordered[i], ordered[i + 1]
        d = _point_segment_dist(p_lat, p_lng,
                                float(a.lat), float(a.lng),
                                float(b.lat), float(b.lng))
        if d < min_dist:
            min_dist = d
    return min_dist


# ── Schemas ──────────────────────────────────────────────────────────────────

class StopIn(BaseModel):
    seq: int
    label: Optional[str] = None
    address: Optional[str] = None
    lat: float
    lng: float
    client_id: Optional[str] = None
    sale_id: Optional[str] = None


class RouteIn(BaseModel):
    sucursal_id: str
    assigned_user: str
    route_date: date
    deviation_threshold_m: Optional[float] = 150.0
    stops: List[StopIn]


class StopPatch(BaseModel):
    status: str


class PingIn(BaseModel):
    route_id: str
    lat: float
    lng: float
    accuracy_m: Optional[float] = None
    speed_kmh: Optional[float] = None
    recorded_at: Optional[datetime] = None


# ── Helpers de serialización ──────────────────────────────────────────────────

def _route_dict(r, include_stops=False, include_last_ping=False):
    d = {
        "id":                    r.id,
        "empresa_id":            r.empresa_id,
        "sucursal_id":           r.sucursal_id,
        "assigned_user":         r.assigned_user,
        "route_date":            str(r.route_date),
        "status":                r.status,
        "deviation_threshold_m": float(r.deviation_threshold_m or 150),
        "created_at":            r.created_at.isoformat() if r.created_at else None,
        "created_by":            r.created_by,
    }
    if include_stops:
        d["stops"] = [_stop_dict(s) for s in sorted(r.stops or [], key=lambda s: s.seq)]
    if include_last_ping:
        pings = sorted(r.pings or [],
                       key=lambda p: p.recorded_at or datetime.min, reverse=True)
        d["last_ping"] = _ping_dict(pings[0]) if pings else None
    return d


def _stop_dict(s):
    return {
        "id":         s.id,
        "route_id":   s.route_id,
        "seq":        s.seq,
        "label":      s.label,
        "address":    s.address,
        "lat":        float(s.lat),
        "lng":        float(s.lng),
        "client_id":  s.client_id,
        "sale_id":    s.sale_id,
        "status":     s.status,
        "arrived_at": s.arrived_at.isoformat() if s.arrived_at else None,
    }


def _ping_dict(p):
    return {
        "id":          p.id,
        "route_id":    p.route_id,
        "user_id":     p.user_id,
        "lat":         float(p.lat),
        "lng":         float(p.lng),
        "accuracy_m":  float(p.accuracy_m) if p.accuracy_m is not None else None,
        "speed_kmh":   float(p.speed_kmh)  if p.speed_kmh  is not None else None,
        "recorded_at": p.recorded_at.isoformat() if p.recorded_at else None,
        "deviation_m": float(p.deviation_m) if p.deviation_m is not None else None,
        "is_deviated": bool(p.is_deviated),
    }


def _get_route_or_404(db, empresa_id, route_id):
    r = db.query(models.Route).filter(
        models.Route.empresa_id == empresa_id,
        models.Route.id == route_id,
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Ruta no encontrada")
    return r


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/api/routes", status_code=201)
def create_route(
    payload_in: RouteIn,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_ADMIN_GUARD),
):
    username = payload.get("sub", "")
    route = models.Route(
        empresa_id=empresa_id,
        id=str(uuid.uuid4()),
        sucursal_id=payload_in.sucursal_id,
        assigned_user=payload_in.assigned_user,
        route_date=payload_in.route_date,
        status="planned",
        deviation_threshold_m=payload_in.deviation_threshold_m or 150,
        created_by=username,
    )
    db.add(route)
    db.flush()

    for s in payload_in.stops:
        db.add(models.RouteStop(
            empresa_id=empresa_id,
            id=str(uuid.uuid4()),
            route_id=route.id,
            seq=s.seq,
            label=s.label,
            address=s.address,
            lat=s.lat,
            lng=s.lng,
            client_id=s.client_id,
            sale_id=s.sale_id,
            status="pending",
        ))

    db.commit()
    db.refresh(route)
    return _route_dict(route, include_stops=True)


@router.get("/api/routes")
def list_routes(
    route_date: Optional[date] = Query(None),
    sucursal_id: Optional[str] = Query(None),
    assigned_user: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    q = db.query(models.Route).filter(models.Route.empresa_id == empresa_id)
    if route_date:
        q = q.filter(models.Route.route_date == route_date)
    if sucursal_id:
        q = q.filter(models.Route.sucursal_id == sucursal_id)
    if assigned_user:
        q = q.filter(models.Route.assigned_user == assigned_user)
    rows = q.order_by(models.Route.route_date.desc()).limit(200).all()
    return [_route_dict(r) for r in rows]


@router.get("/api/routes/{route_id}")
def get_route(
    route_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_GPS_GUARD),
):
    username = payload.get("sub", "")
    role     = payload.get("role", "")
    route    = _get_route_or_404(db, empresa_id, route_id)

    is_admin = role.lower() in ("admin", "administrador", "gerente", "superadmin")
    if not is_admin and route.assigned_user != username:
        raise HTTPException(status_code=403, detail="Solo puedes ver tu propia ruta")

    return _route_dict(route, include_stops=True, include_last_ping=True)


@router.patch("/api/routes/{route_id}/stops/{stop_id}")
def patch_stop(
    route_id: str,
    stop_id: str,
    body: StopPatch,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_GPS_GUARD),
):
    username = payload.get("sub", "")
    role     = payload.get("role", "")
    route    = _get_route_or_404(db, empresa_id, route_id)

    is_admin = role.lower() in ("admin", "administrador", "gerente", "superadmin")
    if not is_admin and route.assigned_user != username:
        raise HTTPException(status_code=403, detail="Solo puedes actualizar paradas de tu ruta")

    if body.status not in ("arrived", "delivered", "skipped"):
        raise HTTPException(status_code=422,
                            detail="status debe ser arrived, delivered o skipped")

    stop = db.query(models.RouteStop).filter(
        models.RouteStop.empresa_id == empresa_id,
        models.RouteStop.id == stop_id,
        models.RouteStop.route_id == route_id,
    ).first()
    if not stop:
        raise HTTPException(status_code=404, detail="Parada no encontrada")

    stop.status = body.status
    if body.status == "arrived":
        stop.arrived_at = datetime.now(timezone.utc)

    if route.status == "planned" and body.status in ("arrived", "delivered"):
        route.status = "in_progress"

    db.commit()
    return _stop_dict(stop)


@router.post("/api/gps/ping", status_code=201)
def receive_ping(
    body: PingIn,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    payload: dict = Depends(_GPS_GUARD),
):
    username = payload.get("sub", "")
    route    = _get_route_or_404(db, empresa_id, body.route_id)

    if route.status not in ("planned", "in_progress"):
        raise HTTPException(status_code=409,
                            detail="La ruta no está activa (estado: " + route.status + ")")

    recorded = body.recorded_at or datetime.now(timezone.utc)

    stops = db.query(models.RouteStop).filter(
        models.RouteStop.empresa_id == empresa_id,
        models.RouteStop.route_id == body.route_id,
    ).all()

    deviation_m = _deviation_from_route(body.lat, body.lng, stops)
    threshold   = float(route.deviation_threshold_m or 150)
    is_deviated = bool(deviation_m is not None and deviation_m > threshold)

    ping = models.GpsPing(
        empresa_id=empresa_id,
        id=str(uuid.uuid4()),
        route_id=body.route_id,
        user_id=username,
        lat=body.lat,
        lng=body.lng,
        accuracy_m=body.accuracy_m,
        speed_kmh=body.speed_kmh,
        recorded_at=recorded,
        deviation_m=deviation_m,
        is_deviated=is_deviated,
    )
    db.add(ping)

    if route.status == "planned":
        route.status = "in_progress"

    if is_deviated:
        _create_deviation_notif(db, empresa_id, route, username, deviation_m)

    _trim_old_pings(db, empresa_id, body.route_id)
    db.commit()
    return _ping_dict(ping)


@router.get("/api/routes/{route_id}/live")
def live_route(
    route_id: str,
    db: Session = Depends(get_db),
    empresa_id: str = Depends(get_empresa_id),
    _: dict = Depends(_ADMIN_GUARD),
):
    route = _get_route_or_404(db, empresa_id, route_id)

    pings = (
        db.query(models.GpsPing)
        .filter(
            models.GpsPing.empresa_id == empresa_id,
            models.GpsPing.route_id == route_id,
        )
        .order_by(models.GpsPing.recorded_at.desc())
        .limit(50)
        .all()
    )
    last_ping   = pings[0] if pings else None
    trail_asc   = list(reversed(pings))

    return {
        "route_id":    route_id,
        "status":      route.status,
        "is_deviated": bool(last_ping and last_ping.is_deviated),
        "last_ping":   _ping_dict(last_ping) if last_ping else None,
        "trail":       [_ping_dict(p) for p in trail_asc],
        "stops":       [_stop_dict(s) for s in sorted(route.stops or [], key=lambda s: s.seq)],
    }


# ── Helpers internos ──────────────────────────────────────────────────────────

def _create_deviation_notif(db, empresa_id, route, user_id, deviation_m):
    _DEST_GERENCIA = ["GERENTE", "Gerente", "gerente", "ADMIN", "Administrador", "admin"]
    db.add(models.Notification(
        empresa_id=empresa_id,
        sucursal_id=route.sucursal_id,
        tipo="ROUTE_DEVIATION",
        severidad="WARNING",
        titulo=f"Desviación de ruta: {route.assigned_user}",
        cuerpo=(f"El usuario {user_id} está a {deviation_m:.0f} m fuera de la ruta "
                f"(umbral {float(route.deviation_threshold_m):.0f} m)."),
        roles_dest=_DEST_GERENCIA,
        ref_tipo="route",
        ref_id=route.id,
        meta={"deviation_m": round(deviation_m, 1), "route_date": str(route.route_date)},
    ))


def _trim_old_pings(db, empresa_id, route_id):
    total = db.query(models.GpsPing).filter(
        models.GpsPing.empresa_id == empresa_id,
        models.GpsPing.route_id == route_id,
    ).count()
    if total <= _GPS_PING_TRAIL:
        return
    oldest = (
        db.query(models.GpsPing.id)
        .filter(
            models.GpsPing.empresa_id == empresa_id,
            models.GpsPing.route_id == route_id,
        )
        .order_by(models.GpsPing.recorded_at.asc())
        .limit(total - _GPS_PING_TRAIL)
        .all()
    )
    ids = [r[0] for r in oldest]
    if ids:
        db.query(models.GpsPing).filter(
            models.GpsPing.id.in_(ids)
        ).delete(synchronize_session=False)
