/**
 * CALEBSYS ERP — DASHBOARD WIDGET REGISTRY & RENDERERS
 * Archivo: frontend/scripts/dashboard/registry.js
 * Cumple 100% CSP script-src 'self' (sin eval, sin inline handlers).
 * Alineado con el contrato camelCase de backend/dashboard/providers.py y widget_registry.py.
 */
(function () {
  'use strict';

  const REGISTERED_WIDGETS = new Map();

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(val) {
    const n = Number(val || 0);
    return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatNumber(val) {
    const n = Number(val || 0);
    return n.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  }

  function registerDashboardWidget(definition) {
    if (!definition || !definition.key) {
      throw new Error('registerDashboardWidget requiere definition.key');
    }
    REGISTERED_WIDGETS.set(definition.key, definition);
  }

  function getRegisteredWidget(key) {
    return REGISTERED_WIDGETS.get(key) || null;
  }

  function buildSparklineSvg(points, accentColor) {
    const arr = Array.isArray(points) && points.length >= 2 ? points.map(Number) : [12, 18, 15, 25, 22, 30, 35];
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const range = max - min > 0 ? max - min : 1;
    const w = 92;
    const h = 42;
    const pad = 4;

    const coords = arr.map((v, idx) => {
      const x = pad + (idx / (arr.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return [x.toFixed(1), y.toFixed(1)];
    });

    const polylinePoints = coords.map(c => c.join(',')).join(' ');
    const areaPoints = `${coords[0][0]},${h} ` + polylinePoints + ` ${coords[coords.length - 1][0]},${h}`;

    const colorMap = {
      green: '#4ade80',
      blue: '#60a5fa',
      cyan: '#22d3ee',
      purple: '#c084fc',
      orange: '#fbbf24',
      red: '#f87171',
    };
    const stroke = colorMap[accentColor] || '#60a5fa';
    const last = coords[coords.length - 1];

    return `
      <svg class="dash-kpi-sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="${areaPoints}" fill="${stroke}" fill-opacity="0.16"></polygon>
        <polyline points="${polylinePoints}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></polyline>
        <circle cx="${last[0]}" cy="${last[1]}" r="3.2" fill="#ffffff" stroke="${stroke}" stroke-width="2"></circle>
      </svg>
    `;
  }

  /**
   * 1. Tarjetas KPI con Ícono Orb, Valor Grande, Variación y Sparkline (Fila 1)
   */
  function renderKpiSparklineWidget(container, instance, payload, context) {
    const d = (payload && payload.data) || {};
    const m = (payload && payload.meta) || {};
    const wkey = instance.widgetKey || instance.widget_key;
    const meta = (context && context.catalogMap && context.catalogMap[wkey]) || {};
    const title = (instance.settings && instance.settings.customTitle) || meta.name || meta.title || wkey;
    const icon = meta.icon || 'fa-chart-line';
    const accent = (instance.settings && instance.settings.accent) || meta.accent || 'blue';
    const formatted = d.formatted || d.formatted_value || formatMoney(d.value);
    const deltaPct = Number(d.comparisonValue ?? d.delta_pct ?? 0);
    const deltaSign = deltaPct > 0 ? '+' : '';
    const deltaClass = deltaPct > 0 ? 'positive' : deltaPct < 0 ? 'negative' : 'neutral';
    const deltaArrow = deltaPct >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
    const deltaLabel = d.comparisonLabel || d.comparison_label || 'vs. periodo ant.';
    const tooltipDef = m.definition ? `${m.title || title}: ${m.definition}` : title;
    const customDatePreset = instance.filters && instance.filters.datePreset;

    container.innerHTML = `
      <div class="dash-kpi-card-layout" title="${escapeHtml(tooltipDef)}">
        <div class="dash-kpi-left">
          <div class="dash-kpi-icon-orb">
            <i class="fa-solid ${escapeHtml(icon)}"></i>
          </div>
          <div class="dash-kpi-info">
            <div class="dash-kpi-label-row">
              <span class="dash-kpi-label">${escapeHtml(title)}</span>
              ${customDatePreset ? `<span class="dash-widget-badge-override">${escapeHtml(customDatePreset)}</span>` : ''}
            </div>
            <div class="dash-kpi-value">${escapeHtml(formatted)}</div>
            <div class="dash-kpi-delta ${deltaClass}">
              <i class="fa-solid ${deltaArrow}"></i>
              <span>${deltaSign}${deltaPct.toFixed(1)}%</span>
              <small style="opacity:0.82;font-weight:500;">${escapeHtml(deltaLabel)}</small>
            </div>
          </div>
        </div>
        ${buildSparklineSvg(d.sparkline, accent)}
      </div>
    `;

    const drillPage = meta.drilldownRoute || meta.drilldown_page;
    if (drillPage && !context.isEditing) {
      container.closest('.dash-widget')?.classList.add('is-clickable');
      container.onclick = () => {
        if (!context.isEditing && typeof window.navigateTo === 'function') {
          window.navigateTo(drillPage);
        }
      };
    }
  }

  /**
   * 2. Tendencia de Ventas (Barras + Línea SVG + Pestañas 7 días / 30 días / Mes / Año)
   */
  function renderSalesTrendWidget(container, instance, payload, context) {
    const d = (payload && payload.data) || {};
    const points = Array.isArray(d.points) ? d.points : (Array.isArray(d.series) ? d.series : []);
    const wkey = instance.widgetKey || instance.widget_key;
    const meta = (context && context.catalogMap && context.catalogMap[wkey]) || {};
    const title = (instance.settings && instance.settings.customTitle) || meta.name || 'Tendencia de Ventas';
    const activeTab = (instance.settings && instance.settings.rangeTab) || d.rangeTab || '7d';

    const w = 540;
    const h = 195;
    const padL = 54;
    const padR = 18;
    const padT = 28;
    const padB = 28;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const maxVal = Math.max(100, ...points.map(p => Number(p.value ?? p.total ?? 0)));
    const barCount = Math.max(1, points.length);
    const slotW = plotW / barCount;
    const barW = Math.min(36, Math.max(8, slotW * 0.56));

    let gridLinesHtml = '';
    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const y = (padT + plotH - ratio * plotH).toFixed(1);
      const val = maxVal * ratio;
      const lbl = val >= 1000 ? '$' + (val / 1000).toFixed(val >= 10000 ? 0 : 1) + 'K' : '$' + val.toFixed(0);
      gridLinesHtml += `
        <line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--dash-chart-grid)" stroke-dasharray="3,3"></line>
        <text x="${padL - 8}" y="${Number(y) + 4}" text-anchor="end" fill="var(--dash-chart-axis-y)" font-size="11">${escapeHtml(lbl)}</text>
      `;
    }

    let barsHtml = '';
    let lineCoords = [];
    points.forEach((pt, idx) => {
      const val = Number(pt.value ?? pt.total ?? 0);
      const bh = Math.max(3, (val / maxVal) * plotH);
      const cx = padL + idx * slotW + slotW / 2;
      const bx = cx - barW / 2;
      const by = padT + plotH - bh;
      lineCoords.push([cx.toFixed(1), by.toFixed(1), val, pt.label || '']);

      const showXLabel = points.length <= 12 || idx % Math.ceil(points.length / 8) === 0 || idx === points.length - 1;
      barsHtml += `
        <g class="dash-bar-group">
          <title>${escapeHtml(pt.label)}: ${escapeHtml(formatMoney(val))} (${pt.tickets || 0} tickets)</title>
          <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="5" fill="url(#dashBarGrad)"></rect>
          ${showXLabel ? `<text x="${cx.toFixed(1)}" y="${h - 8}" text-anchor="middle" fill="var(--dash-chart-axis-x)" font-size="11">${escapeHtml(pt.label || '')}</text>` : ''}
        </g>
      `;
    });

    const polyPoints = lineCoords.map(c => `${c[0]},${c[1]}`).join(' ');
    let dotsHtml = '';
    lineCoords.forEach((c, idx) => {
      const isLast = idx === lineCoords.length - 1;
      dotsHtml += `<circle cx="${c[0]}" cy="${c[1]}" r="${isLast ? 4.5 : 3}" fill="${isLast ? '#10b981' : 'var(--dash-chart-dot-bg)'}" stroke="#ffffff" stroke-width="2"></circle>`;
      if (isLast) {
        const badgeW = 92;
        const bx = Math.min(w - badgeW - 4, Math.max(padL, Number(c[0]) - badgeW / 2));
        const by = Math.max(2, Number(c[1]) - 26);
        dotsHtml += `
          <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${badgeW}" height="20" rx="10" fill="#10b981"></rect>
          <text x="${(bx + badgeW / 2).toFixed(1)}" y="${(by + 14).toFixed(1)}" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="700">${escapeHtml(formatMoney(c[2]))}</text>
        `;
      }
    });

    container.innerHTML = `
      <div class="dash-widget-header">
        <div class="dash-widget-title-group">
          <span class="dash-widget-title-icon"><i class="fa-solid fa-chart-column"></i></span>
          <h3 class="dash-widget-title">${escapeHtml(title)}</h3>
        </div>
        <div class="dash-chart-tabs" role="tablist">
          <button type="button" class="dash-chart-tab ${activeTab === '7d' ? 'active' : ''}" data-gran="7d">7 días</button>
          <button type="button" class="dash-chart-tab ${activeTab === '30d' ? 'active' : ''}" data-gran="30d">30 días</button>
          <button type="button" class="dash-chart-tab ${activeTab === 'month' ? 'active' : ''}" data-gran="month">Mes</button>
          <button type="button" class="dash-chart-tab ${activeTab === 'year' ? 'active' : ''}" data-gran="year">Año</button>
        </div>
      </div>
      <div class="dash-widget-body">
        <div class="dash-svg-chart-wrap">
          <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
            <defs>
              <linearGradient id="dashBarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.95"></stop>
                <stop offset="100%" stop-color="#1d4ed8" stop-opacity="0.78"></stop>
              </linearGradient>
            </defs>
            ${gridLinesHtml}
            ${barsHtml}
            ${lineCoords.length > 1 ? `<polyline points="${polyPoints}" fill="none" stroke="var(--dash-chart-line)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></polyline>` : ''}
            ${dotsHtml}
          </svg>
        </div>
      </div>
    `;

    container.querySelectorAll('.dash-chart-tab').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const gran = btn.getAttribute('data-gran');
        if (context && typeof context.onUpdateWidgetSetting === 'function') {
          context.onUpdateWidgetSetting(instance.instanceId || instance.instance_id, { rangeTab: gran });
        }
      });
    });
  }

  /**
   * 3. Ventas por Departamento / Métodos de Pago (Donut SVG + Leyenda)
   */
  function renderSalesByDepartmentWidget(container, instance, payload, context) {
    const d = (payload && payload.data) || {};
    const segments = Array.isArray(d.segments) ? d.segments : (Array.isArray(d.items) ? d.items : []);
    const total = Number(d.total || 0);
    const wkey = instance.widgetKey || instance.widget_key;
    const meta = (context && context.catalogMap && context.catalogMap[wkey]) || {};
    const title = (instance.settings && instance.settings.customTitle) || meta.name || 'Ventas por Departamento';
    const colors = ['#0ea5e9', '#22c55e', '#facc15', '#f97316', '#a855f7', '#94a3b8'];

    const r = 58;
    const c = 2 * Math.PI * r;
    let offset = 0;
    let circlesHtml = '';

    if (segments.length === 0 || total <= 0) {
      circlesHtml = `<circle cx="78" cy="78" r="${r}" fill="none" stroke="rgba(148,163,184,0.2)" stroke-width="20"></circle>`;
    } else {
      segments.forEach((seg, idx) => {
        const pct = Math.max(0, Number(seg.percentage ?? seg.share_pct ?? 0)) / 100;
        const dash = pct * c;
        const color = seg.color || colors[idx % colors.length];
        const segName = seg.name || seg.department || 'General';
        const segVal = seg.value ?? seg.total ?? 0;
        circlesHtml += `
          <circle cx="78" cy="78" r="${r}" fill="none" stroke="${color}" stroke-width="20"
                  stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}"
                  stroke-dashoffset="${(-offset).toFixed(2)}"
                  transform="rotate(-90 78 78)">
            <title>${escapeHtml(segName)}: ${escapeHtml(formatMoney(segVal))} (${(pct * 100).toFixed(1)}%)</title>
          </circle>
        `;
        offset += dash;
      });
    }

    const legendHtml = segments.length > 0
      ? segments.slice(0, 6).map((seg, idx) => {
          const color = seg.color || colors[idx % colors.length];
          const segName = seg.name || seg.department || 'General';
          const pct = Number(seg.percentage ?? seg.share_pct ?? 0);
          return `
            <div class="dash-donut-legend-row" title="${escapeHtml(seg.formatted || formatMoney(seg.value))}">
              <span class="dash-donut-legend-name">
                <span class="dash-donut-dot" style="background:${color};"></span>
                ${escapeHtml(segName)}
              </span>
              <span class="dash-donut-legend-pct">${pct.toFixed(1)}%</span>
            </div>
          `;
        }).join('')
      : `<div class="dash-widget-state">Sin datos en el periodo</div>`;

    container.innerHTML = `
      <div class="dash-widget-header">
        <div class="dash-widget-title-group">
          <span class="dash-widget-title-icon"><i class="fa-solid ${escapeHtml(meta.icon || 'fa-chart-pie')}"></i></span>
          <h3 class="dash-widget-title">${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="dash-widget-body">
        <div class="dash-donut-layout">
          <div class="dash-donut-svg-box">
            <svg viewBox="0 0 156 156">
              ${circlesHtml}
            </svg>
            <div class="dash-donut-center">
              <div class="dash-donut-center-val">${escapeHtml(d.formattedTotal || formatMoney(total))}</div>
              <div class="dash-donut-center-lbl">Total</div>
            </div>
          </div>
          <div class="dash-donut-legend">
            ${legendHtml}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 4. Ventas por Sucursal (Barras de Progreso + Total General Inferior)
   */
  function renderSalesByBranchWidget(container, instance, payload, context) {
    const d = (payload && payload.data) || {};
    const branches = Array.isArray(d.branches) ? d.branches : [];
    const grandTotal = Number(d.total ?? d.grand_total ?? 0);
    const wkey = instance.widgetKey || instance.widget_key;
    const meta = (context && context.catalogMap && context.catalogMap[wkey]) || {};
    const title = (instance.settings && instance.settings.customTitle) || meta.name || 'Ventas por Sucursal';
    const barColors = [
      'linear-gradient(90deg, #22c55e, #38bdf8)',
      'linear-gradient(90deg, #3b82f6, #60a5fa)',
      'linear-gradient(90deg, #8b5cf6, #c084fc)',
      'linear-gradient(90deg, #f59e0b, #fbbf24)'
    ];

    const listHtml = branches.map((b, idx) => {
      const pct = Math.min(100, Math.max(0, Number(b.percentage ?? b.share_pct ?? 0)));
      const val = Number(b.value ?? b.total ?? 0);
      const bId = b.sucursalId || b.sucursal_id || 'MATRIZ';
      return `
        <div class="dash-branch-item" data-branch-id="${escapeHtml(bId)}" title="Clic para filtrar por ${escapeHtml(b.name)}">
          <div class="dash-branch-top">
            <span class="dash-branch-name">
              <i class="fa-solid fa-store"></i>
              ${escapeHtml(b.name)}
            </span>
            <div class="dash-branch-figures">
              <span class="dash-branch-amount">${escapeHtml(b.formatted || formatMoney(val))}</span>
              <span class="dash-branch-pct">${pct.toFixed(1)}%</span>
            </div>
          </div>
          <div class="dash-branch-bar-bg">
            <div class="dash-branch-bar-fill" style="width:${Math.max(5, pct)}%;background:${barColors[idx % barColors.length]};"></div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="dash-widget-header">
        <div class="dash-widget-title-group">
          <span class="dash-widget-title-icon"><i class="fa-solid fa-building-user"></i></span>
          <h3 class="dash-widget-title">${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="dash-widget-body">
        <div class="dash-branch-list">
          <div>${listHtml || '<div class="dash-widget-state">Sin sucursales registradas</div>'}</div>
          <div class="dash-branch-total-box">
            <span>Total General</span>
            <span>${escapeHtml(d.formattedTotal || formatMoney(grandTotal))}</span>
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll('.dash-branch-item').forEach(el => {
      el.addEventListener('click', () => {
        if (context.isEditing) return;
        const branchId = el.getAttribute('data-branch-id');
        if (branchId && typeof context.onSelectBranchFilter === 'function') {
          context.onSelectBranchFilter(branchId);
        }
      });
    });
  }

  /**
   * 5. Barra de 8 Accesos Rápidos Operativos (Fila 3 de la Imagen)
   */
  function renderQuickActionsWidget(container, instance, payload, context) {
    const d = (payload && payload.data) || {};
    const actions = Array.isArray(d.actions) ? d.actions : [];
    const iconColorMap = {
      green: '#4ade80',
      blue: '#60a5fa',
      purple: '#c084fc',
      orange: '#fbbf24',
      cyan: '#22d3ee',
    };

    container.innerHTML = `
      <div class="dash-quick-actions-grid">
        ${actions.map((act, idx) => `
          <button type="button" class="dash-qa-btn ${idx === 0 ? 'qa-green' : ''}"
                  data-qa-href="${escapeHtml(act.href || '')}"
                  data-qa-page="${escapeHtml(act.page || '')}"
                  data-qa-action="${escapeHtml(act.action || '')}">
            <i class="fa-solid ${escapeHtml(act.icon)} dash-qa-icon" style="color:${iconColorMap[act.accent] || '#60a5fa'};"></i>
            <span class="dash-qa-label">${escapeHtml(act.label)}</span>
            ${act.shortcut ? `<span class="dash-qa-shortcut">${escapeHtml(act.shortcut)}</span>` : ''}
          </button>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.dash-qa-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (context.isEditing) return;
        const href = btn.getAttribute('data-qa-href');
        const page = btn.getAttribute('data-qa-page');
        const action = btn.getAttribute('data-qa-action');
        if (action === 'openAiModal' && typeof context.onOpenAiModal === 'function') {
          context.onOpenAiModal();
        } else if (page && typeof window.navigateTo === 'function') {
          window.navigateTo(page);
        } else if (href) {
          window.location.href = href;
        }
      });
    });
  }

  /**
   * 6. Alertas y Pendientes Operativos con Botón "Ver" (Fila 4 Izquierda)
   */
  function renderAlertsPendingWidget(container, instance, payload, context) {
    const d = (payload && payload.data) || {};
    const alerts = Array.isArray(d.items) ? d.items : (Array.isArray(d.alerts) ? d.alerts : []);
    const totalCount = Number(d.totalAlerts ?? d.total_count ?? alerts.length);
    const wkey = instance.widgetKey || instance.widget_key;
    const meta = (context && context.catalogMap && context.catalogMap[wkey]) || {};
    const title = (instance.settings && instance.settings.customTitle) || meta.name || 'Alertas y Pendientes';

    const colorBg = {
      red: 'rgba(239, 68, 68, 0.2)',
      orange: 'rgba(245, 158, 11, 0.2)',
      blue: 'rgba(59, 130, 246, 0.2)',
      purple: 'rgba(139, 92, 246, 0.2)',
      green: 'rgba(16, 185, 129, 0.2)',
    };
    const colorFg = {
      red: '#f87171',
      orange: '#fbbf24',
      blue: '#60a5fa',
      purple: '#c084fc',
      green: '#4ade80',
    };

    container.innerHTML = `
      <div class="dash-widget-header">
        <div class="dash-widget-title-group">
          <span class="dash-widget-title-icon" style="color:#fbbf24;"><i class="fa-solid fa-bell"></i></span>
          <h3 class="dash-widget-title">${escapeHtml(title)}</h3>
          <span class="dash-alert-count-badge">${totalCount}</span>
        </div>
      </div>
      <div class="dash-widget-body">
        <div class="dash-alerts-list">
          ${alerts.map(a => {
            const cKey = a.color || 'blue';
            const lbl = a.label || a.title || '';
            const route = a.actionRoute || a.target_page || 'inventario';
            return `
              <div class="dash-alert-row">
                <div class="dash-alert-left">
                  <span class="dash-alert-icon" style="background:${colorBg[cKey] || colorBg.blue};color:${colorFg[cKey] || colorFg.blue};">
                    <i class="fa-solid ${escapeHtml(a.icon || 'fa-bell')}"></i>
                  </span>
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(lbl)}</span>
                </div>
                <button type="button" class="dash-alert-ver-btn" data-target-page="${escapeHtml(route)}">${escapeHtml(a.actionLabel || 'Ver')}</button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('.dash-alert-ver-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (context.isEditing) return;
        const page = btn.getAttribute('data-target-page');
        if (page && typeof window.navigateTo === 'function') {
          window.navigateTo(page);
        }
      });
    });
  }

  /**
   * 7. Top Productos del Día (Fila 4 Centro)
   */
  function renderTopProductsWidget(container, instance, payload, context) {
    const d = (payload && payload.data) || {};
    const items = Array.isArray(d.items) ? d.items : [];
    const wkey = instance.widgetKey || instance.widget_key;
    const meta = (context && context.catalogMap && context.catalogMap[wkey]) || {};
    const title = (instance.settings && instance.settings.customTitle) || meta.name || 'Top Productos del Día';

    const rowsHtml = items.length > 0
      ? items.slice(0, 5).map(it => {
          const rev = it.formattedRevenue || formatMoney(it.revenue ?? it.amount ?? 0);
          return `
            <tr>
              <td class="dash-top-rank">${Number(it.rank || 1)}</td>
              <td>
                <div class="dash-prod-cell">
                  <span class="dash-prod-thumb"><i class="fa-solid fa-cube"></i></span>
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px;" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</span>
                </div>
              </td>
              <td style="text-align:right;font-weight:600;">${escapeHtml(formatNumber(it.qty))}</td>
              <td style="text-align:right;font-weight:700;">${escapeHtml(rev)}</td>
            </tr>
          `;
        }).join('')
      : `<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--dash-text-muted);">Sin productos vendidos en este periodo</td></tr>`;

    container.innerHTML = `
      <div class="dash-widget-header">
        <div class="dash-widget-title-group">
          <span class="dash-widget-title-icon" style="color:#facc15;"><i class="fa-solid fa-trophy"></i></span>
          <h3 class="dash-widget-title">${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="dash-widget-body">
        <table class="dash-top-products-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Producto</th>
              <th style="text-align:right;">Ventas</th>
              <th style="text-align:right;">Importe</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="dash-widget-footer-link" data-nav-target="reportes">
          <span>Ver catálogo de ventas</span>
          <i class="fa-solid fa-arrow-right"></i>
        </div>
      </div>
    `;

    const link = container.querySelector('.dash-widget-footer-link');
    if (link) {
      link.addEventListener('click', () => {
        if (!context.isEditing && typeof window.navigateTo === 'function') {
          window.navigateTo('reportes');
        }
      });
    }
  }

  /**
   * 8. Resumen Financiero del Mes (Fila 4 Derecha)
   */
  function renderFinancialSummaryWidget(container, instance, payload, context) {
    const d = (payload && payload.data) || {};
    const wkey = instance.widgetKey || instance.widget_key;
    const meta = (context && context.catalogMap && context.catalogMap[wkey]) || {};
    const title = (instance.settings && instance.settings.customTitle) || meta.name || 'Resumen Financiero del Mes';

    const salesStr = d.formattedSales || formatMoney(d.sales ?? d.ventas_mxn ?? 0);
    const costStr = d.formattedCostOfSales || formatMoney(d.costOfSales ?? d.costo_ventas ?? 0);
    const grossStr = d.formattedGrossProfit || formatMoney(d.grossProfit ?? d.utilidad_bruta ?? 0);
    const expStr = d.formattedOperatingExpenses || formatMoney(d.operatingExpenses ?? d.gastos_operativos ?? 0);
    const netStr = d.formattedNetProfit || formatMoney(d.netProfit ?? d.utilidad_neta ?? 0);
    const marginPct = Number(d.netMarginPct ?? d.margen_neto_pct ?? 0);

    container.innerHTML = `
      <div class="dash-widget-header">
        <div class="dash-widget-title-group">
          <span class="dash-widget-title-icon" style="color:#38bdf8;"><i class="fa-solid fa-coins"></i></span>
          <h3 class="dash-widget-title">${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="dash-widget-body">
        <div class="dash-fin-rows">
          <div>
            <div class="dash-fin-row">
              <span class="dash-fin-label">Ventas (MXN)</span>
              <span class="dash-fin-val">${escapeHtml(salesStr)}</span>
            </div>
            <div class="dash-fin-row">
              <span class="dash-fin-label">Costo de Ventas</span>
              <span class="dash-fin-val">${escapeHtml(costStr)}</span>
            </div>
            <div class="dash-fin-row">
              <span class="dash-fin-label">Utilidad Bruta</span>
              <span class="dash-fin-val gross-profit">${escapeHtml(grossStr)}</span>
            </div>
            <div class="dash-fin-row" style="border-bottom:none;">
              <span class="dash-fin-label">Gastos Operativos</span>
              <span class="dash-fin-val">${escapeHtml(expStr)}</span>
            </div>
          </div>
          <div class="dash-fin-net-banner">
            <span class="dash-fin-net-title">Utilidad Neta</span>
            <span class="dash-fin-net-amount">${escapeHtml(netStr)}</span>
            <span class="dash-fin-margin-pill">Margen: ${marginPct.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 9. Resumen Ejecutivo IA (Sección 24)
   */
  function renderAiSummaryWidget(container, instance, payload, context) {
    const d = (payload && payload.data) || {};
    const insights = Array.isArray(d.insights) ? d.insights : [];
    const wkey = instance.widgetKey || instance.widget_key;
    const meta = (context && context.catalogMap && context.catalogMap[wkey]) || {};
    const title = (instance.settings && instance.settings.customTitle) || meta.name || 'Resumen Ejecutivo IA';

    container.innerHTML = `
      <div class="dash-widget-header">
        <div class="dash-widget-title-group">
          <span class="dash-widget-title-icon" style="background:rgba(139,92,246,0.25);color:#c084fc;"><i class="fa-solid fa-wand-magic-sparkles"></i></span>
          <h3 class="dash-widget-title">${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="dash-widget-body">
        <div class="dash-alerts-list">
          ${insights.map(ins => `
            <div class="dash-alert-row">
              <div class="dash-alert-left" style="white-space:normal;">
                <span class="dash-alert-icon" style="background:rgba(139,92,246,0.2);color:#c084fc;">
                  <i class="fa-solid ${escapeHtml(ins.icon || 'fa-bolt')}"></i>
                </span>
                <span>${escapeHtml(ins.text)}</span>
              </div>
              <button type="button" class="dash-alert-ver-btn" data-target-page="${escapeHtml(ins.route || 'reportes')}">Ver</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('.dash-alert-ver-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const page = btn.getAttribute('data-target-page');
        if (page && typeof window.navigateTo === 'function') window.navigateTo(page);
      });
    });
  }

  /**
   * 10. Genérico de Tablas / Listados / Estados Operativos para el resto del catálogo
   */
  function renderGenericCatalogWidget(container, instance, payload, context) {
    const d = (payload && payload.data) || {};
    const wkey = instance.widgetKey || instance.widget_key;
    const meta = (context && context.catalogMap && context.catalogMap[wkey]) || {};
    const title = (instance.settings && instance.settings.customTitle) || d.paramLabel || meta.name || wkey;
    const icon = meta.icon || 'fa-cube';
    const routePath = d.routePath || (instance.settings && instance.settings.routePath) || meta.routePath || '';
    const routeUrl = d.routeUrl || (instance.settings && instance.settings.routeUrl) || meta.routeUrl || '';
    const targetPage = d.targetPage || (instance.settings && instance.settings.targetPage) || meta.drilldownRoute || '';

    let bodyHtml = '';
    if (Array.isArray(d.items)) {
      if (d.items.length === 0) {
        bodyHtml = `<div class="dash-widget-state">Sin registros para mostrar en el periodo seleccionado.</div>`;
      } else {
        bodyHtml = `
          <div class="dash-alerts-list">
            ${d.items.slice(0, 6).map(item => `
              <div class="dash-alert-row">
                <div>
                  <div style="font-weight:600;">${escapeHtml(item.label || item.name || 'Registro')}</div>
                  ${item.sublabel ? `<small style="color:var(--dash-text-muted);font-size:11px;">${escapeHtml(item.sublabel)}</small>` : ''}
                </div>
                <span style="color:#60a5fa;font-weight:700;">${escapeHtml(item.formatted || String(item.value ?? ''))}</span>
              </div>
            `).join('')}
          </div>
        `;
      }
    } else if (Array.isArray(d.rows)) {
      bodyHtml = `
        <div class="dash-fin-rows">
          ${d.headline ? `<div style="font-size:20px;font-weight:800;color:var(--dash-text-primary);">${escapeHtml(d.headline)}</div>` : ''}
          ${d.subheadline ? `<div style="font-size:11.5px;color:var(--dash-text-muted);margin-bottom:4px;">${escapeHtml(d.subheadline)}</div>` : ''}
          <div>
            ${d.rows.map(r => `
              <div class="dash-fin-row">
                <span class="dash-fin-label">${escapeHtml(r.label)}</span>
                <span class="dash-fin-val">${escapeHtml(r.value)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      bodyHtml = `<div class="dash-widget-state">${escapeHtml(d.formatted || 'Conectado al ERP')}</div>`;
    }

    const routeBadgeHtml = routePath
      ? `<button type="button" class="dash-widget-route-chip" data-route-page="${escapeHtml(targetPage)}" title="Ir a ${escapeHtml(routePath)} (${escapeHtml(routeUrl)})">📍 ${escapeHtml(routePath)} ↗</button>`
      : '';

    container.innerHTML = `
      <div class="dash-widget-header">
        <div class="dash-widget-title-group">
          <span class="dash-widget-title-icon"><i class="fa-solid ${escapeHtml(icon)}"></i></span>
          <h3 class="dash-widget-title">${escapeHtml(title)}</h3>
        </div>
        ${routeBadgeHtml}
      </div>
      <div class="dash-widget-body">${bodyHtml}</div>
    `;

    const routeBtn = container.querySelector('.dash-widget-route-chip');
    if (routeBtn) {
      routeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const page = routeBtn.getAttribute('data-route-page');
        if (page && page === 'pos') {
          window.location.href = '/';
        } else if (page && typeof window.navigateTo === 'function') {
          window.navigateTo(page);
        }
      });
    }
  }

  [
    'sales_today', 'products_sold', 'clients_served', 'crm_opportunities',
    'avg_ticket', 'tickets_count', 'inventory_valuation', 'returns_cancellations'
  ].forEach(key => {
    registerDashboardWidget({ key, render: renderKpiSparklineWidget });
  });

  registerDashboardWidget({ key: 'sales_trend', render: renderSalesTrendWidget });
  registerDashboardWidget({ key: 'sales_by_department', render: renderSalesByDepartmentWidget });
  registerDashboardWidget({ key: 'payment_methods_breakdown', render: renderSalesByDepartmentWidget });
  registerDashboardWidget({ key: 'sales_by_branch', render: renderSalesByBranchWidget });
  registerDashboardWidget({ key: 'quick_actions', render: renderQuickActionsWidget });
  registerDashboardWidget({ key: 'alerts_pending', render: renderAlertsPendingWidget });
  registerDashboardWidget({ key: 'top_products', render: renderTopProductsWidget });
  registerDashboardWidget({ key: 'financial_summary_month', render: renderFinancialSummaryWidget });
  registerDashboardWidget({ key: 'ai_executive_summary', render: renderAiSummaryWidget });

  [
    'sales_by_seller', 'quotes_conversion', 'inventory_low_stock',
    'inventory_movements_summary', 'purchase_orders_status', 'cxp_summary',
    'cash_cuts_status', 'cxc_summary', 'cfdi_status_summary',
    'hr_attendance', 'logistics_deliveries', 'recent_activity_audit',
    'window_parameter_card'
  ].forEach(key => {
    registerDashboardWidget({ key, render: renderGenericCatalogWidget });
  });

  window.CalebsysDashboardRegistry = {
    registerDashboardWidget,
    getRegisteredWidget,
    renderGenericCatalogWidget,
    formatMoney,
    formatNumber,
    escapeHtml,
  };
})();
