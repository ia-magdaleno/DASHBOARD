/**
 * almacen-devoluciones.js
 * Loader del modulo Devoluciones de Venta en admin-shell.
 * Endpoints: GET /api/returns  |  POST /api/sales/{id}/cross-return
 *            POST /api/returns/{id}/approve
 */
(function () {
  'use strict';

  // ── estado interno ──────────────────────────────────────────────────────────
  let _devAll      = [];   // lista completa sin filtrar
  let _devSearch   = '';   // texto del filtro activo
  let _ventaActual = null; // venta cargada en el modal

  // ── inicializacion del modulo ───────────────────────────────────────────────
  function initDevoluciones() {
    _cargarLista();
    _setupSearch();
  }

  function _setupSearch() {
    const inp = document.getElementById('dev-search');
    if (!inp || inp._devBound) return;
    inp._devBound = true;
    inp.addEventListener('input', function () {
      _devSearch = inp.value.trim().toLowerCase();
      _renderLista(_filtrar(_devAll));
    });
  }

  // ── carga de la lista ───────────────────────────────────────────────────────
  function _cargarLista() {
    const body = document.getElementById('dev-table-body');
    if (body) {
      body.innerHTML = '<div class="loading-state"><div class="spinner"></div>' +
        '<div class="loading-text">Cargando devoluciones...</div></div>';
    }

    AdminAPI.apiFetch('/api/returns')
      .then(function (data) {
        _devAll = Array.isArray(data) ? data : (data.items || data.returns || []);
        _renderLista(_filtrar(_devAll));
        _actualizarContador(_devAll.length);
      })
      .catch(function (err) {
        if (body) {
          body.innerHTML = '<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i>' +
            '<p>Error al cargar devoluciones: ' + (err.message || err) + '</p></div>';
        }
      });
  }

  function _filtrar(lista) {
    if (!_devSearch) return lista;
    return lista.filter(function (d) {
      var folio  = (d.folio || d.id || '').toLowerCase();
      var estado = (d.estado || d.status || '').toLowerCase();
      var sku    = JSON.stringify(d.items || []).toLowerCase();
      return folio.includes(_devSearch) || estado.includes(_devSearch) || sku.includes(_devSearch);
    });
  }

  function _actualizarContador(n) {
    var el = document.getElementById('dev-count');
    if (el) el.textContent = n;
  }

  // ── render de la tabla ──────────────────────────────────────────────────────
  var ESTADO_BADGE = {
    PENDIENTE: '<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;">Pendiente</span>',
    APROBADA:  '<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;">Aprobada</span>',
    RECHAZADA: '<span style="background:#fee2e2;color:#991b1b;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;">Rechazada</span>',
  };

  function _renderLista(lista) {
    var body = document.getElementById('dev-table-body');
    if (!body) return;

    if (lista.length === 0) {
      body.innerHTML = '<div class="empty-state"><i class="fa-solid fa-rotate-left" ' +
        'style="font-size:2rem;opacity:.3;"></i><p>Sin devoluciones' +
        (_devSearch ? ' para esta busqueda' : ' registradas') + '.</p></div>';
      return;
    }

    var COLS = ['Folio / ID', 'Fecha', 'Estado', 'Sucursal origen', 'Total reintegro', 'Acciones'];
    var thead = '<div class="table-head">' +
      COLS.map(function (c) { return '<div class="th">' + c + '</div>'; }).join('') +
      '</div>';

    var rows = lista.map(function (d) {
      var id     = d.id || '';
      var folio  = d.folio || id.slice(0, 8).toUpperCase() || '—';
      var fecha  = d.created_at
        ? new Date(d.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
        : '—';
      var estado = (d.estado || d.status || 'PENDIENTE').toUpperCase();
      var badge  = ESTADO_BADGE[estado] || ('<span>' + estado + '</span>');
      var suc    = d.sucursal_origen || '—';
      var total  = d.total_reintegro != null
        ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(d.total_reintegro)
        : '—';

      var acciones = '<div style="display:flex;gap:6px;align-items:center;">';
      if (estado === 'PENDIENTE') {
        acciones += '<button class="btn btn-primary btn-xs" ' +
          'onclick="window.aprobarDevolucion(\'' + id + '\')">' +
          '<i class="fa-solid fa-check"></i> Aprobar</button>';
        acciones += '<button class="btn btn-danger btn-xs" ' +
          'onclick="window.rechazarDevolucion(\'' + id + '\')">' +
          '<i class="fa-solid fa-x"></i> Rechazar</button>';
      } else {
        acciones += '<span style="font-size:12px;color:var(--text-muted);">—</span>';
      }
      acciones += '</div>';

      return '<div class="table-row">' +
        '<div class="td" data-label="Folio">' +
          '<span style="font-family:monospace;font-weight:700;">' + folio + '</span>' +
        '</div>' +
        '<div class="td" data-label="Fecha">' + fecha + '</div>' +
        '<div class="td" data-label="Estado">' + badge + '</div>' +
        '<div class="td" data-label="Sucursal">' + suc + '</div>' +
        '<div class="td" data-label="Total">' + total + '</div>' +
        '<div class="td" data-label="Acciones">' + acciones + '</div>' +
        '</div>';
    }).join('');

    body.innerHTML = '<div class="table-grid" style="grid-template-columns:' +
      '1.2fr 1fr 0.9fr 1fr 1fr 1.4fr;">' + thead + rows + '</div>';
  }

  // ── modal nueva devolucion ──────────────────────────────────────────────────
  function openModalDevolucion() {
    _ventaActual = null;
    var info  = document.getElementById('dev-venta-info');
    var items = document.getElementById('dev-items-container');
    var btn   = document.getElementById('btn-confirmar-dev');
    var err   = document.getElementById('dev-error');
    var inp   = document.getElementById('dev-sale-id');
    if (info)  { info.style.display = 'none'; info.innerHTML = ''; }
    if (items) items.style.display = 'none';
    if (btn)   btn.disabled = true;
    if (err)   { err.style.display = 'none'; err.textContent = ''; }
    if (inp)   inp.value = '';

    var modal = document.getElementById('modal-devolucion');
    if (modal) modal.classList.add('open');
  }

  function closeModalDevolucion() {
    var modal = document.getElementById('modal-devolucion');
    if (modal) modal.classList.remove('open');
    _ventaActual = null;
  }

  // ── buscar venta ────────────────────────────────────────────────────────────
  function buscarVentaDevolucion() {
    var inp = document.getElementById('dev-sale-id');
    var err = document.getElementById('dev-error');
    if (!inp) return;

    var rawId = inp.value.trim();
    if (!rawId) { _showErr('Ingresa el ID de la venta.'); return; }
    if (err) { err.style.display = 'none'; }

    var btn = document.querySelector('[onclick="window.buscarVentaDevolucion()"]');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    AdminAPI.apiFetch('/api/sales/' + encodeURIComponent(rawId))
      .then(function (sale) {
        _ventaActual = sale;
        _renderVentaInfo(sale);
        _renderItemsDev(sale);
        var btnConf = document.getElementById('btn-confirmar-dev');
        if (btnConf) btnConf.disabled = false;
      })
      .catch(function (e) {
        _showErr('No se encontro la venta: ' + (e.message || e));
      })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Buscar'; }
      });
  }

  function _showErr(msg) {
    var err = document.getElementById('dev-error');
    if (err) { err.textContent = msg; err.style.display = 'block'; }
  }

  function _renderVentaInfo(sale) {
    var el = document.getElementById('dev-venta-info');
    if (!el) return;
    var fecha = sale.created_at
      ? new Date(sale.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
      : '—';
    var total = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(sale.total || 0);
    el.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:12px;">' +
      '<span><strong>Folio:</strong> ' + (sale.folio || sale.id.slice(0,8)) + '</span>' +
      '<span><strong>Fecha:</strong> ' + fecha + '</span>' +
      '<span><strong>Total:</strong> <strong style="color:#dc2626;">' + total + '</strong></span>' +
      '</div>';
    el.style.display = 'block';
  }

  function _renderItemsDev(sale) {
    var cont = document.getElementById('dev-items-container');
    var div  = document.getElementById('dev-items');
    if (!cont || !div) return;

    var items = sale.items || sale.sale_items || [];
    if (items.length === 0) {
      div.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">Sin productos en esta venta.</p>';
    } else {
      div.innerHTML = items.map(function (it, i) {
        var nombre = it.product_name || it.description || it.sku || '—';
        var qty    = Number(it.quantity || it.qty || 0);
        var precio = Number(it.price || it.unit_price || 0);
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">' +
          '<input type="checkbox" id="dchk-' + i + '" class="dev-item-chk" checked ' +
          'style="accent-color:#dc2626;width:14px;height:14px;" />' +
          '<span style="flex:1;font-size:13px;">' + nombre + '</span>' +
          '<span style="font-size:12px;color:var(--text-muted);">x</span>' +
          '<input type="number" id="dqty-' + i + '" value="' + qty + '" min="1" max="' + qty + '" ' +
          'style="width:56px;padding:2px 6px;border:1px solid var(--border);border-radius:6px;' +
          'font-size:12px;text-align:center;" />' +
          '<span style="font-size:12px;min-width:60px;text-align:right;">' +
          new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(qty * precio) +
          '</span>' +
          '</div>';
      }).join('');
    }
    cont.style.display = 'block';
  }

  // ── confirmar devolucion ────────────────────────────────────────────────────
  function confirmarDevolucion() {
    if (!_ventaActual) return;
    var items     = _ventaActual.items || _ventaActual.sale_items || [];
    var returnItems = [];
    items.forEach(function (it, i) {
      var chk = document.getElementById('dchk-' + i);
      var qty = parseInt((document.getElementById('dqty-' + i) || {}).value) || 0;
      if (chk && chk.checked && qty > 0) {
        returnItems.push({ sale_item_id: it.id, quantity: qty });
      }
    });

    if (returnItems.length === 0) { _showErr('Selecciona al menos un producto.'); return; }

    var btn = document.getElementById('btn-confirmar-dev');
    if (btn) { btn.disabled = true; btn.textContent = 'Procesando...'; }

    AdminAPI.apiFetch('/api/sales/' + _ventaActual.id + '/cross-return', {
      method: 'POST',
      body:   JSON.stringify({ return_items: returnItems, notas: null })
    })
    .then(function () {
      closeModalDevolucion();
      _cargarLista();
      _toastOk('Devolucion registrada correctamente.');
    })
    .catch(function (e) {
      _showErr('Error: ' + (e.message || e));
      if (btn) { btn.disabled = false; btn.textContent = 'Registrar Devolucion'; }
    });
  }

  // ── aprobar / rechazar ──────────────────────────────────────────────────────
  function aprobarDevolucion(returnId) {
    if (!confirm('Aprobar devolucion ' + returnId.slice(0,8) + '?\nSe actualizara el stock.')) return;

    AdminAPI.apiFetch('/api/returns/' + returnId + '/approve', { method: 'POST' })
      .then(function () { _cargarLista(); _toastOk('Devolucion aprobada.'); })
      .catch(function (e) { alert('Error: ' + (e.message || e)); });
  }

  function rechazarDevolucion(returnId) {
    if (!confirm('Rechazar devolucion ' + returnId.slice(0,8) + '?\nEsta accion no se puede deshacer.')) return;

    AdminAPI.apiFetch('/api/returns/' + returnId + '/reject', { method: 'POST' })
      .then(function () { _cargarLista(); _toastOk('Devolucion rechazada.'); })
      .catch(function (e) { alert('Error: ' + (e.message || e)); });
  }

  // ── toast interno ───────────────────────────────────────────────────────────
  function _toastOk(msg) {
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#16a34a;color:#fff;' +
      'font-size:13px;font-weight:700;padding:12px 20px;border-radius:10px;z-index:9999;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.2);';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  // ── exponer al scope global ─────────────────────────────────────────────────
  window.openModalDevolucion      = openModalDevolucion;
  window.closeModalDevolucion     = closeModalDevolucion;
  window.buscarVentaDevolucion    = buscarVentaDevolucion;
  window.confirmarDevolucion      = confirmarDevolucion;
  window.aprobarDevolucion        = aprobarDevolucion;
  window.rechazarDevolucion       = rechazarDevolucion;

  // ── registrar en pageInitHandlers (mecanismo de admin-shell) ──────────────
  window.pageInitHandlers = window.pageInitHandlers || {};
  window.pageInitHandlers['almacen-devoluciones'] = initDevoluciones;

  // Fallback: si la pagina ya esta en el DOM al cargar el script
  if (document.getElementById('dev-table-body')) {
    initDevoluciones();
  }

})();
