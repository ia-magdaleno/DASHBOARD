/* =============================================================
   loaders/almacen.js — CalebSys Módulo Almacén v1.0 (Fase 2)
   Cubre: inventario, kardex v2, traslados, compras, devoluciones, ajustes
   ============================================================= */
(function (global) {
  'use strict';

  /* ── helpers ── */
  function api(path, opts) {
    var headers = { 'Content-Type': 'application/json' };
    var tok = localStorage.getItem('calebsys_token') || sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    return fetch(path, Object.assign({ headers: headers, credentials: 'include' }, opts)).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || 'HTTP ' + r.status); });
      return r.json();
    });
  }

  function post(path, body) {
    return api(path, { method: 'POST', body: JSON.stringify(body) });
  }

  function put(path, body) {
    return api(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  function fmtQ(n) { return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(Number(n) || 0); }
  function fmtM(n) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0); }
  function fmtD(v) { if (!v) return '—'; try { return new Date(v).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return v; } }

  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'rh-toast';
    t.style.background = type === 'error' ? 'var(--danger)' : '';
    t.innerHTML = '<i class="fa-solid ' + (type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check') + '"></i> ' + msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3000);
  }

  function setLoading(id, cols) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">Cargando...</div></div>';
  }

  function setError(id, msg, cols) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<table><tbody><tr><td colspan="' + (cols || 6) + '">' +
      '<div class="empty-state" style="padding:32px 16px;">' +
      '<div class="empty-icon" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i></div>' +
      '<div class="empty-title" style="color:var(--danger)">' + msg + '</div>' +
      '</div></td></tr></tbody></table>';
  }

  /* ─────────────────────────────────────────────────────────
     BODEGAS — cache compartido entre módulos
  ───────────────────────────────────────────────────────── */
  var _warehousesCache = null;

  async function getWarehouses() {
    if (_warehousesCache) return _warehousesCache;
    try {
      _warehousesCache = await api('/api/warehouses');
    } catch (e) {
      _warehousesCache = [];
    }
    return _warehousesCache;
  }

  function populateWarehouseSelect(selectId, addEmpty) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    getWarehouses().then(function (whs) {
      var prev = sel.value;
      sel.innerHTML = addEmpty ? '<option value="">Todas las bodegas</option>' : '<option value="">Seleccionar bodega...</option>';
      whs.forEach(function (w) {
        var o = document.createElement('option');
        o.value = w.id; o.textContent = w.name;
        sel.appendChild(o);
      });
      if (prev) sel.value = prev;
    });
  }

  /* ─────────────────────────────────────────────────────────
     INVENTARIO — /api/warehouse-stock + /api/inventario/kpis
  ───────────────────────────────────────────────────────── */
  var _invStock       = [];   // últimas líneas de warehouse-stock (con valor_linea)
  var _invActive      = null;  // KPI activo en el panel de detalle
  var _invCompromisos = {};    // {sku: {resguardos, apartados}}

  function _invSetKpis(k) {
    k = k || {};
    var map = {
      'inv-kpi-productos':   fmtQ(k.productos),
      'inv-kpi-bodegas':     fmtQ(k.bodegas),
      'inv-kpi-valor':       fmtM(k.valor_total),
      'inv-kpi-sin-stock':   fmtQ(k.sin_stock),
      'inv-kpi-resguardos':  fmtQ(k.resguardos),
      'inv-kpi-apartados':   fmtQ(k.apartados)
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && map[id] != null) el.textContent = map[id];
    });
  }

  global.loadInventario = async function () {
    var container = document.getElementById('inv-table-body');
    if (!container) return;
    setLoading('inv-table-body');
    populateWarehouseSelect('inv-filter-warehouse', true);

    // Leer filtros
    var whId = (document.getElementById('inv-filter-warehouse') || {}).value || '';
    var search = (document.getElementById('inv-search') || {}).value || '';
    var url = '/api/warehouse-stock' + (whId ? '?warehouse_id=' + encodeURIComponent(whId) : '');

    // KPIs y compromisos por SKU (no dependen del filtro de bodega ni de la búsqueda)
    api('/api/inventario/kpis').then(_invSetKpis).catch(function () {});
    api('/api/inventario/sku-compromisos').then(function (d) { _invCompromisos = d || {}; }).catch(function () {});

    try {
      var items = await api(url);
      _invStock = items.slice();
      if (search) {
        var q = search.toLowerCase();
        items = items.filter(function (i) {
          return (i.product_sku || '').toLowerCase().includes(q) ||
                 (i.product_name || '').toLowerCase().includes(q);
        });
      }

      var cnt = document.getElementById('inv-count'); if (cnt) cnt.textContent = items.length + ' registros';

      if (!items.length) {
        container.innerHTML = '<table><tbody><tr><td colspan="6"><div class="empty-state" style="padding:40px"><div class="empty-icon"><i class="fa-solid fa-boxes-stacked"></i></div><div class="empty-title">Sin registros de stock</div><div class="empty-desc">Registra una entrada de mercancía para ver existencias.</div></div></td></tr></tbody></table>';
        return;
      }

      var rows = items.map(function (i) {
        var qColor = i.quantity > 0 ? 'color:var(--success)' : 'color:var(--danger)';
        var comp = _invCompromisos[i.product_sku] || { resguardos: 0, apartados: 0 };
        var rgHtml = comp.resguardos > 0
          ? '<span style="background:rgba(245,158,11,0.15);color:var(--warning);padding:2px 7px;border-radius:10px;font-size:0.7rem;font-weight:700;">' + comp.resguardos + '</span>'
          : '<span class="td-muted">—</span>';
        var apHtml = comp.apartados > 0
          ? '<span style="color:var(--info);font-weight:600;">' + comp.apartados + '</span>'
          : '<span class="td-muted">—</span>';
        return '<tr>' +
          '<td class="td-mono">' + (i.product_sku || '—') + '</td>' +
          '<td>' + (i.product_name || '—') + '</td>' +
          '<td>' + (i.warehouse_name || i.warehouse_id || '—') + '</td>' +
          '<td style="font-weight:700;' + qColor + '">' + fmtQ(i.quantity) + '</td>' +
          '<td class="td-muted">' + fmtM(i.unit_cost) + '</td>' +
          '<td style="font-weight:600;">' + fmtM(i.valor_linea) + '</td>' +
          '<td style="text-align:center;">' + rgHtml + '</td>' +
          '<td style="text-align:center;">' + apHtml + '</td>' +
          '</tr>';
      }).join('');

      container.innerHTML = '<table>' +
        '<thead><tr><th>SKU</th><th>Producto</th><th>Bodega</th><th>Existencia</th><th>Costo Unit.</th><th>Valor</th><th title="Resguardos abiertos"><i class="fa-solid fa-box-archive"></i> Rsgdo.</th><th title="Apartados (histórico)"><i class="fa-solid fa-bookmark"></i> Apto.</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';

      // Si hay un KPI abierto en el panel de detalle, refrescarlo
      if (_invActive) global.invKpiFilter(_invActive, true);

    } catch (e) {
      setError('inv-table-body', e.message, 6);
    }
  };

  /* ── Acciones de resguardo (T-4d / T-4g / T-4h) ── */
  global.fijarEtaResguardo = async function (id) {
    var eta = window.prompt('Fecha estimada de llegada (YYYY-MM-DD):');
    if (!eta) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eta.trim())) { toast('Formato: YYYY-MM-DD', 'error'); return; }
    try {
      await put('/api/resguardos/' + id + '/eta', { eta_date: eta.trim() });
      toast('ETA fijada — resguardo en ETA_CONFIRMADA');
      global.invKpiFilter('resguardos', true);
    } catch (e) { toast(e.message, 'error'); }
  };

  global.ajustarResguardo = async function (id) {
    var motivo = window.prompt('Motivo del ajuste (vencido / no disponible / …):');
    if (motivo === null) return;
    if (!window.confirm('El valor pendiente se acreditará como Anticipo al cliente. ¿Continuar?')) return;
    try {
      var r = await post('/api/resguardos/' + id + '/ajustar', { motivo: motivo || 'Ajuste de resguardo' });
      toast('Resguardo AJUSTADO — anticipo $' + fmtQ(r.credito_anticipo) + ' al cliente');
      global.invKpiFilter('resguardos', true);
    } catch (e) { toast(e.message, 'error'); }
  };

  global.escanearVencimientosResguardo = async function () {
    try {
      var r = await post('/api/resguardos/vencimiento/scan?dias_aviso=3', {});
      toast(r.marcados ? (r.marcados + ' resguardo(s) marcados POR_VENCER + avisos enviados') : 'Sin resguardos por vencer');
      global.invKpiFilter('resguardos', true);
    } catch (e) { toast(e.message, 'error'); }
  };

  /* Panel de detalle: filtra/agrupa las existencias según el KPI pulsado.
     tipos: 'todos' | 'bodegas' | 'valor' | 'sin-stock' | 'resguardos' | 'apartados' */
  global.invKpiFilter = async function (tipo, keepOpen) {
    var panel = document.getElementById('inv-detail-panel');
    var body  = document.getElementById('inv-detail-body');
    var title = document.getElementById('inv-detail-title');
    var count = document.getElementById('inv-detail-count');
    if (!panel || !body) return;

    // Toggle: volver a pulsar el mismo KPI (o pasar null) cierra el panel
    if (!tipo || (_invActive === tipo && !keepOpen)) {
      panel.style.display = 'none';
      _invActive = null;
      document.querySelectorAll('#inv-kpis .kpi-card').forEach(function (c) { c.style.outline = ''; });
      return;
    }

    _invActive = tipo;
    panel.style.display = '';
    document.querySelectorAll('#inv-kpis .kpi-card').forEach(function (c) {
      c.style.outline = (c.dataset.kpi === tipo) ? '2px solid var(--info)' : '';
    });

    var TITLES = {
      'todos':      'Todas las existencias',
      'bodegas':    'Existencias por bodega',
      'valor':      'Líneas por valor en stock (desc.)',
      'sin-stock':  'Productos sin stock',
      'resguardos': 'Resguardos pendientes',
      'apartados':  'Apartados / resguardos (histórico)'
    };
    if (title) title.textContent = TITLES[tipo] || 'Detalle';

    body.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">Cargando...</div></div>';

    // ── Apartados: histórico completo desde /api/safekept ──
    if (tipo === 'apartados') {
      try {
        var sk = await api('/api/safekept');
        if (count) count.textContent = sk.length + ' registros';
        if (!sk.length) {
          body.innerHTML = '<table><tbody><tr><td colspan="5"><div class="empty-state" style="padding:32px"><div class="empty-title">Sin registros</div></div></td></tr></tbody></table>';
          return;
        }
        body.innerHTML = '<table>' +
          '<thead><tr><th>SKU</th><th>Producto</th><th>Venta</th><th>Pend. / Total</th><th>Estado</th></tr></thead><tbody>' +
          sk.map(function (s) {
            var pend = (Number(s.quantity_ordered) || 0) - (Number(s.quantity_delivered) || 0);
            var st = s.status || '—';
            var cerrado = (st === 'Entregado' || st === 'ENTREGADO' || st === 'AJUSTADO');
            var badge = '<span class="badge badge-' + (cerrado ? 'success' : (st === 'POR_VENCER' ? 'danger' : 'warning')) + '">' + st + '</span>';
            if (s.eta_date) badge += ' <span class="td-muted" style="font-size:11px;">ETA ' + s.eta_date + '</span>';
            return '<tr><td class="td-mono">' + (s.product_sku || '—') + '</td><td>' +
              ((s.product && (s.product.name || s.product.description)) || '—') + '</td><td class="td-mono">' +
              String(s.sale_id || '—').slice(0, 8).toUpperCase() + '</td><td style="font-weight:700;">' +
              fmtQ(pend) + ' / ' + fmtQ(s.quantity_ordered) + '</td><td>' + badge + '</td></tr>';
          }).join('') + '</tbody></table>';
      } catch (e) { setError('inv-detail-body', e.message, 5); }
      return;
    }

    // ── Resguardos abiertos: /api/resguardos con acciones (T-4d / T-4g / T-4h) ──
    if (tipo === 'resguardos') {
      try {
        var rg = await api('/api/resguardos?abiertos=true');
        if (count) count.textContent = rg.length + ' abiertos';
        var head = '<div style="margin-bottom:8px;"><button class="btn btn-secondary btn-sm" onclick="window.escanearVencimientosResguardo()">' +
          '<i class="fa-solid fa-clock-rotate-left"></i> Revisar vencimientos</button></div>';
        if (!rg.length) {
          body.innerHTML = head + '<table><tbody><tr><td colspan="7"><div class="empty-state" style="padding:32px"><div class="empty-title">Sin resguardos abiertos</div></div></td></tr></tbody></table>';
          return;
        }
        body.innerHTML = head + '<table>' +
          '<thead><tr><th>SKU</th><th>Cliente</th><th>Venta</th><th>Pend.</th><th>Estado</th><th>ETA</th><th>Acciones</th></tr></thead><tbody>' +
          rg.map(function (r) {
            var st = r.status || '—';
            var bcls = (st === 'POR_VENCER') ? 'danger' : (st === 'EN_INVENTARIO' ? 'info' : 'warning');
            var acc = '<button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:11px;" onclick="window.fijarEtaResguardo(\'' + r.id + '\')">ETA</button> ' +
              '<button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:11px;" onclick="window.ajustarResguardo(\'' + r.id + '\')">Ajustar</button>';
            return '<tr><td class="td-mono">' + (r.product_sku || '—') + '</td>' +
              '<td>' + (r.client_name || '—') + (r.client_whatsapp ? ' <i class="fa-brands fa-whatsapp" style="color:#25D366" title="' + r.client_whatsapp + '"></i>' : '') + '</td>' +
              '<td class="td-mono">' + String(r.sale_id || '—').slice(0, 8).toUpperCase() + '</td>' +
              '<td style="font-weight:700;">' + fmtQ(r.quantity_pending) + '</td>' +
              '<td><span class="badge badge-' + bcls + '">' + st + '</span></td>' +
              '<td class="td-muted">' + (r.eta_date || '—') + '</td>' +
              '<td>' + acc + '</td></tr>';
          }).join('') + '</tbody></table>';
      } catch (e) { setError('inv-detail-body', e.message, 7); }
      return;
    }

    // ── Vistas derivadas de las existencias en memoria (_invStock) ──
    var data = _invStock.slice();

    if (tipo === 'sin-stock') {
      // SKUs cuya existencia sumada en todas las bodegas es <= 0
      var totBySku = {};
      data.forEach(function (i) {
        var k = i.product_sku || '—';
        totBySku[k] = (totBySku[k] || 0) + (Number(i.quantity) || 0);
      });
      var seen = {};
      data = data.filter(function (i) {
        var k = i.product_sku || '—';
        if ((totBySku[k] || 0) > 0 || seen[k]) return false;
        seen[k] = true;
        return true;
      });
    } else if (tipo === 'valor') {
      data.sort(function (a, b) { return (Number(b.valor_linea) || 0) - (Number(a.valor_linea) || 0); });
    }

    if (tipo === 'bodegas') {
      // Agregado por bodega: nº de SKUs + existencia total + valor
      var byWh = {};
      data.forEach(function (i) {
        var key = i.warehouse_name || i.warehouse_id || '—';
        if (!byWh[key]) byWh[key] = { skus: 0, qty: 0, val: 0 };
        byWh[key].skus += 1;
        byWh[key].qty  += Number(i.quantity) || 0;
        byWh[key].val  += Number(i.valor_linea) || 0;
      });
      var whKeys = Object.keys(byWh).sort();
      if (count) count.textContent = whKeys.length + ' bodegas';
      body.innerHTML = '<table>' +
        '<thead><tr><th>Bodega</th><th>SKUs</th><th>Existencia total</th><th>Valor</th></tr></thead><tbody>' +
        whKeys.map(function (k) {
          return '<tr><td>' + k + '</td><td>' + fmtQ(byWh[k].skus) + '</td><td style="font-weight:700;">' +
            fmtQ(byWh[k].qty) + '</td><td style="font-weight:600;">' + fmtM(byWh[k].val) + '</td></tr>';
        }).join('') +
        '</tbody></table>';
      return;
    }

    if (count) count.textContent = data.length + ' líneas';
    if (!data.length) {
      body.innerHTML = '<table><tbody><tr><td colspan="8"><div class="empty-state" style="padding:32px"><div class="empty-title">Sin líneas</div></div></td></tr></tbody></table>';
      return;
    }
    body.innerHTML = '<table>' +
      '<thead><tr><th>SKU</th><th>Producto</th><th>Bodega</th><th>Existencia</th><th>Costo Unit.</th><th>Valor</th><th title="Resguardos abiertos"><i class="fa-solid fa-box-archive"></i> Rsgdo.</th><th title="Apartados (histórico)"><i class="fa-solid fa-bookmark"></i> Apto.</th></tr></thead><tbody>' +
      data.map(function (i) {
        var qColor = i.quantity > 0 ? 'color:var(--success)' : 'color:var(--danger)';
        var comp = _invCompromisos[i.product_sku] || { resguardos: 0, apartados: 0 };
        var rgHtml = comp.resguardos > 0
          ? '<span style="background:rgba(245,158,11,0.15);color:var(--warning);padding:2px 7px;border-radius:10px;font-size:0.7rem;font-weight:700;">' + comp.resguardos + '</span>'
          : '<span class="td-muted">—</span>';
        var apHtml = comp.apartados > 0
          ? '<span style="color:var(--info);font-weight:600;">' + comp.apartados + '</span>'
          : '<span class="td-muted">—</span>';
        return '<tr>' +
          '<td class="td-mono">' + (i.product_sku || '—') + '</td>' +
          '<td>' + (i.product_name || '—') + '</td>' +
          '<td>' + (i.warehouse_name || i.warehouse_id || '—') + '</td>' +
          '<td style="font-weight:700;' + qColor + '">' + fmtQ(i.quantity) + '</td>' +
          '<td class="td-muted">' + fmtM(i.unit_cost) + '</td>' +
          '<td style="font-weight:600;">' + fmtM(i.valor_linea) + '</td>' +
          '<td style="text-align:center;">' + rgHtml + '</td>' +
          '<td style="text-align:center;">' + apHtml + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  };

  // Filtro en tiempo real
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'inv-search') global.loadInventario();
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'inv-filter-warehouse') global.loadInventario();
  });

  /* ─────────────────────────────────────────────────────────
     KARDEX v2 — /api/kardex/v2
  ───────────────────────────────────────────────────────── */
  var TYPE_BADGES = {
    COMPRA:           '<span class="badge badge-success">COMPRA</span>',
    VENTA:            '<span class="badge badge-info">VENTA</span>',
    AJUSTE_FISICO:    '<span class="badge badge-warning">AJUSTE</span>',
    MERMA:            '<span class="badge badge-danger">MERMA</span>',
    TRASPASO_ENTRADA: '<span class="badge badge-neutral">TRASLADO ↓</span>',
    TRASPASO_SALIDA:  '<span class="badge badge-neutral">TRASLADO ↑</span>',
    DEVOLUCION:       '<span class="badge badge-warning">DEVOLUCIÓN</span>',
  };

  var _kardexFilter = '';

  global.loadKardex = async function () {
    var container = document.getElementById('kardex-table-body');
    if (!container) return;
    setLoading('kardex-table-body');
    populateWarehouseSelect('kardex-filter-warehouse', true);

    var whId = (document.getElementById('kardex-filter-warehouse') || {}).value || '';
    var sku  = (document.getElementById('kardex-filter-sku')       || {}).value || '';
    var type = _kardexFilter;

    var params = new URLSearchParams({ limit: 200 });
    if (whId) params.set('warehouse_id', whId);
    if (sku)  params.set('product_sku',  sku);
    if (type) params.set('movement_type', type);

    try {
      var data = await api('/api/kardex/v2?' + params.toString());
      var items = data.items || [];

      // Filtro de búsqueda local
      var search = ((document.getElementById('kardex-search-input') || {}).value || '').toLowerCase();
      if (search) {
        items = items.filter(function (m) {
          return (m.product_sku || '').toLowerCase().includes(search) ||
                 (m.reference_id || '').toLowerCase().includes(search) ||
                 (m.product_name || '').toLowerCase().includes(search);
        });
      }

      var cnt = document.getElementById('kardex-count');
      if (cnt) cnt.textContent = (data.total || items.length) + ' movimientos';

      if (!items.length) {
        container.innerHTML = '<table><tbody><tr><td colspan="7"><div class="empty-state" style="padding:40px"><div class="empty-icon"><i class="fa-solid fa-inbox"></i></div><div class="empty-title">Sin movimientos</div></div></td></tr></tbody></table>';
        return;
      }

      var rows = items.map(function (m) {
        var t = (m.movement_type || '').toUpperCase();
        var badge = TYPE_BADGES[t] || '<span class="badge badge-neutral">' + t + '</span>';
        var qty = Number(m.quantity || 0);
        var isOut = t.includes('SALIDA') || t === 'VENTA' || t === 'MERMA';
        var qStr = (isOut ? '−' : '+') + fmtQ(qty);
        var qColor = isOut ? 'color:var(--danger)' : 'color:var(--success)';
        return '<tr>' +
          '<td class="td-muted">' + fmtD(m.timestamp) + '</td>' +
          '<td>' + badge + '</td>' +
          '<td class="td-mono">' + (m.product_sku || '—') + '</td>' +
          '<td>' + (m.product_name || '—') + '</td>' +
          '<td style="font-weight:700;' + qColor + '">' + qStr + '</td>' +
          '<td>' + fmtM(m.unit_cost) + '</td>' +
          '<td class="td-muted">' + (m.warehouse_name || m.warehouse_id || '—') + '</td>' +
          '</tr>';
      }).join('');

      container.innerHTML = '<table>' +
        '<thead><tr><th>Fecha</th><th>Tipo</th><th>SKU</th><th>Producto</th><th>Cantidad</th><th>Costo Unit.</th><th>Bodega</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';

    } catch (e) {
      setError('kardex-table-body', e.message, 7);
    }
  };

  // Pill-tabs del Kardex
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('#kardex-tabs .pill-tab');
    if (!tab) return;
    document.querySelectorAll('#kardex-tabs .pill-tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    _kardexFilter = tab.dataset.filter || '';
    global.loadKardex();
  });
  document.addEventListener('input', function (e) {
    if (e.target && (e.target.id === 'kardex-search-input' || e.target.id === 'kardex-filter-sku')) global.loadKardex();
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'kardex-filter-warehouse') global.loadKardex();
  });

  /* ─────────────────────────────────────────────────────────
     TRASLADOS — /api/transfers + /api/warehouse/transfer
  ───────────────────────────────────────────────────────── */
  var _trasPAGE = 50;
  var _trasState = { page: 0, total: 0, search: '' };
  var _trasCached = [];
  var _trasListeners = false;
  var _trasDebounce = null;

  function _updateTraspasosPag() {
    var prev = document.getElementById('traspasos-btn-prev');
    var next = document.getElementById('traspasos-btn-next');
    var info = document.getElementById('traspasos-pag-info');
    var start = _trasState.total ? _trasState.page * _trasPAGE + 1 : 0;
    var end   = Math.min((_trasState.page + 1) * _trasPAGE, _trasState.total);
    if (info) info.textContent = _trasState.total ? (start + '–' + end + ' de ' + _trasState.total) : '0 registros';
    if (prev) prev.disabled = _trasState.page === 0;
    if (next) next.disabled = (_trasState.page + 1) * _trasPAGE >= _trasState.total;
  }

  function _renderTraspasos(items) {
    var container = document.getElementById('traspasos-table-body');
    if (!container) return;
    var cnt = document.getElementById('traspasos-count');
    if (cnt) cnt.textContent = _trasState.total + ' traslados';
    var q = (_trasState.search || '').toLowerCase();
    var filtered = q ? items.filter(function (t) {
      return (t.product_sku || '').toLowerCase().indexOf(q) >= 0 ||
             (t.product_name || '').toLowerCase().indexOf(q) >= 0 ||
             (t.source_warehouse_name || '').toLowerCase().indexOf(q) >= 0 ||
             (t.destination_warehouse_name || '').toLowerCase().indexOf(q) >= 0;
    }) : items;
    if (!filtered.length) {
      container.innerHTML = '<table><tbody><tr><td colspan="7"><div class="empty-state" style="padding:40px"><div class="empty-icon"><i class="fa-solid fa-arrow-right-arrow-left"></i></div><div class="empty-title">' + (q ? 'Sin resultados para "' + q + '"' : 'Sin traslados registrados') + '</div></div></td></tr></tbody></table>';
      return;
    }
    var rows = filtered.map(function (t) {
      return '<tr>' +
        '<td class="td-mono">' + (t.id || '—').toString().slice(0, 8).toUpperCase() + '</td>' +
        '<td class="td-muted">' + fmtD(t.created_at) + '</td>' +
        '<td class="td-mono">' + (t.product_sku || '—') + '</td>' +
        '<td>' + (t.product_name || '—') + '</td>' +
        '<td class="td-muted">' + (t.source_warehouse_name || '—') + '</td>' +
        '<td class="td-muted">' + (t.destination_warehouse_name || '—') + '</td>' +
        '<td style="font-weight:700;">' + fmtQ(t.quantity) + ' uds.</td>' +
        '</tr>';
    }).join('');
    container.innerHTML = '<table>' +
      '<thead><tr><th>ID</th><th>Fecha</th><th>SKU</th><th>Producto</th><th>Origen</th><th>Destino</th><th>Cantidad</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  async function _fetchTraspasos() {
    var container = document.getElementById('traspasos-table-body');
    if (!container) return;
    setLoading('traspasos-table-body');
    try {
      var data = await api('/api/transfers?limit=' + _trasPAGE + '&offset=' + (_trasState.page * _trasPAGE));
      _trasCached = data.items || [];
      _trasState.total = data.total || 0;
      _renderTraspasos(_trasCached);
      _updateTraspasosPag();
    } catch (e) {
      setError('traspasos-table-body', e.message, 7);
    }
  }

  function _wireTrasposListeners() {
    if (_trasListeners) return;
    _trasListeners = true;
    var searchEl = document.getElementById('traspasos-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        clearTimeout(_trasDebounce);
        _trasDebounce = setTimeout(function () {
          _trasState.search = searchEl.value || '';
          _renderTraspasos(_trasCached);
        }, 250);
      });
    }
  }

  global.loadTraspasos = async function () {
    _trasState = { page: 0, total: 0, search: '' };
    _trasCached = [];
    _trasListeners = false;
    _wireTrasposListeners();
    await _fetchTraspasos();
  };

  global.traspasosPrev = function () {
    if (_trasState.page > 0) { _trasState.page--; _fetchTraspasos(); }
  };
  global.traspasosNext = function () {
    if ((_trasState.page + 1) * _trasPAGE < _trasState.total) { _trasState.page++; _fetchTraspasos(); }
  };

  global.openModalTraslado = function () {
    _warehousesCache = null; // refrescar bodegas
    populateWarehouseSelect('traslado-origen', false);
    populateWarehouseSelect('traslado-destino', false);
    var m = document.getElementById('modal-traslado');
    if (m) m.classList.add('open');
  };
  global.closeModalTraslado = function () {
    var m = document.getElementById('modal-traslado');
    if (m) m.classList.remove('open');
  };
  global.confirmarTraslado = async function () {
    var sku    = (document.getElementById('traslado-sku')    || {}).value || '';
    var qty    = parseFloat((document.getElementById('traslado-qty') || {}).value || 0);
    var origen = (document.getElementById('traslado-origen') || {}).value || '';
    var dest   = (document.getElementById('traslado-destino') || {}).value || '';
    var notas  = (document.getElementById('traslado-notas')  || {}).value || '';
    var errEl  = document.getElementById('traslado-error');

    if (!sku || !qty || !origen || !dest) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = 'Completa todos los campos obligatorios.'; }
      return;
    }
    if (errEl) errEl.style.display = 'none';

    var btn = document.getElementById('btn-confirmar-traslado');
    if (btn) btn.disabled = true;

    try {
      await post('/api/warehouse/transfer', {
        product_sku: sku, quantity: qty,
        source_warehouse_id: origen, destination_warehouse_id: dest,
        notes: notas,
        idempotency_key: 'XFER-' + Date.now()
      });
      global.closeModalTraslado();
      toast('Traslado registrado correctamente');
      global.loadTraspasos();
    } catch (e) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = e.message; }
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /* ─────────────────────────────────────────────────────────
     COMPRAS — /api/warehouse/purchase-receipt
  ───────────────────────────────────────────────────────── */
  var _compraItems = [];

  global.loadCompras = async function () {
    var container = document.getElementById('compras-table-body');
    if (!container) return;
    setLoading('compras-table-body');
    try {
      var data = await api('/api/kardex/v2?movement_type=COMPRA&limit=200');
      var items = data.items || [];
      var cnt = document.getElementById('compras-count');
      if (cnt) cnt.textContent = items.length + ' entradas';

      if (!items.length) {
        container.innerHTML = '<table><tbody><tr><td colspan="6"><div class="empty-state" style="padding:40px"><div class="empty-icon"><i class="fa-solid fa-truck-ramp-box"></i></div><div class="empty-title">Sin entradas registradas</div></div></td></tr></tbody></table>';
        return;
      }

      var rows = items.map(function (m) {
        return '<tr>' +
          '<td class="td-muted">' + fmtD(m.timestamp) + '</td>' +
          '<td class="td-mono">' + (m.product_sku || '—') + '</td>' +
          '<td>' + (m.product_name || '—') + '</td>' +
          '<td style="font-weight:700;color:var(--success)">+' + fmtQ(m.quantity) + '</td>' +
          '<td>' + fmtM(m.unit_cost) + '</td>' +
          '<td class="td-muted">' + (m.reason || '—') + '</td>' +
          '</tr>';
      }).join('');

      container.innerHTML = '<table>' +
        '<thead><tr><th>Fecha</th><th>SKU</th><th>Producto</th><th>Cantidad</th><th>Costo Unit.</th><th>Proveedor / Ref.</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
    } catch (e) { setError('compras-table-body', e.message, 6); }
  };

  global.openModalCompra = function () {
    _compraItems = [];
    populateWarehouseSelect('compra-warehouse', false);
    global.addCompraItem();
    var m = document.getElementById('modal-compra');
    if (m) m.classList.add('open');
    global._recalcCompraTotal();
  };
  global.closeModalCompra = function () {
    var m = document.getElementById('modal-compra');
    if (m) m.classList.remove('open');
  };

  global.addCompraItem = function () {
    var idx = _compraItems.length;
    _compraItems.push({ sku: '', qty: 1, cost: 0 });
    var cont = document.getElementById('compra-items');
    if (!cont) return;
    var div = document.createElement('div');
    div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:center;';
    div.dataset.idx = idx;
    div.innerHTML =
      '<input type="text" placeholder="SKU *" class="form-input" data-field="sku" data-idx="' + idx + '">' +
      '<input type="number" placeholder="Cant. *" min="0.01" step="0.01" class="form-input" data-field="qty" data-idx="' + idx + '" value="1">' +
      '<input type="number" placeholder="Costo unit. *" min="0" step="0.01" class="form-input" data-field="cost" data-idx="' + idx + '" value="0">' +
      '<button class="btn btn-secondary btn-sm" onclick="window.removeCompraItem(' + idx + ')"><i class="fa-solid fa-trash"></i></button>';
    cont.appendChild(div);
    div.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = Number(inp.dataset.idx);
        _compraItems[i][inp.dataset.field] = inp.value;
        global._recalcCompraTotal();
      });
    });
  };

  global.removeCompraItem = function (idx) {
    var cont = document.getElementById('compra-items');
    if (!cont) return;
    var div = cont.querySelector('[data-idx="' + idx + '"]');
    if (div) div.remove();
    _compraItems[idx] = null;
    global._recalcCompraTotal();
  };

  global._recalcCompraTotal = function () {
    var total = (_compraItems || []).reduce(function (s, i) {
      if (!i) return s;
      return s + (parseFloat(i.qty) || 0) * (parseFloat(i.cost) || 0);
    }, 0);
    var el = document.getElementById('compra-total');
    if (el) el.textContent = 'Total: ' + fmtM(total);
  };

  global.confirmarCompra = async function () {
    var wh     = (document.getElementById('compra-warehouse')  || {}).value || '';
    var prov   = (document.getElementById('compra-proveedor')  || {}).value || '';
    var ref    = (document.getElementById('compra-referencia') || {}).value || '';
    var errEl  = document.getElementById('compra-error');

    // Recolectar ítems desde el DOM (más fiable que el cache)
    var items = [];
    document.querySelectorAll('#compra-items [data-field="sku"]').forEach(function (inp) {
      var idx = inp.dataset.idx;
      var sku  = inp.value.trim();
      var qty  = parseFloat((document.querySelector('[data-field="qty"][data-idx="' + idx + '"]') || {}).value || 0);
      var cost = parseFloat((document.querySelector('[data-field="cost"][data-idx="' + idx + '"]') || {}).value || 0);
      if (sku && qty > 0) items.push({ product_sku: sku, quantity: qty, unit_cost: cost });
    });

    if (!wh || !items.length) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = 'Selecciona bodega y agrega al menos un producto.'; }
      return;
    }
    if (errEl) errEl.style.display = 'none';
    var btn = document.getElementById('btn-confirmar-compra');
    if (btn) btn.disabled = true;

    try {
      await post('/api/warehouse/purchase-receipt', {
        warehouse_id: wh, supplier_name: prov, reference_doc: ref, items: items,
        idempotency_key: 'COMP-' + Date.now()
      });
      global.closeModalCompra();
      toast('Entrada de mercancía registrada');
      global.loadCompras();
    } catch (e) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = e.message; }
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /* ─────────────────────────────────────────────────────────
     DEVOLUCIONES — /api/sales/{id}/return
  ───────────────────────────────────────────────────────── */
  var _devVenta = null;

  var _devPAGE = 50;
  var _devState = { page: 0, total: 0, search: '' };
  var _devCached = [];
  var _devListeners = false;
  var _devDebounce = null;

  function _updateDevPag() {
    var prev = document.getElementById('dev-btn-prev');
    var next = document.getElementById('dev-btn-next');
    var info = document.getElementById('dev-pag-info');
    var start = _devState.total ? _devState.page * _devPAGE + 1 : 0;
    var end   = Math.min((_devState.page + 1) * _devPAGE, _devState.total);
    if (info) info.textContent = _devState.total ? (start + '–' + end + ' de ' + _devState.total) : '0 registros';
    if (prev) prev.disabled = _devState.page === 0;
    if (next) next.disabled = (_devState.page + 1) * _devPAGE >= _devState.total;
  }

  function _renderDevoluciones(items) {
    var container = document.getElementById('dev-table-body');
    if (!container) return;
    var cnt = document.getElementById('dev-count');
    if (cnt) cnt.textContent = _devState.total + ' devoluciones';
    var q = (_devState.search || '').toLowerCase();
    var filtered = q ? items.filter(function (m) {
      return (m.product_sku || '').toLowerCase().indexOf(q) >= 0 ||
             (m.product_name || '').toLowerCase().indexOf(q) >= 0 ||
             (m.reference_id || '').toLowerCase().indexOf(q) >= 0;
    }) : items;
    if (!filtered.length) {
      container.innerHTML = '<table><tbody><tr><td colspan="5"><div class="empty-state" style="padding:40px"><div class="empty-icon"><i class="fa-solid fa-rotate-left"></i></div><div class="empty-title">' + (q ? 'Sin resultados para "' + q + '"' : 'Sin devoluciones registradas') + '</div></div></td></tr></tbody></table>';
      return;
    }
    var rows = filtered.map(function (m) {
      return '<tr>' +
        '<td class="td-muted">' + fmtD(m.timestamp) + '</td>' +
        '<td class="td-mono">' + (m.product_sku || '—') + '</td>' +
        '<td>' + (m.product_name || '—') + '</td>' +
        '<td style="font-weight:700;color:var(--info)">+' + fmtQ(m.quantity) + '</td>' +
        '<td class="td-muted">' + (m.reference_id || '—') + '</td>' +
        '</tr>';
    }).join('');
    container.innerHTML = '<table>' +
      '<thead><tr><th>Fecha</th><th>SKU</th><th>Producto</th><th>Cantidad</th><th>Venta</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  async function _fetchDevoluciones() {
    var container = document.getElementById('dev-table-body');
    if (!container) return;
    setLoading('dev-table-body');
    try {
      var data = await api('/api/kardex/v2?movement_type=DEVOLUCION,DEVOLUCION_VENTA&limit=' + _devPAGE + '&offset=' + (_devState.page * _devPAGE));
      _devCached = data.items || [];
      _devState.total = data.total || 0;
      _renderDevoluciones(_devCached);
      _updateDevPag();
    } catch (e) { setError('dev-table-body', e.message, 5); }
  }

  function _wireDevListeners() {
    if (_devListeners) return;
    _devListeners = true;
    var searchEl = document.getElementById('dev-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        clearTimeout(_devDebounce);
        _devDebounce = setTimeout(function () {
          _devState.search = searchEl.value || '';
          _renderDevoluciones(_devCached);
        }, 250);
      });
    }
  }

  global.loadDevoluciones = async function () {
    _devState = { page: 0, total: 0, search: '' };
    _devCached = [];
    _devListeners = false;
    _wireDevListeners();
    await _fetchDevoluciones();
  };

  global.devPrev = function () {
    if (_devState.page > 0) { _devState.page--; _fetchDevoluciones(); }
  };
  global.devNext = function () {
    if ((_devState.page + 1) * _devPAGE < _devState.total) { _devState.page++; _fetchDevoluciones(); }
  };

  global.openModalDevolucion = function () {
    _devVenta = null;
    populateWarehouseSelect('dev-warehouse', false);
    var info = document.getElementById('dev-venta-info');
    var cont = document.getElementById('dev-items-container');
    var btn  = document.getElementById('btn-confirmar-dev');
    var inp  = document.getElementById('dev-sale-id');
    if (info) { info.style.display = 'none'; info.innerHTML = ''; }
    if (cont) cont.style.display = 'none';
    if (btn)  btn.disabled = true;
    if (inp)  inp.value = '';
    var m = document.getElementById('modal-devolucion');
    if (m) m.classList.add('open');
  };
  global.closeModalDevolucion = function () {
    var m = document.getElementById('modal-devolucion');
    if (m) m.classList.remove('open');
  };

  global.buscarVentaDevolucion = async function () {
    var saleId = ((document.getElementById('dev-sale-id') || {}).value || '').trim();
    var errEl  = document.getElementById('dev-error');
    if (!saleId) { if (errEl) { errEl.style.display = ''; errEl.textContent = 'Escribe el ID de la venta.'; } return; }
    if (errEl) errEl.style.display = 'none';

    try {
      _devVenta = await api('/api/sales/' + encodeURIComponent(saleId));
      var info = document.getElementById('dev-venta-info');
      if (info) {
        info.style.display = '';
        info.innerHTML = '<strong>Venta #' + (saleId.slice(0,8).toUpperCase()) + '</strong>' +
          '&nbsp;·&nbsp;' + fmtD(_devVenta.created_at) +
          '&nbsp;·&nbsp;<strong>' + fmtM(_devVenta.total) + '</strong>' +
          '&nbsp;·&nbsp;' + (_devVenta.payment_method === '006' ? 'Crédito' : 'Efectivo');
      }

      // Generar renglones de devolución
      var cont = document.getElementById('dev-items');
      var wrap = document.getElementById('dev-items-container');
      if (cont && _devVenta.items && _devVenta.items.length) {
        cont.innerHTML = _devVenta.items.map(function (item) {
          var max = (item.quantity || 0) - (item.returned_quantity || 0);
          if (max <= 0) return ''; // ya devuelto completamente
          return '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;align-items:center;">' +
            '<div><span class="td-mono">' + (item.product_sku || '—') + '</span>' +
            ' <span class="td-muted" style="font-size:12px;">máx. ' + fmtQ(max) + '</span></div>' +
            '<input type="number" class="form-input" data-sku="' + item.product_sku + '"' +
            ' min="0" max="' + max + '" step="1" value="0" placeholder="0">' +
            '<span class="td-muted">' + fmtM(item.price) + '/u</span>' +
            '</div>';
        }).join('');
        if (wrap) wrap.style.display = '';
        var btn = document.getElementById('btn-confirmar-dev');
        if (btn) btn.disabled = false;
      }
    } catch (e) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = 'Venta no encontrada: ' + e.message; }
    }
  };

  global.confirmarDevolucion = async function () {
    if (!_devVenta) return;
    var saleId = _devVenta.id;
    var wh     = (document.getElementById('dev-warehouse') || {}).value || '';
    var errEl  = document.getElementById('dev-error');
    if (errEl) errEl.style.display = 'none';

    var items = [];
    document.querySelectorAll('#dev-items input[data-sku]').forEach(function (inp) {
      var qty = parseFloat(inp.value || 0);
      if (qty > 0) items.push({ product_sku: inp.dataset.sku, quantity_returned: qty });
    });

    if (!items.length) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = 'Indica al menos un producto a devolver.'; }
      return;
    }

    var btn = document.getElementById('btn-confirmar-dev');
    if (btn) btn.disabled = true;

    try {
      await post('/api/sales/' + encodeURIComponent(saleId) + '/return', {
        sale_id: saleId, items: items,
        restock_warehouse_id: wh || null,
        idempotency_key: 'DEV-' + saleId + '-' + Date.now()
      });
      global.closeModalDevolucion();
      toast('Devolución registrada correctamente');
      global.loadDevoluciones();
    } catch (e) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = e.message; }
      if (btn) btn.disabled = false;
    }
  };

  /* ─────────────────────────────────────────────────────────
     AJUSTES — /api/warehouse/adjust
  ───────────────────────────────────────────────────────── */
  var _ajusteItems = [];

  var _ajustePAGE = 50;
  var _ajusteState = { page: 0, total: 0, search: '' };
  var _ajusteCached = [];
  var _ajusteListeners = false;
  var _ajusteDebounce = null;

  var _AJUSTE_BADGES = {
    MERMA: 'badge-danger', AJUSTE_FISICO: 'badge-warning', AJUSTE_POSITIVO: 'badge-success'
  };

  function _updateAjustePag() {
    var prev = document.getElementById('ajuste-btn-prev');
    var next = document.getElementById('ajuste-btn-next');
    var info = document.getElementById('ajuste-pag-info');
    var start = _ajusteState.total ? _ajusteState.page * _ajustePAGE + 1 : 0;
    var end   = Math.min((_ajusteState.page + 1) * _ajustePAGE, _ajusteState.total);
    if (info) info.textContent = _ajusteState.total ? (start + '–' + end + ' de ' + _ajusteState.total) : '0 registros';
    if (prev) prev.disabled = _ajusteState.page === 0;
    if (next) next.disabled = (_ajusteState.page + 1) * _ajustePAGE >= _ajusteState.total;
  }

  function _renderAjustes(items) {
    var container = document.getElementById('ajuste-table-body');
    if (!container) return;
    var cnt = document.getElementById('ajuste-count');
    if (cnt) cnt.textContent = _ajusteState.total + ' ajustes';
    var q = (_ajusteState.search || '').toLowerCase();
    var filtered = q ? items.filter(function (m) {
      return (m.product_sku || '').toLowerCase().indexOf(q) >= 0 ||
             (m.product_name || '').toLowerCase().indexOf(q) >= 0 ||
             (m.movement_type || '').toLowerCase().indexOf(q) >= 0;
    }) : items;
    if (!filtered.length) {
      container.innerHTML = '<table><tbody><tr><td colspan="5"><div class="empty-state" style="padding:40px"><div class="empty-icon"><i class="fa-solid fa-sliders"></i></div><div class="empty-title">' + (q ? 'Sin resultados para "' + q + '"' : 'Sin ajustes registrados') + '</div></div></td></tr></tbody></table>';
      return;
    }
    var rows = filtered.map(function (m) {
      var isPos = m.movement_type === 'AJUSTE_POSITIVO';
      var qColor = isPos ? 'color:var(--success)' : 'color:var(--danger)';
      var badgeCls = _AJUSTE_BADGES[m.movement_type] || 'badge-warning';
      return '<tr>' +
        '<td class="td-muted">' + fmtD(m.timestamp) + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + (m.movement_type || 'AJUSTE') + '</span></td>' +
        '<td class="td-mono">' + (m.product_sku || '—') + '</td>' +
        '<td style="font-weight:700;' + qColor + '">' + (isPos ? '+' : '') + fmtQ(m.quantity) + '</td>' +
        '<td class="td-muted">' + (m.reason || '—') + '</td>' +
        '</tr>';
    }).join('');
    container.innerHTML = '<table>' +
      '<thead><tr><th>Fecha</th><th>Tipo</th><th>SKU</th><th>Cantidad</th><th>Motivo / Autorización</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  async function _fetchAjustes() {
    var container = document.getElementById('ajuste-table-body');
    if (!container) return;
    setLoading('ajuste-table-body');
    try {
      var data = await api('/api/kardex/v2?movement_type=MERMA,AJUSTE_FISICO,AJUSTE_POSITIVO&limit=' + _ajustePAGE + '&offset=' + (_ajusteState.page * _ajustePAGE));
      _ajusteCached = data.items || [];
      _ajusteState.total = data.total || 0;
      _renderAjustes(_ajusteCached);
      _updateAjustePag();
    } catch (e) { setError('ajuste-table-body', e.message, 5); }
  }

  function _wireAjusteListeners() {
    if (_ajusteListeners) return;
    _ajusteListeners = true;
    var searchEl = document.getElementById('ajuste-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        clearTimeout(_ajusteDebounce);
        _ajusteDebounce = setTimeout(function () {
          _ajusteState.search = searchEl.value || '';
          _renderAjustes(_ajusteCached);
        }, 250);
      });
    }
  }

  global.loadAjustes = async function () {
    _ajusteState = { page: 0, total: 0, search: '' };
    _ajusteCached = [];
    _ajusteListeners = false;
    _wireAjusteListeners();
    await _fetchAjustes();
  };

  global.ajustePrev = function () {
    if (_ajusteState.page > 0) { _ajusteState.page--; _fetchAjustes(); }
  };
  global.ajusteNext = function () {
    if ((_ajusteState.page + 1) * _ajustePAGE < _ajusteState.total) { _ajusteState.page++; _fetchAjustes(); }
  };

  global.openModalAjuste = function () {
    _ajusteItems = [];
    populateWarehouseSelect('ajuste-warehouse', false);
    var cont = document.getElementById('ajuste-items');
    if (cont) cont.innerHTML = '';
    global.addAjusteItem();
    var m = document.getElementById('modal-ajuste');
    if (m) m.classList.add('open');
  };
  global.closeModalAjuste = function () {
    var m = document.getElementById('modal-ajuste');
    if (m) m.classList.remove('open');
  };

  global.addAjusteItem = function () {
    var idx = _ajusteItems.length;
    _ajusteItems.push({ sku: '', delta: 0, reason: 'MERMA' });
    var cont = document.getElementById('ajuste-items');
    if (!cont) return;
    var div = document.createElement('div');
    div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:center;';
    div.innerHTML =
      '<input type="text" placeholder="SKU *" class="form-input" data-afield="sku" data-aidx="' + idx + '">' +
      '<input type="number" placeholder="Delta *" step="0.01" class="form-input" data-afield="delta" data-aidx="' + idx + '" title="+ entrada · - salida">' +
      '<select class="form-input" data-afield="reason" data-aidx="' + idx + '">' +
        '<option value="MERMA">Merma</option>' +
        '<option value="AJUSTE_FISICO">Ajuste físico</option>' +
        '<option value="DONACION">Donación</option>' +
        '<option value="OTRO">Otro</option>' +
      '</select>' +
      '<button class="btn btn-secondary btn-sm" onclick="window.removeAjusteItem(' + idx + ')"><i class="fa-solid fa-trash"></i></button>';
    cont.appendChild(div);
    div.querySelectorAll('input,select').forEach(function (el) {
      el.addEventListener('input', function () {
        _ajusteItems[Number(el.dataset.aidx)][el.dataset.afield] = el.value;
      });
      el.addEventListener('change', function () {
        _ajusteItems[Number(el.dataset.aidx)][el.dataset.afield] = el.value;
      });
    });
  };

  global.removeAjusteItem = function (idx) {
    var cont = document.getElementById('ajuste-items');
    if (!cont) return;
    var div = cont.querySelector('[data-aidx="' + idx + '"]') || cont.querySelector('[data-afield="sku"][data-aidx="' + idx + '"]');
    if (div && div.parentNode && div.parentNode.parentNode === cont) div.parentNode.remove();
    else {
      var rows = cont.children;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].querySelector('[data-aidx="' + idx + '"]')) { cont.removeChild(rows[i]); break; }
      }
    }
    _ajusteItems[idx] = null;
  };

  global.confirmarAjuste = async function () {
    var wh   = (document.getElementById('ajuste-warehouse')  || {}).value || '';
    var auth = (document.getElementById('ajuste-autorizado') || {}).value || '';
    var notas= (document.getElementById('ajuste-notas')      || {}).value || '';
    var errEl= document.getElementById('ajuste-error');

    // Recolectar ítems del DOM
    var items = [];
    document.querySelectorAll('#ajuste-items [data-afield="sku"]').forEach(function (inp) {
      var idx    = inp.dataset.aidx;
      var sku    = inp.value.trim();
      var delta  = parseFloat((document.querySelector('[data-afield="delta"][data-aidx="' + idx + '"]') || {}).value || 0);
      var reason = (document.querySelector('[data-afield="reason"][data-aidx="' + idx + '"]') || {}).value || 'MERMA';
      if (sku && delta !== 0) items.push({ product_sku: sku, quantity_delta: delta, reason: reason });
    });

    if (!wh || !auth || !items.length) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = 'Completa bodega, autorización y al menos un producto con delta ≠ 0.'; }
      return;
    }
    if (errEl) errEl.style.display = 'none';
    var btn = document.getElementById('btn-confirmar-ajuste');
    if (btn) btn.disabled = true;

    try {
      await post('/api/warehouse/adjust', {
        warehouse_id: wh, authorized_by: auth, notes: notas, items: items,
        idempotency_key: 'AJST-' + Date.now()
      });
      global.closeModalAjuste();
      toast('Ajuste aplicado correctamente');
      global.loadAjustes();
    } catch (e) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = e.message; }
    } finally {
      if (btn) btn.disabled = false;
    }
  };

})(window);
