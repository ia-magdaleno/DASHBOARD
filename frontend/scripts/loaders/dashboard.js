/* =============================================================
   loaders/dashboard.js — CALEBSYS Admin Shell v5.1A
   Dashboard del Módulo Administración — 100% conectado y funcional.

   Fuentes de datos:
     GET /api/dashboard/stats   → KPIs, gráfica horaria, top productos,
                                   últimas ventas, ventas diarias/mensuales.
     GET /api/dashboard/activity → Feed unificado audit_log + ventas recientes.

   Arquitectura:
     - Función pública: loadDashboard() — llamada por admin-shell.js
       en el dispatcher loadPageData('dashboard').
     - Sin dependencias externas: Chart.js, D3, etc. NO requeridos.
       Las barras se renderizan con divs flexbox (misma técnica que el
       dashboard de OS anterior, manteniendo coherencia visual).
     - Tolerante a fallo parcial: si /stats carga pero /activity falla
       (o viceversa), la parte que cargó se muestra igual.
     - Compatible SQLite (dev local) y PostgreSQL (SaaS).

   Comentarios internos obligatorios per software-architect skill.
   ============================================================= */
(function (global) {
  'use strict';

  /* ──────────────────────────────────────────────────────────────
     ESTADO DEL DRILL-DOWN POR SUCURSAL (M-2)
     _branchNames: mapa sucursal_id -> nombre, para mostrar en el
     desglose y el breadcrumb (poblado una sola vez desde /api/branches).
     _lastScope: último scope devuelto por /api/dashboard/stats
     ('ALL' o un sucursal_id), para que dashDrillFromKpi() sepa si debe
     dirigir la atención al panel de desglose.
     ────────────────────────────────────────────────────────────── */
  var _branchNames = {};
  var _lastScope = null;

  function _branchLabel(sucursalId) {
    if (!sucursalId) return 'Sin sucursal';
    return _branchNames[sucursalId] || sucursalId;
  }

  /* ──────────────────────────────────────────────────────────────
     HELPERS INTERNOS
     ────────────────────────────────────────────────────────────── */

  /** Formatea hora ISO (HH:00 o ISO timestamp) a "HH:00" legible */
  function _fmtHour(raw) {
    if (!raw) return '—';
    // raw puede venir como "08:00" (SQLite) o "2026-08-12T08:00:00+00:00" (PG)
    if (raw.length <= 5) return raw;
    try {
      var d = new Date(raw);
      return String(d.getHours()).padStart(2, '0') + ':00';
    } catch (e) { return raw.slice(0, 5); }
  }

  /** Clasifica el método de pago en una categoría CSS */
  function _payClass(method) {
    if (!method) return 'otros';
    var m = method.toLowerCase();
    if (m.includes('efectivo') || m.includes('cash')) return 'efectivo';
    if (m.includes('tarjeta') || m.includes('card') || m.includes('credito_banco')) return 'tarjeta';
    if (m.includes('transfer')) return 'transferencia';
    if (m.includes('credito') || m.includes('crédito')) return 'credito';
    return 'otros';
  }

  /** Formatea timestamp ISO a "HH:MM" o "DD/MM HH:MM" según cercanía */
  function _fmtTimestamp(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      var now = new Date();
      var diffMs = now - d;
      var diffMin = Math.round(diffMs / 60000);
      if (diffMin < 1)  return 'ahora';
      if (diffMin < 60) return 'hace ' + diffMin + ' min';
      if (diffMin < 1440) {
        return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
      }
      return (d.getDate()) + '/' + (d.getMonth()+1) + ' ' +
             String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    } catch(e) { return String(iso).slice(11,16); }
  }

  /** Abreviatura de ID de venta (últimos 8 chars) */
  function _shortId(id) {
    if (!id) return '—';
    return '…' + String(id).slice(-8);
  }

  /* ──────────────────────────────────────────────────────────────
     RENDERIZADOR: KPI helpers
     ────────────────────────────────────────────────────────────── */

  /** Escribe valor en el elemento KPI y actualiza su trend-line */
  function _setKpi(id, value, trendId, trendHtml) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = value;
    if (trendId) {
      var tEl = document.getElementById(trendId);
      if (tEl) tEl.innerHTML = trendHtml || '';
    }
  }

  /** Muestra estado de error en todos los KPIs */
  function _kpiError(msg) {
    var ids = ['kpi-ventas-hoy','kpi-transacciones','kpi-ticket-prom','kpi-cxc','kpi-delta','kpi-top-sku'];
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '<span style="color:var(--danger);font-size:0.9rem;">—</span>';
    });
    var tIds = ['kpi-trend-ventas','kpi-trend-trans','kpi-trend-prom','kpi-trend-cxc','kpi-trend-delta','kpi-trend-sku'];
    tIds.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '<i class="fa-solid fa-wifi-slash" style="color:var(--danger);"></i> ' + (msg || 'Sin conexión');
    });
  }

  /* ──────────────────────────────────────────────────────────────
     RENDERIZADOR: Gráfica de barras horaria
     ────────────────────────────────────────────────────────────── */

  /**
   * Renderiza las barras de ventas por hora.
   * Construye 24 columnas (00-23); las horas sin datos quedan en gris mínimo.
   * La altura de cada barra es proporcional al máximo de la serie.
   *
   * @param {Array} hourlyData  Array de {hour: "HH:00", total: number}
   * @param {number} dayTotal   Total del día para el label superior
   */
  function _renderHourlyChart(hourlyData, dayTotal) {
    var wrap = document.getElementById('hourly-chart-wrap');
    if (!wrap) return;

    // Construir mapa hora -> total para acceso O(1)
    var map = {};
    (hourlyData || []).forEach(function(h) {
      var key = _fmtHour(h.hour);
      map[key] = (h.total || 0);
    });

    // Detectar máximo para escalar las barras
    var maxVal = 0;
    for (var h = 0; h < 24; h++) {
      var key = String(h).padStart(2,'0') + ':00';
      if ((map[key] || 0) > maxVal) maxVal = map[key];
    }
    if (maxVal === 0) maxVal = 1; // evitar división por cero

    var html = '';
    for (var hour = 0; hour < 24; hour++) {
      var hKey = String(hour).padStart(2,'0') + ':00';
      var val  = map[hKey] || 0;
      var pct  = Math.max(4, Math.round((val / maxVal) * 140)); // 4px mín, 140px máx
      var isZero = val === 0;
      var isNow  = hour === new Date().getHours();

      html += '<div class="dash-bar-col" title="' + hKey + ': ' + AdminAPI.fmtCurrency(val) + '">';
      html += '  <div class="dash-bar-fill' + (isZero ? ' zero' : '') + '" ' +
              '       style="height:' + pct + 'px;' +
              (isNow ? 'outline:2px solid #f59e0b;outline-offset:1px;' : '') + '"></div>';
      // Sólo mostrar label en horas pares para no saturar
      html += '  <div class="dash-bar-label">' + (hour % 4 === 0 ? hKey.slice(0,2) : '') + '</div>';
      html += '</div>';
    }

    wrap.innerHTML = html;

    // Actualizar label de total del día
    var totalLabel = document.getElementById('chart-total-label');
    if (totalLabel) {
      totalLabel.textContent = 'Total hoy: ' + AdminAPI.fmtCurrency(dayTotal || 0);
    }
  }

  /* ──────────────────────────────────────────────────────────────
     RENDERIZADOR: Top Productos
     ────────────────────────────────────────────────────────────── */

  function _renderTopProducts(topProducts) {
    var wrap = document.getElementById('top-products-list');
    if (!wrap) return;

    if (!topProducts || topProducts.length === 0) {
      wrap.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:0.78rem;">' +
                       '<i class="fa-solid fa-inbox"></i> Sin ventas hoy</div>';
      return;
    }

    var rankClasses = ['gold','silver','bronze','',''];
    var html = '';
    topProducts.slice(0,5).forEach(function(p, i) {
      var rankClass = rankClasses[i] || '';
      html += '<div class="top-prod-row">';
      html += '  <div class="top-prod-rank ' + rankClass + '">' + (i+1) + '</div>';
      html += '  <div style="flex:1;min-width:0;">';
      html += '    <div style="font-size:0.78rem;font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
              (p.sku || '—') + '</div>';
      html += '    <div style="font-size:0.68rem;color:var(--text-muted);">' +
              AdminAPI.fmtNum(p.qty || 0) + ' uds.</div>';
      html += '  </div>';
      html += '  <div style="font-size:0.8rem;font-weight:800;color:var(--text-main);font-family:\'Plus Jakarta Sans\',sans-serif;">' +
              AdminAPI.fmtCurrency(p.revenue || 0) + '</div>';
      html += '</div>';
    });

    wrap.innerHTML = html;
  }

  /* ──────────────────────────────────────────────────────────────
     RENDERIZADOR: Últimas Ventas (tabla)
     ────────────────────────────────────────────────────────────── */

  function _renderRecentSales(recentSales) {
    var tbody = document.getElementById('recent-sales-body');
    if (!tbody) return;

    if (!recentSales || recentSales.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.78rem;">' +
                        '<i class="fa-solid fa-inbox"></i> Sin ventas hoy</td></tr>';
      return;
    }

    var html = '';
    recentSales.slice(0,8).forEach(function(s) {
      var payClass = _payClass(s.payment_method);
      var payLabel = (s.payment_method || 'N/A').replace(/_/g,' ');
      html += '<tr style="border-bottom:1px solid var(--border);">';
      html += '  <td style="padding:8px;font-size:0.72rem;color:var(--text-muted);font-family:monospace;">' +
              _shortId(s.id) + '</td>';
      html += '  <td style="padding:8px;">' +
              '<span class="pay-badge ' + payClass + '">' + payLabel + '</span></td>';
      html += '  <td style="padding:8px;text-align:right;font-weight:700;font-size:0.8rem;color:var(--text-main);">' +
              AdminAPI.fmtCurrency(s.total) + '</td>';
      html += '  <td style="padding:8px;text-align:right;font-size:0.7rem;color:var(--text-muted);">' +
              _fmtTimestamp(s.created_at) + '</td>';
      html += '</tr>';
    });

    tbody.innerHTML = html;
  }

  /* ──────────────────────────────────────────────────────────────
     RENDERIZADOR + NAVEGACIÓN: Drill-down por sucursal (M-2)

     Nivel 1 — scope="ALL": KPIs agregados de todo el tenant (ya los
       pinta _renderStats con los datos que manda el backend en modo
       ALL) + este panel de desglose por sucursal debajo.
     Nivel 2 — el panel de desglose (#by-sucursal-panel): una fila por
       sucursal con sus ventas/tickets de hoy. Clic en una fila = nivel 3.
     Nivel 3 — scope=<sucursal_id>: detalle completo de esa sede (los
       mismos KPIs/gráfica/tabla ya quedan scoped por el backend) +
       breadcrumb arriba para regresar al nivel 1.

     Solo aplica para el admin dueño/gerente general — para cualquier
     otro rol el selector está oculto y esta función no muestra nada.
     ────────────────────────────────────────────────────────────── */

  function _renderScopeUI(data, isOwnerAdmin) {
    var breadcrumb = document.getElementById('dash-scope-breadcrumb');
    var panel       = document.getElementById('by-sucursal-panel');
    if (!breadcrumb || !panel) return;

    var kpiCards = [
      document.getElementById('kpi-card-ventas'),
      document.getElementById('kpi-card-transacciones'),
      document.getElementById('kpi-card-cxc'),
    ];

    if (!isOwnerAdmin) {
      // Gerente/Almacenista/Cajero/etc.: nunca ven el selector ni el
      // desglose — su vista siempre es su propia sucursal, sin drill-down.
      breadcrumb.style.display = 'none';
      panel.style.display = 'none';
      kpiCards.forEach(function(c) { if (c) c.classList.remove('dash-kpi-clickable'); });
      return;
    }

    var scope = data.scope;
    if (scope === 'ALL') {
      // Nivel 1: agregado del tenant — mostrar el desglose, ocultar breadcrumb.
      breadcrumb.style.display = 'none';
      panel.style.display = 'block';
      kpiCards.forEach(function(c) { if (c) c.classList.add('dash-kpi-clickable'); });
      _renderBySucursal(data.by_sucursal || []);
    } else if (scope) {
      // Nivel 3: detalle de una sola sucursal — mostrar breadcrumb, ocultar desglose.
      panel.style.display = 'none';
      breadcrumb.style.display = 'flex';
      kpiCards.forEach(function(c) { if (c) c.classList.remove('dash-kpi-clickable'); });
      var label = document.getElementById('dash-scope-label');
      if (label) label.textContent = _branchLabel(scope);
    } else {
      // Sin scope reconocible (no debería pasar) — ocultar ambos por seguridad.
      breadcrumb.style.display = 'none';
      panel.style.display = 'none';
      kpiCards.forEach(function(c) { if (c) c.classList.remove('dash-kpi-clickable'); });
    }
  }

  /** Pinta el panel de desglose por sucursal (nivel 2 del drill-down). */
  function _renderBySucursal(rows) {
    var wrap = document.getElementById('by-sucursal-list');
    if (!wrap) return;

    if (!rows || rows.length === 0) {
      wrap.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:0.78rem;">' +
                       '<i class="fa-solid fa-inbox"></i> Sin ventas hoy en ninguna sucursal</div>';
      return;
    }

    var maxTotal = 0;
    rows.forEach(function(r) { if ((r.ventas_hoy || 0) > maxTotal) maxTotal = r.ventas_hoy || 0; });
    if (maxTotal === 0) maxTotal = 1;

    var html = '';
    rows.forEach(function(r) {
      var pct = Math.max(3, Math.round(((r.ventas_hoy || 0) / maxTotal) * 100));
      var label = _branchLabel(r.sucursal_id);
      html += '<div class="by-suc-row" title="' + label.replace(/"/g, '&quot;') +
              '" onclick="if(typeof dashSelectSucursal===\'function\')dashSelectSucursal(\'' +
              String(r.sucursal_id).replace(/'/g, "\\'") + '\')">';
      html += '  <div style="width:240px;flex-shrink:0;font-size:0.78rem;font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
              label + '</div>';
      html += '  <div class="by-suc-bar-track"><div class="by-suc-bar-fill" style="width:' + pct + '%;"></div></div>';
      html += '  <div style="width:110px;flex-shrink:0;text-align:right;font-size:0.82rem;font-weight:800;color:var(--text-main);font-family:\'Plus Jakarta Sans\',sans-serif;">' +
              AdminAPI.fmtCurrency(r.ventas_hoy || 0) + '</div>';
      html += '  <div style="width:70px;flex-shrink:0;text-align:right;font-size:0.7rem;color:var(--text-muted);">' +
              AdminAPI.fmtNum(r.tickets_hoy || 0) + ' tickets</div>';
      html += '  <div style="width:110px;flex-shrink:0;text-align:right;font-size:0.78rem;font-weight:700;' +
              ((r.cxc_pendiente || 0) > 0 ? 'color:#f59e0b;' : 'color:var(--text-muted);') + '">' +
              AdminAPI.fmtCurrency(r.cxc_pendiente || 0) + '<div style="font-size:0.6rem;font-weight:500;color:var(--text-muted);">CxC</div></div>';
      html += '  <i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:0.7rem;flex-shrink:0;"></i>';
      html += '</div>';
    });
    wrap.innerHTML = html;
  }

  /** Nivel 2 → 3: clic en una fila del desglose — va al detalle de esa sucursal. */
  global.dashSelectSucursal = function (sucursalId) {
    var sel = document.getElementById('dash-sucursal-filter');
    if (!sel) return;
    sel.value = sucursalId;
    if (typeof global.loadDashboard === 'function') global.loadDashboard();
  };

  /** Nivel 3 → 1: botón del breadcrumb — regresa al agregado de todas las sucursales. */
  global.dashBackToAll = function () {
    var sel = document.getElementById('dash-sucursal-filter');
    if (!sel) return;
    sel.value = 'ALL';
    if (typeof global.loadDashboard === 'function') global.loadDashboard();
  };

  /** Nivel 1 → 2: clic en la tarjeta de Ventas Hoy/Transacciones cuando el
      scope activo es "todas las sucursales" — dirige la atención al panel
      de desglose (ya está en pantalla, no hace falta otra petición). */
  global.dashDrillFromKpi = function () {
    if (_lastScope !== 'ALL') return; // ya está en el detalle de una sucursal, o no es admin
    var panel = document.getElementById('by-sucursal-panel');
    if (!panel) return;
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    panel.classList.remove('dash-panel-pulse');
    // Forzar reflow para poder re-disparar la animación si se hace clic varias veces
    void panel.offsetWidth;
    panel.classList.add('dash-panel-pulse');
  };

  /* ──────────────────────────────────────────────────────────────
     RENDERIZADOR: Feed de Actividad
     ────────────────────────────────────────────────────────────── */

  /**
   * Renderiza el feed de actividad reciente unificado.
   * Distingue visualmente entre eventos de auditoría y ventas.
   * Usa íconos y colores coherentes con el design system del shell.
   */
  function _renderActivityFeed(activity) {
    var wrap = document.getElementById('activity-feed');
    if (!wrap) return;

    if (!activity || activity.length === 0) {
      wrap.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.78rem;">' +
                       '<i class="fa-solid fa-inbox"></i><br>Sin actividad reciente</div>';
      return;
    }

    var html = '';
    activity.slice(0,12).forEach(function(item) {
      var dotClass = 'audit';
      var icon = 'fa-shield-halved';
      var textHtml = '';

      if (item.type === 'sale') {
        // Evento de venta
        dotClass = 'sale';
        icon = 'fa-receipt';
        textHtml = '<strong>' + AdminAPI.fmtCurrency(item.total) + '</strong>' +
                   ' — ' + (item.client_name || 'Público General') +
                   ' <span style="color:var(--text-muted);font-size:0.68rem;">[' +
                   (item.payment_method || '—') + ']</span>';
      } else {
        // Evento de auditoría
        var sev = (item.severity || 'INFO').toUpperCase();
        if (sev === 'WARNING') { dotClass = 'warn'; icon = 'fa-triangle-exclamation'; }
        else if (sev === 'CRITICAL' || sev === 'SECURITY') { dotClass = 'crit'; icon = 'fa-shield-exclamation'; }
        else { dotClass = 'audit'; icon = 'fa-shield-halved'; }

        // Detalles: pueden ser string o JSON object
        var details = item.details || '';
        if (typeof details === 'object') details = JSON.stringify(details);
        textHtml = '<strong>' + (item.action || '—').replace(/_/g,' ') + '</strong>' +
                   (details ? ' — <span style="color:var(--text-muted);">' + String(details).slice(0,60) + '</span>' : '') +
                   (item.user ? ' <span style="font-size:0.65rem;color:var(--text-muted);">[' + item.user + ']</span>' : '');
      }

      html += '<div class="activity-row">';
      html += '  <span class="activity-dot ' + dotClass + '"></span>';
      html += '  <div style="flex:1;min-width:0;">';
      html += '    <div class="activity-text">' + textHtml + '</div>';
      html += '  </div>';
      html += '  <div class="activity-time">' + _fmtTimestamp(item.created_at) + '</div>';
      html += '</div>';
    });

    wrap.innerHTML = html;
  }

  /* ──────────────────────────────────────────────────────────────
     RENDERIZADOR: KPIs principales (stats)
     ────────────────────────────────────────────────────────────── */

  function _renderStats(data) {
    // ── Ventas Hoy
    var ventasHoy = data.ventas_hoy ?? 0;
    var delta     = data.delta_ventas ?? 0;
    var deltaSign = delta >= 0 ? '+' : '';
    var deltaColor= delta >= 0 ? '#10b981' : '#ef4444';
    var deltaIcon = delta >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';

    _setKpi(
      'kpi-ventas-hoy', AdminAPI.fmtCurrency(ventasHoy),
      'kpi-trend-ventas',
      '<i class="fa-solid ' + deltaIcon + '" style="color:' + deltaColor + ';"></i>' +
      ' <span style="color:' + deltaColor + ';font-weight:700;">' + deltaSign + delta + '%</span>' +
      ' vs ayer'
    );

    // ── Transacciones
    var tickets = data.tickets_hoy ?? 0;
    _setKpi(
      'kpi-transacciones', AdminAPI.fmtNum(tickets),
      'kpi-trend-trans',
      '<i class="fa-solid fa-check" style="color:#10b981;"></i> Ventas completadas hoy'
    );

    // ── Ticket Promedio (ventas_hoy / tickets)
    var ticketProm = tickets > 0 ? (ventasHoy / tickets) : 0;
    _setKpi(
      'kpi-ticket-prom', AdminAPI.fmtCurrency(ticketProm),
      'kpi-trend-prom',
      tickets > 0
        ? '<i class="fa-solid fa-check" style="color:#10b981;"></i> ' + tickets + ' transacciones'
        : '<span style="color:var(--text-muted);">Sin ventas hoy</span>'
    );

    // ── CxC Pendiente
    var cxc = data.cuentas_por_cobrar ?? 0;
    _setKpi(
      'kpi-cxc', AdminAPI.fmtCurrency(cxc),
      'kpi-trend-cxc',
      cxc > 0
        ? '<i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> Cartera pendiente'
        : '<i class="fa-solid fa-circle-check" style="color:#10b981;"></i> Sin cartera pendiente'
    );

    // ── Delta vs Ayer
    var deltaAbs = Math.abs(delta);
    _setKpi(
      'kpi-delta',
      '<span style="color:' + deltaColor + ';">' + deltaSign + deltaAbs + '%</span>',
      'kpi-trend-delta',
      delta >= 0
        ? '<i class="fa-solid fa-arrow-up" style="color:#10b981;"></i> Mejor que ayer'
        : '<i class="fa-solid fa-arrow-down" style="color:#ef4444;"></i> Menor que ayer'
    );

    // Ajustar color/ícono del contenedor KPI-5 según tendencia
    var iconEl = document.getElementById('kpi-delta-icon');
    if (iconEl) {
      iconEl.style.background   = delta >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
      iconEl.style.color        = delta >= 0 ? '#10b981' : '#ef4444';
      iconEl.innerHTML = '<i class="fa-solid ' + deltaIcon + '"></i>';
    }

    // ── Top SKU del día
    var topProds = data.top_products || [];
    if (topProds.length > 0) {
      _setKpi(
        'kpi-top-sku', topProds[0].sku || '—',
        'kpi-trend-sku',
        '<i class="fa-solid fa-boxes-stacked" style="color:#14b8a6;"></i>' +
        ' ' + AdminAPI.fmtNum(topProds[0].qty) + ' uds. — ' +
        AdminAPI.fmtCurrency(topProds[0].revenue)
      );
    } else {
      _setKpi('kpi-top-sku', '—', 'kpi-trend-sku', 'Sin ventas hoy');
    }

    // ── Dialecto y timestamp
    var dialectEl = document.getElementById('dash-dialect-badge');
    if (dialectEl) {
      var dialect = data._dialect || 'desconocido';
      dialectEl.innerHTML =
        '<i class="fa-solid fa-database"></i> BD: ' + dialect.toUpperCase() +
        (data._compat_mode ? ' <span style="color:#f59e0b;">(compat)</span>' : '');
    }
    var updEl = document.getElementById('dash-last-updated');
    if (updEl) {
      updEl.innerHTML = '<i class="fa-solid fa-clock"></i> Actualizado: ' +
        new Date().toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    }

    // ── Badge de estado
    var badge = document.getElementById('dash-status-badge');
    if (badge) {
      badge.className = 'badge badge-success';
      badge.innerHTML = '<span class="dot"></span> Sistema Activo';
    }

    // ── Subtítulo con fecha
    var sub = document.getElementById('dash-subtitle');
    if (sub) {
      var hoy = new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'});
      sub.textContent = 'Resumen operativo — ' + hoy.charAt(0).toUpperCase() + hoy.slice(1);
    }
  }

  /* ──────────────────────────────────────────────────────────────
     FUNCIÓN PÚBLICA: loadDashboard()
     Llamada por admin-shell.js dispatch al navegar al dashboard.
     ────────────────────────────────────────────────────────────── */

  /**
   * Carga todas las secciones del dashboard en paralelo.
   * Las dos peticiones corren simultáneamente con Promise.allSettled
   * para que un fallo parcial no bloquee la otra fuente.
   */
  global.loadDashboard = async function () {
    if (document.getElementById('calebsys-dashboard-root') && window.CalebsysDashboardEngine) {
      return await window.CalebsysDashboardEngine.init();
    }
    // 1. Mostrar spinners mientras carga
    var badge = document.getElementById('dash-status-badge');
    if (badge) {
      badge.className = 'badge';
      badge.innerHTML = '<span class="dot" style="background:var(--warning);"></span> Cargando…';
    }

    // M-1/M-2: Mostrar selector de sucursal solo para ADMIN (dueño/gerente
    // general) y poblarlo si está vacío. El Gerente de sucursal nunca ve
    // este selector — el backend además lo ignoraría si lo mandara.
    // Bug M-1 preexistente: leía window._calebsysRole, que ningún script del
    // proyecto llega a asignar nunca — el patrón real (login.js, admin-shell.js,
    // os-admin.js, etc.) guarda el rol en localStorage('calebsys_role'). Por
    // eso el selector nunca se mostraba. Corregido aquí (04-sep-2026).
    var sucursalSel = document.getElementById('dash-sucursal-filter');
    var sessionRole = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
    var isOwnerAdmin = (sessionRole === 'admin' || sessionRole === 'administrador');
    if (sucursalSel) {
      if (isOwnerAdmin) {
        sucursalSel.style.display = 'block';
        // Poblar opciones si aún no se hizo (solo primera vez)
        if (sucursalSel.options.length <= 1) {
          AdminAPI.apiFetch('/api/branches').then(function(branches) {
            if (!Array.isArray(branches)) return;
            branches.forEach(function(b) {
              var id = b.id || b.sucursal_id || '';
              if (!id) return;
              _branchNames[id] = b.name || b.nombre || id;
              var opt = document.createElement('option');
              opt.value = id;
              opt.textContent = _branchNames[id];
              sucursalSel.appendChild(opt);
            });
          }).catch(function() { /* sin sucursales — ok, se listan solo por id */ });
        }
      } else {
        sucursalSel.style.display = 'none';
      }
    }

    // M-1/M-2: Construir URL con el scope elegido. Solo el admin dueño/
    // gerente general manda este parámetro — para cualquier otro rol el
    // dashboard sigue scoped a su propia sucursal (comportamiento previo).
    var statsUrl = '/api/dashboard/stats';
    if (isOwnerAdmin && sucursalSel && sucursalSel.value) {
      statsUrl += '?sucursal_id=' + encodeURIComponent(sucursalSel.value);
    }

    // 2. Lanzar ambas peticiones en paralelo
    var results = await Promise.allSettled([
      AdminAPI.apiFetch(statsUrl),
      AdminAPI.apiFetch('/api/dashboard/activity')
    ]);

    var statsResult    = results[0];
    var activityResult = results[1];

    /* ── Procesar /stats ── */
    if (statsResult.status === 'fulfilled') {
      var data = statsResult.value;
      try {
        // Render KPIs
        _renderStats(data);
        // Render gráfica de barras horaria
        _renderHourlyChart(data.hourly_sales || [], data.ventas_hoy || 0);
        // Render top productos
        _renderTopProducts(data.top_products || []);
        // Render tabla últimas ventas
        _renderRecentSales(data.recent_sales || []);
        // M-2: Drill-down — breadcrumb (nivel 3) o panel de desglose (nivel 1→2)
        _lastScope = data.scope != null ? data.scope : null;
        _renderScopeUI(data, isOwnerAdmin);
      } catch (renderErr) {
        console.error('[Dashboard] Error renderizando stats:', renderErr);
      }
    } else {
      // Stats fallida: mostrar error en KPIs y gráfica
      console.warn('[Dashboard] /api/dashboard/stats falló:', statsResult.reason);
      _kpiError('Error al cargar KPIs');

      var wrap = document.getElementById('hourly-chart-wrap');
      if (wrap) wrap.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--danger);font-size:0.8rem;">' +
        '<i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i> Error al cargar gráfica</div>';

      var badge2 = document.getElementById('dash-status-badge');
      if (badge2) {
        badge2.className = 'badge badge-danger';
        badge2.innerHTML = '<span class="dot" style="background:var(--danger);"></span> Error de conexión';
      }
    }

    /* ── Procesar /activity ── */
    if (activityResult.status === 'fulfilled') {
      var actData = activityResult.value;
      _renderActivityFeed(actData.activity || []);
    } else {
      console.warn('[Dashboard] /api/dashboard/activity falló:', activityResult.reason);
      var feed = document.getElementById('activity-feed');
      if (feed) {
        feed.innerHTML =
          '<div style="text-align:center;padding:16px;color:var(--danger);font-size:0.78rem;">' +
          '<i class="fa-solid fa-wifi-slash"></i> No se pudo cargar la actividad</div>';
      }
    }
  };

})(window);
