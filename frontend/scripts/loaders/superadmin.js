/* =============================================================
   loaders/superadmin.js — Consola del dueño del software (S-2)
   GET/POST /api/superadmin/tenants · PUT .../{empresa_id}
   Solo se usa cuando calebsys_role === 'superadmin'.
   ============================================================= */
(function (global) {
  'use strict';

  function _tok() {
    return localStorage.getItem('calebsys_token')
        || sessionStorage.getItem('auth_token')
        || localStorage.getItem('auth_token') || '';
  }
  function _api(path, opts) {
    var h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + _tok() };
    return fetch(path, Object.assign({ headers: h, credentials: 'include' }, opts))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.detail || ('HTTP ' + r.status));
          return d;
        });
      });
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _msg(text, ok) {
    var m = document.getElementById('st-msg');
    if (!m) return;
    m.textContent = text; m.style.display = '';
    m.style.background = ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
    m.style.color = ok ? 'var(--success)' : 'var(--danger)';
    setTimeout(function () { m.style.display = 'none'; }, 4000);
  }

  global.loadTenants = async function () {
    var tb = document.getElementById('st-tbody');
    if (!tb) return;
    try {
      var rows = await _api('/api/superadmin/tenants');
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:16px;color:var(--text-muted);">Sin tenants todavía</td></tr>';
        return;
      }
      tb.innerHTML = rows.map(function (t) {
        var suspended = (t.status || '').toUpperCase() === 'SUSPENDED';
        var badge = '<span style="font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:10px;background:' +
          (suspended ? 'rgba(239,68,68,.15);color:var(--danger)' : 'rgba(16,185,129,.15);color:var(--success)') +
          ';">' + (suspended ? 'SUSPENDIDO' : 'ACTIVO') + '</span>';
        var btnToggle = suspended
          ? '<button class="btn btn-secondary btn-sm" style="font-size:0.66rem;" onclick="toggleTenant(\'' + t.empresa_id + '\',\'ACTIVE\')"><i class="fa-solid fa-play"></i> Reactivar</button>'
          : '<button class="btn btn-secondary btn-sm" style="font-size:0.66rem;" onclick="toggleTenant(\'' + t.empresa_id + '\',\'SUSPENDED\')"><i class="fa-solid fa-pause"></i> Suspender</button>';
        var btnCfdi = '<button class="btn btn-secondary btn-sm" style="font-size:0.66rem;margin-left:4px;" onclick="saAbrirCfdi(\'' + _esc(t.empresa_id) + '\',\'' + _esc(t.nombre) + '\')"><i class="fa-solid fa-file-invoice"></i> CFDI</button>';
        return '<tr>' +
          '<td class="td-mono" style="font-weight:700;">' + _esc(t.empresa_id) + '</td>' +
          '<td>' + _esc(t.nombre) + '</td>' +
          '<td class="td-muted">' + _esc(t.plan || '') + '</td>' +
          '<td>' + (t.usuarios != null ? t.usuarios : '—') + '</td>' +
          '<td>' + (t.sucursales != null ? t.sucursales : '—') + '</td>' +
          '<td>' + (t.productos != null ? t.productos : '—') + '</td>' +
          '<td>' + (t.clientes != null ? t.clientes : '—') + '</td>' +
          '<td>' + badge + '</td>' +
          '<td style="white-space:nowrap;">' + btnToggle + btnCfdi + '</td>' +
          '</tr>';
      }).join('');
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="9" style="color:var(--danger);padding:16px;">' + _esc(e.message) + '</td></tr>';
    }
  };

  global.crearTenant = async function () {
    var body = {
      prefijo:        ((document.getElementById('st-prefijo')    || {}).value || '').trim(),
      nombre:         ((document.getElementById('st-nombre')     || {}).value || '').trim(),
      rfc:            ((document.getElementById('st-rfc')        || {}).value || '').trim() || null,
      plan:           ((document.getElementById('st-plan')       || {}).value || '').trim() || 'CalebSys MVP',
      admin_username: ((document.getElementById('st-admin-user') || {}).value || '').trim(),
      admin_password:  (document.getElementById('st-admin-pw')   || {}).value || '',
    };
    try {
      var res = await _api('/api/superadmin/tenants', { method: 'POST', body: JSON.stringify(body) });
      _msg(res.message || ('Tenant ' + res.empresa_id + ' creado.'), true);
      ['st-prefijo', 'st-nombre', 'st-rfc', 'st-admin-user', 'st-admin-pw'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
      loadTenants();
    } catch (e) {
      _msg('Error: ' + e.message, false);
    }
  };

  global.toggleTenant = async function (empresaId, nuevoEstado) {
    var verbo = nuevoEstado === 'SUSPENDED' ? 'suspender' : 'reactivar';
    if (!confirm('¿Seguro que quieres ' + verbo + ' el tenant ' + empresaId + '?')) return;
    try {
      await _api('/api/superadmin/tenants/' + encodeURIComponent(empresaId),
                 { method: 'PUT', body: JSON.stringify({ status: nuevoEstado }) });
      loadTenants();
    } catch (e) {
      _msg('Error: ' + e.message, false);
    }
  };

  // ── CFDI modal por tenant ──────────────────────────────────────────────────
  var _saCfdiTenant = null;

  function _saCfdiMsg(text, ok) {
    var m = document.getElementById('sa-cfdi-msg');
    if (!m) return;
    m.textContent = text; m.style.display = '';
    m.style.background = ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
    m.style.color = ok ? 'var(--success)' : 'var(--danger)';
  }

  global.saOnPacModeChange = function () {
    var mode = (document.getElementById('sa-cfdi-pac-mode') || {}).value;
    var sec = document.getElementById('sa-cfdi-pac-section');
    if (sec) sec.style.display = (mode === 'other') ? 'none' : '';
  };

  global.saAbrirCfdi = async function (empresaId, nombre) {
    _saCfdiTenant = empresaId;
    var lbl = document.getElementById('sa-cfdi-tenant-label');
    if (lbl) lbl.textContent = empresaId + ' — ' + nombre;
    var overlay = document.getElementById('sa-cfdi-overlay');
    if (overlay) { overlay.style.display = 'flex'; }
    var msg = document.getElementById('sa-cfdi-msg');
    if (msg) msg.style.display = 'none';
    try {
      var cfg = await _api('/api/admin/integrations/cfdi?target_empresa=' + encodeURIComponent(empresaId));
      var g = function (id) { return document.getElementById(id); };
      if (g('sa-cfdi-rfc'))         g('sa-cfdi-rfc').value         = cfg.rfc_emisor        || '';
      if (g('sa-cfdi-lugar'))       g('sa-cfdi-lugar').value       = cfg.lugar_expedicion  || '';
      if (g('sa-cfdi-nombre'))      g('sa-cfdi-nombre').value      = cfg.nombre_emisor     || '';
      if (g('sa-cfdi-regimen'))     g('sa-cfdi-regimen').value     = cfg.regimen_emisor    || '';
      if (g('sa-cfdi-pac-mode'))    g('sa-cfdi-pac-mode').value    = cfg.pac_mode          || 'platform';
      if (g('sa-cfdi-environment')) g('sa-cfdi-environment').value = cfg.environment       || 'sandbox';
      if (g('sa-cfdi-api-mode'))    g('sa-cfdi-api-mode').value    = cfg.api_mode          || 'multiemisor';
      if (g('sa-cfdi-api-user'))    g('sa-cfdi-api-user').value    = cfg.api_user          || '';
      if (g('sa-cfdi-api-password')) g('sa-cfdi-api-password').value = '';
      saOnPacModeChange();
    } catch (e) {
      _saCfdiMsg('Error cargando config: ' + e.message, false);
    }
  };

  global.saCerrarCfdi = function () {
    var overlay = document.getElementById('sa-cfdi-overlay');
    if (overlay) overlay.style.display = 'none';
    _saCfdiTenant = null;
  };

  global.saGuardarCfdi = async function () {
    if (!_saCfdiTenant) return;
    var g = function (id) { return (document.getElementById(id) || {}).value || ''; };
    var body = {
      rfc_emisor:        g('sa-cfdi-rfc').toUpperCase(),
      lugar_expedicion:  g('sa-cfdi-lugar'),
      nombre_emisor:     g('sa-cfdi-nombre'),
      regimen_emisor:    g('sa-cfdi-regimen'),
      pac_mode:          g('sa-cfdi-pac-mode'),
      environment:       g('sa-cfdi-environment'),
      api_mode:          g('sa-cfdi-api-mode'),
      api_user:          g('sa-cfdi-api-user'),
    };
    var pw = g('sa-cfdi-api-password');
    if (pw) body.api_password = pw;
    try {
      await _api('/api/admin/integrations/cfdi?target_empresa=' + encodeURIComponent(_saCfdiTenant),
                 { method: 'PUT', body: JSON.stringify(body) });
      _saCfdiMsg('Configuración guardada.', true);
    } catch (e) {
      _saCfdiMsg('Error guardando: ' + e.message, false);
    }
  };

  global.saProbarCfdi = async function () {
    if (!_saCfdiTenant) return;
    _saCfdiMsg('Probando timbrado…', true);
    try {
      var res = await _api('/api/admin/integrations/cfdi/test?target_empresa=' + encodeURIComponent(_saCfdiTenant),
                           { method: 'POST', body: JSON.stringify({}) });
      _saCfdiMsg('OK: ' + (res.message || res.uuid || JSON.stringify(res)), true);
    } catch (e) {
      _saCfdiMsg('Error en prueba: ' + e.message, false);
    }
  };

})(window);
