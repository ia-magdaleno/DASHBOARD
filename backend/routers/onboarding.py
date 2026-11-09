"""Onboarding — subida de catálogos del tenant (productos/clientes/proveedores/
empleados) desde Excel/CSV, y descarga de las plantillas.

Núcleo en backend/import_onboarding.py. Lo consume el wizard "Configuración
inicial" del admin del tenant.
"""
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

import import_onboarding as onb
from database import get_db
from deps import role_guard

router = APIRouter(tags=["onboarding"])

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


@router.get("/api/admin/import/plantilla/{tipo}")
def descargar_plantilla(
    tipo: str,
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Devuelve el .xlsx en blanco (encabezados + fila de ejemplo) para `tipo`."""
    if tipo not in onb.SPECS:
        raise HTTPException(status_code=404, detail=f"tipo no soportado: {tipo}")
    data = onb.plantilla_bytes(tipo)
    return Response(
        content=data, media_type=_XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="plantilla_{tipo}.xlsx"'},
    )


@router.post("/api/admin/import/{tipo}")
async def importar_catalogo(
    tipo: str,
    file: UploadFile = File(...),
    dry_run: bool = Query(True, description="true = simula y reporta, no escribe"),
    db: Session = Depends(get_db),
    tenant: dict = Depends(role_guard(["admin", "Administrador", "SUPERADMIN"])),
):
    """Carga (o simula) las filas del archivo en el catálogo del tenant."""
    if tipo not in onb.SPECS:
        raise HTTPException(status_code=404, detail=f"tipo no soportado: {tipo}")
    raw = await file.read(_MAX_BYTES + 1)
    await file.close()
    if not raw:
        raise HTTPException(status_code=400, detail="archivo vacío")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="archivo demasiado grande (máx 10 MB)")

    try:
        rows = onb.read_rows(raw, filename=file.filename or "")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"no se pudo leer el archivo: {e}")
    if not rows:
        raise HTTPException(status_code=400, detail="el archivo no tiene filas de datos")

    empresa_id = tenant.get("empresa")
    default_suc = tenant.get("sucursal") or "MATRIZ"
    try:
        res = onb.importar(db, empresa_id, tipo, rows,
                           dry_run=dry_run, default_sucursal=default_suc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res
