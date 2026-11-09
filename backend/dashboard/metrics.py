"""Diccionario centralizado de definiciones de métricas y cálculo de periodos (Sección 18).

Garantiza que ningún indicador sea ambiguo: cada métrica incluye su definición
oficial, fuente de datos, moneda, inclusión/exclusión de IVA y reglas de comparación.
"""
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Tuple

DEFAULT_TIMEZONE = "America/Mazatlan"
DEFAULT_CURRENCY = "MXN"

METRIC_DEFINITIONS: Dict[str, dict] = {
    "sales_today": {
        "title": "Ventas del Periodo",
        "definition": "Suma de ventas con estado 'completed' en el periodo seleccionado (incluye impuestos, excluye canceladas).",
        "source": "sales",
        "unit": "currency",
        "includesTax": True,
    },
    "sales_net": {
        "title": "Ventas Netas",
        "definition": "Ventas completadas menos devoluciones registradas en el mismo periodo.",
        "source": "sales, sale_returns",
        "unit": "currency",
        "includesTax": True,
    },
    "tickets_count": {
        "title": "Tickets Generados",
        "definition": "Número total de tickets con estado 'completed' en el periodo seleccionado.",
        "source": "sales",
        "unit": "integer",
        "includesTax": False,
    },
    "avg_ticket": {
        "title": "Ticket Promedio",
        "definition": "Ventas completadas divididas entre el número de tickets completados del periodo.",
        "source": "sales",
        "unit": "currency",
        "includesTax": True,
    },
    "products_sold": {
        "title": "Productos Vendidos",
        "definition": "Suma de unidades vendidas (sale_items.quantity) en operaciones con estado 'completed'.",
        "source": "sale_items, sales",
        "unit": "quantity",
        "includesTax": False,
    },
    "clients_served": {
        "title": "Clientes Atendidos",
        "definition": "Operaciones atendidas y clientes únicos identificados (excluye duplicados de RFC genérico en conteo de únicos).",
        "source": "sales, clients",
        "unit": "integer",
        "includesTax": False,
    },
    "crm_opportunities": {
        "title": "Oportunidades (CRM)",
        "definition": "Cotizaciones activas, prospectos y oportunidades comerciales registradas en el periodo.",
        "source": "quotes, clients, projects",
        "unit": "integer",
        "includesTax": False,
    },
    "sales_trend": {
        "title": "Tendencia de Ventas",
        "definition": "Serie temporal de ventas completadas agrupadas por día o mes según el periodo seleccionado.",
        "source": "sales",
        "unit": "currency",
        "includesTax": True,
    },
    "sales_by_department": {
        "title": "Ventas por Departamento / Familia",
        "definition": "Distribución porcentual y monetaria de ventas completadas por departamento o categoría de producto.",
        "source": "sale_items, products",
        "unit": "currency",
        "includesTax": True,
    },
    "sales_by_branch": {
        "title": "Ventas por Sucursal",
        "definition": "Comparativo de ventas completadas y participación porcentual por cada sucursal autorizada.",
        "source": "sales, branches",
        "unit": "currency",
        "includesTax": True,
    },
    "alerts_pending": {
        "title": "Alertas y Pendientes Operativos",
        "definition": "Consolidado de alertas activas: stock bajo, órdenes de compra por recibir, cotizaciones sin seguimiento, CxC vencidas y RH.",
        "source": "products, purchase_orders, quotes, accounts_receivable, employees",
        "unit": "list",
        "includesTax": False,
    },
    "top_products": {
        "title": "Top Productos del Periodo",
        "definition": "Productos con mayor importe y volumen de venta en operaciones completadas del periodo.",
        "source": "sale_items, products",
        "unit": "table",
        "includesTax": True,
    },
    "financial_summary_month": {
        "title": "Resumen Financiero",
        "definition": "Estado de resultados operativo: Ventas, Costo de Ventas (costo promedio), Utilidad Bruta, Gastos Operativos y Utilidad Neta.",
        "source": "sales, sale_items, products, operating_expenses",
        "unit": "financial",
        "includesTax": True,
    },
    "inventory_low_stock": {
        "title": "Productos con Stock Bajo / Agotado",
        "definition": "Artículos cuya existencia actual es menor o igual al stock mínimo configurado o se encuentran en cero.",
        "source": "products, warehouse_stock",
        "unit": "integer",
        "includesTax": False,
    },
    "inventory_valuation": {
        "title": "Valor Total del Inventario",
        "definition": "Suma de existencias físicas multiplicadas por el costo promedio (o precio base si carece de costo).",
        "source": "products",
        "unit": "currency",
        "includesTax": False,
    },
    "cxc_summary": {
        "title": "Cuentas por Cobrar (Cartera)",
        "definition": "Saldo total pendiente de cobro y cartera vencida con fecha límite anterior a hoy.",
        "source": "accounts_receivable",
        "unit": "currency",
        "includesTax": True,
    },
    "cxp_summary": {
        "title": "Cuentas por Pagar y Compras",
        "definition": "Saldo pendiente a proveedores en cuentas por pagar y órdenes de compra abiertas.",
        "source": "accounts_payable, purchase_orders",
        "unit": "currency",
        "includesTax": True,
    },
    "cash_cuts_status": {
        "title": "Estado de Cajas y Cortes",
        "definition": "Turnos de caja abiertos, efectivo esperado, declarado y diferencias pendientes de autorización.",
        "source": "cash_shifts, sales",
        "unit": "currency",
        "includesTax": True,
    },
    "quotes_conversion": {
        "title": "Cotizaciones y Conversión",
        "definition": "Cotizaciones emitidas, abiertas y porcentaje de conversión en el periodo.",
        "source": "quotes",
        "unit": "percentage",
        "includesTax": True,
    },
    "hr_attendance": {
        "title": "Recursos Humanos y Asistencia",
        "definition": "Plantilla activa de empleados, incidencias y autorizaciones de reloj checador en el periodo.",
        "source": "employees, attendance_authorizations",
        "unit": "integer",
        "includesTax": False,
    },
    "logistics_deliveries": {
        "title": "Entregas, Rutas y Traspasos",
        "definition": "Rutas de reparto activas, paradas pendientes, resguardos y traspasos entre almacenes.",
        "source": "routes, route_stops, transfers, safekept_items",
        "unit": "integer",
        "includesTax": False,
    },
    "ai_executive_summary": {
        "title": "Resumen Ejecutivo IA",
        "definition": "Análisis inteligente generado a partir de los indicadores autorizados para el rol activo.",
        "source": "multi-source",
        "unit": "insights",
        "includesTax": False,
    },
}


