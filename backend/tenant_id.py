"""Formato del TENANT ID (D4 — Don Antonio, 06-sep-2026).

`AAA-NNN` — 7 caracteres: 3 alfabéticos que identifican al tenant + guion +
3 dígitos que identifican la sede/sucursal. `001` = Matriz, `002`+ = sucursales.
Ej.: `MAG-001` = Matriz de M&M Magdaleno, `MAG-002` = su sucursal.

Nota: hay tenants heredados cuyo `empresa_id` NO sigue este formato todavía
(`DEMO_CORP`, etc.). `parse_tenant_id` los marca `valid=False` sin reventar —
la validación estricta solo se aplica donde D4 lo exige (registro de terminales,
enforcement de sede en login).
"""
import re

TENANT_ID_RE = re.compile(r"^([A-Za-z]{3})-(\d{3})$")


def parse_tenant_id(value: str) -> dict:
    """Descompone un TENANT ID `AAA-NNN`. Nunca lanza — devuelve valid=False
    para cualquier cosa que no calce."""
    raw = (value or "").strip()
    m = TENANT_ID_RE.match(raw)
    if not m:
        return {"valid": False, "raw": raw, "prefix": None, "sede": None, "is_matriz": False}
    prefix, sede = m.group(1).upper(), m.group(2)
    return {
        "valid": True,
        "raw": raw,
        "prefix": prefix,
        "sede": sede,
        "is_matriz": sede == "001",
    }


def is_valid_tenant_id(value: str) -> bool:
    return parse_tenant_id(value)["valid"]
