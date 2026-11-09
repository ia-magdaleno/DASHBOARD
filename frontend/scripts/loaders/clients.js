/* loaders/clients.js — Calebsys Admin Shell v5.1B
   Conectado a: GET /api/clients?q=
   Fase 5.1B — Conexión Controlada Clientes/CRM
   Freeze base: v1.0.1-ui-core-shell-modular-freeze
*/
(function (global) {
  'use strict';

  /* ─────────────────────────────────────────────────────────
     ALTA / EDICIÓN DE CLIENTE — formato único (constancia fiscal
     + perfil). Se monta en un overlay con iframe a
     pages/client-form.html, mismo formato que usa el POS.
     El iframe avisa por postMessage: {source:'calebsys-client-form'}.
  ───────────────────────────────────────────────────────── */
  var _cfOverlay = null;

  function _cfEnsureOverlay() {
    if (_cfOverlay) return _cfOverlay;
    var ov = document.createElement('div');
    ov.id = 'client-form-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:4000;background:rgba(15,23,42,.55);' +
      'display:none;padding:20px;';
    ov.innerHTML =
      '<div style="max-width:1240px;height:100%;margin:0 auto;background:#f8fafc;' +
        'border-radius:16px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.45);' +
        'display:flex;flex-direction:column;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;' +
          'padding:10px 16px;background:#fff;border-bottom:1px solid var(--border,#e2e8f0);">' +
          '<div id="client-form-title" style="font-weight:700;font-size:.9rem;">Nuevo Cliente</div>' +
          '<button type="button" id="client-form-x" title="Cerrar" ' +
            'style="border:0;background:transparent;font-size:1.1rem;cursor:pointer;color:#64748b;">' +
            '<i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<iframe id="client-form-frame" title="Alta de cliente" ' +
          'style="flex:1;width:100%;border:0;background:#f8fafc;"></iframe>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('#client-form-x').addEventListener('click', _cfClose);
    ov.addEventListener('click', function (e) { if (e.target === ov) _cfClose(); });
    _cfOverlay = ov;
    return ov;
  }

  function _cfClose() {
    if (!_cfOverlay) return;
    _cfOverlay.style.display = 'none';
    var f = document.getElementById('client-form-frame');
    if (f) f.src = 'about:blank';
    document.body.style.overflow = '';
  }

  global.clientsOpenForm = function (mode, client) {
    var ov = _cfEnsureOverlay();
    mode = mode === 'edit' ? 'edit' : 'new';
    try {
      if (mode === 'edit' && client) sessionStorage.setItem('calebsys_client_edit', JSON.stringify(client));
      else sessionStorage.removeItem('calebsys_client_edit');
    } catch (e) {}
    document.getElementById('client-form-title').textContent =
      mode === 'edit' ? ('Editar Cliente — ' + ((client && client.name) || '')) : 'Nuevo Cliente';
    document.getElementById('client-form-frame').src =
      'pages/client-form.html?mode=' + mode +
      (mode === 'edit' && client ? '&id=' + encodeURIComponent(client.id) : '') +
      '&t=' + Date.now();
    ov.style.display = 'block';
    document.body.style.overflow = 'hidden';
  };

  global.clientsNuevoCliente = function () { global.clientsOpenForm('new'); };

  if (!global._cfMsgBound) {
    global._cfMsgBound = true;
    window.addEventListener('message', function (ev) {
      var d = ev && ev.data;
      if (!d || d.source !== 'calebsys-client-form') return;
      if (d.type === 'cancel') { _cfClose(); return; }
      if (d.type === 'saved') {
        _cfClose();
        if (typeof global.loadClients === 'function') global.loadClients(global._clientsQuery || '');
      }
    });
  }

  global.loadClients = async function (query) {
    var container = document.getElementById('clients-table-body');
    if (!container) return;

    /* Show loading */
    container.innerHTML = '<div class="loading-state">' +
      '<div class="spinner"></div>' +
      '<div class="loading-text">Conectando con /api/clients...</div>' +
      '</div>';

    var countEl   = document.getElementById('clients-count');
    if (countEl) countEl.textContent = '—';

    try {
      var q = query || '';
      var data = await AdminAPI.apiFetch('/api/clients?q=' + encodeURIComponent(q));
      var items = Array.isArray(data) ? data : (data.items || data.clients || data.data || []);

      /* ── Store in page-level cache for filter/search ── */
      if (typeof global._clientsAll !== 'undefined') {
        global._clientsAll = items;
        global._clientsQuery = '';
        global._clientsFilter = 'all';
      }

      /* ── KPI calculations ── */
      var totalCredit     = items.filter(function(c){ return Number(c.limite_credito||0) > 0; }).length;
      var totalDeuda      = items.reduce(function(s,c){ return s + Number(c.saldo_actual||0); }, 0);
      var totalFavor      = items.reduce(function(s,c){ return s + Number(c.saldo_favor||0); }, 0);
      var totalResguardos = items.filter(function(c){ return c.resguardos === true; }).length;
      var totalApartados  = items.reduce(function(s,c){ return s + Number(c.apartados||0); }, 0);

      _setKpi('kpi-total-clientes',  AdminAPI.fmtNum(items.length),           'kpi-trend-clientes',    items.length + ' registros en /api/clients');
      _setKpi('kpi-credito-activo',  AdminAPI.fmtNum(totalCredit),            'kpi-trend-credito',     totalCredit + ' con límite > 0');
      _setKpi('kpi-deuda-total',     AdminAPI.fmtCurrency(totalDeuda),        'kpi-trend-deuda',       'Suma saldo_actual');
      _setKpi('kpi-saldo-favor',     AdminAPI.fmtCurrency(totalFavor),        'kpi-trend-favor',       'Suma saldo_favor');
      _setKpi('kpi-resguardos',      AdminAPI.fmtNum(totalResguardos),        'kpi-trend-resguardos',  totalResguardos + ' con resguardo activo');
      _setKpi('kpi-apartados',       AdminAPI.fmtCurrency(totalApartados),    'kpi-trend-apartados',   'Suma apartados');

      /* ── Update timestamp ── */
      var tsEl = document.getElementById('clients-last-updated');
      if (tsEl) tsEl.textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-MX');

      /* ── Render table via page-level clientsRender() ── */
      if (typeof global.clientsRender === 'function') {
        global.clientsRender();
      } else {
        /* Fallback render if page script not loaded */
        _renderFallback(items, container);
      }

    } catch (err) {
      /* ── Error state — never breaks navigation ── */
      container.innerHTML =
        '<div class="empty-state" style="padding:48px 32px;">' +
        '<div class="empty-icon" style="color:var(--danger);border-color:rgba(239,68,68,0.25);width:64px;height:64px;">' +
        '<i class="fa-solid fa-triangle-exclamation"></i></div>' +
        '<div class="empty-title" style="color:var(--danger);">No se pudo conectar con /api/clients</div>' +
        '<div class="empty-desc">' + err.message + '</div>' +
        '<button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="loadClients()">' +
        '<i class="fa-solid fa-rotate-right"></i> Reintentar</button>' +
        '</div>';

      /* Reset KPIs */
      ['kpi-total-clientes','kpi-credito-activo','kpi-deuda-total','kpi-saldo-favor'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) { el.textContent = '—'; el.title = err.message; }
        var t = document.getElementById(id.replace('kpi-','kpi-trend-').replace('total-','trend-').replace('-activo','').replace('-deuda-total','').replace('-total',''));
        if (t) t.innerHTML = '<i class="fa-solid fa-wifi-slash" style="color:var(--danger);"></i> Sin conexión';
      });

      console.warn('[Calebsys] Clientes no cargados:', err.message);
    }
  };

  /* ── Helpers ── */
  function _setKpi(valueId, value, trendId, trendText) {
    var el = document.getElementById(valueId);
    if (el) el.textContent = value;
    var t = document.getElementById(trendId);
    if (t) t.innerHTML = '<i class="fa-solid fa-check" style="color:var(--success);"></i> ' + trendText;
  }

  function _renderFallback(items, container) {
    var countEl = document.getElementById('clients-count');
    if (countEl) countEl.textContent = items.length + ' clientes';

    if (!items.length) {
      container.innerHTML =
        '<div class="empty-state" style="padding:60px 32px;">' +
        '<div class="empty-icon"><i class="fa-solid fa-users"></i></div>' +
        '<div class="empty-title">Sin clientes registrados</div>' +
        '<div class="empty-desc">Agrega el primer cliente con el botón "Nuevo Cliente".</div>' +
        '<button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="clientsNuevoCliente()">' +
        '<i class="fa-solid fa-user-plus"></i> Nuevo Cliente</button>' +
        '</div>';
      return;
    }

    var rows = items.map(function (c) {
      var balance = Number(c.saldo_actual || 0);
      var limit   = Number(c.limite_credito || 0);
      var balHtml = balance > 0
        ? '<span style="color:var(--danger);font-weight:700;">' + AdminAPI.fmtCurrency(balance) + '</span>'
        : '<span class="td-muted">—</span>';
      return '<tr>' +
        '<td style="font-weight:600;">' + (c.name || '—') + '</td>' +
        '<td class="td-mono">' + (c.rfc || '<span class="td-muted">—</span>') + '</td>' +
        '<td><span class="badge badge-neutral">' + (c.client_type || 'Público General') + '</span></td>' +
        '<td>' + (limit > 0 ? AdminAPI.fmtCurrency(limit) : '<span class="td-muted">Sin crédito</span>') + '</td>' +
        '<td>' + balHtml + '</td>' +
        '<td class="td-muted">' + (c.phone || '—') + '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<table>' +
      '<thead><tr><th>Nombre</th><th>RFC</th><th>Tipo</th><th>Límite Crédito</th><th>Saldo Deudor</th><th>Teléfono</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

})(window);