def resolve_date_range(
    date_preset: str = "today",
    custom_from: Optional[str] = None,
    custom_to: Optional[str] = None,
    comparison_mode: str = "previous_period",
) -> Tuple[datetime, datetime, datetime, datetime, str]:
    """Devuelve (start_utc, end_utc, prev_start_utc, prev_end_utc, label_es).

    Usa horario local de negocio (UTC-7 America/Mazatlan) para que "Hoy" cubra
    el día operativo completo del negocio.
    """
    now_utc = datetime.now(timezone.utc)
    tz_offset = timedelta(hours=-7)
    now_local = now_utc + tz_offset
    today_local_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)

    preset = (date_preset or "today").lower().strip()

    if preset == "yesterday":
        start_local = today_local_start - timedelta(days=1)
        end_local = today_local_start
        label = "Ayer"
    elif preset in ("7d", "last_7_days"):
        start_local = today_local_start - timedelta(days=6)
        end_local = today_local_start + timedelta(days=1)
        label = "Últimos 7 días"
    elif preset in ("30d", "last_30_days"):
        start_local = today_local_start - timedelta(days=29)
        end_local = today_local_start + timedelta(days=1)
        label = "Últimos 30 días"
    elif preset in ("month", "this_month"):
        start_local = today_local_start.replace(day=1)
        end_local = today_local_start + timedelta(days=1)
        label = "Mes actual"
    elif preset in ("prev_month", "last_month"):
        first_this_month = today_local_start.replace(day=1)
        end_local = first_this_month
        prev_m = first_this_month - timedelta(days=1)
        start_local = prev_m.replace(day=1)
        label = "Mes anterior"
    elif preset in ("year", "this_year"):
        start_local = today_local_start.replace(month=1, day=1)
        end_local = today_local_start + timedelta(days=1)
        label = "Año actual"
    elif preset == "custom" and custom_from:
        try:
            start_local = datetime.fromisoformat(custom_from.replace("Z", "")).replace(tzinfo=timezone.utc) + tz_offset
        except Exception:
            start_local = today_local_start
        if custom_to:
            try:
                end_local = datetime.fromisoformat(custom_to.replace("Z", "")).replace(tzinfo=timezone.utc) + tz_offset + timedelta(days=1)
            except Exception:
                end_local = today_local_start + timedelta(days=1)
        else:
            end_local = today_local_start + timedelta(days=1)
        label = f"{custom_from[:10]} a {(custom_to or custom_from)[:10]}"
    else:
        # Default: today
        start_local = today_local_start
        end_local = today_local_start + timedelta(days=1)
        label = "Hoy"

    start_utc = start_local - tz_offset
    end_utc = end_local - tz_offset

    span = end_utc - start_utc
    if span.total_seconds() <= 0:
        span = timedelta(days=1)

    if (comparison_mode or "").lower() == "previous_year":
        prev_start_utc = start_utc - timedelta(days=365)
        prev_end_utc = end_utc - timedelta(days=365)
    else:
        prev_end_utc = start_utc
        prev_start_utc = start_utc - span

    return start_utc, end_utc, prev_start_utc, prev_end_utc, label
