/* frontend/scripts/admin/page-inits.js
   Page initializers extracted from admin HTML fragments.
   Called by admin-shell.js after each fragment loads. */

if(!window.pageInitHandlers)window.pageInitHandlers={};

window.pageInitHandlers['loyalty']=function(){
const API = window.API_BASE || '/api';

  // ── Helpers UI ──────────────────────────────────────────────────────────────
  function showMsg(id, text, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display  = 'block';
    el.style.background = ok ? '#d1fae5' : '#fee2e2';
    el.style.color      = ok ? '#065f46' : '#991b1b';
    el.textContent = text;
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  function setStatCard(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ── Acumulación: etiqueta dinámica ─────────────────────────────────────────
  function updateRateLabel() {
    const mode = document.getElementById('loyalty-mode').value;
    const lbl  = document.getElementById('loyalty-rate-label');
    const hint = document.getElementById('loyalty-rate-hint');
    if (mode === 'percent') {
      lbl.textContent  = 'Tasa (%)';
      hint.textContent = 'Ej: 2 → el cliente gana 2 puntos por cada $100 de compra';
    } else {
      lbl.textContent  = 'Puntos fijos por compra';
      hint.textContent = 'Ej: 5 → el cliente gana 5 puntos en cada venta, sin importar el monto';
    }
    runSimulator();
  }
  document.getElementById('loyalty-mode').addEventListener('change', updateRateLabel);

  // ── Simulador ───────────────────────────────────────────────────────────────
  function runSimulator() {
    const mode   = document.getElementById('loyalty-mode').value;
    const rate   = parseFloat(document.getElementById('loyalty-rate').value) || 0;
    const amount = parseFloat(document.getElementById('sim-amount').value)   || 0;
    const resEl  = document.getElementById('sim-result');
    if (!resEl) return;
    let pts;
    if (mode === 'percent') {
      pts = Math.floor(amount * rate / 100);
    } else {
      pts = amount > 0 ? Math.floor(rate) : 0;
    }
    resEl.textContent = `${pts} pts`;
  }
  document.getElementById('loyalty-rate').addEventListener('input', runSimulator);
  document.getElementById('sim-amount').addEventListener('input', runSimulator);

  // ── Preview valor_punto ────────────────────────────────────────────────────
  function updateValorPreview() {
    const v = parseFloat(document.getElementById('loyalty-valor-punto').value) || 1;
    const el = document.getElementById('valor-equiv');
    if (el) el.textContent = `$${(100 * v).toFixed(2)}`;
  }
  document.getElementById('loyalty-valor-punto').addEventListener('input', updateValorPreview);

  // ── Modos: extrae array de checkboxes + textarea custom ───────────────────
  function getSelectedModes() {
    const known = Array.from(document.querySelectorAll('.loyalty-mode-check'))
      .filter(c => c.checked).map(c => c.value);
    const customRaw = (document.getElementById('loyalty-modes-custom').value || '')
      .split('\n').map(s => s.trim()).filter(Boolean);
    // Deduplica
    const all = [...new Set([...known, ...customRaw])];
    return all;
  }

  function setSelectedModes(modes) {
    const known = ['pago_parcial','sorteo','regalo','descuento_especial','donacion'];
    const custom = [];
    modes.forEach(m => {
      const cb = document.getElementById('mode-' + m);
      if (cb) {
        cb.checked = true;
      } else {
        custom.push(m);
      }
    });
    document.getElementById('loyalty-modes-custom').value = custom.join('\n');
  }

  // ── Cargar config actual ───────────────────────────────────────────────────
  fetch(`${API}/loyalty/config`, { credentials: 'include' })
    .then(r => r.ok ? r.json() : {})
    .then(d => {
      const mode = d.mode || 'percent';
      const rate = d.rate ?? 1.0;
      document.getElementById('loyalty-mode').value = mode;
      document.getElementById('loyalty-rate').value = rate;
      updateRateLabel();
      // Stat cards
      setStatCard('stat-mode', mode === 'percent' ? 'Porcentaje' : 'Fijos');
      setStatCard('stat-rate', mode === 'percent' ? `${rate}%` : `${rate} pts`);
    })
    .catch(() => {});

  fetch(`${API}/loyalty/redemption-config`, { credentials: 'include' })
    .then(r => r.ok ? r.json() : {})
    .then(d => {
      const modes      = d.modes || ['pago_parcial','sorteo','regalo'];
      const valorPunto = d.valor_punto ?? 1.0;
      setSelectedModes(modes);
      document.getElementById('loyalty-valor-punto').value = valorPunto;
      updateValorPreview();
      // Stat card
      setStatCard('stat-valor', `$${parseFloat(valorPunto).toFixed(2)}/pt`);
    })
    .catch(() => {});

  // ── Guardar acumulación ───────────────────────────────────────────────────
  window.saveLoyaltyConfig = function() {
    const mode = document.getElementById('loyalty-mode').value;
    const rate = parseFloat(document.getElementById('loyalty-rate').value);
    if (isNaN(rate) || rate < 0) {
      showMsg('loyalty-config-msg', 'Tasa inválida: debe ser un número ≥ 0', false);
      return;
    }
    fetch(`${API}/loyalty/config`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, rate })
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(() => {
        showMsg('loyalty-config-msg', '✓ Configuración guardada', true);
        setStatCard('stat-mode', mode === 'percent' ? 'Porcentaje' : 'Fijos');
        setStatCard('stat-rate', mode === 'percent' ? `${rate}%` : `${rate} pts`);
      })
      .catch(() => showMsg('loyalty-config-msg', 'Error al guardar', false));
  };

  // ── Guardar redención ─────────────────────────────────────────────────────
  window.saveLoyaltyRedemption = function() {
    const modes      = getSelectedModes();
    const valorPunto = parseFloat(document.getElementById('loyalty-valor-punto').value);
    if (!modes.length) {
      showMsg('loyalty-redemption-msg', 'Habilita al menos un modo de redención', false);
      return;
    }
    if (isNaN(valorPunto) || valorPunto <= 0) {
      showMsg('loyalty-redemption-msg', 'Valor del punto inválido: debe ser > 0', false);
      return;
    }
    fetch(`${API}/loyalty/redemption-config`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modes, valor_punto: valorPunto })
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(() => {
        showMsg('loyalty-redemption-msg', '✓ Modos de redención guardados', true);
        setStatCard('stat-valor', `$${valorPunto.toFixed(2)}/pt`);
      })
      .catch(() => showMsg('loyalty-redemption-msg', 'Error al guardar', false));
  };

  // Init simulador con valores por defecto
  runSimulator();
};

