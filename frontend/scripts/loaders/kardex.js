/* loaders/kardex.js — F-03 Kardex 7 pestañas completas */
(function (global) {
  'use strict';

  var PAGE_SIZE = 50;

  var state = {
    filter:    '',
    warehouse: '',
    sku:       '',
    page:      0,
    total:     0,
    searchTxt: '',
  };

  var _skuDebounce   = null;
  var _listenersSet  = false;
  var _cachedItems   = [];

  /* ── type badges ── */
  var TYPE_LABELS = {
    COMPRA:           { label: 'Compra',        cls: 'badge-success' },
    VENTA:            { label: 'Venta',          cls: 'badge-info'    },
    DEVOLUCION:       { label: 'Devolución',     cls: 'badge-warning' },
    DEVOLUCION_VENTA: { label: 'Dev. Venta',     cls: 'badge-warning' },
    TRASPASO_ENTRADA: { label: 'Trasp. Entrada', cls: 'badge-neutral' },
    TRASPASO_SALIDA:  { label: 'Trasp. Salida',  cls: 'badge-neutral' },
    MERMA:            { label: 'Merma',          cls: 'badge-danger'  },
    AJUSTE_FISICO:    { label: 'Ajuste Físico',  cls: 'badge-warning' },
    AJUSTE_POSITIVO:  { label: 'Ajuste +',       cls: 'badge-success' },
  };

  function typeBadge(type) {
    var t = TYPE_LABELS[type];
    if (t) return '<span class="badge ' + t.cls + '">' + t.label + '</span>';
    return '<span class="badge badge-neutral">' + (type || '?') + '</span>';
  }

  function fmtQty(q) {
    var n = Number(q) || 0;
    var color = n >= 0 ? 'color:var(--success)' : 'color:var(--danger)';
    return '<span style="font-weight:700;' + color + '">' + (n >= 0 ? '+' : '') +
      n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 4 }) + '</span>';
  }

  function fmtCost(c) {
    var n = Number(c) || 0;
    return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(s) {
    if (!s) return '—';
    return s.replace('T', ' ').slice(0, 16);
  }

  /* ── render ── */
  function renderRows(items) {
    var txt = (state.searchTxt || '').toLowerCase();
    var list = txt ? items.filter(function (m) {
      return (m.product_sku   || '').toLowerCase().includes(txt) ||
             (m.product_name  || '').toLowerCase().includes(txt) ||
             (m.reference_id  || '').toLowerCase().includes(txt) ||
             (m.reference_type|| '').toLowerCase().includes(txt);
    }) : items;

    if (!list.length) {
      return '<table><tbody><tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">Sin movimientos para este filtro</td></tr></tbody></table>';
    }

    var rows = list.map(function (m) {
      var refCell = m.reference_type
        ? (m.reference_type + (m.reference_id ? ': ' + String(m.reference_id).slice(0, 8) + '…' : ''))
        : '—';
      return '<tr>' +
        '<td class="td-muted">' + fmtDate(m.timestamp) + '</td>' +
        '<td>' + typeBadge(m.movement_type) + '</td>' +
        '<td class="td-mono" style="font-size:12px">' + (m.product_sku  || '—') + '</td>' +
        '<td style="font-size:12px">'                 + (m.product_name || '—') + '</td>' +
        '<td style="text-align:right">'               + fmtQty(m.quantity)      + '</td>' +
        '<td style="text-align:right" class="td-muted">' + fmtCost(m.unit_cost) + '</td>' +
        '<td class="td-muted">'                       + (m.warehouse_name || m.warehouse_id || '—') + '</td>' +
        '<td class="td-muted" style="font-size:11px">'+ refCell + '</td>' +
        '</tr>';
    }).join('');

    return '<table>' +
      '<thead><tr>' +
        '<th>Fecha</th><th>Tipo</th><th>SKU</th><th>Producto</th>' +
        '<th style="text-align:right">Cantidad</th><th style="text-align:right">Costo Unit.</th>' +
        '<th>Bodega</th><th>Referencia</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function updatePagination() {
    var from = state.total > 0 ? state.page * PAGE_SIZE + 1 : 0;
    var to   = Math.min((state.page + 1) * PAGE_SIZE, state.total);
    var info = document.getElementById('kardex-pagination-info');
    var prev = document.getElementById('kardex-btn-prev');
    var next = document.getElementById('kardex-btn-next');
    if (info) info.textContent = state.total > 0 ? (from + '–' + to + ' de ' + state.total) : 'Sin resultados';
    if (prev) prev.disabled = state.page === 0;
    if (next) next.disabled = (state.page + 1) * PAGE_SIZE >= state.total;
  }

  /* ── core fetch + render ── */
  async function _fetchAndRender() {
    var container = document.getElementById('kardex-table-body');
    var countEl   = document.getElementById('kardex-count');
    if (!container) return;

    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">Cargando...</div></div>';
    if (countEl) countEl.textContent = '…';

    try {
      var params = new URLSearchParams({ limit: PAGE_SIZE, offset: state.page * PAGE_SIZE });
      if (state.filter)    params.set('movement_type', state.filter);
      if (state.warehouse) params.set('warehouse_id',  state.warehouse);
      if (state.sku)       params.set('product_sku',   state.sku);

      var data    = await AdminAPI.apiFetch('/api/kardex/v2?' + params.toString());
      _cachedItems = Array.isArray(data) ? data : (data.items || []);
      state.total  = (data && data.total != null) ? data.total : _cachedItems.length;

      if (countEl) countEl.textContent = state.total + ' movimientos';
      container.innerHTML = renderRows(_cachedItems);
      updatePagination();
    } catch (err) {
      container.innerHTML = '<table><tbody><tr><td colspan="8" style="text-align:center;padding:24px;color:var(--danger)">' +
        (err.message || 'Error al cargar kardex') + '</td></tr></tbody></table>';
      console.warn('[Calebsys] Kardex error:', err.message);
    }
  }

  /* ── public API ── */
  global.loadKardex = function () {
    // Reset all state on each page navigation
    state.page = 0; state.filter = ''; state.warehouse = '';
    state.sku = ''; state.searchTxt = ''; state.total = 0;
    _cachedItems = [];
    _listenersSet = false;

    _wireListeners();
    _fetchAndRender();
  };

  global.kardexPrevPage = function () {
    if (state.page > 0) { state.page--; _fetchAndRender(); }
  };

  global.kardexNextPage = function () {
    if ((state.page + 1) * PAGE_SIZE < state.total) { state.page++; _fetchAndRender(); }
  };

  /* ── event wiring (runs once per page load) ── */
  function _wireListeners() {
    if (_listenersSet) return;
    _listenersSet = true;

    // Warehouses dropdown
    AdminAPI.apiFetch('/api/warehouses').then(function (whs) {
      var sel = document.getElementById('kardex-filter-warehouse');
      if (!sel) return;
      while (sel.options.length > 1) sel.remove(1);
      (Array.isArray(whs) ? whs : (whs.items || [])).forEach(function (w) {
        var opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = w.name || w.id;
        sel.appendChild(opt);
      });
    }).catch(function () {});

    // Pill-tabs
    var tabs = document.getElementById('kardex-tabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var tab = e.target.closest('.pill-tab');
        if (!tab) return;
        tabs.querySelectorAll('.pill-tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        state.filter = tab.dataset.filter || '';
        state.page = 0;
        _fetchAndRender();
      });
    }

    // Warehouse select
    var whSel = document.getElementById('kardex-filter-warehouse');
    if (whSel) {
      whSel.addEventListener('change', function () {
        state.warehouse = whSel.value;
        state.page = 0;
        _fetchAndRender();
      });
    }

    // SKU input (debounced 400 ms)
    var skuInput = document.getElementById('kardex-filter-sku');
    if (skuInput) {
      skuInput.addEventListener('input', function () {
        clearTimeout(_skuDebounce);
        _skuDebounce = setTimeout(function () {
          state.sku = skuInput.value.trim().toUpperCase();
          state.page = 0;
          _fetchAndRender();
        }, 400);
      });
    }

    // Search box (client-side, no API call)
    var searchInput = document.getElementById('kardex-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        state.searchTxt = searchInput.value.trim();
        var container = document.getElementById('kardex-table-body');
        if (container) container.innerHTML = renderRows(_cachedItems);
      });
    }
  }

})(window);
