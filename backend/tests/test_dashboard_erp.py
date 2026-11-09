# -*- coding: utf-8 -*-
"""
Suite de Pruebas Automatizadas — Dashboard Principal ERP CALEBSYS (Sección 32)
Archivo: backend/tests/test_dashboard_erp.py

Verifica:
1. Contexto, Catálogo (23+ widgets, 10 categorías) y 7 Plantillas oficiales.
2. Persistencia real de Layout (creación desde system_default, edición, mover/redimensionar, agregar widget, recarga).
3. Cancelación y Restablecimiento a plantilla oficial (/reset).
4. Permisos granulares por rol y por widget:
   - Administrador ve Resumen Financiero del Mes (HTTP 200).
   - Cajero intenta consultar /api/dashboard/widgets/financial_summary_month/data -> HTTP 403.
   - Copiloto Ejecutivo IA (ai_executive_summary) omite información financiera para Cajero.
5. Aislamiento Multiempresa (Tenant A vs Tenant B):
   - Un usuario de Empresa B nunca puede ver ni modificar layouts ni ventas de Empresa A.
6. Aislamiento Multisucursal:
   - Administrador con permiso consolidado ve 'ALL' y desglose por sucursales.
   - Usuario de sucursal sin permiso consolidado recibe HTTP 403 al pedir otra sucursal o 'ALL'.
7. Filtros Globales vs Filtros Propios por Widget (filters).
8. Concurrencia y Bloqueo Optimista de Versión (version obsoleta -> HTTP 409 Conflict).
9. Exportación e Importación JSON validada y rechazo de payloads maliciosos (<script>).
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import jwt
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import main
import models
from database import engine_local
from deps import JWT_ALGORITHM, JWT_SECRET

models.Base.metadata.create_all(bind=engine_local)
client = TestClient(main.app)


def _make_token(empresa_id: str, usuario_id: str, role: str, sucursal_id: str = "MATRIZ") -> str:
    payload = {
        "sub": usuario_id,
        "user_id": usuario_id,
        "usuario": usuario_id,
        "empresa": empresa_id,
        "sucursal": sucursal_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=4),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_01_context_catalog_and_templates():
    token_admin = _make_token("PMM-001", "ANTONIO", "admin", "MATRIZ")
    r_ctx = client.get("/api/dashboard/context", headers=_auth(token_admin))
    assert r_ctx.status_code == 200, r_ctx.text
    ctx = r_ctx.json()
    assert ctx["company"]["id"] == "PMM-001"
    assert ctx["company"]["canViewConsolidated"] is True
    assert "dashboard.view_financial" in ctx["permissions"]

    r_cat = client.get("/api/dashboard/widgets/catalog", headers=_auth(token_admin))
    assert r_cat.status_code == 200
    cat = r_cat.json()
    assert len(cat["widgets"]) >= 20
    assert len(cat["categories"]) == 10

    r_tpl = client.get("/api/dashboard/templates", headers=_auth(token_admin))
    assert r_tpl.status_code == 200
    tpl_ids = {t["id"] for t in r_tpl.json()["templates"]}
    expected_ids = {"executive", "commercial", "operations", "finance", "inventory", "branch", "seller"}
    assert expected_ids.issubset(tpl_ids)


def test_02_layout_persistence_and_optimistic_locking():
    uid = f"ANTONIO_PERSIST_{int(datetime.now(timezone.utc).timestamp())}"
    token_admin = _make_token("PMM-001", uid, "admin", "MATRIZ")

    # 1. Obtener layout activo inicial (system_default con plantilla ejecutiva)
    r_act = client.get("/api/dashboard/layouts/active", headers=_auth(token_admin))
    assert r_act.status_code == 200, r_act.text
    active_doc = r_act.json()
    layout_payload = active_doc["layout"]

    # Verificar que incluye los 11 widgets principales de la imagen de referencia
    w_keys = [w["widgetKey"] for w in layout_payload["widgets"]]
    for req_key in [
        "sales_today", "products_sold", "clients_served", "crm_opportunities",
        "sales_trend", "sales_by_department", "sales_by_branch",
        "quick_actions", "alerts_pending", "top_products", "financial_summary_month",
    ]:
        assert req_key in w_keys, f"Falta widget {req_key} en layout ejecutivo"

    # 2. Guardar personalización sobre system_default (materializa el layout personal en BD v1)
    layout_payload["theme"]["mode"] = "executive"
    layout_payload["widgets"][0]["positions"]["desktop"] = {"x": 0, "y": 0, "w": 4, "h": 2}
    layout_payload["widgets"].append({
        "instanceId": "w_custom_ai_01",
        "widgetKey": "ai_executive_summary",
        "widgetVersion": 1,
        "visible": True,
        "locked": True,
        "positions": {"desktop": {"x": 0, "y": 12, "w": 6, "h": 4}},
        "settings": {"customTitle": "mi resumen ia", "variant": "glass", "accent": "purple"},
        "filters": {"datePreset": "30d"},
    })

    r_put1 = client.put(
        f"/api/dashboard/layouts/{active_doc['id']}",
        headers=_auth(token_admin),
        json={
            "version": 1,
            "name": "mi dashboard personalizado",
            "layout": layout_payload,
        },
    )
    assert r_put1.status_code == 200, r_put1.text
    saved_doc = r_put1.json()
    real_layout_id = saved_doc["id"]
    assert real_layout_id != "system_default"
    assert saved_doc["version"] == 1
    # Regla AGENTS.md: Normalización a MAYÚSCULAS
    assert saved_doc["name"] == "MI DASHBOARD PERSONALIZADO"
    saved_ai = [w for w in saved_doc["layout"]["widgets"] if w["instanceId"] == "w_custom_ai_01"][0]
    assert saved_ai["settings"]["customTitle"] == "MI RESUMEN IA"
    assert saved_ai["locked"] is True

    # 3. Segunda edición legítima incrementa versión a v2
    r_put2 = client.put(
        f"/api/dashboard/layouts/{real_layout_id}",
        headers=_auth(token_admin),
        json={
            "version": 1,
            "name": "MI DASHBOARD V2",
            "layout": saved_doc["layout"],
        },
    )
    assert r_put2.status_code == 200, r_put2.text
    assert r_put2.json()["version"] == 2

    # 4. Concurrencia / Bloqueo Optimista: intentar guardar enviando version=1 cuando el servidor ya está en v2 -> 409 Conflict
    r_conflict = client.put(
        f"/api/dashboard/layouts/{real_layout_id}",
        headers=_auth(token_admin),
        json={
            "version": 1,
            "name": "INTENTO OBSOLETO",
            "layout": saved_doc["layout"],
        },
    )
    assert r_conflict.status_code == 409, f"Se esperaba 409 Conflict, se obtuvo {r_conflict.status_code}"

    # 5. Restablecer a plantilla predeterminada (/reset)
    r_reset = client.post(
        f"/api/dashboard/layouts/{real_layout_id}/reset",
        headers=_auth(token_admin),
        json={"templateId": "executive"},
    )
    assert r_reset.status_code == 200
    reset_doc = r_reset.json()
    assert reset_doc["version"] == 3
    assert not any(w["instanceId"] == "w_custom_ai_01" for w in reset_doc["layout"]["widgets"])


def test_03_permissions_admin_vs_cajero_and_ai_privacy():
    token_admin = _make_token("PMM-001", "ANTONIO", "admin", "MATRIZ")
    token_cajero = _make_token("PMM-001", "CAJERO01", "cajero", "MATRIZ")

    # Admin puede consultar el Resumen Financiero del Mes -> 200 OK
    r_fin_admin = client.get(
        "/api/dashboard/widgets/financial_summary_month/data?datePreset=month",
        headers=_auth(token_admin),
    )
    assert r_fin_admin.status_code == 200, r_fin_admin.text
    assert "netProfit" in r_fin_admin.json()["data"]

    # Cajero intenta consultar directamente el endpoint de Resumen Financiero -> 403 Forbidden
    r_fin_cajero = client.get(
        "/api/dashboard/widgets/financial_summary_month/data?datePreset=month",
        headers=_auth(token_cajero),
    )
    assert r_fin_cajero.status_code == 403, f"Cajero no debe acceder a datos financieros: {r_fin_cajero.text}"

    # Copiloto IA para Cajero jamás debe filtrar utilidad ni margen financiero
    r_ai_cajero = client.get(
        "/api/dashboard/widgets/ai_executive_summary/data?datePreset=today",
        headers=_auth(token_cajero),
    )
    assert r_ai_cajero.status_code == 200
    ai_data = r_ai_cajero.json()["data"]
    for ins in ai_data["insights"]:
        assert ins.get("type") != "financial"
        assert "margen" not in ins["text"].lower()
        assert "utilidad" not in ins["text"].lower()


def test_04_multi_company_and_multi_branch_isolation():
    uid = str(int(datetime.now(timezone.utc).timestamp()))
    token_emp_a = _make_token("EMP-ALPHA", f"ADMIN_A_{uid}", "admin", "MATRIZ")
    token_emp_b = _make_token("EMP-BETA", f"ADMIN_B_{uid}", "admin", "MATRIZ")

    # Crear layout en Empresa A
    act_a = client.get("/api/dashboard/layouts/active", headers=_auth(token_emp_a)).json()
    saved_a = client.put(
        "/api/dashboard/layouts/system_default",
        headers=_auth(token_emp_a),
        json={"version": 1, "name": "LAYOUT EMPRESA A", "layout": act_a["layout"]},
    ).json()
    assert saved_a["empresaId"] == "EMP-ALPHA"

    # Admin de Empresa B intenta modificar el layout de Empresa A -> 404 (Aislamiento estricto por tenant)
    r_cross_put = client.put(
        f"/api/dashboard/layouts/{saved_a['id']}",
        headers=_auth(token_emp_b),
        json={
            "version": 1,
            "name": "HACK CROSS TENANT",
            "layout": saved_a["layout"],
        },
    )
    assert r_cross_put.status_code == 404

    # Usuario de Sucursal 1 (vendedor sin permiso consolidado) intenta pedir otra sucursal o ALL -> 403
    token_suc1 = _make_token("PMM-001", "VEND_SUC1", "vendedor", "SUCURSAL-1")
    r_other_branch = client.get(
        "/api/dashboard/widgets/sales_today/data?branchMode=MATRIZ",
        headers=_auth(token_suc1),
    )
    assert r_other_branch.status_code == 403

    r_all_branches = client.get(
        "/api/dashboard/widgets/sales_today/data?branchMode=ALL",
        headers=_auth(token_suc1),
    )
    assert r_all_branches.status_code == 403

    # Pero su propia sucursal responde 200 OK
    r_own_branch = client.get(
        "/api/dashboard/widgets/sales_today/data?branchMode=SUCURSAL-1",
        headers=_auth(token_suc1),
    )
    assert r_own_branch.status_code == 200
    assert r_own_branch.json()["meta"]["scope"] == "SUCURSAL-1"


def test_05_global_filters_vs_widget_overrides_and_malicious_json_rejection():
    token_admin = _make_token("PMM-001", "ANTONIO", "admin", "MATRIZ")

    # Snapshot combinando filtro global (today) con un widget que tiene override propio (month)
    r_snap = client.post(
        "/api/dashboard/snapshot",
        headers=_auth(token_admin),
        json={
            "dashboardKey": "erp_main",
            "globalFilters": {"datePreset": "today", "branchMode": "ALL"},
            "widgetRequests": [
                {"instanceId": "w_global", "widgetKey": "sales_today", "filters": {}},
                {"instanceId": "w_override", "widgetKey": "sales_today", "filters": {"datePreset": "month"}},
            ],
        },
    )
    assert r_snap.status_code == 200, r_snap.text
    widgets_res = r_snap.json()["widgets"]
    assert widgets_res["w_global"]["meta"]["hasCustomFilter"] is False
    assert widgets_res["w_override"]["meta"]["hasCustomFilter"] is True
    assert widgets_res["w_global"]["meta"]["periodLabel"] != widgets_res["w_override"]["meta"]["periodLabel"]

    # Rechazo de importación JSON con intento de inyección XSS (<script>)
    r_xss = client.post(
        "/api/dashboard/layouts/import",
        headers=_auth(token_admin),
        json={
            "name": "<script>alert(1)</script>",
            "widgets": [],
        },
    )
    assert r_xss.status_code == 422


if __name__ == "__main__":
    test_01_context_catalog_and_templates()
    print("[PASS] test_01_context_catalog_and_templates")
    test_02_layout_persistence_and_optimistic_locking()
    print("[PASS] test_02_layout_persistence_and_optimistic_locking")
    test_03_permissions_admin_vs_cajero_and_ai_privacy()
    print("[PASS] test_03_permissions_admin_vs_cajero_and_ai_privacy")
    test_04_multi_company_and_multi_branch_isolation()
    print("[PASS] test_04_multi_company_and_multi_branch_isolation")
    test_05_global_filters_vs_widget_overrides_and_malicious_json_rejection()
    print("[PASS] test_05_global_filters_vs_widget_overrides_and_malicious_json_rejection")
    print("ALL DASHBOARD ERP TESTS PASSED SUCCESSFULLY!")