window.pageInitHandlers['caja']=function(){
var _shift = null; // turno activo en memoria

  // M-2: mismo mecanismo de drill-down por sucursal que el dashboard —
  // el admin dueño/gerente general puede ver TODAS las sucursales con
  // desglose, o el detalle de una sola. El Gerente de sucursal nunca ve
  // el selector: su historial queda scoped a su propia sede (como antes).
  var _branchNames = {};
  function _branchLabel(id) { return (id && _branchNames[id]) || id || 'Sin sucursal'; }
  function _isOwnerAdmin() {
    var role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
    return role === 'admin' || role === 'administrador';
  }

  function fmt(v) {
    if (v == null) return '—';
    return new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' }).format(Number(v));
  }
  function fmtD(v) {
    if (!v) return '—';
    try { return new Date(v).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' }); }
    catch(e) { return v; }
  }

  window.closeModalCaja = function(id) {
    var m = document.getElementById(id);
    if (m) m.classList.remove('open');
  };

  window.cajaLoad = async function() {
    try {
      var shift = await AdminAPI.apiFetch('/api/caja/turno-activo');
      _shift = shift;
      // Turno abierto
      document.getElementById('caja-sin-turno').style.display = 'none';
      document.getElementById('caja-turno-panel').style.display = '';
      document.getElementById('caja-turno-badge').style.display = '';
      document.getElementById('btn-abrir-turno').style.display = 'none';
      document.getElementById('btn-corte').style.display = '';
      document.getElementById('caja-fondo').textContent   = fmt(shift.opening_amount);
      var ventas = (shift.expected_amount || 0) - (shift.opening_amount || 0);
      document.getElementById('caja-ventas').textContent   = fmt(ventas < 0 ? 0 : ventas);
      document.getElementById('caja-esperado').textContent = fmt(shift.expected_amount);
      document.getElementById('caja-opened-by').textContent = shift.opened_by_id || '—';
      document.getElementById('caja-desde').textContent     = fmtD(shift.created_at);
      document.getElementById('caja-shift-id').textContent  = (shift.id || '').slice(0,8).toUpperCase();
    } catch(e) {
      // Sin turno activo (404)
      _shift = null;
      document.getElementById('caja-sin-turno').style.display = '';
      document.getElementById('caja-turno-panel').style.display = 'none';
      document.getElementById('caja-turno-badge').style.display = 'none';
      document.getElementById('btn-abrir-turno').style.display = '';
      document.getElementById('btn-corte').style.display = 'none';
    }
    // Siempre cargar historial (admin/gerente)
    cajaLoadHistorial();
  };

  window.cajaAbrirTurno = function() {
    if (_shift) { if (typeof toast==='function') toast('Ya hay un turno abierto', 'warn'); return; }
    document.getElementById('caja-fondo-input').value = '0';
    var errEl = document.getElementById('caja-abrir-error');
    if (errEl) errEl.style.display = 'none';
    document.getElementById('modal-abrir-turno').classList.add('open');
  };

  window.cajaConfirmarAbrir = async function() {
    var fondo = parseFloat(document.getElementById('caja-fondo-input').value) || 0;
    var errEl = document.getElementById('caja-abrir-error');
    if (errEl) errEl.style.display = 'none';
    try {
      await AdminAPI.apiFetch('/api/caja/abrir', {
        method:'POST', body: JSON.stringify({ opening_amount: fondo })
      });
      window.closeModalCaja('modal-abrir-turno');
      cajaLoad();
      if (typeof toast==='function') toast('Turno abierto correctamente', 'success');
    } catch(e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
    }
  };

  window.cajaMostrarCorte = function() {
    if (!_shift) return;
    document.getElementById('caja-reportado-input').value = '';
    var errEl = document.getElementById('caja-corte-error');
    if (errEl) errEl.style.display = 'none';
    document.getElementById('modal-corte-ciego').classList.add('open');
    setTimeout(function(){ document.getElementById('caja-reportado-input').focus(); }, 200);
  };

  window.cajaConfirmarCorte = async function() {
    if (!_shift) return;
    var reportado = parseFloat(document.getElementById('caja-reportado-input').value);
    var errEl = document.getElementById('caja-corte-error');
    if (isNaN(reportado) || reportado < 0) {
      if (errEl) { errEl.textContent = 'Ingresa un monto válido.'; errEl.style.display = ''; }
      return;
    }
    if (errEl) errEl.style.display = 'none';
    try {
      var result = await AdminAPI.apiFetch('/api/caja/cerrar/' + _shift.id, {
        method:'POST', body: JSON.stringify({ reported_amount: reportado })
      });
      window.closeModalCaja('modal-corte-ciego');
      cajaMostrarResultado(result);
    } catch(e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
    }
  };

  function cajaMostrarResultado(shift) {
    var diff = shift.difference != null ? parseFloat(shift.difference) : null;
    var tieneDiff = diff != null && Math.abs(diff) > 0.01;
    var body = document.getElementById('resultado-body');
    var footer = document.getElementById('resultado-footer');
    var title = document.getElementById('resultado-title');

    var diffColor = tieneDiff ? (diff < 0 ? 'var(--danger)' : 'var(--success)') : 'var(--success)';
    var diffLabel = diff == null ? '—' : (diff > 0 ? '+' : '') + fmt(diff);
    var statusIcon = tieneDiff
      ? '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning);font-size:2rem;"></i>'
      : '<i class="fa-solid fa-circle-check" style="color:var(--success);font-size:2rem;"></i>';

    title.innerHTML = '<i class="fa-solid fa-receipt"></i> ' + (tieneDiff ? 'Corte con Diferencia' : 'Corte Exitoso');
    body.innerHTML =
      '<div style="text-align:center;margin-bottom:20px;">' + statusIcon + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">' +
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">' +
          '<div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Esperado (sistema)</div>' +
          '<div style="font-size:1.2rem;font-weight:800;">' + fmt(shift.expected_amount) + '</div>' +
        '</div>' +
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">' +
          '<div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Reportado (cajero)</div>' +
          '<div style="font-size:1.2rem;font-weight:800;">' + fmt(shift.reported_amount) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="background:var(--surface);border:2px solid ' + diffColor + ';border-radius:8px;padding:14px;text-align:center;">' +
        '<div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Diferencia</div>' +
        '<div style="font-size:1.5rem;font-weight:900;color:' + diffColor + ';">' + diffLabel + '</div>' +
      '</div>';

    if (tieneDiff) {
      body.innerHTML += '<div style="margin-top:14px;padding:10px 14px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:8px;font-size:0.78rem;color:var(--text-muted);">' +
        '<i class="fa-solid fa-info-circle" style="color:var(--warning);"></i> Se requiere autorización del Administrador o Gerente para cerrar con diferencia.' +
        '</div>';
      footer.innerHTML =
        '<button class="btn btn-warning" style="background:var(--warning);color:#fff;" onclick="cajaAutorizar(\'' + shift.id + '\')">' +
          '<i class="fa-solid fa-check-double"></i> Autorizar y Cerrar' +
        '</button>' +
        '<button class="btn btn-secondary" onclick="closeModalCaja(\'modal-resultado-corte\');cajaLoad()">Cancelar</button>';
    } else {
      footer.innerHTML = '<button class="btn btn-primary" onclick="closeModalCaja(\'modal-resultado-corte\');cajaLoad()"><i class="fa-solid fa-check"></i> Listo</button>';
    }

    document.getElementById('modal-resultado-corte').classList.add('open');
    cajaLoad();
  }

  window.cajaAutorizar = async function(shiftId) {
    try {
      await AdminAPI.apiFetch('/api/caja/autorizar/' + shiftId, {
        method:'POST', body: JSON.stringify({ authorize: true })
      });
      window.closeModalCaja('modal-resultado-corte');
      cajaLoad();
      if (typeof toast==='function') toast('Turno cerrado y autorizado', 'success');
    } catch(e) {
      if (typeof toast==='function') toast(e.message, 'error');
    }
  };

  window.cajaLoadHistorial = async function() {
    var tbody = document.getElementById('caja-hist-tbody');
    var section = document.getElementById('caja-historial-section');
    if (!tbody || !section) return;

    var isAdmin = _isOwnerAdmin();
    var sel = document.getElementById('caja-sucursal-filter');
    var thSuc = document.getElementById('caja-th-sucursal');

    // M-2: mostrar/poblar el selector solo para el admin dueño/gerente general
    if (sel) {
      if (isAdmin) {
        sel.style.display = 'inline-block';
        if (sel.options.length <= 1) {
          try {
            var branches = await AdminAPI.apiFetch('/api/branches');
            if (Array.isArray(branches)) {
              branches.forEach(function(b) {
                var id = b.id || b.sucursal_id || '';
                if (!id) return;
                _branchNames[id] = b.name || b.nombre || id;
                var opt = document.createElement('option');
                opt.value = id; opt.textContent = _branchNames[id];
                sel.appendChild(opt);
              });
            }
          } catch (e) { /* sin sucursales — ok, se listan solo por id */ }
        }
      } else {
        sel.style.display = 'none';
      }
    }
    if (thSuc) thSuc.style.display = isAdmin ? '' : 'none';

    var url = '/api/caja/historial';
    if (isAdmin && sel && sel.value) url += '?sucursal_id=' + encodeURIComponent(sel.value);

    try {
      var resp = await AdminAPI.apiFetch(url);
      // Compat: si por algún motivo llega el shape viejo (array plano), lo envolvemos.
      var data = Array.isArray(resp) ? { scope: '', by_sucursal: [], items: resp } : (resp || {});
      var items = data.items || [];

      _renderCajaScopeUI(data, isAdmin);

      if (!items.length) { section.style.display = 'none'; return; }
      section.style.display = '';
      var cnt = document.getElementById('caja-hist-count');
      if (cnt) cnt.textContent = items.length;
      var ST = { OPEN:'<span class="badge badge-success">Abierto</span>', CLOSED:'<span class="badge badge-neutral">Cerrado</span>', DISCREPANCY:'<span class="badge badge-warning">Con diferencia</span>' };
      tbody.innerHTML = items.map(function(s){
        var diff = s.difference != null ? parseFloat(s.difference) : null;
        var diffHtml = diff == null ? '—' : '<span style="font-weight:700;color:' + (Math.abs(diff)>0.01 ? (diff<0?'var(--danger)':'var(--success)') : 'var(--text-muted)') + ';">' + (diff>=0?'+':'') + fmt(diff) + '</span>';
        var authBtn = s.status === 'DISCREPANCY'
          ? '<button class="btn btn-ghost btn-sm" onclick="cajaAutorizar(\'' + s.id + '\')" title="Autorizar"><i class="fa-solid fa-check-double" style="color:var(--warning);"></i></button>'
          : '';
        var sucCell = isAdmin
          ? '<td style="padding:8px 12px;color:var(--text-muted);">' + _branchLabel(s.sucursal_id) + '</td>'
          : '';
        return '<tr>' +
          sucCell +
          '<td style="padding:8px 12px;">' + (s.opened_by_id||'—') + '</td>' +
          '<td style="padding:8px 12px;color:var(--text-muted);">' + (s.closed_by_id||'—') + '</td>' +
          '<td style="padding:8px 12px;text-align:right;">' + fmt(s.opening_amount) + '</td>' +
          '<td style="padding:8px 12px;text-align:right;">' + fmt(s.expected_amount) + '</td>' +
          '<td style="padding:8px 12px;text-align:right;">' + (s.reported_amount!=null ? fmt(s.reported_amount) : '—') + '</td>' +
          '<td style="padding:8px 12px;text-align:right;">' + diffHtml + '</td>' +
          '<td style="padding:8px 12px;">' + (ST[s.status]||s.status) + '</td>' +
          '<td style="padding:8px 12px;color:var(--text-muted);font-size:0.72rem;">' + fmtD(s.created_at) + '</td>' +
          '<td style="padding:8px 12px;">' + authBtn + '</td>' +
          '</tr>';
      }).join('');
    } catch(e) {
      section.style.display = 'none';
    }
  };

  /** M-2: pinta breadcrumb (nivel 3) o panel de desglose (nivel 1→2). */
  function _renderCajaScopeUI(data, isAdmin) {
    var breadcrumb = document.getElementById('caja-scope-breadcrumb');
    var panel = document.getElementById('caja-by-sucursal-panel');
    if (!breadcrumb || !panel) return;

    if (!isAdmin) {
      breadcrumb.style.display = 'none';
      panel.style.display = 'none';
      return;
    }

    if (data.scope === 'ALL') {
      breadcrumb.style.display = 'none';
      panel.style.display = 'block';
      _renderCajaBySucursal(data.by_sucursal || []);
    } else if (data.scope) {
      panel.style.display = 'none';
      breadcrumb.style.display = 'flex';
      var label = document.getElementById('caja-scope-label');
      if (label) label.textContent = _branchLabel(data.scope);
    } else {
      breadcrumb.style.display = 'none';
      panel.style.display = 'none';
    }
  }

  /** M-2: desglose de turnos por sucursal (nivel 2). */
  function _renderCajaBySucursal(rows) {
    var wrap = document.getElementById('caja-by-sucursal-list');
    if (!wrap) return;
    if (!rows || !rows.length) {
      wrap.innerHTML = '<div style="color:var(--text-muted);font-size:0.76rem;padding:6px 0;">Sin turnos registrados en ninguna sucursal.</div>';
      return;
    }
    wrap.innerHTML = rows.map(function(r) {
      var label = _branchLabel(r.sucursal_id);
      var warn = r.con_diferencia > 0
        ? '<span style="color:var(--warning);font-weight:700;"><i class="fa-solid fa-triangle-exclamation"></i> ' + r.con_diferencia + ' con diferencia</span>'
        : '<span style="color:var(--text-muted);">Sin diferencias pendientes</span>';
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-app);cursor:pointer;" ' +
        'onclick="if(typeof cajaSelectSucursal===\'function\')cajaSelectSucursal(\'' + String(r.sucursal_id).replace(/'/g,"\\'") + '\')">' +
        '<div style="width:200px;flex-shrink:0;font-size:0.78rem;font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + label + '</div>' +
        '<div style="width:110px;flex-shrink:0;font-size:0.76rem;color:var(--text-muted);">' + r.total + ' turno(s)</div>' +
        '<div style="width:90px;flex-shrink:0;font-size:0.76rem;color:var(--text-muted);">' + r.abiertos + ' abierto(s)</div>' +
        '<div style="flex:1;font-size:0.76rem;">' + warn + '</div>' +
        '<i class="fa-solid fa-chevron-right" style="color:var(--text-muted);font-size:0.7rem;"></i>' +
        '</div>';
    }).join('');
  }

  /** Nivel 2 → 3: clic en una fila del desglose. */
  window.cajaSelectSucursal = function(sucursalId) {
    var sel = document.getElementById('caja-sucursal-filter');
    if (!sel) return;
    sel.value = sucursalId;
    window.cajaLoadHistorial();
  };

  /** Nivel 3 → 1: botón del breadcrumb. */
  window.cajaBackToAll = function() {
    var sel = document.getElementById('caja-sucursal-filter');
    if (!sel) return;
    sel.value = 'ALL';
    window.cajaLoadHistorial();
  };

  // Auto-inicializar cuando la página de caja se cargue
  window.cajaLoad();
};

window.pageInitHandlers['clientes']=function(){
window._clientsAll = [];
  window._clientsFilter = 'all';

  window.clientsSetFilter = function(el, filter) {
    document.querySelectorAll('#clients-filter-tabs .pill-tab').forEach(function(t){ t.classList.remove('active'); });
    el.classList.add('active');
    window._clientsFilter = filter;
    clientsRender();
  };

  window.clientsSearch = function(q) {
    window._clientsQuery = q.toLowerCase().trim();
    clientsRender();
  };

  window.clientsRender = function() {
    var items = window._clientsAll || [];
    var filter = window._clientsFilter || 'all';
    var q = window._clientsQuery || '';

    // Apply filter
    if (filter === 'credit') items = items.filter(function(c){ return Number(c.limite_credito||0) > 0; });
    else if (filter === 'deuda') items = items.filter(function(c){ return Number(c.saldo_actual||0) > 0; });
    else if (filter === 'saldo_favor') items = items.filter(function(c){ return Number(c.saldo_favor||0) > 0; });
    else if (filter === 'resguardos') items = items.filter(function(c){ return c.resguardos === true; });
    else if (filter === 'apartados') items = items.filter(function(c){ return Number(c.apartados||0) > 0; });

    // Apply search
    if (q) {
      items = items.filter(function(c){
        return (c.name||'').toLowerCase().includes(q) ||
               (c.rfc||'').toLowerCase().includes(q) ||
               (c.phone||'').includes(q) ||
               (c.whatsapp||'').includes(q) ||
               (c.email||'').toLowerCase().includes(q);
      });
    }

    var countEl = document.getElementById('clients-count');
    if (countEl) countEl.textContent = items.length + ' clientes';

    var container = document.getElementById('clients-table-body');
    if (!container) return;

    if (!items.length) {
      container.innerHTML = '<div class="empty-state" style="padding:40px;">' +
        '<div class="empty-icon"><i class="fa-solid fa-user-slash"></i></div>' +
        '<div class="empty-title">Sin resultados</div>' +
        '<div class="empty-desc">No se encontraron clientes con los filtros aplicados.</div>' +
        '</div>';
      return;
    }

    var rows = items.map(function(c) {
      var balance = Number(c.saldo_actual || 0);
      var favor   = Number(c.saldo_favor  || 0);
      var limit   = Number(c.limite_credito || 0);
      var tipo    = c.client_type || 'Público General';

      var balanceHtml = balance > 0
        ? '<span style="color:var(--danger);font-weight:700;">' + AdminAPI.fmtCurrency(balance) + '</span>'
        : '<span style="color:var(--text-muted);">—</span>';
      var favorHtml = favor > 0
        ? '<span style="color:var(--success);font-weight:600;">' + AdminAPI.fmtCurrency(favor) + '</span>'
        : '<span style="color:var(--text-muted);">—</span>';
      var limitHtml = limit > 0
        ? '<span>' + AdminAPI.fmtCurrency(limit) + '</span>' +
          (c.dias_credito ? ' <span class="td-muted">(' + c.dias_credito + 'd)</span>' : '')
        : '<span class="td-muted">Sin crédito</span>';
      var resguardoHtml = c.resguardos
        ? '<span style="background:rgba(99,102,241,0.15);color:var(--info);padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;">✓</span>'
        : '<span class="td-muted">—</span>';
      var apartadoHtml = Number(c.apartados||0) > 0
        ? '<span style="color:var(--warning);font-weight:600;">' + AdminAPI.fmtCurrency(Number(c.apartados)) + '</span>'
        : '<span class="td-muted">—</span>';

      return '<tr>' +
        '<td>' +
          '<div style="font-weight:600;color:var(--text-primary);">' + (c.name || '—') + '</div>' +
          (c.phone ? '<div class="td-muted" style="font-size:11px;margin-top:2px;"><i class="fa-solid fa-phone" style="font-size:9px;margin-right:3px;"></i>' + c.phone + '</div>' : '') +
        '</td>' +
        '<td class="td-mono">' + (c.rfc || '<span class="td-muted">—</span>') + '</td>' +
        '<td><span class="badge badge-neutral">' + tipo + '</span></td>' +
        '<td>' + limitHtml + '</td>' +
        '<td>' + balanceHtml + '</td>' +
        '<td>' + favorHtml + '</td>' +
        '<td>' + resguardoHtml + '</td>' +
        '<td>' + apartadoHtml + '</td>' +
        '<td style="text-align:right;">' +
          '<button class="btn btn-ghost btn-sm btn-icon" title="Editar" onclick="clientsEdit(\'' + c.id + '\')">' +
            '<i class="fa-solid fa-pen-to-square" style="font-size:12px;color:var(--brand-400);"></i>' +
          '</button>' +
          '<button class="btn btn-ghost btn-sm btn-icon" title="Ver Ledger" onclick="clientsLedger(\'' + c.id + '\',\'' + (c.name||'Cliente').replace(/'/g,"\\'") + '\')">' +
            '<i class="fa-solid fa-clock-rotate-left" style="font-size:12px;color:var(--info);"></i>' +
          '</button>' +
          (Number(c.apartados||0) > 0
            ? '<button class="btn btn-ghost btn-sm btn-icon" title="Ver Apartados" onclick="clientsApartados(\'' + c.id + '\',\'' + (c.name||'Cliente').replace(/'/g,"\\'") + '\')">' +
                '<i class="fa-solid fa-bookmark" style="font-size:12px;color:var(--warning);"></i>' +
              '</button>'
            : '') +
          '<button class="btn btn-ghost btn-sm btn-icon" title="Cambiar Estatus (El backend aún no soporta soft-delete/status)" disabled style="opacity:0.4;cursor:not-allowed;">' +
            '<i class="fa-solid fa-user-lock" style="font-size:12px;color:var(--danger);"></i>' +
          '</button>' +
        '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<table>' +
      '<thead><tr>' +
      '<th>Nombre / Teléfono</th><th>RFC</th><th>Tipo</th><th>Límite / Días</th><th>Saldo Deudor</th><th>Anticipos</th><th>Resguardo</th><th>Apartado</th><th style="text-align:right;">Acciones</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  };

  window.clientsEdit = function(id) {
    var c = (window._clientsAll || []).find(function(x){ return x.id === id; });
    if (!c) return;
    // Creación y edición usan el mismo formato (overlay + client-form.html)
    if (typeof window.clientsOpenForm === 'function') { window.clientsOpenForm('edit', c); return; }
    // Fallback: modal simple si el loader no está disponible
    var modal = document.getElementById('modal-editar-cliente');
    if (!modal) return;
    modal.querySelector('#edit-client-id').value         = c.id || '';
    modal.querySelector('#edit-client-name').value       = c.name || '';
    modal.querySelector('#edit-client-rfc').value        = c.rfc || '';
    modal.querySelector('#edit-client-type').value       = c.client_type || 'Público General';
    modal.querySelector('#edit-client-phone').value      = c.phone || '';
    modal.querySelector('#edit-client-whatsapp').value   = c.whatsapp || '';
    modal.querySelector('#edit-client-email').value      = c.email || '';
    modal.querySelector('#edit-client-limite').value     = c.limite_credito || 0;
    modal.querySelector('#edit-client-dias').value       = c.dias_credito || 30;
    modal.querySelector('#edit-client-direccion').value  = c.direccion || '';
    modal.querySelector('#edit-client-ciudad').value     = c.ciudad || '';
    modal.querySelector('#edit-client-estado').value     = c.estado || '';
    modal.querySelector('#edit-client-cp').value         = c.cp || '';
    openModal('modal-editar-cliente');
  };

  var _ledgerClientId = null;

  window.clientsLedger = function(id, name) {
    _ledgerClientId = id;
    var modal = document.getElementById('modal-ledger');
    if (!modal) return;
    var titleEl = modal.querySelector('#ledger-client-name');
    if (titleEl) titleEl.textContent = name;
    var body = modal.querySelector('#ledger-body');
    var balanceEl = document.getElementById('ledger-balance-display');
    if (body) {
      body.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">Cargando ledger...</div></div>';
    }
    openModal('modal-ledger');
    AdminAPI.apiFetch('/api/clients/' + id + '/ledger').then(function(data){
      var items = (data && data.entries) ? data.entries : (Array.isArray(data) ? data : []);
      var balance = (data && data.credit_balance !== undefined) ? Number(data.credit_balance) : 0;
      if (balanceEl) {
        balanceEl.textContent = 'Saldo a Favor: ' + AdminAPI.fmtCurrency(balance);
        balanceEl.style.display = balance > 0 ? 'block' : 'none';
      }
      if (!items.length) {
        body.innerHTML = '<div class="empty-state" style="padding:24px;"><div class="empty-icon"><i class="fa-solid fa-list"></i></div><div class="empty-title">Sin movimientos de crédito</div></div>';
        return;
      }
      var runningBal = 0;
      var rows = items.map(function(m){
        var amt = Number(m.amount || 0);
        if (m.transaction_type === 'CREDIT') runningBal += Math.abs(amt);
        else runningBal -= Math.abs(amt);
        var color = m.transaction_type === 'CREDIT' ? 'color:var(--success)' : 'color:var(--danger)';
        var sign  = m.transaction_type === 'CREDIT' ? '+' : '-';
        return '<tr>' +
          '<td class="td-muted">' + AdminAPI.fmtDate(m.created_at) + '</td>' +
          '<td><span class="badge ' + (m.transaction_type==='CREDIT' ? 'badge-success' : 'badge-danger') + '">' + (m.transaction_type||'—') + '</span></td>' +
          '<td style="font-weight:700;' + color + '">' + sign + AdminAPI.fmtCurrency(Math.abs(amt)) + '</td>' +
          '<td style="font-weight:700;">' + AdminAPI.fmtCurrency(Math.max(0, runningBal)) + '</td>' +
          '<td class="td-muted">' + (m.description||'—') + '</td>' +
          '</tr>';
      }).join('');
      body.innerHTML = '<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Saldo</th><th>Descripción</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }).catch(function(err){
      body.innerHTML = '<div class="empty-state" style="padding:24px;"><div class="empty-icon" style="color:var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i></div><div class="empty-title" style="color:var(--danger);">Error cargando ledger</div><div class="empty-desc">' + err.message + '</div></div>';
    });
  };

  window.clientsRegistrarAnticipoCRM = function() {
    var id = _ledgerClientId;
    if (!id) { (typeof showToast==='function' ? showToast : alert)('Sin cliente seleccionado'); return; }
    var amountRaw = parseFloat(document.getElementById('crm-anticipo-amount').value || '0');
    if (!amountRaw || amountRaw <= 0) { (typeof showToast==='function' ? showToast : alert)('Ingresa un monto válido'); return; }
    var method = document.getElementById('crm-anticipo-method').value || 'efectivo';
    var desc   = (document.getElementById('crm-anticipo-desc').value || '').trim() || null;
    AdminAPI.apiFetch('/api/clients/' + id + '/anticipo', {
      method: 'POST',
      body: JSON.stringify({ amount: amountRaw, payment_method: method, description: desc }),
    }).then(function(updatedClient){
      if (typeof showToast === 'function') showToast('Anticipo registrado ✓', 'success');
      document.getElementById('crm-anticipo-amount').value = '';
      document.getElementById('crm-anticipo-desc').value = '';
      var c = (window._clientsAll || []).find(function(x){ return x.id === id; });
      if (c) { c.saldo_favor = updatedClient.saldo_favor; clientsRender(); }
      window.clientsLedger(id, document.getElementById('ledger-client-name').textContent);
    }).catch(function(){ if (typeof showToast === 'function') showToast('Error de red', 'error'); });
  };

  var _crmAbonoLayawayId = null;
  var _crmAbonoClientId  = null;
  var _crmAbonoClientName = null;

  window.clientsApartados = function(id, name) {
    _crmAbonoClientId   = id;
    _crmAbonoClientName = name;
    var modal = document.getElementById('modal-apartados-crm');
    if (!modal) return;
    var titleEl = modal.querySelector('#apartados-crm-client-name');
    if (titleEl) titleEl.textContent = name;
    var body = modal.querySelector('#apartados-crm-body');
    if (body) {
      body.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">Cargando apartados...</div></div>';
    }
    openModal('modal-apartados-crm');
    AdminAPI.apiFetch('/api/layaways?client_id=' + encodeURIComponent(id)).then(function(data) {
      var items = Array.isArray(data) ? data : [];
      if (!items.length) {
        body.innerHTML = '<div class="empty-state" style="padding:24px;"><div class="empty-icon"><i class="fa-solid fa-bookmark"></i></div><div class="empty-title">Sin apartados registrados</div></div>';
        return;
      }
      var rows = items.map(function(a) {
        var total   = Number(a.total_amount || 0);
        var paid    = Number(a.amount_paid  || 0);
        var pending = Number(a.amount_pending || 0);
        var fecha   = a.created_at   ? AdminAPI.fmtDate(a.created_at)   : '—';
        var vence   = a.fecha_vencimiento ? AdminAPI.fmtDate(a.fecha_vencimiento) : '—';
        var nItems  = (a.items || []).length;
        var statusColor = a.status === 'ACTIVO'    ? 'var(--success)'
                        : a.status === 'COMPLETADO' ? 'var(--info)'
                        : 'var(--danger)';
        var abonarBtn = a.status === 'ACTIVO'
          ? '<button class="btn btn-ghost btn-sm" onclick="clientsAbonarFromCRM(\'' + a.id + '\',\'' + a.folio + '\',' + pending + ')">' +
              '<i class="fa-solid fa-circle-plus" style="color:var(--success);font-size:11px;"></i> Abonar' +
            '</button>'
          : '<span class="td-muted">—</span>';
        return '<tr>' +
          '<td class="td-mono">' + (a.folio || '—') + '</td>' +
          '<td><span style="font-weight:700;font-size:11px;color:' + statusColor + ';">' + a.status + '</span></td>' +
          '<td class="td-muted">' + nItems + ' art.</td>' +
          '<td class="td-muted">' + fecha + '</td>' +
          '<td class="td-muted">' + vence + '</td>' +
          '<td style="font-weight:600;">' + AdminAPI.fmtCurrency(total) + '</td>' +
          '<td style="color:var(--success);font-weight:600;">' + AdminAPI.fmtCurrency(paid) + '</td>' +
          '<td style="' + (pending > 0 ? 'color:var(--danger);font-weight:700;' : 'color:var(--text-muted);') + '">' + AdminAPI.fmtCurrency(pending) + '</td>' +
          '<td>' + abonarBtn + '</td>' +
        '</tr>';
      }).join('');
      body.innerHTML = '<table><thead><tr>' +
        '<th>Folio</th><th>Estado</th><th>Ítems</th><th>Fecha</th><th>Vencimiento</th>' +
        '<th>Total</th><th>Abonado</th><th>Pendiente</th><th style="text-align:right;">Acción</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }).catch(function(err) {
      body.innerHTML = '<div class="empty-state" style="padding:24px;"><div class="empty-icon" style="color:var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i></div><div class="empty-title" style="color:var(--danger);">Error al cargar apartados</div><div class="empty-desc">' + (err.message || '') + '</div></div>';
    });
  };

  window.clientsAbonarFromCRM = function(layawayId, folio, pending) {
    _crmAbonoLayawayId = layawayId;
    var modal = document.getElementById('modal-abono-crm');
    if (!modal) return;
    var titleEl = modal.querySelector('#abono-crm-folio');
    if (titleEl) titleEl.textContent = folio;
    var pendEl = modal.querySelector('#abono-crm-pendiente');
    if (pendEl) pendEl.textContent = AdminAPI.fmtCurrency(pending);
    var montoEl = modal.querySelector('#abono-crm-monto');
    if (montoEl) { montoEl.value = pending.toFixed(2); montoEl.max = pending.toFixed(2); }
    var metodoEl = modal.querySelector('#abono-crm-metodo');
    if (metodoEl) metodoEl.value = 'efectivo';
    openModal('modal-abono-crm');
  };

  window._submitAbonoFromCRM = function() {
    if (!_crmAbonoLayawayId) return;
    var monto = parseFloat(document.getElementById('abono-crm-monto').value || 0);
    if (!monto || monto <= 0) { alert('Ingresa un monto válido'); return; }
    var metodo = document.getElementById('abono-crm-metodo').value || 'efectivo';
    AdminAPI.apiFetch('/api/layaways/' + _crmAbonoLayawayId + '/payments', {
      method: 'POST',
      body: JSON.stringify({ amount: monto, payment_method: metodo }),
    }).then(function() {
      closeModal('modal-abono-crm');
      if (_crmAbonoClientId) clientsApartados(_crmAbonoClientId, _crmAbonoClientName || 'Cliente');
    }).catch(function(err) {
      alert('Error al registrar abono: ' + (err.message || 'Desconocido'));
    });
  };

  window.clientsExport = function() {
    var items = window._clientsAll || [];
    if (!items.length) return;
    
    function escapeCSV(val) {
      if (val === null || val === undefined) return '';
      var s = String(val);
      // CSV Injection Protection
      if (/^[=+\-@]/.test(s)) {
        s = "'" + s;
      }
      return '"' + s.replace(/"/g, '""') + '"';
    }

    var csv = 'Nombre,RFC,Tipo,Telefono,Email,Limite Credito,Saldo Deudor,Saldo a Favor,Resguardo,Apartado\n';
    items.forEach(function(c) {
      csv += [
        escapeCSV(c.name),
        escapeCSV(c.rfc),
        escapeCSV(c.client_type),
        escapeCSV(c.phone),
        escapeCSV(c.email),
        escapeCSV(c.limite_credito),
        escapeCSV(c.saldo_actual),
        escapeCSV(c.saldo_favor),
        escapeCSV(c.resguardos ? 'SI' : 'NO'),
        escapeCSV(c.apartados)
      ].join(',') + '\n';
    });

    var blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], {type:'text/csv;charset=utf-8;'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'clientes.csv'; a.click();
    URL.revokeObjectURL(url);
  };

window.clientsCreditToggle = function() {
    var toggle = document.getElementById('new-client-credito-toggle');
    var limite = document.getElementById('new-client-limite');
    var dias   = document.getElementById('new-client-dias');
    var active = toggle && toggle.value === 'si';
    if (limite) { limite.disabled = !active; limite.style.opacity = active ? '1' : '.5'; }
    if (dias)   { dias.disabled   = !active; dias.style.opacity   = active ? '1' : '.5'; }
  };

  window.clientsSave = async function() {
    // Validation
    var name = (document.getElementById('new-client-name').value || '').trim();
    var errEl = document.getElementById('new-client-error');
    var errMsg = document.getElementById('new-client-error-msg');
    var errName = document.getElementById('err-name');

    if (errEl) errEl.style.display = 'none';
    if (errName) errName.style.display = 'none';

    var rfc = (document.getElementById('new-client-rfc').value || '').trim().toUpperCase();
    var email = (document.getElementById('new-client-email').value || '').trim();
    var phone = (document.getElementById('new-client-phone').value || '').trim();
    var limit = Number(document.getElementById('new-client-limite').value || 0);
    var dias = Number(document.getElementById('new-client-dias').value || 30);
    var cp = (document.getElementById('new-client-cp').value || '').trim();

    if (!name) {
      if (errName) errName.style.display = 'block';
      document.getElementById('new-client-name').focus();
      return;
    }

    var validationErrors = [];
    if (rfc && rfc.length !== 12 && rfc.length !== 13) validationErrors.push('RFC debe tener 12 o 13 caracteres.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) validationErrors.push('Email inválido.');
    if (phone && !/^\d{10}$/.test(phone)) validationErrors.push('El teléfono debe tener 10 dígitos.');
    if (cp && !/^\d{5}$/.test(cp)) validationErrors.push('El CP debe tener 5 dígitos.');
    
    var creditActive = document.getElementById('new-client-credito-toggle').value === 'si';
    if (creditActive) {
      if (limit < 0) validationErrors.push('Límite de crédito no puede ser negativo.');
      if (dias < 0) validationErrors.push('Días de crédito no puede ser negativo.');
    }

    if (validationErrors.length > 0) {
      if (errEl) errEl.style.display = 'block';
      if (errMsg) errMsg.innerHTML = validationErrors.join('<br>');
      return;
    }

    var payload = {
      name:           name,
      rfc:            (document.getElementById('new-client-rfc').value || '').trim().toUpperCase() || null,
      client_type:    document.getElementById('new-client-type').value || 'Público General',
      regimen_fiscal: (document.getElementById('new-client-regimen').value || '').trim() || null,
      phone:          (document.getElementById('new-client-phone').value || '').trim() || null,
      whatsapp:       (document.getElementById('new-client-whatsapp').value || '').trim() || null,
      email:          (document.getElementById('new-client-email').value || '').trim() || null,
      limite_credito: creditActive ? Number(document.getElementById('new-client-limite').value || 0) : 0,
      dias_credito:   creditActive ? Number(document.getElementById('new-client-dias').value || 30) : 30,
      direccion:      (document.getElementById('new-client-direccion').value || '').trim() || null,
      ciudad:         (document.getElementById('new-client-ciudad').value || '').trim() || null,
      estado:         (document.getElementById('new-client-estado').value || '').trim() || null,
      cp:             (document.getElementById('new-client-cp').value || '').trim() || null,
      saldo_favor:    0,
      saldo_actual:   0,
      puntos:         0,
      resguardos:     false,
      apartados:      0,
      ultima_compra:  'S/N'
    };

    var btn = document.getElementById('btn-save-new-client');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...'; }

    try {
      var token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      var res = await fetch('/api/clients', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        var detail = 'Error ' + res.status;
        try { var body = await res.json(); detail = body.detail || JSON.stringify(body); } catch(e) {}
        throw new Error(detail);
      }

      // Success
      closeModal('modal-nuevo-cliente');
      // Reset form
      ['new-client-name','new-client-rfc','new-client-phone','new-client-whatsapp','new-client-email',
       'new-client-regimen','new-client-direccion','new-client-ciudad','new-client-estado','new-client-cp'].forEach(function(id){
        var el = document.getElementById(id); if (el) el.value = '';
      });
      document.getElementById('new-client-limite').value = '0';
      document.getElementById('new-client-dias').value = '30';
      document.getElementById('new-client-credito-toggle').value = 'no';
      clientsCreditToggle();
      // Reload table
      if (typeof loadClients === 'function') loadClients();

    } catch(err) {
      if (errEl) { errEl.style.display = 'block'; }
      if (errMsg) errMsg.textContent = err.message;
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Guardar Cliente'; }
    }
  };

  window.clientsUpdate = async function() {
    var id   = (document.getElementById('edit-client-id').value || '').trim();
    var name = (document.getElementById('edit-client-name').value || '').trim();
    var errEl  = document.getElementById('edit-client-error');
    var errMsg = document.getElementById('edit-client-error-msg');
    if (errEl) errEl.style.display = 'none';
    if (!name || !id) return;

    var rfc = (document.getElementById('edit-client-rfc').value || '').trim().toUpperCase();
    var email = (document.getElementById('edit-client-email').value || '').trim();
    var phone = (document.getElementById('edit-client-phone').value || '').trim();
    var limit = Number(document.getElementById('edit-client-limite').value || 0);
    var dias = Number(document.getElementById('edit-client-dias').value || 30);
    var cp = (document.getElementById('edit-client-cp').value || '').trim();

    var validationErrors = [];
    if (rfc && rfc.length !== 12 && rfc.length !== 13) validationErrors.push('RFC debe tener 12 o 13 caracteres.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) validationErrors.push('Email inválido.');
    if (phone && !/^\d{10}$/.test(phone)) validationErrors.push('El teléfono debe tener 10 dígitos.');
    if (cp && !/^\d{5}$/.test(cp)) validationErrors.push('El CP debe tener 5 dígitos.');
    if (limit < 0) validationErrors.push('Límite de crédito no puede ser negativo.');
    if (dias < 0) validationErrors.push('Días de crédito no puede ser negativo.');

    if (validationErrors.length > 0) {
      if (errEl) errEl.style.display = 'block';
      if (errMsg) errMsg.innerHTML = validationErrors.join('<br>');
      return;
    }

    var payload = {
      name:          name,
      rfc:           (document.getElementById('edit-client-rfc').value || '').trim().toUpperCase() || null,
      client_type:   document.getElementById('edit-client-type').value || 'Público General',
      phone:         (document.getElementById('edit-client-phone').value || '').trim() || null,
      whatsapp:      (document.getElementById('edit-client-whatsapp').value || '').trim() || null,
      email:         (document.getElementById('edit-client-email').value || '').trim() || null,
      limite_credito: Number(document.getElementById('edit-client-limite').value || 0),
      dias_credito:   Number(document.getElementById('edit-client-dias').value || 30),
      direccion:     (document.getElementById('edit-client-direccion').value || '').trim() || null,
      ciudad:        (document.getElementById('edit-client-ciudad').value || '').trim() || null,
      estado:        (document.getElementById('edit-client-estado').value || '').trim() || null,
      cp:            (document.getElementById('edit-client-cp').value || '').trim() || null
    };

    var btn = document.getElementById('btn-save-edit-client');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...'; }

    try {
      var token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      var res = await fetch('/api/clients/' + id, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        var detail = 'Error ' + res.status;
        try { var body = await res.json(); detail = body.detail || JSON.stringify(body); } catch(e) {}
        throw new Error(detail);
      }

      closeModal('modal-editar-cliente');
      if (typeof loadClients === 'function') loadClients();

    } catch(err) {
      if (errEl) errEl.style.display = 'block';
      if (errMsg) errMsg.textContent = err.message;
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Guardar Cambios'; }
    }
  };
};

window.pageInitHandlers['compras-cxp']=function(){
/* ================================================================
   compras-cxp.html — lógica de página
   Endpoints:
     GET  /api/accounts-payable              → lista de CxP
     GET  /api/accounts-payable/{id}         → detalle con pagos y factura
     GET  /api/accounts-payable/{id}/files/{file_id} → archivo XML/PDF
     POST /api/accounts-payable/{id}/pay     → aplicar pago
   ================================================================ */
(function () {
  'use strict';

  var _cxps        = [];   // cache de cuentas por pagar
  var _proveedores = [];   // cache de proveedores
  var _pagoActual  = null; // CxP abierta en modal de pago

  function getToken() {
    return sessionStorage.getItem('calebsys_token') ||
           localStorage.getItem('calebsys_token') || '';
  }
  function mxn(v) {
    return '$' + Number(v || 0).toLocaleString('es-MX', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }
  function fmtFecha(iso) {
    return iso ? new Date(iso).toLocaleDateString('es-MX') : '—';
  }
  function fmtFechaHora(iso) {
    return iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function totalCxp(c) {
    return c && c.total != null ? Number(c.total) : Number((c && c.amount) || 0);
  }
  function saldoCxp(c) {
    return c && c.balance != null ? Number(c.balance) : totalCxp(c);
  }
  function provNombreCxp(c) {
    return (c && c.supplier_name) || provNombre(c && c.supplier_id);
  }

  function provNombre(id) {
    var p = _proveedores.find(function (x) { return x.id === id; });
    return p ? p.name : (id || '—');
  }

  function estadoBadge(s) {
    var labels = { PENDING:'Pendiente', PARTIAL:'Parcial', PAID:'Pagada', CANCELLED:'Cancelada' };
    var colors  = {
      PENDING:   'var(--color-warning)',
      PARTIAL:   'var(--color-info,#3b82f6)',
      PAID:      'var(--color-success)',
      CANCELLED: 'var(--color-text-muted)'
    };
    return '<span style="color:' + (colors[s] || 'inherit') + ';font-weight:600;">' +
           (labels[s] || s) + '</span>';
  }

  function esVencida(cxp) {
    if (!cxp || !cxp.due_date || cxp.status === 'PAID' || cxp.status === 'CANCELLED') return false;
    var dueDay = new Date(cxp.due_date).toLocaleDateString('en-CA');
    var today  = new Date().toLocaleDateString('en-CA');
    return Boolean(dueDay && dueDay < today);
  }

  /* ── CARGA CATÁLOGOS ── */
  async function cargarProveedores() {
    try {
      var r = await fetch('/api/suppliers?limit=200', {
        headers: { 'Authorization': 'Bearer ' + getToken() }
      });
      if (r.ok) _proveedores = await r.json();
    } catch (e) { /* silencioso */ }
  }

  /* ── CARGA PRINCIPAL ── */
  window.cxpCargar = async function () {
    var tbody = document.getElementById('cxp-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:32px;">' +
      '<i class="fa-solid fa-spinner fa-spin"></i> Cargando…</td></tr>';
    try {
      var r = await fetch('/api/accounts-payable?limit=500', {
        headers: { 'Authorization': 'Bearer ' + getToken() }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _cxps = await r.json();
      cxpActualizarKPIs();
      cxpFiltrar();
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:32px;' +
        'color:var(--color-danger);"><i class="fa-solid fa-triangle-exclamation"></i> ' +
        esc(e.message) + '</td></tr>';
    }
  };

  /* ── KPIs ── */
  function cxpActualizarKPIs() {
    var pending = _cxps.filter(function (c) { return c.status === 'PENDING'; });
    var partial = _cxps.filter(function (c) { return c.status === 'PARTIAL'; });
    var paid    = _cxps.filter(function (c) { return c.status === 'PAID'; });
    var adeudo  = pending.concat(partial).reduce(function (s, c) {
      return s + saldoCxp(c);
    }, 0);
    document.getElementById('cxp-kpi-pending').textContent = pending.length;
    document.getElementById('cxp-kpi-partial').textContent = partial.length;
    document.getElementById('cxp-kpi-paid').textContent    = paid.length;
    document.getElementById('cxp-kpi-total').textContent   = mxn(adeudo);
  }

  /* ── FILTRO ── */
  window.cxpFiltrar = function () {
    var q    = (document.getElementById('cxp-search').value || '').toLowerCase();
    var st   = document.getElementById('cxp-filter-status').value;
    var from = document.getElementById('cxp-filter-from').value;
    var to   = document.getElementById('cxp-filter-to').value;

    var lista = _cxps.filter(function (c) {
      var matchQ  = !q  || (c.folio||'').toLowerCase().includes(q)
                        || (c.invoice_uuid||'').toLowerCase().includes(q)
                        || (c.invoice_ref||'').toLowerCase().includes(q)
                        || (c.receipt_folio||'').toLowerCase().includes(q)
                        || provNombreCxp(c).toLowerCase().includes(q);
      var matchSt = !st || c.status === st;
      var dueDay  = c.due_date ? new Date(c.due_date).toLocaleDateString('en-CA') : '';
      var matchF  = !from || (dueDay && dueDay >= from);
      var matchT  = !to   || (dueDay && dueDay <= to);
      return matchQ && matchSt && matchF && matchT;
    });
    cxpRenderTabla(lista);
  };

  /* ── TABLA ── */
  function cxpRenderTabla(lista) {
    var tbody = document.getElementById('cxp-tbody');
    if (!tbody) return;
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:32px;' +
        'color:var(--color-text-muted);">Sin cuentas por pagar que coincidan</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(function (c) {
      var vencida = esVencida(c);
      var rowStyle = vencida ? 'style="background:rgba(239,68,68,.05);"' : '';
      var dueCell  = vencida
        ? '<span style="color:var(--color-danger);font-weight:600;">' + fmtFecha(c.due_date) +
          ' <i class="fa-solid fa-triangle-exclamation" title="Vencida"></i></span>'
        : fmtFecha(c.due_date);

      var acciones = '';
      if (c.status === 'PENDING' || c.status === 'PARTIAL') {
        acciones += '<button type="button" class="btn btn-ghost btn-xs" title="Aplicar pago" ' +
          'data-click="cxpAbrirPago" data-click-arg="' + esc(c.id) + '"><i class="fa-solid fa-money-bill-wave"></i></button>';
      }
      acciones += '<button type="button" class="btn btn-ghost btn-xs" title="Ver factura y detalle" ' +
        'data-click="cxpVerDetalle" data-click-arg="' + esc(c.id) + '"><i class="fa-solid fa-eye"></i></button>';

      var tipo = c.concept === 'FLETE'
        ? ' <span title="Cuenta por pagar de flete / traslado" style="font-size:10px;font-weight:700;color:#b45309;">FLETE</span>'
        : '';
      var fiscal = c.invoice_uuid
        ? '<div style="font-family:monospace;font-size:11px;word-break:break-all;max-width:240px;font-weight:600;" title="Folio fiscal (UUID)">' + esc(c.invoice_uuid) + '</div>' +
          (c.invoice_ref ? '<small style="color:var(--color-text-muted);">Factura: ' + esc(c.invoice_ref) + '</small>' : '')
        : (c.invoice_ref ? '<div><strong>Factura ' + esc(c.invoice_ref) + '</strong></div>' : '—');
      var recep = (c.receipt_date || c.receipt_folio)
        ? '<div>' + fmtFecha(c.receipt_date) + '</div>' +
          (c.receipt_folio ? '<small style="color:var(--color-text-muted);">Recepción: ' + esc(c.receipt_folio) + '</small>' : '')
        : '—';
      return '<tr ' + rowStyle + '>' +
        '<td><strong>' + esc(c.folio || '—') + '</strong>' + tipo + '</td>' +
        '<td><div>' + esc(provNombreCxp(c)) + '</div>' +
          (c.supplier_rfc ? '<small style="color:var(--color-text-muted);">' + esc(c.supplier_rfc) + '</small>' : '') + '</td>' +
        '<td>' + fiscal + '</td>' +
        '<td>' + recep + '</td>' +
        '<td>' + fmtFecha(c.issue_date) + '</td>' +
        '<td>' + dueCell + '</td>' +
        '<td style="text-align:right;">' + mxn(totalCxp(c)) + '</td>' +
        '<td style="text-align:right;font-weight:600;color:var(--color-danger);">' +
          mxn(saldoCxp(c)) + '</td>' +
        '<td>' + estadoBadge(c.status) + '</td>' +
        '<td style="white-space:nowrap;">' + acciones + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ── MODAL PAGO ── */
  window.cxpAbrirPago = function (id) {
    _pagoActual = _cxps.find(function (c) { return c.id === id; });
    if (!_pagoActual) return;

    var c = _pagoActual;
    var tot   = totalCxp(c);
    var saldo = saldoCxp(c);

    document.getElementById('cxp-pago-id').value          = c.id;
    document.getElementById('cxp-pago-title').textContent = 'Aplicar Pago — ' + (c.folio || id);
    document.getElementById('cxp-info-supplier').textContent = provNombreCxp(c);
    document.getElementById('cxp-info-due').textContent      = fmtFecha(c.due_date);
    document.getElementById('cxp-info-total').textContent    = mxn(tot);
    document.getElementById('cxp-info-balance').textContent  = mxn(saldo);
    document.getElementById('cxp-monto').value              = saldo.toFixed(2);
    document.getElementById('cxp-metodo').value             = 'TRANSFER';
    document.getElementById('cxp-fecha-pago').value         =
      new Date().toISOString().split('T')[0];
    document.getElementById('cxp-referencia').value         = '';
    document.getElementById('cxp-pago-notas').value        = '';
    document.getElementById('cxp-pago-error').style.display = 'none';
    cxpActualizarMontoPago();
    document.getElementById('modal-cxp-pago').style.display = 'flex';
  };

  window.cxpActualizarMontoPago = function () {
    if (!_pagoActual) return;
    var saldo  = saldoCxp(_pagoActual);
    var monto  = parseFloat(document.getElementById('cxp-monto').value) || 0;
    var el     = document.getElementById('cxp-pago-indicator');
    if (monto <= 0) {
      el.textContent = ''; return;
    }
    if (Math.abs(monto - saldo) < 0.01) {
      el.innerHTML = '<span style="color:var(--color-success);">' +
        '<i class="fa-solid fa-circle-check"></i> Pago total — cerrará la CxP</span>';
    } else if (monto < saldo) {
      el.innerHTML = '<span style="color:var(--color-info,#3b82f6);">' +
        '<i class="fa-solid fa-info-circle"></i> Pago parcial — saldo restante: ' +
        mxn(saldo - monto) + '</span>';
    } else {
      el.innerHTML = '<span style="color:var(--color-danger);">' +
        '<i class="fa-solid fa-triangle-exclamation"></i> El monto supera el saldo</span>';
    }
  };

  window.cxpCerrarPago = function () {
    document.getElementById('modal-cxp-pago').style.display = 'none';
    _pagoActual = null;
  };

  /* ── APLICAR PAGO (POST) ── */
  window.cxpAplicarPago = async function () {
    var id     = document.getElementById('cxp-pago-id').value;
    var monto  = parseFloat(document.getElementById('cxp-monto').value) || 0;
    var saldo  = _pagoActual ? saldoCxp(_pagoActual) : 0;

    if (monto <= 0)      { cxpPagoError('El monto debe ser mayor a cero.'); return; }
    if (monto > saldo + 0.01) { cxpPagoError('El monto supera el saldo pendiente (' + mxn(saldo) + ').'); return; }

    var payload = {
      amount:         monto,
      payment_method: document.getElementById('cxp-metodo').value,
      payment_date:   document.getElementById('cxp-fecha-pago').value || null,
      reference:      document.getElementById('cxp-referencia').value.trim() || null,
      notes:          document.getElementById('cxp-pago-notas').value.trim() || null
    };

    var btn = document.getElementById('cxp-btn-pagar');
    btn.disabled = true;
    try {
      var r = await fetch('/api/accounts-payable/' + id + '/pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + getToken()
        },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        var e = await r.json();
        throw new Error(e.detail || 'Error ' + r.status);
      }
      cxpCerrarPago();
      cxpCargar();
    } catch (e) {
      cxpPagoError(e.message);
    } finally {
      btn.disabled = false;
    }
  };

  function cxpPagoError(msg) {
    var el = document.getElementById('cxp-pago-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  /* ── MODAL DETALLE + VISOR DE FACTURA ── */
  var _cxpUrls = [];   // blob: URLs abiertas por el visor (se liberan al cerrar)
  function cxpLimpiarUrls() {
    _cxpUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } });
    _cxpUrls = [];
  }
  async function cxpFetchArchivo(apId, fileId, download) {
    var r = await fetch('/api/accounts-payable/' + apId + '/files/' + fileId + (download ? '?download=true' : ''), {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    });
    if (!r.ok) {
      var msg = 'HTTP ' + r.status;
      try { var j = await r.json(); msg = j.detail || msg; } catch (e) { /* noop */ }
      throw new Error(msg);
    }
    return r.blob();
  }
  function cxpEsPdf(f) { return /pdf/i.test(f.mime || '') || /\.pdf$/i.test(f.filename || ''); }

  function cxpFacturaHtml(d) {
    var inv = d.invoice;
    if (!inv) {
      return '<div style="padding:14px;color:var(--color-text-muted);font-size:13px;"><i class="fa-solid fa-circle-info"></i> ' +
        'Esta cuenta no tiene una factura digital vinculada (se capturó fuera de Recepción de Mercancía).</div>';
    }
    var cons = (inv.conceptos || []);
    var filas = cons.map(function (c) {
      var imp = c.importe != null ? c.importe : (Number(c.cantidad || 0) * Number(c.valor_unitario || 0));
      return '<tr><td>' + esc(c.codigo || '') + '</td><td>' + esc(c.descripcion || '') + '</td>' +
        '<td style="text-align:right;">' + Number(c.cantidad || 0) + '</td>' +
        '<td style="text-align:right;">' + mxn(c.valor_unitario) + '</td>' +
        '<td style="text-align:right;">' + mxn(imp) + '</td></tr>';
    }).join('');
    var tot = inv.tipo === 'FLETE'
      ? '<div style="text-align:right;margin-top:6px;"><strong>Total: ' + mxn(inv.total) + '</strong></div>'
      : '<div style="text-align:right;margin-top:6px;font-size:13px;">Subtotal ' + mxn(inv.subtotal) + ' · IVA ' + mxn(inv.iva) +
        ' · <strong>Total ' + mxn(inv.total) + '</strong></div>';
    return '<div style="background:var(--color-surface-alt,rgba(0,0,0,.03));border:1px solid var(--color-border,#e2e8f0);border-radius:8px;padding:12px;margin-bottom:10px;">' +
      '<div style="font-size:13px;display:grid;grid-template-columns:repeat(2,1fr);gap:6px 16px;margin-bottom:8px;">' +
      '<div><strong>Folio fiscal (UUID):</strong> <span style="font-family:monospace;font-size:12px;">' + esc(inv.uuid || '—') + '</span></div>' +
      '<div><strong>Serie / Folio:</strong> ' + esc(inv.serie_folio || '—') + '</div>' +
      '<div><strong>Día / Fecha de emisión:</strong> ' + (inv.fecha ? fmtFechaHora(inv.fecha) : '—') + '</div>' +
      '<div><strong>Método / Forma de pago:</strong> ' + esc((inv.metodo_pago || '—') + ' / ' + (inv.forma_pago || '—')) + '</div></div>' +
      (cons.length
        ? '<div style="max-height:240px;overflow:auto;border:1px solid var(--color-border,#e2e8f0);border-radius:6px;background:#fff;">' +
          '<table class="data-table" style="font-size:12px;"><thead><tr><th>Código</th><th>Descripción</th>' +
          '<th style="text-align:right;">Cant.</th><th style="text-align:right;">V. unitario</th><th style="text-align:right;">Importe</th></tr></thead>' +
          '<tbody>' + filas + '</tbody></table></div>' : '') + tot + '</div>';
  }

  window.cxpMostrarArchivo = async function (apId, fileId) {
    var host = document.getElementById('cxp-det-visor');
    if (!host) return;
    var d = window.__cxpDetActual;
    var f = d && (d.invoice_files || []).find(function (x) { return x.id === fileId; });
    if (!f) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-cxp-file]'), function (b) {
      b.style.outline = b.getAttribute('data-cxp-file') === fileId ? '2px solid var(--color-primary,#2563eb)' : '';
    });
    host.innerHTML = '<div style="padding:24px;text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Abriendo ' + esc(f.filename) + '…</div>';
    try {
      var blob = await cxpFetchArchivo(apId, fileId, false);
      if (cxpEsPdf(f)) {
        var u = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        _cxpUrls.push(u);
        host.innerHTML = cxpFacturaHtml(d) +
          '<iframe src="' + u + '" title="' + esc(f.filename) + '" ' +
          'style="width:100%;height:65vh;min-height:420px;border:1px solid var(--color-border,#e2e8f0);border-radius:8px;background:#fff;"></iframe>';
      } else {
        var txt = await blob.text();
        host.innerHTML = cxpFacturaHtml(d) +
          '<details open style="margin-top:8px;"><summary style="cursor:pointer;font-weight:600;font-size:13px;">XML CFDI (' + esc(f.filename) + ')</summary>' +
          '<pre style="max-height:320px;overflow:auto;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;font-size:11.5px;white-space:pre-wrap;word-break:break-all;margin-top:6px;">' +
          esc(txt.length > 80000 ? txt.slice(0, 80000) + '\n… (recortado)' : txt) + '</pre></details>';
      }
    } catch (e) {
      host.innerHTML = cxpFacturaHtml(d) +
        '<div style="padding:14px;color:var(--color-danger);">No se pudo abrir el archivo: ' + esc(e.message) + '</div>';
    }
  };

  window.cxpDescargarArchivo = async function (apId, fileId) {
    var d = window.__cxpDetActual;
    var f = d && (d.invoice_files || []).find(function (x) { return x.id === fileId; });
    try {
      var blob = await cxpFetchArchivo(apId, fileId, true);
      var u = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = u; a.download = (f && f.filename) || 'factura';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    } catch (e) { alert('No se pudo descargar: ' + e.message); }
  };

  window.cxpVerDetalle = async function (id) {
    var c = _cxps.find(function (x) { return x.id === id; });
    cxpLimpiarUrls();
    document.getElementById('cxp-det-title').textContent =
      'Cuenta por pagar — ' + ((c && c.folio) || id);
    document.getElementById('cxp-det-body').innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Cargando…';
    document.getElementById('modal-cxp-detalle').style.display = 'flex';

    try {
      var r = await fetch('/api/accounts-payable/' + id, {
        headers: { 'Authorization': 'Bearer ' + getToken() }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      window.__cxpDetActual = d;
      var tot = totalCxp(d);
      var saldo = saldoCxp(d);
      var vencida = esVencida(d);

      var pagosHtml;
      if (d.payments && d.payments.length) {
        pagosHtml = '<div style="margin-top:14px;">' +
          '<div style="font-weight:600;font-size:13px;margin-bottom:6px;">Pagos aplicados</div>' +
          '<table class="data-table" style="font-size:13px;">' +
          '<thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th>' +
          '<th style="text-align:right;">Monto</th></tr></thead><tbody>' +
          d.payments.map(function (p) {
            return '<tr><td>' + fmtFecha(p.payment_date) + '</td>' +
              '<td>' + esc(p.payment_method || '—') + '</td>' +
              '<td>' + esc(p.reference || '—') + '</td>' +
              '<td style="text-align:right;color:var(--color-success);">' + mxn(p.amount) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      } else {
        pagosHtml = '<div style="margin-top:14px;color:var(--color-text-muted);font-size:13px;">' +
          '<i class="fa-solid fa-circle-info"></i> Sin pagos aplicados aún.</div>';
      }

      function kv(label, val, raw) {
        return '<div><div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.03em;">' + label + '</div>' +
          '<div style="font-size:13px;font-weight:600;">' + (raw ? val : esc(val == null || val === '' ? '—' : val)) + '</div></div>';
      }
      var files = d.invoice_files || [];
      var barra = files.length
        ? files.map(function (f) {
            var pdf = cxpEsPdf(f);
            return '<span style="display:inline-flex;gap:4px;margin:0 8px 6px 0;">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-cxp-file="' + esc(f.id) + '" ' +
              'data-click="cxpMostrarArchivo" data-click-arg="' + esc(d.id) + '" data-click-arg2="' + esc(f.id) + '">' +
              (pdf ? '<i class="fa-solid fa-file-pdf"></i> Ver PDF' : '<i class="fa-solid fa-file-code"></i> Ver XML') + ' · ' + esc(f.filename) + '</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" title="Descargar" ' +
              'data-click="cxpDescargarArchivo" data-click-arg="' + esc(d.id) + '" data-click-arg2="' + esc(f.id) + '">' +
              '<i class="fa-solid fa-download"></i></button></span>';
          }).join('')
        : '<span style="font-size:13px;color:var(--color-text-muted);">No hay XML/PDF adjunto a esta cuenta.</span>';

      document.getElementById('cxp-det-body').innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px 16px;margin-bottom:12px;">' +
        kv('Folio de seguimiento (CxP)', d.folio) +
        kv('Estado', estadoBadge(d.status), true) +
        kv('Concepto', d.concept === 'FLETE' ? 'Flete / traslado' : (d.concept === 'MANUAL' ? 'Captura manual' : 'Mercancía')) +
        kv('Proveedor', (d.supplier_name || provNombre(d.supplier_id)) + (d.supplier_rfc ? ' · ' + d.supplier_rfc : '')) +
        kv('Folio fiscal (UUID)', '<span style="font-family:monospace;font-size:11.5px;word-break:break-all;">' + esc(d.invoice_uuid || '—') + '</span>', true) +
        kv('Serie / Folio de factura', d.invoice_ref) +
        kv('Folio de recepción', d.receipt_folio) +
        kv('Fecha de recepción', fmtFechaHora(d.receipt_date)) +
        kv('Día de emisión', d.issue_date ? fmtFechaHora(d.issue_date) : '—') +
        kv('Fecha de vencimiento', (vencida ? '<span style="color:var(--color-danger);">' + fmtFecha(d.due_date) + ' ⚠️ vencida</span>' : fmtFecha(d.due_date)) +
          (d.credit_days != null ? ' <small style="color:var(--color-text-muted);font-weight:400;">(' + d.credit_days + ' días de crédito)</small>' : ''), true) +
        kv('Total', mxn(tot)) +
        kv('Saldo pendiente', '<span style="color:var(--color-danger);font-weight:700;">' + mxn(saldo) + '</span>', true) +
        '</div>' +
        '<div style="border-top:1px solid var(--color-border,#e2e8f0);padding-top:10px;">' +
        '<div style="font-weight:600;font-size:13px;margin-bottom:6px;"><i class="fa-solid fa-file-invoice"></i> Factura para visualizar</div>' +
        '<div>' + barra + '</div>' +
        '<div id="cxp-det-visor" style="margin-top:6px;"></div></div>' + pagosHtml;

      var primero = files.find(cxpEsPdf) || files[0];
      if (primero) { cxpMostrarArchivo(d.id, primero.id); }
      else { document.getElementById('cxp-det-visor').innerHTML = cxpFacturaHtml(d); }
    } catch (e) {
      document.getElementById('cxp-det-body').innerHTML =
        '<span style="color:var(--color-danger);">' + esc(e.message) + '</span>';
    }
  };

  window.cxpCerrarDetalle = function () {
    cxpLimpiarUrls();
    document.getElementById('modal-cxp-detalle').style.display = 'none';
  };

  /* ── INIT ── */
  (async function init() {
    await cargarProveedores();
    cxpCargar();
  })();
})();
};

window.pageInitHandlers['compras-ordenes']=function(){
/* ================================================================
   compras-ordenes.html — lógica de página
   Endpoints: GET/POST /api/purchase-orders
              PUT  /api/purchase-orders/{id}         ← D-05 edición inline
              POST /api/purchase-orders/{id}/send
              POST /api/purchase-orders/{id}/cancel
   ================================================================ */
(function() {
  var _ordenes     = [];   // cache de OC
  var _proveedores = [];   // cache de proveedores para el select
  var _items       = [];   // ítems del modal de nueva OC
  var _editingId   = null; // null = nueva OC; string = id de OC en edición (D-05)
  var IVA          = 0.16;

  function getToken() {
    return sessionStorage.getItem('calebsys_token') || localStorage.getItem('calebsys_token') || '';
  }
  function mxn(v) { return '$' + Number(v||0).toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2}); }

  /* Mapa rápido id→name de proveedores */
  function provNombre(id) {
    var p = _proveedores.find(function(x){ return x.id === id; });
    return p ? p.name : id;
  }

  /* Etiqueta y color de estado */
  function estadoBadge(s) {
    var map = {
      DRAFT:'Borrador', SENT:'Enviada', PARTIAL:'Parcial',
      COMPLETED:'Completada', CANCELLED:'Cancelada'
    };
    var col = { DRAFT:'var(--color-text-muted)', SENT:'var(--color-warning)',
                PARTIAL:'var(--color-info,#3b82f6)', COMPLETED:'var(--color-success)',
                CANCELLED:'var(--color-danger)' };
    return '<span style="color:' + (col[s]||'inherit') + ';font-weight:600;">' + (map[s]||s) + '</span>';
  }

  /* Carga proveedores (para poblar el select) */
  async function cargarProveedores() {
    try {
      var r = await fetch('/api/suppliers?limit=200', { headers: { 'Authorization': 'Bearer ' + getToken() } });
      if (r.ok) _proveedores = await r.json();
    } catch(e) { /* silencioso */ }
  }

  /* Carga y renderiza las órdenes de compra */
  window.ocCargar = async function() {
    var tbody = document.getElementById('oc-tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</td></tr>';
    try {
      var r = await fetch('/api/purchase-orders?limit=200', { headers: { 'Authorization': 'Bearer ' + getToken() } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _ordenes = await r.json();
      ocActualizarKPIs();
      ocFiltrar();
    } catch(e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--color-danger);"><i class="fa-solid fa-triangle-exclamation"></i> ' + e.message + '</td></tr>';
    }
  };

  function ocActualizarKPIs() {
    ['DRAFT','SENT','PARTIAL','COMPLETED'].forEach(function(s, i) {
      var ids = ['oc-kpi-draft','oc-kpi-sent','oc-kpi-partial','oc-kpi-done'];
      document.getElementById(ids[i]).textContent = _ordenes.filter(function(o){ return o.status===s; }).length;
    });
  }

  window.ocFiltrar = function() {
    var q = document.getElementById('oc-search').value.toLowerCase();
    var s = document.getElementById('oc-filter-status').value;
    var lista = _ordenes.filter(function(o) {
      var matchQ = !q || (o.folio||'').toLowerCase().includes(q) || provNombre(o.supplier_id).toLowerCase().includes(q);
      var matchS = !s || o.status === s;
      return matchQ && matchS;
    });
    ocRenderTabla(lista);
  };

  function ocRenderTabla(lista) {
    var tbody = document.getElementById('oc-tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--color-text-muted);">Sin órdenes que coincidan</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(function(o) {
      var fecha = o.issue_date ? new Date(o.issue_date).toLocaleDateString('es-MX') : '—';
      var acciones = '';
      if (o.status === 'DRAFT') {
        acciones += '<button class="btn btn-ghost btn-xs" title="Editar" onclick="ocEditar(' + "'" + o.id + "'" + ')"><i class="fa-solid fa-pen-to-square"></i></button>';
        acciones += '<button class="btn btn-ghost btn-xs" title="Enviar" onclick="ocEnviar(' + "'" + o.id + "'" + ')"><i class="fa-solid fa-paper-plane"></i></button>';
        acciones += '<button class="btn btn-ghost btn-xs" title="Cancelar" onclick="ocCancelar(' + "'" + o.id + "'" + ')"><i class="fa-solid fa-ban"></i></button>';
      }
      acciones += '<button class="btn btn-ghost btn-xs" title="Detalle" onclick="ocVerDetalle(' + "'" + o.id + "'" + ')"><i class="fa-solid fa-eye"></i></button>';
      return '<tr>' +
        '<td><strong>' + (o.folio||'—') + '</strong></td>' +
        '<td>' + provNombre(o.supplier_id) + '</td>' +
        '<td>' + fecha + '</td>' +
        '<td style="text-align:right;">' + mxn(o.total) + '</td>' +
        '<td>' + estadoBadge(o.status) + '</td>' +
        '<td style="white-space:nowrap;">' + acciones + '</td>' +
        '</tr>';
    }).join('');
  }

  /* === MODAL NUEVA OC === */
  window.ocNueva = async function() {
    _items = [];
    if (!_proveedores.length) await cargarProveedores();
    // Llenar select de proveedores
    var sel = document.getElementById('oc-supplier-id');
    sel.innerHTML = '<option value="">— Selecciona proveedor —</option>' +
      _proveedores.filter(function(p){ return p.status==='ACTIVE'; }).map(function(p) {
        return '<option value="' + p.id + '">' + p.name + '</option>';
      }).join('');
    document.getElementById('oc-expected-date').value = '';
    document.getElementById('oc-notes').value          = '';
    document.getElementById('oc-modal-error').style.display = 'none';
    ocRenderItems();
    document.getElementById('modal-oc').style.display = 'flex';
  };

  window.ocCerrarModal = function() {
    document.getElementById('modal-oc').style.display = 'none';
    _editingId = null;
    document.querySelector('#modal-oc .modal-title').textContent = 'Nueva Orden de Compra';
    document.getElementById('oc-btn-guardar').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Borrador';
  };

  /* Agrega una fila vacía de ítem al modal */
  window.ocAgregarItem = function() {
    _items.push({ sku:'', description:'', quantity_ordered:1, unit_cost:0 });
    ocRenderItems();
  };

  /* Elimina un ítem por índice */
  window.ocEliminarItem = function(i) { _items.splice(i,1); ocRenderItems(); };

  /* Actualiza campo de un ítem y recalcula totales.
     NO re-renderiza la tabla: rehacer el innerHTML en cada tecla destruye el
     <input> activo y el campo pierde el foco tras el primer carácter — por eso
     "no reconocía" los ítems. Sólo se refresca el subtotal de la fila y los
     totales; el re-render completo queda para agregar/eliminar filas. */
  window.ocItemChange = function(i, campo, val) {
    if (!_items[i]) return;
    _items[i][campo] = (campo==='quantity_ordered'||campo==='unit_cost') ? (parseFloat(val)||0) : val;
    var sub  = (_items[i].quantity_ordered||0) * (_items[i].unit_cost||0);
    var cell = document.getElementById('oc-item-sub-' + i);
    if (cell) cell.textContent = mxn(sub);
    var subtotal = _items.reduce(function(s,it){ return s + (it.quantity_ordered||0)*(it.unit_cost||0); }, 0);
    ocActualizarTotales(subtotal);
  };

  function ocRenderItems() {
    var tbody = document.getElementById('oc-items-tbody');
    if (!_items.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--color-text-muted);">Agrega al menos un ítem</td></tr>';
      ocActualizarTotales(0);
      return;
    }
    var subtotal = 0;
    tbody.innerHTML = _items.map(function(it, i) {
      var sub = (it.quantity_ordered||0) * (it.unit_cost||0);
      subtotal += sub;
      return '<tr>' +
        '<td><input class="form-input form-input-sm" value="' + it.sku + '" placeholder="SKU" oninput="ocItemChange(' + i + ",'" + 'sku' + "'," + 'this.value)"></td>' +
        '<td><input class="form-input form-input-sm" value="' + it.description + '" placeholder="Descripción" oninput="ocItemChange(' + i + ",'" + 'description' + "'," + 'this.value)"></td>' +
        '<td><input type="number" class="form-input form-input-sm" value="' + it.quantity_ordered + '" min="0.01" step="0.01" oninput="ocItemChange(' + i + ",'" + 'quantity_ordered' + "'," + 'this.value)"></td>' +
        '<td><input type="number" class="form-input form-input-sm" value="' + it.unit_cost + '" min="0" step="0.01" oninput="ocItemChange(' + i + ",'" + 'unit_cost' + "'," + 'this.value)"></td>' +
        '<td id="oc-item-sub-' + i + '" style="text-align:right;">' + mxn(sub) + '</td>' +
        '<td><button class="btn btn-ghost btn-xs" onclick="ocEliminarItem(' + i + ')"><i class="fa-solid fa-trash"></i></button></td>' +
        '</tr>';
    }).join('');
    ocActualizarTotales(subtotal);
  }

  function ocActualizarTotales(subtotal) {
    var tax   = subtotal * IVA;
    var total = subtotal + tax;
    document.getElementById('oc-subtotal-display').textContent = mxn(subtotal);
    document.getElementById('oc-tax-display').textContent      = mxn(tax);
    document.getElementById('oc-total-display').textContent    = mxn(total);
  }

  /* Guarda la OC como DRAFT */
  window.ocGuardar = async function() {
    var supplier_id = document.getElementById('oc-supplier-id').value;
    if (!supplier_id) { ocMostrarError('Selecciona un proveedor.'); return; }
    if (!_items.length) { ocMostrarError('Agrega al menos un ítem.'); return; }
    var itmInvalidos = _items.filter(function(it){ return !it.sku || it.quantity_ordered <= 0; });
    if (itmInvalidos.length) { ocMostrarError('Completa SKU y cantidad en todos los ítems.'); return; }

    var subtotal = _items.reduce(function(s,it){ return s + it.quantity_ordered*it.unit_cost; },0);
    var tax      = subtotal * IVA;
    var payload  = {
      supplier_id:   supplier_id,
      expected_date: document.getElementById('oc-expected-date').value || null,
      notes:         document.getElementById('oc-notes').value.trim() || null,
      subtotal:      subtotal,
      tax_amount:    tax,
      total:         subtotal + tax,
      items: _items.map(function(it){
        return {
          sku: it.sku, description: it.description||it.sku,
          quantity_ordered: it.quantity_ordered, unit_cost: it.unit_cost,
          subtotal: it.quantity_ordered * it.unit_cost
        };
      })
    };

    var btn = document.getElementById('oc-btn-guardar');
    btn.disabled = true;
    try {
      var url    = _editingId ? '/api/purchase-orders/' + _editingId : '/api/purchase-orders';
      var method = _editingId ? 'PUT' : 'POST';
      var r = await fetch(url, {
        method: method,
        headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + getToken() },
        body: JSON.stringify(payload)
      });
      if (!r.ok) { var e=await r.json(); throw new Error(e.detail||'Error '+r.status); }
      ocCerrarModal();
      ocCargar();
    } catch(e) { ocMostrarError(e.message); }
    finally { btn.disabled = false; }
  };

  function ocMostrarError(msg) {
    var el = document.getElementById('oc-modal-error');
    el.textContent = msg; el.style.display = 'block';
  }

  /* D-05 — Editar OC en DRAFT: pre-carga el modal con datos existentes */
  window.ocEditar = async function(id) {
    if (!_proveedores.length) await cargarProveedores();
    try {
      var r = await fetch('/api/purchase-orders/' + id, { headers: { 'Authorization': 'Bearer ' + getToken() } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      // Cargar ítems en caché del modal
      _items = (d.items || []).map(function(it) {
        return {
          sku:              it.sku || '',
          description:      it.description || '',
          quantity_ordered: parseFloat(it.quantity_ordered) || 0,
          unit_cost:        parseFloat(it.unit_cost) || 0,
          product_id:       it.product_id || null
        };
      });
      // Poblar select de proveedor con el actual preseleccionado
      var sel = document.getElementById('oc-supplier-id');
      sel.innerHTML = '<option value="">— Selecciona proveedor —</option>' +
        _proveedores.filter(function(p){ return p.status === 'ACTIVE' || p.id === d.supplier_id; }).map(function(p) {
          return '<option value="' + p.id + '"' + (p.id === d.supplier_id ? ' selected' : '') + '>' + p.name + '</option>';
        }).join('');
      // Otros campos de cabecera
      document.getElementById('oc-expected-date').value = d.expected_date ? d.expected_date.substring(0, 10) : '';
      document.getElementById('oc-notes').value          = d.notes || '';
      document.getElementById('oc-modal-error').style.display = 'none';
      // Activar modo edición
      _editingId = id;
      document.querySelector('#modal-oc .modal-title').textContent = 'Editar OC — ' + (d.folio || id);
      document.getElementById('oc-btn-guardar').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Cambios';
      ocRenderItems();
      document.getElementById('modal-oc').style.display = 'flex';
    } catch(e) { alert('Error al cargar OC: ' + e.message); }
  };

  /* Envía una OC (DRAFT → SENT) */
  window.ocEnviar = async function(id) {
    if (!confirm('¿Enviar esta OC al proveedor? Cambiará a estado ENVIADA.')) return;
    try {
      var r = await fetch('/api/purchase-orders/' + id + '/send', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }
      });
      if (!r.ok) { var e=await r.json(); throw new Error(e.detail||'Error '+r.status); }
      ocCargar();
    } catch(e) { alert('Error: ' + e.message); }
  };

  /* Cancela una OC */
  window.ocCancelar = async function(id) {
    if (!confirm('¿Cancelar esta OC? Esta acción no se puede deshacer.')) return;
    try {
      var r = await fetch('/api/purchase-orders/' + id + '/cancel', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }
      });
      if (!r.ok) { var e=await r.json(); throw new Error(e.detail||'Error '+r.status); }
      ocCargar();
    } catch(e) { alert('Error: ' + e.message); }
  };

  /* Detalle de una OC */
  window.ocVerDetalle = async function(id) {
    var o = _ordenes.find(function(x){ return x.id===id; });
    if (!o) return;
    document.getElementById('oc-det-title').textContent = o.folio||id;
    var body = document.getElementById('oc-det-body');
    body.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cargando detalle…';
    document.getElementById('modal-oc-detalle').style.display = 'flex';
    try {
      var r = await fetch('/api/purchase-orders/' + id, { headers: { 'Authorization':'Bearer '+getToken() } });
      if (!r.ok) throw new Error('HTTP '+r.status);
      var d = await r.json();
      var items = (d.items||[]).map(function(it){
        return '<tr><td>'+(it.sku||'—')+'</td><td>'+(it.description||'')+'</td><td>'+it.quantity_ordered+'</td><td>'+it.quantity_received+'</td><td style="text-align:right;">'+mxn(it.unit_cost)+'</td><td style="text-align:right;">'+mxn(it.subtotal)+'</td></tr>';
      }).join('');
      body.innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;font-size:13px;">' +
        '<div><strong>Proveedor:</strong> '+provNombre(d.supplier_id)+'</div>' +
        '<div><strong>Estado:</strong> '+estadoBadge(d.status)+'</div>' +
        '<div><strong>Fecha:</strong> '+(d.issue_date?new Date(d.issue_date).toLocaleDateString('es-MX'):'—')+'</div>' +
        '<div><strong>Entrega esperada:</strong> '+(d.expected_date?new Date(d.expected_date).toLocaleDateString('es-MX'):'—')+'</div>' +
        (d.notes ? '<div style="grid-column:1/-1;"><strong>Notas:</strong> '+d.notes+'</div>' : '') +
        '</div>' +
        '<table class="data-table" style="margin-bottom:12px;"><thead><tr><th>SKU</th><th>Descripción</th><th>Pedido</th><th>Recibido</th><th>Costo</th><th>Subtotal</th></tr></thead><tbody>' + items + '</tbody></table>' +
        '<div style="text-align:right;font-size:14px;">Subtotal: <strong>'+mxn(d.subtotal)+'</strong> &nbsp; IVA: <strong>'+mxn(d.tax_amount)+'</strong> &nbsp; Total: <strong style="font-size:16px;">'+mxn(d.total)+'</strong></div>';
      // Footer con acciones según estado
      var footer = document.getElementById('oc-det-footer');
      footer.innerHTML = '<button class="btn btn-ghost" onclick="ocCerrarDetalle()">Cerrar</button>';
      if (d.status === 'SENT' || d.status === 'PARTIAL') {
        footer.innerHTML += '<button class="btn btn-primary btn-sm" onclick="ocCerrarDetalle();window.navigateTo&&navigateTo(\'compras-recepciones\')"><i class="fa-solid fa-truck-ramp-box"></i> Registrar Recepción</button>';
      }
    } catch(e) { body.innerHTML = '<span style="color:var(--color-danger);">'+e.message+'</span>'; }
  };

  window.ocCerrarDetalle = function() { document.getElementById('modal-oc-detalle').style.display='none'; };

  /* Init */
  (async function init() {
    await cargarProveedores();
    ocCargar();
  })();
})();
};

window.pageInitHandlers['contractors']=function(){
  window.__editContractorById=function(id){if(window._contractorsReg&&window._contractorsReg[id])window.editContractor(window._contractorsReg[id]);};

const API = window.API_BASE || '/api';
  let editingId = null;

  function showMsg(text, ok) {
    const el = document.getElementById('contractor-msg');
    if (!el) return;
    el.style.display = 'block';
    el.style.background = ok ? '#d1fae5' : '#fee2e2';
    el.style.color      = ok ? '#065f46' : '#991b1b';
    el.textContent = text;
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  window.loadContractors = function() {
    const status = document.getElementById('contractor-status-filter')?.value || '';
    const url = status ? `${API}/contractors?status=${encodeURIComponent(status)}` : `${API}/contractors`;
    fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(rows => {
      const tbody = document.getElementById('contractors-tbody');
      if (!tbody) return;
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-secondary);">Sin contratistas</td></tr>';
        return;
      }
      if(!window._contractorsReg)window._contractorsReg={};
  rows.forEach(c=>{window._contractorsReg[c.id]=c;});
  tbody.innerHTML=rows.map(c=>`
        <tr>
          <td>${c.nombre || '-'}</td>
          <td>${c.rfc || '-'}</td>
          <td>${c.phone || '-'}</td>
          <td>${c.email || '-'}</td>
          <td><span style="font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:20px;
            background:${c.status==='activo'?'#d1fae5':'#f1f5f9'};
            color:${c.status==='activo'?'#065f46':'#64748b'}">${c.status}</span></td>
          <td>
            <button class="btn btn-sm" style="font-size:0.7rem;padding:3px 10px;"
              data-click="__editContractorById" data-click-arg="${c.id}">Editar</button>
          </td>
        </tr>`).join('');
    });
  };

  window.openContractorForm = function(c) {
    editingId = null;
    document.getElementById('contractor-form-title').textContent = 'Nuevo Contratista';
    ['contractor-nombre','contractor-rfc','contractor-phone','contractor-email','contractor-notas'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('contractor-form-card').style.display = 'block';
  };

  window.editContractor = function(c) {
    editingId = c.id;
    document.getElementById('contractor-form-title').textContent = 'Editar Contratista';
    document.getElementById('contractor-nombre').value  = c.nombre  || '';
    document.getElementById('contractor-rfc').value     = c.rfc     || '';
    document.getElementById('contractor-phone').value   = c.phone   || '';
    document.getElementById('contractor-email').value   = c.email   || '';
    document.getElementById('contractor-notas').value   = c.notas   || '';
    document.getElementById('contractor-form-card').style.display = 'block';
    document.getElementById('contractor-form-card').scrollIntoView({ behavior: 'smooth' });
  };

  window.closeContractorForm = function() {
    document.getElementById('contractor-form-card').style.display = 'none';
    editingId = null;
  };

  window.saveContractor = function() {
    const nombre = document.getElementById('contractor-nombre').value.trim();
    if (!nombre) { showMsg('El nombre es obligatorio', false); return; }
    const body = {
      nombre,
      rfc:   document.getElementById('contractor-rfc').value.trim()   || null,
      phone: document.getElementById('contractor-phone').value.trim() || null,
      email: document.getElementById('contractor-email').value.trim() || null,
      notas: document.getElementById('contractor-notas').value.trim() || null,
    };
    const url    = editingId ? `${API}/contractors/${editingId}` : `${API}/contractors`;
    const method = editingId ? 'PUT' : 'POST';
    fetch(url, { method, credentials: 'include', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.detail || 'Error'); }))
      .then(() => {
        showMsg(editingId ? 'Contratista actualizado' : 'Contratista creado', true);
        closeContractorForm();
        loadContractors();
      }).catch(err => showMsg(err.message, false));
  };

  loadContractors();
};

window.pageInitHandlers['projects']=function(){
  window.__editProjectById=function(id){if(window._projectsReg&&window._projectsReg[id])window.editProject(window._projectsReg[id]);};

const API = window.API_BASE || '/api';
  let editingId = null;
  let currentLedgerProjectId = null;

  function showMsg(id, text, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'block';
    el.style.background = ok ? '#d1fae5' : '#fee2e2';
    el.style.color      = ok ? '#065f46' : '#991b1b';
    el.textContent = text;
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  function loadContractorOptions() {
    fetch(`${API}/contractors?status=activo`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(rows => {
        const sel = document.getElementById('project-contractor');
        if (!sel) return;
        const opts = rows.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
        sel.innerHTML = '<option value="">— Sin contratista —</option>' + opts;
      });
  }

  window.loadProjects = function() {
    const status = document.getElementById('project-status-filter')?.value || '';
    const url = status ? `${API}/projects?status=${encodeURIComponent(status)}` : `${API}/projects`;
    fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(rows => {
      const tbody = document.getElementById('projects-tbody');
      if (!tbody) return;
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-secondary);">Sin proyectos</td></tr>';
        return;
      }
      if(!window._projectsReg)window._projectsReg={};
  rows.forEach(p=>{window._projectsReg[p.id]=p;});
  tbody.innerHTML=rows.map(p=>`
        <tr>
          <td>${p.nombre}</td>
          <td>${p.contractor_id || '-'}</td>
          <td>${(parseFloat(p.commission_rate||0)*100).toFixed(2)}%</td>
          <td><span style="font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:20px;
            background:${p.status==='activo'?'#d1fae5':'#f1f5f9'};
            color:${p.status==='activo'?'#065f46':'#64748b'}">${p.status}</span></td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-sm" style="font-size:0.7rem;padding:3px 10px;"
              data-click="__editProjectById" data-click-arg="${p.id}">Editar</button>
            <button class="btn btn-sm" style="font-size:0.7rem;padding:3px 10px;background:#ede9fe;"
              data-click="openLedger" data-click-arg="${p.id}" data-click-arg2="${p.nombre}">Comisiones</button>
            ${p.status==='activo'?`<button class="btn btn-sm" style="font-size:0.7rem;padding:3px 10px;background:#fee2e2;color:#991b1b;"
              data-click="closeProject" data-click-arg="${p.id}">Cerrar</button>`:''}
          </td>
        </tr>`).join('');
    });
  };

  window.openProjectForm = function() {
    editingId = null;
    document.getElementById('project-form-title').textContent = 'Nuevo Proyecto';
    ['project-nombre','project-commission','project-client','project-notas'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    document.getElementById('project-contractor').value = '';
    document.getElementById('project-form-card').style.display = 'block';
    loadContractorOptions();
  };

  window.editProject = function(p) {
    editingId = p.id;
    loadContractorOptions();
    document.getElementById('project-form-title').textContent = 'Editar Proyecto';
    document.getElementById('project-nombre').value     = p.nombre || '';
    document.getElementById('project-commission').value = parseFloat(p.commission_rate||0)*100;
    document.getElementById('project-client').value     = p.client_id || '';
    document.getElementById('project-notas').value      = p.notas || '';
    setTimeout(() => { document.getElementById('project-contractor').value = p.contractor_id || ''; }, 300);
    document.getElementById('project-form-card').style.display = 'block';
    document.getElementById('project-form-card').scrollIntoView({ behavior: 'smooth' });
  };

  window.closeProjectForm = function() {
    document.getElementById('project-form-card').style.display = 'none';
    editingId = null;
  };

  window.saveProject = function() {
    const nombre = document.getElementById('project-nombre').value.trim();
    if (!nombre) { showMsg('project-msg', 'El nombre es obligatorio', false); return; }
    const commPct = parseFloat(document.getElementById('project-commission').value) || 0;
    const body = {
      nombre,
      contractor_id:   document.getElementById('project-contractor').value || null,
      commission_rate: commPct / 100,
      client_id:       document.getElementById('project-client').value.trim() || null,
      notas:           document.getElementById('project-notas').value.trim() || null,
    };
    const url    = editingId ? `${API}/projects/${editingId}` : `${API}/projects`;
    const method = editingId ? 'PUT' : 'POST';
    fetch(url, { method, credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.detail||'Error'); }))
      .then(() => { showMsg('project-msg', editingId?'Proyecto actualizado':'Proyecto creado', true); closeProjectForm(); loadProjects(); })
      .catch(err => showMsg('project-msg', err.message, false));
  };

  window.closeProject = function(id) {
    if (!confirm('¿Cerrar este proyecto? No se puede deshacer.')) return;
    fetch(`${API}/projects/${id}/close`, { method:'POST', credentials:'include' })
      .then(r => r.ok ? loadProjects() : null);
  };

  window.openLedger = function(projectId, nombre) {
    currentLedgerProjectId = projectId;
    document.getElementById('ledger-project-name').textContent = nombre;
    document.getElementById('ledger-card').style.display = 'block';
    document.getElementById('ledger-card').scrollIntoView({ behavior: 'smooth' });
    loadLedger();
  };

  window.closeLedger = function() {
    document.getElementById('ledger-card').style.display = 'none';
    currentLedgerProjectId = null;
  };

  function loadLedger() {
    if (!currentLedgerProjectId) return;
    fetch(`${API}/projects/${currentLedgerProjectId}/commission-ledger`, { credentials:'include' })
      .then(r => r.ok ? r.json() : { summary:{}, entries:[] })
      .then(d => {
        const s = d.summary || {};
        document.getElementById('ledger-summary').innerHTML = `
          <div style="text-align:center;padding:10px 20px;background:#ede9fe;border-radius:8px;">
            <div style="font-size:1.1rem;font-weight:900;color:#5b21b6">$${(s.total_generated||0).toFixed(2)}</div>
            <div style="font-size:0.7rem;color:#7c3aed;font-weight:700">Generado</div>
          </div>
          <div style="text-align:center;padding:10px 20px;background:#d1fae5;border-radius:8px;">
            <div style="font-size:1.1rem;font-weight:900;color:#065f46">$${(s.total_paid||0).toFixed(2)}</div>
            <div style="font-size:0.7rem;color:#047857;font-weight:700">Pagado</div>
          </div>
          <div style="text-align:center;padding:10px 20px;background:#fef9c3;border-radius:8px;">
            <div style="font-size:1.1rem;font-weight:900;color:#854d0e">$${(s.balance_pending||0).toFixed(2)}</div>
            <div style="font-size:0.7rem;color:#a16207;font-weight:700">Pendiente</div>
          </div>`;
        const tbody = document.getElementById('ledger-tbody');
        const entries = d.entries || [];
        if (!entries.length) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text-secondary);">Sin movimientos</td></tr>';
          return;
        }
        tbody.innerHTML = entries.map(e => `<tr>
          <td>${(e.created_at||'').slice(0,10)}</td>
          <td style="color:${e.entry_type==='generated'?'#5b21b6':'#065f46'};font-weight:700">${e.entry_type==='generated'?'Generado':'Pagado'}</td>
          <td>$${parseFloat(e.amount||0).toFixed(2)}</td>
          <td>${e.sale_id ? `Venta ${e.sale_id.slice(0,8)}` : (e.descripcion||'-')}</td>
        </tr>`).join('');
      });
  }

  window.recordPayment = function() {
    if (!currentLedgerProjectId) return;
    const monto = parseFloat(document.getElementById('ledger-monto').value);
    const nota  = document.getElementById('ledger-nota').value.trim();
    if (isNaN(monto) || monto <= 0) { showMsg('ledger-pay-msg','Monto inválido',false); return; }
    fetch(`${API}/projects/${currentLedgerProjectId}/commission-ledger`, {
      method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ entry_type:'paid', amount: monto, descripcion: nota||'Pago manual' })
    }).then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.detail||'Error'); }))
      .then(() => { showMsg('ledger-pay-msg','Pago registrado',true); document.getElementById('ledger-monto').value=''; document.getElementById('ledger-nota').value=''; loadLedger(); })
      .catch(err => showMsg('ledger-pay-msg',err.message,false));
  };

  loadProjects();
};

window.pageInitHandlers['compras-recepciones']=function(){
/* ================================================================
   compras-recepciones.html — lógica de página
   Endpoints: GET/POST /api/purchase-receipts
              GET /api/purchase-orders (para OC por proveedor)
              GET /api/warehouses (bodegas disponibles)
   Acción al guardar: actualiza WarehouseStock + genera CxP si CREDIT
   ================================================================ */
(function() {
  var _recepciones = [];
  var _proveedores = [];
  var _bodegas     = [];
  var _ocPorProv   = [];   // OC del proveedor seleccionado (SENT | PARTIAL)
  var _recItems    = [];

  function getToken() { return sessionStorage.getItem('calebsys_token')||localStorage.getItem('calebsys_token')||''; }
  function mxn(v) { return '$'+Number(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}); }

  /* Carga catálogos de apoyo en paralelo */
  async function cargarCatalogos() {
    var headers = { 'Authorization':'Bearer '+getToken() };
    var [rP, rB] = await Promise.all([
      fetch('/api/suppliers?limit=200', {headers}),
      fetch('/api/warehouses',          {headers})
    ]);
    if (rP.ok) _proveedores = await rP.json();
    if (rB.ok) _bodegas     = await rB.json();
  }

  /* Carga historial de recepciones */
  window.recCargar = async function() {
    var tbody = document.getElementById('rec-tbody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</td></tr>';
    try {
      var r = await fetch('/api/purchase-receipts?limit=100', { headers:{'Authorization':'Bearer '+getToken()} });
      if (!r.ok) throw new Error('HTTP '+r.status);
      _recepciones = await r.json();
      recFiltrar();
    } catch(e) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--color-danger);">'+e.message+'</td></tr>';
    }
  };

  function provNombre(id) { var p=_proveedores.find(function(x){return x.id===id;}); return p?p.name:id; }
  function bodNombre(id)  { var b=_bodegas.find(function(x){return x.id===id;});    return b?b.name:id; }

  window.recFiltrar = function() {
    var q = document.getElementById('rec-search').value.toLowerCase();
    var lista = _recepciones.filter(function(r){
      return !q || (r.folio||'').toLowerCase().includes(q) || provNombre(r.supplier_id).toLowerCase().includes(q);
    });
    var tbody = document.getElementById('rec-tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--color-text-muted);">Sin recepciones registradas</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(function(r) {
      var fecha = r.receipt_date ? new Date(r.receipt_date).toLocaleDateString('es-MX') : '—';
      var pagoBadge = r.payment_type==='CREDIT'
        ? '<span style="color:var(--color-warning);font-weight:600;">Crédito</span>'
        : '<span style="color:var(--color-success);font-weight:600;">Contado</span>';
      return '<tr>'+
        '<td><strong>'+(r.folio||'—')+'</strong>'+(r.purchase_order_id?'<br><small style="color:var(--color-text-muted);">OC vinculada</small>':'')+'</td>'+
        '<td>'+provNombre(r.supplier_id)+'</td>'+
        '<td>'+bodNombre(r.warehouse_id)+'</td>'+
        '<td>'+fecha+'</td>'+
        '<td style="text-align:right;">'+mxn(r.total)+'</td>'+
        '<td>'+pagoBadge+'</td>'+
        '<td><button class="btn btn-ghost btn-xs" title="Detalle"><i class="fa-solid fa-eye"></i></button></td>'+
        '</tr>';
    }).join('');
  };

  /* Abre el modal de nueva recepción */
  window.recNueva = async function() {
    _recItems = [];
    _ocPorProv = [];
    if (!_proveedores.length || !_bodegas.length) await cargarCatalogos();

    var selP = document.getElementById('rec-supplier-id');
    selP.innerHTML = '<option value="">— Selecciona proveedor —</option>' +
      _proveedores.filter(function(p){return p.status==='ACTIVE';}).map(function(p){
        return '<option value="'+p.id+'">'+p.name+'</option>';
      }).join('');

    var selB = document.getElementById('rec-warehouse-id');
    selB.innerHTML = '<option value="">— Selecciona bodega —</option>' +
      _bodegas.map(function(b){ return '<option value="'+b.id+'">'+b.name+'</option>'; }).join('');

    document.getElementById('rec-po-id').innerHTML   = '<option value="">— Entrada directa sin OC —</option>';
    document.getElementById('rec-payment-type').value = 'CREDIT';
    document.getElementById('rec-notes').value         = '';
    document.getElementById('rec-modal-error').style.display = 'none';
    recRenderItems();
    document.getElementById('modal-rec').style.display = 'flex';
  };

  window.recCerrarModal = function() { document.getElementById('modal-rec').style.display='none'; };

  /* Al cambiar proveedor → carga sus OC abiertas */
  window.recOnSupplierChange = async function() {
    var suppId = document.getElementById('rec-supplier-id').value;
    var selOC  = document.getElementById('rec-po-id');
    selOC.innerHTML = '<option value="">— Entrada directa sin OC —</option>';
    _ocPorProv = [];
    if (!suppId) return;
    try {
      var r = await fetch('/api/purchase-orders?supplier_id='+suppId+'&limit=50', {
        headers: { 'Authorization':'Bearer '+getToken() }
      });
      if (!r.ok) return;
      var ocs = await r.json();
      _ocPorProv = ocs.filter(function(o){ return o.status==='SENT'||o.status==='PARTIAL'; });
      selOC.innerHTML = '<option value="">— Entrada directa sin OC —</option>' +
        _ocPorProv.map(function(o){
          return '<option value="'+o.id+'">'+o.folio+' — '+mxn(o.total)+'</option>';
        }).join('');
    } catch(e) { /* silencioso */ }
  };

  /* Al seleccionar OC → pre-carga los ítems pendientes */
  window.recOnOCChange = async function() {
    var ocId = document.getElementById('rec-po-id').value;
    if (!ocId) { _recItems=[]; recRenderItems(); return; }
    try {
      var r = await fetch('/api/purchase-orders/'+ocId, { headers:{'Authorization':'Bearer '+getToken()} });
      if (!r.ok) throw new Error('HTTP '+r.status);
      var oc = await r.json();
      // Solo ítems pendientes (sin recibir totalmente)
      _recItems = (oc.items||[])
        .filter(function(it){ return it.status !== 'RECEIVED'; })
        .map(function(it){
          return {
            sku:               it.sku,
            description:       it.description||it.sku,
            quantity_received: it.quantity_ordered - (it.quantity_received||0),
            unit_cost:         it.unit_cost,
            purchase_order_item_id: it.id,
            product_id:        it.product_id||null
          };
        });
      recRenderItems();
    } catch(e) { recMostrarError('Error cargando OC: '+e.message); }
  };

  window.recAgregarItem = function() {
    _recItems.push({ sku:'', description:'', quantity_received:1, unit_cost:0, product_id:null, purchase_order_item_id:null });
    recRenderItems();
  };

  window.recEliminarItem = function(i) { _recItems.splice(i,1); recRenderItems(); };

  window.recItemChange = function(i, campo, val) {
    _recItems[i][campo] = (campo==='quantity_received'||campo==='unit_cost') ? parseFloat(val)||0 : val;
    recRenderItems();
  };

  function recRenderItems() {
    var tbody = document.getElementById('rec-items-tbody');
    if (!_recItems.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--color-text-muted);">Agrega ítems o selecciona una OC</td></tr>';
      document.getElementById('rec-total-display').textContent = '$0.00';
      return;
    }
    var total = 0;
    tbody.innerHTML = _recItems.map(function(it, i) {
      var sub = (it.quantity_received||0)*(it.unit_cost||0);
      total += sub;
      var origin = it.purchase_order_item_id ? '<i class="fa-solid fa-link" title="Vinculado a OC" style="color:var(--color-info,#3b82f6);margin-left:4px;"></i>' : '';
      return '<tr>'+
        '<td><input class="form-input form-input-sm" value="'+it.sku+'" placeholder="SKU" oninput="recItemChange('+i+',"sku",this.value)">'+origin+'</td>'+
        '<td><input class="form-input form-input-sm" value="'+it.description+'" placeholder="Descripción" oninput="recItemChange('+i+',"description",this.value)"></td>'+
        '<td><input type="number" class="form-input form-input-sm" value="'+it.quantity_received+'" min="0.01" step="0.01" oninput="recItemChange('+i+',"quantity_received",this.value)"></td>'+
        '<td><input type="number" class="form-input form-input-sm" value="'+it.unit_cost+'" min="0" step="0.01" oninput="recItemChange('+i+',"unit_cost",this.value)"></td>'+
        '<td style="text-align:right;">'+mxn(sub)+'</td>'+
        '<td><button class="btn btn-ghost btn-xs" onclick="recEliminarItem('+i+')"><i class="fa-solid fa-trash"></i></button></td>'+
        '</tr>';
    }).join('');
    document.getElementById('rec-total-display').textContent = mxn(total);
  }

  /* Envía la recepción al backend */
  window.recGuardar = async function() {
    var supplier_id  = document.getElementById('rec-supplier-id').value;
    var warehouse_id = document.getElementById('rec-warehouse-id').value;
    if (!supplier_id)  { recMostrarError('Selecciona un proveedor.'); return; }
    if (!warehouse_id) { recMostrarError('Selecciona una bodega de destino.'); return; }
    if (!_recItems.length) { recMostrarError('Agrega al menos un ítem.'); return; }
    var invalidos = _recItems.filter(function(it){ return !it.sku||it.quantity_received<=0; });
    if (invalidos.length) { recMostrarError('Completa SKU y cantidad en todos los ítems.'); return; }

    var total = _recItems.reduce(function(s,it){ return s+it.quantity_received*it.unit_cost; },0);
    var payload = {
      supplier_id:       supplier_id,
      purchase_order_id: document.getElementById('rec-po-id').value || null,
      warehouse_id:      warehouse_id,
      payment_type:      document.getElementById('rec-payment-type').value,
      notes:             document.getElementById('rec-notes').value.trim()||null,
      subtotal:          total,
      tax_amount:        0,
      total:             total,
      idempotency_key:   'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      items: _recItems.map(function(it){
        return {
          sku: it.sku, description: it.description||it.sku,
          quantity_received: it.quantity_received,
          unit_cost:         it.unit_cost,
          subtotal:          it.quantity_received*it.unit_cost,
          purchase_order_item_id: it.purchase_order_item_id||null,
          product_id: it.product_id||null
        };
      })
    };

    var btn = document.getElementById('rec-btn-guardar');
    btn.disabled = true;
    try {
      var r = await fetch('/api/purchase-receipts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+getToken() },
        body: JSON.stringify(payload)
      });
      if (!r.ok) { var e=await r.json(); throw new Error(e.detail||'Error '+r.status); }
      recCerrarModal();
      recCargar();
    } catch(e) { recMostrarError(e.message); }
    finally { btn.disabled=false; }
  };

  function recMostrarError(msg) {
    var el = document.getElementById('rec-modal-error');
    el.textContent=msg; el.style.display='block';
  }

  /* Init */
  (async function() {
    await cargarCatalogos();
    recCargar();
  })();
})();
};

window.pageInitHandlers['proveedores']=function(){
/* ================================================================
   proveedores.html — lógica de página
   Conecta con: GET/POST/PUT /api/suppliers
   Roles: admin (CRUD), Gerente/Almacenista (solo lectura)
   ================================================================ */
(function() {
  var _proveedores = [];   // cache local de la respuesta API
  var _token = '';

  /* Obtiene el token JWT del sessionStorage (patrón del shell) */
  function getToken() {
    return sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
  }

  /* Carga la lista de proveedores desde la API */
  window.provCargar = async function() {
    _token = getToken();
    var tbody = document.getElementById('prov-tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</td></tr>';
    try {
      var r = await fetch('/api/suppliers?limit=200', {
        headers: { 'Authorization': 'Bearer ' + _token }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _proveedores = await r.json();
      provActualizarKPIs();
      provRenderTabla(_proveedores);
    } catch(e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--color-danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error al cargar: ' + e.message + '</td></tr>';
    }
  };

  /* Actualiza los KPI cards superiores */
  function provActualizarKPIs() {
    var total   = _proveedores.length;
    var activos = _proveedores.filter(function(p){ return p.status === 'ACTIVE'; }).length;
    var credito = _proveedores.filter(function(p){ return p.credit_days > 0; }).length;
    document.getElementById('prov-kpi-total').textContent   = total;
    document.getElementById('prov-kpi-activos').textContent = activos;
    document.getElementById('prov-kpi-credito').textContent = credito;
  }

  /* Filtra la tabla en tiempo real (búsqueda + select de estado) */
  window.provFiltrar = function() {
    var q      = document.getElementById('prov-search').value.toLowerCase();
    var estado = document.getElementById('prov-filter-status').value;
    var lista  = _proveedores.filter(function(p) {
      var matchQ = !q || (p.name||'').toLowerCase().includes(q) || (p.rfc||'').toLowerCase().includes(q);
      var matchE = !estado || p.status === estado;
      return matchQ && matchE;
    });
    provRenderTabla(lista);
  };

  /* Renderiza las filas de la tabla */
  function provRenderTabla(lista) {
    var tbody = document.getElementById('prov-tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--color-text-muted);">Sin proveedores que coincidan</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(function(p) {
      var badgeColor = p.status === 'ACTIVE' ? 'var(--color-success)' : 'var(--color-text-muted)';
      var credLabel  = p.credit_days > 0 ? p.credit_days + 'd / $' + Number(p.credit_limit||0).toLocaleString('es-MX') : '<span style="color:var(--color-text-muted)">Contado</span>';
      return '<tr>' +
        '<td><strong>' + (p.name||'—') + '</strong>' + (p.trade_name ? '<br><small style="color:var(--color-text-muted)">' + p.trade_name + '</small>' : '') + '</td>' +
        '<td>' + (p.rfc||'—') + '</td>' +
        '<td>' + (p.contact_name||'') + (p.phone ? '<br><small>' + p.phone + '</small>' : '') + '</td>' +
        '<td>' + credLabel + '</td>' +
        '<td><span style="color:' + badgeColor + ';font-weight:600;">' + (p.status === 'ACTIVE' ? 'Activo' : 'Inactivo') + '</span></td>' +
        '<td><button class="btn btn-ghost btn-xs" onclick="provEditar(' + "'" + p.id + "'" + ')"><i class="fa-solid fa-pen"></i></button></td>' +
        '</tr>';
    }).join('');
  }

  /* Abre el modal para un nuevo proveedor */
  window.provNuevo = function() {
    document.getElementById('prov-id').value          = '';
    document.getElementById('prov-name').value        = '';
    document.getElementById('prov-trade-name').value  = '';
    document.getElementById('prov-rfc').value         = '';
    document.getElementById('prov-contact').value     = '';
    document.getElementById('prov-phone').value       = '';
    document.getElementById('prov-email').value       = '';
    document.getElementById('prov-credit-days').value = '0';
    document.getElementById('prov-credit-limit').value= '0';
    document.getElementById('prov-bank').value        = '';
    document.getElementById('prov-notes').value       = '';
    document.getElementById('prov-status-group').style.display = 'none';
    document.getElementById('modal-prov-title').textContent    = 'Nuevo Proveedor';
    document.getElementById('prov-modal-error').style.display  = 'none';
    document.getElementById('modal-proveedor').style.display   = 'flex';
  };

  /* Carga datos de un proveedor existente en el modal */
  window.provEditar = function(id) {
    var p = _proveedores.find(function(x){ return x.id === id; });
    if (!p) return;
    document.getElementById('prov-id').value           = p.id;
    document.getElementById('prov-name').value         = p.name||'';
    document.getElementById('prov-trade-name').value   = p.trade_name||'';
    document.getElementById('prov-rfc').value          = p.rfc||'';
    document.getElementById('prov-contact').value      = p.contact_name||'';
    document.getElementById('prov-phone').value        = p.phone||'';
    document.getElementById('prov-email').value        = p.email||'';
    document.getElementById('prov-credit-days').value  = p.credit_days||0;
    document.getElementById('prov-credit-limit').value = p.credit_limit||0;
    document.getElementById('prov-bank').value         = p.bank_account||'';
    document.getElementById('prov-notes').value        = p.notes||'';
    document.getElementById('prov-status').value       = p.status||'ACTIVE';
    document.getElementById('prov-status-group').style.display = 'block';
    document.getElementById('modal-prov-title').textContent    = 'Editar Proveedor';
    document.getElementById('prov-modal-error').style.display  = 'none';
    document.getElementById('modal-proveedor').style.display   = 'flex';
  };

  /* Cierra el modal */
  window.provCerrarModal = function() {
    document.getElementById('modal-proveedor').style.display = 'none';
  };

  /* Guarda (POST = nuevo, PUT = edición) */
  window.provGuardar = async function() {
    var id   = document.getElementById('prov-id').value;
    var name = document.getElementById('prov-name').value.trim();
    if (!name) { provMostrarError('El nombre comercial es obligatorio.'); return; }

    var payload = {
      name:         name,
      trade_name:   document.getElementById('prov-trade-name').value.trim()||null,
      rfc:          document.getElementById('prov-rfc').value.trim()||null,
      contact_name: document.getElementById('prov-contact').value.trim()||null,
      phone:        document.getElementById('prov-phone').value.trim()||null,
      email:        document.getElementById('prov-email').value.trim()||null,
      credit_days:  parseInt(document.getElementById('prov-credit-days').value)||0,
      credit_limit: parseFloat(document.getElementById('prov-credit-limit').value)||0,
      bank_account: document.getElementById('prov-bank').value.trim()||null,
      notes:        document.getElementById('prov-notes').value.trim()||null,
    };
    if (id) payload.status = document.getElementById('prov-status').value;

    var btn = document.getElementById('prov-btn-guardar');
    btn.disabled = true;
    try {
      var url    = id ? '/api/suppliers/' + id : '/api/suppliers';
      var method = id ? 'PUT' : 'POST';
      var r = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
        body: JSON.stringify(payload)
      });
      if (!r.ok) { var e = await r.json(); throw new Error(e.detail||'Error ' + r.status); }
      provCerrarModal();
      provCargar();
    } catch(e) {
      provMostrarError(e.message);
    } finally {
      btn.disabled = false;
    }
  };

  function provMostrarError(msg) {
    var el = document.getElementById('prov-modal-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  /* Auto-carga al montar la página */
  provCargar();
})();
};

window.pageInitHandlers['reportes']=function(){
'use strict';

  var fmt    = AdminAPI.fmtCurrency;
  var fmtNum = AdminAPI.fmtNum;
  var fmtD   = AdminAPI.fmtDate;

  // ── JWT decode helpers ────────────────────────────────────────────────────
  function _decodeJwt() {
    var tok = localStorage.getItem('calebsys_token') ||
              sessionStorage.getItem('auth_token') ||
              localStorage.getItem('auth_token') || '';
    if (!tok) return {};
    try {
      var parts = tok.split('.');
      if (parts.length < 2) return {};
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(atob(b64));
    } catch (_) { return {}; }
  }

  var _jwt     = _decodeJwt();
  var _role    = (_jwt.role || '').toLowerCase();
  var _sucursal = _jwt.sucursal || 'MATRIZ';
  var _masterRoles = ['admin','administrador','administrador general',
                      'dueño','dueno','owner','gerente general'];
  var _isAdmin = (_masterRoles.indexOf(_role) !== -1);

  // Current scope: 'all' | 'suc'
  // Admin defaults to 'all'; everyone else is always 'suc' (forced).
  var _scope = _isAdmin ? 'all' : 'suc';

  // ── scope UI ──────────────────────────────────────────────────────────────
  function _initScopeBar() {
    if (!_isAdmin) return;
    var bar = document.getElementById('rep-scope-bar');
    if (bar) bar.hidden = false;
    _renderScopeButtons();
  }

  function _renderScopeButtons() {
    var btnSuc = document.getElementById('rep-scope-suc');
    var btnAll = document.getElementById('rep-scope-all');
    if (!btnSuc || !btnAll) return;
    if (_scope === 'all') {
      btnAll.className = 'btn btn-primary btn-sm';
      btnSuc.className = 'btn btn-secondary btn-sm';
    } else {
      btnSuc.className = 'btn btn-primary btn-sm';
      btnAll.className = 'btn btn-secondary btn-sm';
    }
    var sub = document.getElementById('rep-subtitle');
    if (sub) {
      sub.textContent = _scope === 'all'
        ? 'Vista empresa completa — todas las sucursales'
        : 'Sucursal: ' + _sucursal;
    }
  }

  window.repSetScope = function (s) {
    if (!_isAdmin) return;
    _scope = s;
    _renderScopeButtons();
    repRefreshAll();
  };

  // ── helpers ───────────────────────────────────────────────────────────────
  function _el(id) { return document.getElementById(id); }

  function _errHtml(msg) {
    return '<div class="rep-err"><i class="fa-solid fa-triangle-exclamation"></i> ' + msg + '</div>';
  }
  function _emptyHtml(msg) {
    return '<div style="font-size:12px;color:var(--text-secondary);padding:8px 0;">' + msg + '</div>';
  }

  function _scopeParam(endpoint) {
    // Returns query string for scope
    if (_scope === 'all' && _isAdmin) {
      if (endpoint === 'stats' || endpoint === 'caja') return '?sucursal_id=ALL';
      if (endpoint === 'aging') return '';          // admin sees all by role, no param needed
    }
    return '';                                       // suc scope → JWT handles it server-side
  }

  // ── Dashboard stats + KPI row + chart + top products ─────────────────────
  function loadDashboard() {
    var qs = _scopeParam('stats');
    AdminAPI.apiFetch('/api/dashboard/stats' + qs)
      .then(function (d) {
        var delta = d.delta_ventas || 0;
        var dColor = delta >= 0 ? '#22c55e' : '#ef4444';
        var dIcon  = delta >= 0 ? '▲' : '▼';
        _el('rep-ventas-hoy').textContent  = fmt(d.ventas_hoy || 0);
        _el('rep-tickets-hoy').textContent = fmtNum(d.tickets_hoy || 0);
        _el('rep-delta').innerHTML =
          '<span style="color:' + dColor + ';font-weight:700;">' + dIcon + ' ' + Math.abs(delta) + '%</span> vs ayer';
        _el('rep-cxc-total').textContent = fmt(d.cuentas_por_cobrar || 0);

        // Daily chart
        var daily = d.daily_sales || [];
        if (!daily.length) {
          _el('rep-daily-chart').innerHTML = _emptyHtml('Sin ventas este mes');
        } else {
          var maxV = Math.max.apply(null, daily.map(function (r) { return r.total || 0; })) || 1;
          var mTotal = daily.reduce(function (s, r) { return s + (r.total || 0); }, 0);
          var bars = daily.map(function (r) {
            var pct = Math.round(((r.total || 0) / maxV) * 100);
            var day = r.day ? new Date(r.day).getDate() : '?';
            return '<div class="rep-bar-wrap" title="Día ' + day + ': ' + fmt(r.total || 0) + '">' +
              '<div class="rep-bar" style="height:' + Math.max(pct, 4) + 'px;"></div>' +
              '<div class="rep-bar-lbl">' + day + '</div></div>';
          }).join('');
          _el('rep-daily-chart').style.height = '80px';
          _el('rep-daily-chart').innerHTML = bars;
          _el('rep-daily-total').textContent = 'Total mes: ' + fmt(mTotal);
        }

        // Desglose por sucursal (scope ALL)
        var bySuc = d.by_sucursal || [];
        var bySucEl = _el('rep-by-sucursal');
        if (bySucEl) {
          if (bySuc.length > 1) {
            bySucEl.hidden = false;
            var th = '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px;border-top:1px solid var(--border,#e2e8f0);padding-top:10px;">Desglose por sucursal — hoy</div>';
            var rows = bySuc.map(function (r) {
              return '<tr><td style="font-weight:600;">' + (r.sucursal_id || '—') + '</td>' +
                '<td style="text-align:right;">' + fmt(r.ventas_hoy || 0) + '</td>' +
                '<td style="text-align:right;">' + fmtNum(r.tickets_hoy || 0) + '</td>' +
                (r.cxc_pendiente != null ? '<td style="text-align:right;color:var(--danger);">' + fmt(r.cxc_pendiente) + '</td>' : '<td></td>') +
                '</tr>';
            }).join('');
            bySucEl.innerHTML = th +
              '<table class="rep-suc-tbl"><thead><tr>' +
              '<th>Sucursal</th><th style="text-align:right;">Ventas</th><th style="text-align:right;">Tickets</th><th style="text-align:right;">CxC</th>' +
              '</tr></thead><tbody>' + rows + '</tbody></table>';
          } else {
            bySucEl.hidden = true;
          }
        }

        // Top products
        var tp = d.top_products || [];
        if (!tp.length) {
          _el('rep-top-products').innerHTML = _emptyHtml('Sin ventas hoy');
        } else {
          var maxQ = Math.max.apply(null, tp.map(function (p) { return p.qty || 0; })) || 1;
          _el('rep-top-products').innerHTML = tp.map(function (p, i) {
            var pct = Math.round(((p.qty || 0) / maxQ) * 100);
            return '<div style="margin-bottom:8px;">' +
              '<div class="rep-bucket-row">' +
              '<div class="rep-bucket-label" style="width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + p.sku + '">' +
              (i + 1) + '. ' + p.sku + '</div>' +
              '<div class="rep-bucket-bar" style="background:var(--primary,#3b82f6);opacity:' + (0.35 + pct / 150) + ';width:' + pct + '%;max-width:100%;"></div>' +
              '<div class="rep-bucket-val">' + fmtNum(p.qty) + ' uds</div>' +
              '</div>' +
              '<div style="font-size:10px;color:var(--text-secondary);margin-left:96px;">' + fmt(p.revenue || 0) + '</div>' +
              '</div>';
          }).join('');
        }
      })
      .catch(function (err) {
        var m = err.message || 'Error';
        _el('rep-ventas-hoy').textContent  = '—';
        _el('rep-tickets-hoy').textContent = '—';
        _el('rep-cxc-total').textContent   = '—';
        _el('rep-daily-chart').innerHTML   = _errHtml(m);
        _el('rep-top-products').innerHTML  = _errHtml(m);
      });
  }

  // ── Cartera vencida aging ─────────────────────────────────────────────────
  function loadAging() {
    var qs = _scopeParam('aging');
    var note = _el('rep-aging-scope-note');
    if (note) note.textContent = _isAdmin ? '(empresa completa)' : '(mi sucursal)';
    AdminAPI.apiFetch('/api/accounts-receivable/aging' + qs)
      .then(function (d) {
        var total = d.total_cartera || 0;
        if (!total) { _el('rep-aging').innerHTML = _emptyHtml('Sin cartera vencida'); return; }
        var cols = { 'por_vencer':'#22c55e','1-30':'#f59e0b','31-60':'#ef4444','61-90':'#dc2626','90+':'#7f1d1d' };
        var lbls = { 'por_vencer':'Por vencer','1-30':'1-30 días','31-60':'31-60 días','61-90':'61-90 días','90+':'+90 días' };
        var html = '<div style="margin-bottom:10px;font-size:11px;color:var(--text-secondary);">Total: <strong>' +
          fmt(total) + '</strong> · ' + (d.cuentas || 0) + ' cuentas</div>';
        (d.buckets || ['por_vencer','1-30','31-60','61-90','90+']).forEach(function (b) {
          var val = (d.totales || {})[b] || 0;
          var pct = total > 0 ? Math.round((val / total) * 100) : 0;
          html += '<div class="rep-bucket-row">' +
            '<div class="rep-bucket-label">' + (lbls[b] || b) + '</div>' +
            '<div class="rep-bucket-bar" style="background:' + (cols[b] || '#94a3b8') + ';width:' + pct + '%;max-width:calc(100% - 160px);"></div>' +
            '<div class="rep-bucket-val" style="color:' + (cols[b] || '#94a3b8') + ';">' + fmt(val) +
            ' <span style="color:var(--text-secondary);font-weight:400;">(' + pct + '%)</span></div>' +
            '</div>';
        });
        _el('rep-aging').innerHTML = html;
      })
      .catch(function (err) { _el('rep-aging').innerHTML = _errHtml(err.message || 'Error'); });
  }

  // ── Inventario KPIs — always empresa-wide ─────────────────────────────────
  function loadInventario() {
    AdminAPI.apiFetch('/api/inventario/kpis')
      .then(function (d) {
        var rows = [
          ['Productos activos',  fmtNum(d.productos)],
          ['Valor total stock',  fmt(d.valor_total)],
          ['Sin stock', '<span style="color:var(--danger);font-weight:700;">' + fmtNum(d.sin_stock) + '</span>'],
          ['Bodegas',            fmtNum(d.bodegas)],
          ['Resguardos activos', fmtNum(d.resguardos)],
          ['Apartados (hist.)',  fmtNum(d.apartados)],
        ];
        _el('rep-inventario').innerHTML = rows.map(function (r) {
          return '<div class="rep-kv"><span class="rep-kv-label">' + r[0] +
            '</span><span class="rep-kv-val">' + r[1] + '</span></div>';
        }).join('');
      })
      .catch(function (err) { _el('rep-inventario').innerHTML = _errHtml(err.message || 'Error'); });
  }

  // ── Top clientes CxC — empresa-wide ──────────────────────────────────────
  function loadTopClientes() {
    AdminAPI.apiFetch('/api/accounts-receivable?status=Pendiente')
      .then(function (list) {
        if (!list || !list.length) { _el('rep-top-clients').innerHTML = _emptyHtml('Sin cuentas pendientes'); return; }
        var sorted = list.slice().sort(function (a, b) {
          return (b.current_balance || 0) - (a.current_balance || 0);
        }).slice(0, 7);
        var html = '<table class="rep-tbl"><thead><tr>' +
          '<th>Cliente</th><th style="text-align:right;">Sucursal</th><th style="text-align:right;">Saldo</th><th style="text-align:right;">Días</th>' +
          '</tr></thead><tbody>';
        sorted.forEach(function (r) {
          var dias     = r.dias_vencido != null ? r.dias_vencido : '—';
          var dColor   = (r.dias_vencido > 30) ? 'color:var(--danger);' : '';
          var sucLabel = r.sucursal_id || '—';
          html += '<tr>' +
            '<td style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (r.client_name || r.client_id) + '">' + (r.client_name || r.client_id) + '</td>' +
            '<td style="text-align:right;font-size:10px;color:var(--text-secondary);">' + sucLabel + '</td>' +
            '<td style="text-align:right;font-weight:700;">' + fmt(r.current_balance) + '</td>' +
            '<td style="text-align:right;' + dColor + '">' + dias + '</td></tr>';
        });
        html += '</tbody></table>';
        if (list.length > 7) html += '<div style="font-size:11px;color:var(--text-secondary);text-align:right;margin-top:4px;">+' + (list.length - 7) + ' más</div>';
        _el('rep-top-clients').innerHTML = html;
      })
      .catch(function (err) { _el('rep-top-clients').innerHTML = _errHtml(err.message || 'Error'); });
  }

  // ── Cortes de caja ────────────────────────────────────────────────────────
  function loadCaja() {
    var qs = _scopeParam('caja');
    var note = _el('rep-caja-scope-note');
    if (note) note.textContent = (_scope === 'all' && _isAdmin) ? '(todas las sucursales)' : '(mi sucursal)';
    AdminAPI.apiFetch('/api/caja/historial?limit=8' + (_scope === 'all' && _isAdmin ? '&sucursal_id=ALL' : ''))
      .then(function (d) {
        var items = (d && d.items) || d || [];
        if (!items.length) { _el('rep-caja').innerHTML = _emptyHtml('Sin cortes registrados'); return; }
        var sLabels = { OPEN:'Abierto', CLOSED:'Cerrado', DISCREPANCY:'Diferencia', AUTHORIZED:'Autorizado' };
        var sColors = { OPEN:'#22c55e', CLOSED:'var(--text-secondary)', DISCREPANCY:'var(--danger)', AUTHORIZED:'var(--primary)' };
        var showSuc = (_scope === 'all' && _isAdmin);
        var html = '<table class="rep-tbl"><thead><tr>' +
          '<th>Fecha</th>' + (showSuc ? '<th>Sucursal</th>' : '') +
          '<th>Estado</th><th style="text-align:right;">Apertura</th><th style="text-align:right;">Diferencia</th>' +
          '</tr></thead><tbody>';
        items.forEach(function (s) {
          var fecha = s.created_at ? new Date(s.created_at).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' }) : '—';
          var color = sColors[s.status] || 'var(--text-secondary)';
          var lbl   = sLabels[s.status] || s.status;
          var diff  = s.difference != null
            ? '<span style="color:' + (s.difference < 0 ? 'var(--danger)' : 'var(--text-primary)') + ';font-weight:700;">' + fmt(s.difference) + '</span>'
            : '—';
          html += '<tr>' +
            '<td style="white-space:nowrap;">' + fecha + '</td>' +
            (showSuc ? '<td style="font-size:10px;color:var(--text-secondary);">' + (s.sucursal_id || '—') + '</td>' : '') +
            '<td><span style="color:' + color + ';font-weight:700;font-size:11px;">' + lbl + '</span></td>' +
            '<td style="text-align:right;">' + fmt(s.opening_amount) + '</td>' +
            '<td style="text-align:right;">' + diff + '</td></tr>';
        });
        html += '</tbody></table>';
        _el('rep-caja').innerHTML = html;
      })
      .catch(function (err) { _el('rep-caja').innerHTML = _errHtml(err.message || 'Error'); });
  }

  // ── Refresh all ───────────────────────────────────────────────────────────
  window.repRefreshAll = function () {
    ['rep-daily-chart','rep-top-products','rep-aging','rep-inventario','rep-top-clients','rep-caja'].forEach(function (id) {
      var el = _el(id); if (el) el.innerHTML = '<span class="rep-loading">Cargando...</span>';
    });
    loadDashboard();
    loadAging();
    loadInventario();
    loadTopClientes();
    loadCaja();
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  _initScopeBar();
  loadDashboard();
  loadAging();
  loadInventario();
  loadTopClientes();
  loadCaja();
};

window.pageInitHandlers['sellers-config']=function(){
const API = window.API_BASE || '/api';
  let selectedSellerId = null;
  let allEmployees = [];

  // Cargar lista de empleados
  fetch(`${API}/employees`, { credentials:'include' })
    .then(r => r.ok ? r.json() : [])
    .then(rows => {
      allEmployees = rows;
      renderSellerOptions(rows);
    });

  function renderSellerOptions(rows) {
    const sel = document.getElementById('seller-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Selecciona un vendedor —</option>' +
      rows.map(e => `<option value="${e.id}">${e.name || e.nombre || e.id} (${e.puesto||e.area||'—'})</option>`).join('');
  }

  window.searchSellers = function() {
    const q = (document.getElementById('seller-search')?.value||'').toLowerCase();
    renderSellerOptions(allEmployees.filter(e =>
      (e.name||e.nombre||'').toLowerCase().includes(q) || (e.puesto||'').toLowerCase().includes(q)
    ));
  };

  function showMsg(id, text, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'block';
    el.style.background = ok ? '#d1fae5' : '#fee2e2';
    el.style.color      = ok ? '#065f46' : '#991b1b';
    el.textContent = text;
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  window.loadSellerConfig = function() {
    selectedSellerId = document.getElementById('seller-select')?.value;
    if (!selectedSellerId) { document.getElementById('seller-config-area').style.display='none'; return; }
    document.getElementById('seller-config-area').style.display='block';
    loadCatalogPerms();
    loadCommRules();
  };

  // ── Catálogo ──────────────────────────────────────────────────────────────
  function loadCatalogPerms() {
    fetch(`${API}/sellers/${selectedSellerId}/catalog-permissions`, { credentials:'include' })
      .then(r => r.ok ? r.json() : [])
      .then(rows => {
        const tbody = document.getElementById('cat-perm-tbody');
        if (!tbody) return;
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--text-secondary);">Sin restricciones (acceso total)</td></tr>';
          return;
        }
        tbody.innerHTML = rows.map(r => `<tr>
          <td>${r.category}</td>
          <td style="color:${r.can_sell?'#065f46':'#991b1b'};font-weight:700">${r.can_sell?'✓ Puede':'✗ Bloqueado'}</td>
          <td><button class="btn btn-sm" style="font-size:0.68rem;padding:2px 8px;background:#fee2e2;color:#991b1b;"
            onclick="deleteCatalogPerm('${r.id}')">Quitar</button></td>
        </tr>`).join('');
      });
  }

  window.addCatalogPerm = function() {
    const cat    = document.getElementById('cat-perm-cat')?.value.trim();
    const canStr = document.getElementById('cat-perm-can')?.value;
    if (!cat) { showMsg('cat-perm-msg','Escribe la categoría',false); return; }
    fetch(`${API}/sellers/${selectedSellerId}/catalog-permissions`, {
      method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ category: cat, can_sell: canStr === 'true' })
    }).then(r => r.ok ? r.json() : r.json().then(e=>{throw new Error(e.detail);}))
      .then(() => { showMsg('cat-perm-msg','Guardado',true); document.getElementById('cat-perm-cat').value=''; loadCatalogPerms(); })
      .catch(err => showMsg('cat-perm-msg',err.message,false));
  };

  window.deleteCatalogPerm = function(permId) {
    fetch(`${API}/sellers/${selectedSellerId}/catalog-permissions/${permId}`, { method:'DELETE', credentials:'include' })
      .then(() => loadCatalogPerms());
  };

  // ── Comisiones ────────────────────────────────────────────────────────────
  window.toggleCommScopeValue = function() {
    const scope = document.getElementById('comm-scope')?.value;
    const inp   = document.getElementById('comm-scope-value');
    if (inp) inp.disabled = (scope === 'default');
    if (scope === 'default' && inp) inp.value = '';
  };
  toggleCommScopeValue();

  function loadCommRules() {
    fetch(`${API}/sellers/${selectedSellerId}/commission-rules`, { credentials:'include' })
      .then(r => r.ok ? r.json() : [])
      .then(rows => {
        const tbody = document.getElementById('comm-rules-tbody');
        if (!tbody) return;
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:12px;color:var(--text-secondary);">Sin reglas explícitas</td></tr>';
          return;
        }
        tbody.innerHTML = rows.map(r => `<tr>
          <td>${r.scope}</td>
          <td>${r.scope_value||'-'}</td>
          <td>${(parseFloat(r.rate||0)*100).toFixed(2)}%</td>
          <td><button class="btn btn-sm" style="font-size:0.68rem;padding:2px 8px;background:#fee2e2;color:#991b1b;"
            onclick="deleteCommRule('${r.id}')">Quitar</button></td>
        </tr>`).join('');
      });
  }

  window.addCommRule = function() {
    const scope  = document.getElementById('comm-scope')?.value;
    const val    = document.getElementById('comm-scope-value')?.value.trim() || null;
    const ratePct= parseFloat(document.getElementById('comm-rate')?.value);
    if (isNaN(ratePct)) { showMsg('comm-msg','Tasa inválida',false); return; }
    if (scope !== 'default' && !val) { showMsg('comm-msg','Escribe el valor (categoría o escala)',false); return; }
    fetch(`${API}/sellers/${selectedSellerId}/commission-rules`, {
      method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ scope, scope_value: scope==='default'?null:val, rate: ratePct/100 })
    }).then(r => r.ok ? r.json() : r.json().then(e=>{throw new Error(e.detail);}))
      .then(() => { showMsg('comm-msg','Regla guardada',true); document.getElementById('comm-rate').value=''; loadCommRules(); })
      .catch(err => showMsg('comm-msg',err.message,false));
  };

  window.deleteCommRule = function(ruleId) {
    fetch(`${API}/sellers/${selectedSellerId}/commission-rules/${ruleId}`, { method:'DELETE', credentials:'include' })
      .then(() => loadCommRules());
  };

  window.simulateRate = function() {
    const cat   = document.getElementById('sim-category')?.value.trim() || '';
    const scale = document.getElementById('sim-scale')?.value.trim() || '';
    let url = `${API}/sellers/${selectedSellerId}/commission-rate`;
    const params = [];
    if (cat)   params.push(`category=${encodeURIComponent(cat)}`);
    if (scale) params.push(`price_scale=${encodeURIComponent(scale)}`);
    if (params.length) url += '?' + params.join('&');
    fetch(url, { credentials:'include' }).then(r => r.ok ? r.json() : null).then(d => {
      const el = document.getElementById('sim-result');
      if (!d || !el) return;
      el.textContent = `Tasa: ${(parseFloat(d.rate||0)*100).toFixed(4)}%  |  scope: ${d.scope}${d.scope_value?' ('+d.scope_value+')':''}`;
    });
  };
};

window.pageInitHandlers['rutas']=function(){
'use strict';

  var API = '';
  var refreshInterval = null;

  // ── Tabs ──────────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.getElementById('panel-' + t.dataset.tab).classList.add('active');
    });
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _statusClass(s) {
    return { planned:'sp-planned', in_progress:'sp-in_progress',
             completed:'sp-completed', cancelled:'sp-cancelled' }[s] || 'sp-planned';
  }
  function _statusLabel(s) {
    return { planned:'Planeada', in_progress:'En curso',
             completed:'Completada', cancelled:'Cancelada' }[s] || s;
  }
  function _stopChip(s) {
    var bg = { pending:'#e2e8f0', arrived:'#fef3c7', delivered:'#dcfce7', skipped:'#fee2e2' }[s] || '#e2e8f0';
    var c  = { pending:'#64748b', arrived:'#d97706', delivered:'#16a34a', skipped:'#dc2626' }[s] || '#64748b';
    return 'background:' + bg + ';color:' + c;
  }

  // ── Lista de rutas ─────────────────────────────────────────────────────────
  async function _loadList() {
    var date = document.getElementById('filter-date').value;
    var url  = API + '/api/routes' + (date ? '?route_date=' + date : '');
    var el   = document.getElementById('routes-list');
    el.textContent = 'Cargando…';
    try {
      var r = await fetch(url, { credentials: 'include' });
      if (!r.ok) { el.textContent = 'Error al cargar rutas'; return; }
      var rows = await r.json();
      if (!rows.length) { el.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Sin rutas para este criterio.</p>'; return; }
      el.innerHTML = '';
      rows.forEach(function (rt) {
        var div = document.createElement('div');
        div.className = 'route-row';
        div.innerHTML = [
          '<div class="route-info">',
            '<div class="date-label">' + rt.route_date + '</div>',
            '<div class="sub">Usuario: ' + rt.assigned_user + ' · Sede: ' + rt.sucursal_id + '</div>',
          '</div>',
          '<span class="status-pill ' + _statusClass(rt.status) + '">' + _statusLabel(rt.status) + '</span>',
          '<button class="btn btn-sm" style="background:#dbeafe;color:var(--accent)" data-id="' + rt.id + '">Ver en vivo</button>',
        ].join('');
        div.querySelector('button').addEventListener('click', function () {
          _openLive(rt.id);
        });
        el.appendChild(div);
      });
    } catch (e) { el.textContent = 'Error de red'; }
  }

  document.getElementById('btn-filter').addEventListener('click', _loadList);

  // ── Live view ─────────────────────────────────────────────────────────────
  function _openLive(routeId) {
    document.querySelectorAll('.tab,.panel').forEach(function (el) { el.classList.remove('active'); });
    document.getElementById('panel-live').style.display = 'block';
    _refreshLive(routeId);
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(function () { _refreshLive(routeId); }, 8000);
  }

  async function _refreshLive(routeId) {
    try {
      var r = await fetch(API + '/api/routes/' + routeId + '/live', { credentials: 'include' });
      if (!r.ok) return;
      var data = await r.json();
      document.getElementById('live-header').textContent =
        'Ruta en vivo — ' + data.status + ' · ID: ' + routeId.slice(0, 8) + '…';

      var banner = document.getElementById('deviation-banner');
      banner.style.display = data.is_deviated ? 'block' : 'none';

      var lp = data.last_ping;
      document.getElementById('gps-info').textContent = lp
        ? 'Último ping: ' + new Date(lp.recorded_at).toLocaleTimeString('es-MX') +
          ' · Lat ' + lp.lat.toFixed(5) + ' Lng ' + lp.lng.toFixed(5) +
          (lp.deviation_m != null ? ' · Desv: ' + Math.round(lp.deviation_m) + ' m' : '')
        : 'Sin pings recibidos.';

      var list = document.getElementById('stops-live-list');
      list.innerHTML = '';
      (data.stops || []).forEach(function (s) {
        var row = document.createElement('div');
        row.className = 'live-stop-row';
        row.innerHTML = [
          '<div class="live-seq">' + s.seq + '</div>',
          '<span class="live-label">' + (s.label || 'Parada ' + s.seq) + '</span>',
          '<span class="live-status" style="' + _stopChip(s.status) + '">' + s.status + '</span>',
        ].join('');
        list.appendChild(row);
      });
    } catch (e) {}
  }

  document.getElementById('btn-back-live').addEventListener('click', function () {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    document.getElementById('panel-live').style.display = 'none';
    document.getElementById('panel-list').classList.add('active');
    document.querySelector('[data-tab="list"]').classList.add('active');
  });

  // ── Crear ruta ─────────────────────────────────────────────────────────────
  var stopCount = 0;

  function _addStopRow() {
    stopCount++;
    var row = document.createElement('div');
    row.className = 'stop-row';
    row.dataset.seq = stopCount;
    row.innerHTML = [
      '<input type="number" value="' + stopCount + '" min="1" placeholder="#" title="Orden">',
      '<input type="text" placeholder="Etiqueta (cliente, dirección…)">',
      '<input type="number" step="any" placeholder="Lat (ej. 19.4326)">',
      '<input type="number" step="any" placeholder="Lng (ej. -99.1332)">',
      '<button class="btn btn-sm btn-danger" title="Quitar">✕</button>',
    ].join('');
    row.querySelector('button').addEventListener('click', function () { row.remove(); });
    document.getElementById('stops-rows').appendChild(row);
  }

  document.getElementById('btn-add-stop').addEventListener('click', _addStopRow);
  _addStopRow();

  document.getElementById('btn-save-route').addEventListener('click', async function () {
    var msg = document.getElementById('create-msg');
    msg.style.color = 'var(--muted)';
    msg.textContent = 'Guardando…';

    var routeDate  = document.getElementById('new-date').value;
    var user       = document.getElementById('new-user').value.trim();
    var sucursal   = document.getElementById('new-sucursal').value.trim();
    var threshold  = parseFloat(document.getElementById('new-threshold').value) || 150;

    if (!routeDate || !user || !sucursal) {
      msg.style.color = 'var(--danger)';
      msg.textContent = 'Completa fecha, usuario y sucursal.';
      return;
    }

    var stops = [];
    document.querySelectorAll('#stops-rows .stop-row').forEach(function (row) {
      var inputs = row.querySelectorAll('input');
      var lat = parseFloat(inputs[2].value);
      var lng = parseFloat(inputs[3].value);
      if (!isNaN(lat) && !isNaN(lng)) {
        stops.push({
          seq:     parseInt(inputs[0].value) || stops.length + 1,
          label:   inputs[1].value.trim() || null,
          lat:     lat,
          lng:     lng,
        });
      }
    });

    if (!stops.length) {
      msg.style.color = 'var(--danger)';
      msg.textContent = 'Agrega al menos una parada con coordenadas válidas.';
      return;
    }

    try {
      var r = await fetch(API + '/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sucursal_id: sucursal,
          assigned_user: user,
          route_date: routeDate,
          deviation_threshold_m: threshold,
          stops: stops,
        }),
      });
      if (r.ok) {
        msg.style.color = 'var(--success)';
        msg.textContent = 'Ruta creada correctamente.';
        document.getElementById('stops-rows').innerHTML = '';
        stopCount = 0;
        _addStopRow();
      } else {
        var err = await r.json().catch(function () { return {}; });
        msg.style.color = 'var(--danger)';
        msg.textContent = 'Error: ' + (err.detail || r.status);
      }
    } catch (e) {
      msg.style.color = 'var(--danger)';
      msg.textContent = 'Error de red';
    }
  });

  // Cargar lista al inicio
  var today = new Date().toISOString().slice(0, 10);
  document.getElementById('filter-date').value = today;
  _loadList();
};

window.pageInitHandlers['cuentas-cobrar']=function(){
/* ── CxC · CP2: cartera real (abonos, anticipos, antigüedad) ────────────── */
(function(){
  var _cxcData = [];
  var _aging   = null;
  var _sortCol = 'dias';
  var _sortAsc = false;
  var _abonoCuenta = null;

  function _tok(){ return localStorage.getItem('calebsys_token') || sessionStorage.getItem('auth_token') || ''; }
  function _h(){ var h={'Content-Type':'application/json'}; var t=_tok(); if(t) h['Authorization']='Bearer '+t; return h; }
  function api(p){ return fetch(p,{headers:_h(),credentials:'include'}).then(function(r){ return r.json(); }); }
  function post(p,body){
    return fetch(p,{method:'POST',headers:_h(),credentials:'include',body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(j){ return {status:r.status, body:j}; }); });
  }
  function money(n){ return '$' + Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function diasVencido(r){
    if(!r.due_date) return null;
    var hoy = new Date(); hoy.setHours(0,0,0,0);
    return Math.floor((hoy - new Date(r.due_date)) / 86400000);
  }

  // ── vista 1: cartera ────────────────────────────────────────────────
  function cxcCargar(){
    api('/api/accounts-receivable').then(function(data){
      _cxcData = Array.isArray(data) ? data : (data.items || []);
      document.getElementById('cxc-count').textContent = _cxcData.length + ' registros';
      cxcRender(_cxcData);
    }).catch(function(e){
      document.getElementById('cxc-table-body').innerHTML =
        '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger);">' + esc(e.message) + '</td></tr>';
    });
  }

  function cxcRender(list){
    var tb = document.getElementById('cxc-table-body');
    if(!list.length){ tb.innerHTML='<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted);">Sin cuentas por cobrar registradas</td></tr>'; return; }
    tb.innerHTML = list.map(function(r){
      var dias = diasVencido(r);
      var liquidada = r.status === 'Liquidado';
      var estado = liquidada ? 'Liquidada'
                 : dias === null ? 'Sin venc.'
                 : dias > 0 ? 'Vencida' : dias === 0 ? 'Vence hoy' : 'Vigente';
      var estadoClass = liquidada ? 'badge-success'
                      : dias > 30 ? 'badge-danger' : dias > 0 ? 'badge-warning' : 'badge-neutral';
      var rowStyle = liquidada ? 'opacity:.55;'
                   : dias > 30 ? 'background:rgba(239,68,68,0.04);'
                   : dias > 0 ? 'background:rgba(245,158,11,0.04);' : '';
      var anticipo = Number(r.anticipo_aplicado||0) > 0
        ? ' <span class="badge badge-neutral" title="Anticipo aplicado en la venta">ant. ' + money(r.anticipo_aplicado) + '</span>' : '';
      return '<tr style="' + rowStyle + '">' +
        '<td><strong>' + esc(r.client_name || r.client_id) + '</strong></td>' +
        '<td><span class="badge badge-neutral">' + esc(r.sale_folio || r.id.slice(0,8)) + '</span>' + anticipo + '</td>' +
        '<td style="text-align:right;font-weight:700;">' + money(r.current_balance) + '</td>' +
        '<td>' + (r.due_date ? r.due_date.slice(0,10) : '—') + '</td>' +
        '<td style="text-align:right;font-weight:700;color:' + (dias > 0 && !liquidada ? 'var(--danger)' : 'inherit') + ';">' +
          (liquidada ? '—' : dias === null ? '—' : dias > 0 ? '+'+dias : dias === 0 ? 'Hoy' : dias) + '</td>' +
        '<td><span class="badge ' + estadoClass + '">' + estado + '</span></td>' +
        '<td style="text-align:center;white-space:nowrap;">' +
          (liquidada ? '' :
            '<button class="btn btn-ghost btn-sm" title="Registrar abono" onclick="cxcAbrirAbono(\'' + r.id + '\')">' +
            '<i class="fa-solid fa-dollar-sign" style="color:var(--success);"></i></button>') +
          '<button class="btn btn-ghost btn-sm" title="Estado de cuenta" onclick="cxcEstadoCuenta(\'' + r.id + '\')">' +
          '<i class="fa-solid fa-receipt"></i></button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  // ── vista 2: antigüedad ─────────────────────────────────────────────
  function agingCargar(){
    api('/api/accounts-receivable/aging').then(function(rep){
      _aging = rep;
      document.getElementById('aging-asof').textContent =
        'al ' + String(rep.as_of||'').slice(0,10) + ' · ' + rep.cuentas + ' cuenta(s)';
      var tb = document.getElementById('aging-body');
      if(!rep.rows || !rep.rows.length){
        tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted);">Sin saldos pendientes</td></tr>';
        document.getElementById('aging-foot').innerHTML = '';
        return;
      }
      tb.innerHTML = rep.rows.map(function(r){
        var b = r.buckets || {};
        function c(k, danger){
          var v = Number(b[k]||0);
          return '<td style="text-align:right;' + (v>0&&danger?'color:var(--danger);font-weight:600;':'') + '">' +
                 (v ? money(v) : '—') + '</td>';
        }
        return '<tr>' +
          '<td><strong>' + esc(r.client_name) + '</strong> <span class="badge badge-neutral">' + r.cuentas + '</span></td>' +
          c('por_vencer', false) + c('1-30', false) + c('31-60', true) + c('61-90', true) + c('90+', true) +
          '<td style="text-align:right;font-weight:700;">' + money(r.total) + '</td>' +
        '</tr>';
      }).join('');
      var t = rep.totales || {};
      document.getElementById('aging-foot').innerHTML =
        '<tr style="border-top:2px solid var(--border);font-weight:700;">' +
        '<td>Total cartera</td>' +
        ['por_vencer','1-30','31-60','61-90','90+'].map(function(k){
          return '<td style="text-align:right;">' + money(t[k]||0) + '</td>'; }).join('') +
        '<td style="text-align:right;">' + money(rep.total_cartera) + '</td></tr>';
    }).catch(function(e){
      document.getElementById('aging-body').innerHTML =
        '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger);">' + esc(e.message) + '</td></tr>';
    });
  }


  // ── abonos ──────────────────────────────────────────────────────────
  window.cxcAbrirAbono = function(id){
    _abonoCuenta = _cxcData.filter(function(r){ return r.id === id; })[0];
    if(!_abonoCuenta) return;
    document.getElementById('abono-contexto').innerHTML =
      esc(_abonoCuenta.client_name) + ' · ' + esc(_abonoCuenta.sale_folio || '') +
      ' · saldo <strong>' + money(_abonoCuenta.current_balance) + '</strong>';
    document.getElementById('abono-monto').value = '';
    document.getElementById('abono-monto').max = _abonoCuenta.current_balance;
    document.getElementById('abono-hint').textContent = 'Máximo ' + money(_abonoCuenta.current_balance);
    document.getElementById('abono-ref').value = '';
    document.getElementById('abono-nota').value = '';
    document.getElementById('abono-origen').value = 'efectivo';
    document.getElementById('abono-error').textContent = '';
    cxcOrigenCambio();
    document.getElementById('modal-abono').classList.add('open');
  };
  window.cxcCerrarAbono = function(){ document.getElementById('modal-abono').classList.remove('open'); };
  window.cxcOrigenCambio = function(){
    var esSaldo = document.getElementById('abono-origen').value === 'saldo_favor';
    document.getElementById('abono-metodo-wrap').hidden = esSaldo;
  };

  window.cxcGuardarAbono = function(){
    if(!_abonoCuenta) return;
    var err = document.getElementById('abono-error');
    var monto = parseFloat(document.getElementById('abono-monto').value);
    if(!(monto > 0)){ err.textContent = 'Captura un monto mayor a cero.'; return; }
    var btn = document.getElementById('abono-guardar');
    btn.disabled = true; err.textContent = '';
    var origen = document.getElementById('abono-origen').value;
    post('/api/accounts-receivable/' + _abonoCuenta.id + '/payments', {
      amount: monto,
      applied_from: origen,
      method: origen === 'saldo_favor' ? 'saldo_favor' : document.getElementById('abono-metodo').value,
      reference: document.getElementById('abono-ref').value || null,
      notes: document.getElementById('abono-nota').value || null,
      // Idempotencia: evita que un doble clic cobre dos veces.
      idempotency_key: 'ui-' + _abonoCuenta.id + '-' + Date.now()
    }).then(function(res){
      btn.disabled = false;
      if(res.status !== 201){
        var d = res.body && res.body.detail;
        err.textContent = (typeof d === 'string' ? d : (d && d.message) || 'No se pudo registrar el abono.');
        return;
      }
      cxcCerrarAbono();
      cxcCargar();
      if(typeof showToast === 'function')
        showToast('Abono registrado. Saldo: ' + money(res.body.balance_after), 'success');
    }).catch(function(e){ btn.disabled = false; err.textContent = e.message; });
  };

  window.cxcEstadoCuenta = function(id){
    var cta = _cxcData.filter(function(r){ return r.id === id; })[0];
    document.getElementById('estado-resumen').innerHTML = cta
      ? '<strong>' + esc(cta.client_name) + '</strong> · ' + esc(cta.sale_folio||'') +
        '<br>Original ' + money(cta.original_amount) +
        ' · Anticipo ' + money(cta.anticipo_aplicado) +
        ' · <strong>Saldo ' + money(cta.current_balance) + '</strong>'
      : '';
    document.getElementById('estado-body').innerHTML =
      '<tr><td colspan="6" style="text-align:center;padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
    document.getElementById('modal-estado-cuenta').classList.add('open');
    api('/api/accounts-receivable/' + id + '/payments').then(function(rows){
      var etiqueta = {efectivo:'Cobro en caja', saldo_favor:'Saldo a favor', anticipo:'Anticipo de la venta'};
      document.getElementById('estado-body').innerHTML = (rows||[]).length
        ? rows.map(function(p){
            return '<tr>' +
              '<td>' + String(p.created_at||'').slice(0,10) + '</td>' +
              '<td>' + esc(etiqueta[p.applied_from] || p.applied_from) + '</td>' +
              '<td>' + esc(p.method) + '</td>' +
              '<td>' + esc(p.reference || '—') + '</td>' +
              '<td style="text-align:right;font-weight:600;">' + money(p.amount) + '</td>' +
              '<td style="text-align:right;">' + money(p.balance_after) + '</td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">Sin abonos registrados</td></tr>';
    });
  };
  window.cxcCerrarEstado = function(){ document.getElementById('modal-estado-cuenta').classList.remove('open'); };

  // ── filtros / orden / export ────────────────────────────────────────
  window.cxcFiltrar = function(){
    var q = (document.getElementById('cxc-search-input').value||'').toLowerCase();
    cxcRender(_cxcData.filter(function(r){
      return (r.client_name||'').toLowerCase().indexOf(q) >= 0
          || (r.sale_folio||'').toLowerCase().indexOf(q) >= 0;
    }));
  };
  window.cxcOrdenar = function(col){
    if(_sortCol===col) _sortAsc=!_sortAsc; else { _sortCol=col; _sortAsc=true; }
    var s=_sortAsc?1:-1;
    function val(r){
      if(col==='dias') return diasVencido(r) === null ? -99999 : diasVencido(r);
      if(col==='monto') return Number(r.current_balance||0);
      if(col==='vencimiento') return r.due_date || '';
      if(col==='cliente') return (r.client_name||'').toLowerCase();
      return (r.sale_folio||'').toLowerCase();
    }
    _cxcData.sort(function(a,b){ var av=val(a), bv=val(b); return av>bv?s:av<bv?-s:0; });
    cxcRender(_cxcData);
  };

  function bajarCSV(nombre, filas){
    var csv = filas.map(function(f){
      return f.map(function(c){ return '"' + String(c==null?'':c).replace(/"/g,'""') + '"'; }).join(',');
    }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8;'}));
    a.download = nombre; a.click(); URL.revokeObjectURL(a.href);
  }

  window.cxcExportar = function(){
    bajarCSV('cartera.csv', [['Cliente','Documento','Original','Anticipo','Saldo','Vencimiento','Dias vencido','Estado']]
      .concat(_cxcData.map(function(r){
        return [r.client_name, r.sale_folio, r.original_amount, r.anticipo_aplicado,
                r.current_balance, (r.due_date||'').slice(0,10), diasVencido(r), r.status];
      })));
  };
  window.cxcExportarAging = function(){
    if(!_aging) return;
    var head = ['Cliente','Cuentas','Por vencer','1-30','31-60','61-90','90+','Total'];
    bajarCSV('antiguedad-saldos.csv', [head].concat(_aging.rows.map(function(r){
      var b=r.buckets||{};
      return [r.client_name, r.cuentas, b['por_vencer'], b['1-30'], b['31-60'], b['61-90'], b['90+'], r.total];
    })));
  };

  function cxcInit(){ cxcCargar(); agingCargar(); }
  window.cxcCargar = cxcCargar;
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',cxcInit); else setTimeout(cxcInit,0);
})();
};

window.pageInitHandlers['productos']=function(){
window._productsAll = [];
  window._productsFilter = 'all';
  window._productsQuery = '';

  window.productsSetFilter = function(el, filter) {
    document.querySelectorAll('#productos-tabs .pill-tab').forEach(function(t){ t.classList.remove('active'); });
    el.classList.add('active');
    window._productsFilter = filter;
    productsRender();
  };

  window.productsSearch = function(q) {
    window._productsQuery = q.toLowerCase().trim();
    productsRender();
  };

  window.productsRender = function() {
    var items = window._productsAll || [];
    var filter = window._productsFilter || 'all';
    var q = window._productsQuery || '';

    // Apply filter
    if (filter === 'active') items = items.filter(function(p){ return p.is_active !== false; });
    else if (filter === 'nostock') items = items.filter(function(p){ return Number(p.stock || p.stock_actual || 0) <= 0; });

    // Apply search
    if (q) {
      items = items.filter(function(p){
        return (p.nombre||p.name||'').toLowerCase().includes(q) ||
               (p.sku||p.barcode||'').toLowerCase().includes(q);
      });
    }

    var countEl = document.getElementById('products-count');
    if (countEl) countEl.textContent = items.length + ' productos';

    var container = document.getElementById('products-table-body');
    if (!container) return;

    if (!items.length) {
      container.innerHTML = '<div class="empty-state" style="padding:40px;">' +
        '<div class="empty-icon"><i class="fa-solid fa-box-open"></i></div>' +
        '<div class="empty-title">Sin resultados</div>' +
        '<div class="empty-desc">No se encontraron productos con los filtros aplicados.</div>' +
        '</div>';
      return;
    }

    var rows = items.map(function(p) {
      var price = Number(p.precio_venta || p.price || p.sale_price || 0);
      var stock = Number(p.stock || p.stock_actual || 0);
      var statusBadge = p.is_active !== false
        ? '<span class="badge badge-success"><span class="dot"></span>Activo</span>'
        : '<span class="badge badge-neutral">Inactivo</span>';

      var stockHtml = stock <= 0 
        ? '<span style="color:var(--danger);font-weight:600;">' + stock + '</span>' 
        : '<span>' + stock + '</span>';

      return '<tr>' +
        '<td class="td-mono">' + (p.sku || p.barcode || '—') + '</td>' +
        '<td style="font-weight:600;">' + (p.nombre || p.name || '—') + '</td>' +
        '<td>' + AdminAPI.fmtCurrency(price) + '</td>' +
        '<td>' + stockHtml + '</td>' +
        '<td class="td-muted">' + (p.unidad_venta || p.unit || '—') + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td style="text-align:right;white-space:nowrap;">' +
          '<button class="btn btn-ghost btn-sm btn-icon" title="Ver Detalle" onclick="productsDetail(\'' + (p.id||p.sku) + '\')">' +
            '<i class="fa-solid fa-eye" style="font-size:12px;color:var(--brand-400);"></i>' +
          '</button>' +
          '<button class="btn btn-ghost btn-sm btn-icon" title="Editar (Bloqueado)" disabled style="opacity:0.4;cursor:not-allowed;">' +
            '<i class="fa-solid fa-pen-to-square" style="font-size:12px;color:var(--text-muted);"></i>' +
          '</button>' +
          '<button class="btn btn-ghost btn-sm btn-icon" title="Ver Kardex (Bloqueado)" disabled style="opacity:0.4;cursor:not-allowed;">' +
            '<i class="fa-solid fa-clock-rotate-left" style="font-size:12px;color:var(--text-muted);"></i>' +
          '</button>' +
        '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<table>' +
      '<thead><tr><th>SKU</th><th>Nombre</th><th>Precio Venta</th><th>Stock</th><th>Unidad</th><th>Estado</th><th style="text-align:right;">Acciones</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  };

  window.productsDetail = function(id) {
    var p = (window._productsAll || []).find(function(x){ return x.id === id || x.sku === id; });
    if (!p) return;
    
    var modal = document.getElementById('modal-detalle-producto');
    if (!modal) return;

    modal.querySelector('#det-prod-name').textContent = p.nombre || p.name || 'Sin nombre';
    modal.querySelector('#det-prod-sku').textContent = p.sku || p.barcode || '—';
    modal.querySelector('#det-prod-desc').textContent = p.descripcion || p.description || 'Sin descripción';
    
    var statusHtml = p.is_active !== false
        ? '<span class="badge badge-success"><span class="dot"></span>Activo</span>'
        : '<span class="badge badge-neutral">Inactivo</span>';
    modal.querySelector('#det-prod-status').innerHTML = statusHtml;

    var price = Number(p.precio_venta || p.price || p.sale_price || 0);
    modal.querySelector('#det-prod-price').textContent = AdminAPI.fmtCurrency(price);
    
    modal.querySelector('#det-prod-unit').textContent = p.unidad_venta || p.unit || '—';
    
    var stock = Number(p.stock || p.stock_actual || 0);
    modal.querySelector('#det-prod-stock').textContent = stock + ' unidades';

    openModal('modal-detalle-producto');
  };
};
