/* =============================================================
   loaders/admin.js — CalebSys Módulo Administración v1.0 (Fase 2)
   Cubre: auditoría, usuarios del sistema, empresa/config
   ============================================================= */
(function (global) {
  'use strict';

  /* ── helpers ── */
  function api(path, opts) {
    var h = { 'Content-Type': 'application/json' };
    // calebsys_token es la clave canónica del login — auth_token mantenido como fallback legacy
    var tok = localStorage.getItem('calebsys_token')
           || sessionStorage.getItem('auth_token')
           || localStorage.getItem('auth_token')
           || '';
    if (tok) h['Authorization'] = 'Bearer ' + tok;
    return fetch(path, Object.assign({ headers: h, credentials: 'include' }, opts)).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || 'HTTP ' + r.status); });
      return r.json();
    });
  }
  function post(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }
  function put(path, body)  { return api(path, { method: 'PUT',  body: JSON.stringify(body) }); }
  function del(path)        { return api(path, { method: 'DELETE' }); }

  function fmtD(v) {
    if (!v) return '—';
    try { return new Date(v).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }); }
    catch(e) { return v; }
  }

  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'rh-toast';
    t.style.background = type === 'error' ? 'var(--danger)' : (type === 'warn' ? 'var(--warning)' : '');
    t.innerHTML = '<i class="fa-solid ' + (type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check') + '"></i> ' + msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3000);
  }

  /* ─────────────────────────────────────────────────────────
     AUDITORÍA — /api/admin/audit-logs
  ───────────────────────────────────────────────────────── */
  var _auditSeverity = '';

  global.loadAuditLogs = async function () {
    var tbody = document.getElementById('audit-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="center"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...</td></tr>';

    var search = ((document.getElementById('audit-search') || {}).value || '').trim();
    var params = new URLSearchParams({ limit: 200 });
    if (_auditSeverity) params.set('severity', _auditSeverity);
    if (search)         params.set('search', search);

    try {
      var data  = await api('/api/admin/audit-logs?' + params.toString());
      var items = data.items || [];
      var cnt   = document.getElementById('audit-count');
      if (cnt) cnt.textContent = data.total + ' registros';

      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state" style="padding:32px"><div class="empty-icon"><i class="fa-solid fa-shield-halved"></i></div><div class="empty-title">Sin registros de auditoría</div></div></td></tr>';
        return;
      }

      var SEV_COLORS = { INFO: '#3b82f6', WARNING: '#f59e0b', CRITICAL: '#ef4444', SECURITY: '#8b5cf6' };
      tbody.innerHTML = items.map(function (r) {
        var color = SEV_COLORS[r.severity] || '#6b7280';
        var badge = '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:0.65rem;font-weight:700;background:' + color + '22;color:' + color + '">' + (r.severity || 'INFO') + '</span>';
        var detail = r.details ? JSON.stringify(r.details).slice(0, 60) + '…' : '—';
        return '<tr>' +
          '<td class="td-muted">' + fmtD(r.created_at) + '</td>' +
          '<td class="td-mono" style="font-size:0.78rem;">' + (r.user_id || '—') + '</td>' +
          '<td style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (r.action || '—') + '</td>' +
          '<td>' + badge + '</td>' +
          '<td class="td-muted">' + (r.ip_address || '—') + '</td>' +
          '<td class="td-muted" style="font-size:0.7rem;">' + detail + '</td>' +
          '</tr>';
      }).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--danger);padding:20px;">' + e.message + '</td></tr>';
    }
  };

  // Pill-tabs de severidad
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('#audit-tabs .pill-tab');
    if (!tab) return;
    document.querySelectorAll('#audit-tabs .pill-tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    _auditSeverity = tab.dataset.sev || '';
    global.loadAuditLogs();
  });
  var _auditSearchTimer = null;
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'audit-search') {
      clearTimeout(_auditSearchTimer);
      _auditSearchTimer = setTimeout(function () { global.loadAuditLogs(); }, 300);
    }
  });

  /* ─────────────────────────────────────────────────────────
     USUARIOS DEL SISTEMA — /api/admin/users
  ───────────────────────────────────────────────────────── */
  var _adminUsers = [];
  var _rolesCat = null;

  /** D2: puebla los <select> de rol (#nu-role / #eu-role) desde el catálogo
      del tenant en vez de la lista fija del HTML. */
  global.loadRolesCatalog = async function () {
    try {
      var data = await api('/api/admin/roles');
      _rolesCat = (data && data.roles) || [];
    } catch (e) {
      console.warn('[admin.js] loadRolesCatalog:', e.message);
      return;
    }
    ['nu-role', 'eu-role'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var prev = sel.value;
      sel.innerHTML = _rolesCat.map(function (r) {
        return '<option value="' + r.slug + '">' + (r.label || r.slug) +
               (r.is_system ? ' (sistema)' : '') + '</option>';
      }).join('');
      if (prev) sel.value = prev;
    });
  };

  global.loadAdminUsers = async function () {
    var tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="center"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...</td></tr>';
    loadRolesCatalog();   // D2: llena los <select> de rol

    try {
      _adminUsers = await api('/api/admin/users');
      var cnt = document.getElementById('users-count');
      if (cnt) cnt.textContent = _adminUsers.length + ' usuarios';

      if (!_adminUsers.length) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state" style="padding:32px"><div class="empty-icon"><i class="fa-solid fa-users-gear"></i></div><div class="empty-title">Sin usuarios registrados</div></div></td></tr>';
        return;
      }

      var ROLE_COLORS = { admin:'#ef4444', ADMIN:'#ef4444', Gerente:'#f59e0b', GERENTE:'#f59e0b', Vendedor:'#8b5cf6', VENDEDOR:'#8b5cf6', Cajero:'#3b82f6', CAJERO:'#3b82f6', Almacenista:'#10b981', ALMACENISTA:'#10b981' };
      tbody.innerHTML = _adminUsers.map(function (u, i) {
        var rc = ROLE_COLORS[u.role] || '#6b7280';
        var roleBadge = '<span style="display:inline-flex;padding:2px 8px;border-radius:12px;font-size:0.65rem;font-weight:700;background:' + rc + '22;color:' + rc + '">' + u.role + '</span>';
        var active = u.status === 'ACTIVE' || u.status === 'active';
        var statusDot = '<span style="display:inline-flex;align-items:center;gap:5px;font-size:0.75rem;color:' + (active ? 'var(--success)' : 'var(--text-muted)') + '"><span style="width:7px;height:7px;border-radius:50%;background:currentColor;display:inline-block;"></span>' + (active ? 'Activo' : 'Inactivo') + '</span>';
        return '<tr>' +
          '<td class="td-mono" style="font-size:0.72rem;">' + (u.id || '').slice(0, 8).toUpperCase() + '</td>' +
          '<td style="font-weight:600;">' + (u.username || '—') + '</td>' +
          '<td>' + roleBadge + '</td>' +
          '<td class="td-muted">' + (u.sucursal_id || '—') + '</td>' +
          '<td>' + statusDot + '</td>' +
          '<td class="td-muted">' + fmtD(u.created_at) + '</td>' +
          '<td style="display:flex;gap:6px;">' +
            '<button class="btn btn-secondary btn-sm" style="font-size:0.68rem;" onclick="openModalEditarUsuario(\'' + u.id + '\')"><i class="fa-solid fa-user-pen"></i> Editar</button>' +
            (active
              ? '<button class="btn btn-secondary btn-sm" style="font-size:0.68rem;" onclick="adminToggleUser(\'' + u.id + '\',\'INACTIVE\')"><i class="fa-solid fa-ban"></i> Desactivar</button>'
              : '<button class="btn btn-secondary btn-sm" style="font-size:0.68rem;" onclick="adminToggleUser(\'' + u.id + '\',\'ACTIVE\')"><i class="fa-solid fa-check"></i> Activar</button>') +
          '</td>' +
          '</tr>';
      }).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--danger);padding:20px;">' + e.message + '</td></tr>';
    }
  };

  global.adminToggleUser = async function (userId, newStatus) {
    try {
      await put('/api/admin/users/' + userId, { status: newStatus });
      toast(newStatus === 'INACTIVE' ? 'Usuario desactivado' : 'Usuario activado');
      global.loadAdminUsers();
    } catch (e) { toast(e.message, 'error'); }
  };

  /** Puebla un <select> de sucursales reales desde /api/branches (compartido
      entre los modales de Nuevo/Editar usuario). preselectId, si se pasa,
      queda seleccionado; si no existe entre las opciones cargadas se agrega
      igual (ej. una sucursal desactivada) para no perder el valor actual. */
  async function _populateSucursalSelect(sel, preselectId) {
    if (!sel) return;
    sel.innerHTML = '<option value="">Cargando...</option>';
    try {
      var branches = await api('/api/branches');
      if (!branches || !branches.length) {
        sel.innerHTML = '<option value="MATRIZ">MATRIZ (sin sucursales)</option>';
      } else {
        sel.innerHTML = branches.map(function (b) {
          var sel_ = preselectId ? (b.id === preselectId) : !!b.is_main;
          return '<option value="' + b.id + '"' + (sel_ ? ' selected' : '') + '>' +
                 b.name + (b.status === 'INACTIVE' ? ' (inactiva)' : '') + '</option>';
        }).join('');
      }
      if (preselectId && sel.value !== preselectId) {
        var opt = document.createElement('option');
        opt.value = preselectId; opt.textContent = preselectId + ' (no encontrada)'; opt.selected = true;
        sel.appendChild(opt);
      }
    } catch (e) {
      sel.innerHTML = '<option value="MATRIZ" selected>MATRIZ (sucursal principal)</option>';
      console.warn('[admin.js] branches fallback a MATRIZ:', e.message);
    }
  }

  global.openModalNuevoUsuario = async function () {
    var m = document.getElementById('modal-nuevo-usuario');
    if (m) m.classList.add('open');

    // Reset campos de texto y error
    ['nu-username','nu-password','nu-error'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (id === 'nu-error') { el.style.display = 'none'; el.textContent = ''; }
      else el.value = '';
    });
    await loadRolesCatalog();
    var roleEl = document.getElementById('nu-role');
    if (roleEl && [].some.call(roleEl.options, function (o) { return o.value === 'cajero'; })) {
      roleEl.value = 'cajero';
    }

    await _populateSucursalSelect(document.getElementById('nu-sucursal'));
  };
  global.closeModalNuevoUsuario = function () {
    var m = document.getElementById('modal-nuevo-usuario');
    if (m) m.classList.remove('open');
  };
  global.guardarNuevoUsuario = async function () {
    var username  = ((document.getElementById('nu-username') || {}).value || '').trim();
    var password  = ((document.getElementById('nu-password') || {}).value || '').trim();
    var role      = ((document.getElementById('nu-role')     || {}).value || '').trim() || 'cajero';
    var sucursal  = ((document.getElementById('nu-sucursal') || {}).value || '').trim() || 'MATRIZ';
    var errEl     = document.getElementById('nu-error');
    if (!username || !password) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = 'Usuario y contraseña son obligatorios.'; }
      return;
    }
    if (!sucursal) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = 'Selecciona la sede base.'; }
      return;
    }
    if (errEl) errEl.style.display = 'none';
    var btn = document.getElementById('btn-guardar-usuario');
    if (btn) btn.disabled = true;
    try {
      await post('/api/admin/users', { username: username, password: password, role: role, sucursal_id: sucursal });
      global.closeModalNuevoUsuario();
      toast('Usuario "' + username + '" creado');
      global.loadAdminUsers();
    } catch (e) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = e.message; }
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /** Edición de rol/sucursal de un usuario existente (PUT /api/admin/users/{id},
      ya soportado por el backend desde antes -- esta es la UI que faltaba). */
  global.openModalEditarUsuario = async function (userId) {
    var u = _adminUsers.find(function (x) { return x.id === userId; });
    if (!u) { toast('Usuario no encontrado en la lista cargada', 'error'); return; }

    var m = document.getElementById('modal-editar-usuario');
    if (m) m.classList.add('open');

    document.getElementById('eu-user-id').value = u.id;
    var label = document.getElementById('eu-username-label');
    if (label) label.textContent = u.username;
    var errEl = document.getElementById('eu-error');
    if (errEl) errEl.style.display = 'none';

    var roleEl = document.getElementById('eu-role');
    if (roleEl) {
      // Si el rol actual no está en el catálogo fijo (dato viejo con texto
      // libre), se agrega como opción extra para no perderlo silenciosamente.
      if (u.role && !Array.prototype.some.call(roleEl.options, function (o) { return o.value === u.role; })) {
        var extraOpt = document.createElement('option');
        extraOpt.value = u.role; extraOpt.textContent = u.role + ' (rol libre, fuera de catálogo)';
        roleEl.appendChild(extraOpt);
      }
      roleEl.value = u.role || 'Cajero';
    }

    await _populateSucursalSelect(document.getElementById('eu-sucursal'), u.sucursal_id);
  };
  global.closeModalEditarUsuario = function () {
    var m = document.getElementById('modal-editar-usuario');
    if (m) m.classList.remove('open');
  };
  global.guardarEditarUsuario = async function () {
    var userId   = (document.getElementById('eu-user-id') || {}).value;
    var role     = ((document.getElementById('eu-role')     || {}).value || '').trim();
    var sucursal = ((document.getElementById('eu-sucursal') || {}).value || '').trim();
    var errEl    = document.getElementById('eu-error');
    if (!userId) return;
    if (!role || !sucursal) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = 'Rol y sede base son obligatorios.'; }
      return;
    }
    if (errEl) errEl.style.display = 'none';
    var btn = document.getElementById('btn-editar-usuario');
    if (btn) btn.disabled = true;
    try {
      await put('/api/admin/users/' + userId, { role: role, sucursal_id: sucursal });
      global.closeModalEditarUsuario();
      toast('Usuario actualizado');
      global.loadAdminUsers();
    } catch (e) {
      if (errEl) { errEl.style.display = ''; errEl.textContent = e.message; }
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /* ─────────────────────────────────────────────────────────
     EMPRESA / CONFIGURACIÓN — /api/admin/empresa + /api/admin/config
  ───────────────────────────────────────────────────────── */
  global.loadEmpresaConfig = async function () {
    try {
      var data = await api('/api/admin/empresa');
      var el;
      el = document.getElementById('config-empresa-id');    if (el) el.value = data.empresa_id || '';
      el = document.getElementById('config-total-users');   if (el) el.value = data.total_users || 0;
      el = document.getElementById('config-sucursales');    if (el) el.value = data.total_sucursales || 0;
      el = document.getElementById('config-plan');          if (el) el.value = data.plan || '—';
    } catch (e) {
      console.warn('[admin.js] loadEmpresaConfig empresa:', e.message);
    }

    // Cargar valores guardados del ticket desde /api/admin/config?prefix=ticket
    try {
      var cfg = await api('/api/admin/config?prefix=ticket');
      var h = document.getElementById('ticket-header');
      var f = document.getElementById('ticket-footer');
      var v = document.getElementById('ticket-iva');
      if (h && cfg['ticket.header'] !== undefined) h.value = cfg['ticket.header'] || '';
      if (f && cfg['ticket.footer'] !== undefined) f.value = cfg['ticket.footer'] || '';
      if (v && cfg['ticket.iva']    !== undefined) v.value = cfg['ticket.iva']    || 16;
    } catch (e) {
      // Si no hay config guardada aun, los placeholders del HTML son suficientes
      console.info('[admin.js] Sin config de ticket guardada:', e.message);
    }

    // D3: parámetros / folios / catálogos (editor estructurado de AdminConfig)
    if (document.getElementById('card-adminconfig')) loadD3();
    // D4: terminales autorizadas por sede
    if (document.getElementById('ms-tbody')) loadTerminales();
    // CP2: integración CFDI (Facturama)
    if (document.getElementById('card-cfdi')) loadCfdiConfig();
  };

  /* ─────────────────────────────────────────────────────────
     S-1 — Configuración inicial: importar catálogos
     GET /api/admin/import/plantilla/{tipo}  ·  POST /api/admin/import/{tipo}
  ───────────────────────────────────────────────────────── */
  function _impTok() {
    return localStorage.getItem('calebsys_token')
        || sessionStorage.getItem('auth_token')
        || localStorage.getItem('auth_token') || '';
  }

  global.descargarPlantilla = async function () {
    var tipo = (document.getElementById('imp-tipo') || {}).value || 'productos';
    try {
      var r = await fetch('/api/admin/import/plantilla/' + tipo, {
        headers: { Authorization: 'Bearer ' + _impTok() }, credentials: 'include',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var blob = await r.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'plantilla_' + tipo + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      toast('No se pudo descargar la plantilla: ' + e.message, 'error');
    }
  };

  global.importarCatalogo = async function (dryRun) {
    var tipo = (document.getElementById('imp-tipo') || {}).value || 'productos';
    var fileEl = document.getElementById('imp-file');
    var box = document.getElementById('imp-result');
    var f = fileEl && fileEl.files && fileEl.files[0];
    if (!f) { toast('Elige un archivo .xlsx o .csv primero', 'warn'); return; }

    var fd = new FormData();
    fd.append('file', f);
    if (box) {
      box.style.display = '';
      box.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando ' + f.name + '…';
    }
    try {
      var r = await fetch('/api/admin/import/' + tipo + '?dry_run=' + (dryRun ? 'true' : 'false'), {
        method: 'POST', headers: { Authorization: 'Bearer ' + _impTok() },
        credentials: 'include', body: fd,
      });
      var d = await r.json();
      if (!r.ok) throw new Error(d.detail || ('HTTP ' + r.status));

      var modo = d.dry_run ? 'SIMULACIÓN (no se guardó nada)' : 'APLICADO';
      var head = (d.errores && d.errores.length)
        ? '<b style="color:var(--danger)">' + modo + ' — con ' + d.errores.length + ' error(es)</b>'
        : '<b style="color:var(--success)">' + modo + ' ✓</b>';
      var errs = (d.errores || []).slice(0, 30).map(function (e) {
        return '<div style="color:var(--danger)">· fila ' + e.fila +
          (e.dato ? ' (' + _acfgEsc(e.dato) + ')' : '') + ': ' + _acfgEsc(e.motivo) + '</div>';
      }).join('');
      var stats;
      if (tipo === 'apertura') {
        stats = 'Filas leídas: ' + d.total +
          ' · DEBE: $' + (d.total_debe || '0.00') +
          ' · HABER: $' + (d.total_haber || '0.00') +
          ' · con error: ' + (d.errores ? d.errores.length : 0);
      } else {
        stats = 'Filas leídas: ' + d.total +
          ' · creados: ' + d.creados + ' · actualizados: ' + d.actualizados +
          ' · con error: ' + (d.errores ? d.errores.length : 0);
      }
      if (box) {
        box.innerHTML = head +
          '<div style="margin-top:4px;">' + stats + '</div>' +
          (errs ? '<div style="margin-top:6px;">' + errs +
            ((d.errores || []).length > 30 ? '<div>… y más</div>' : '') + '</div>' : '');
      }
      if (!d.dry_run && d.ok) {
        if (tipo === 'apertura') {
          toast('Apertura registrada: ' + d.total + ' líneas, DEBE = HABER = $' + (d.total_debe || '0.00'));
        } else {
          toast('Importación aplicada: ' + d.creados + ' nuevos, ' + d.actualizados + ' actualizados');
        }
      }
    } catch (e) {
      if (box) box.innerHTML = '<b style="color:var(--danger)">Error: ' + _acfgEsc(e.message) + '</b>';
    }
  };

  /* ─────────────────────────────────────────────────────────
     D4 — Terminales autorizadas por sede
     GET/PUT /api/multisucursal/config
  ───────────────────────────────────────────────────────── */
  var _msTerminales = {};

  function _msMsg(text, ok) {
    var m = document.getElementById('ms-msg');
    if (!m) return;
    m.textContent = text; m.style.display = '';
    m.style.background = ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
    m.style.color = ok ? 'var(--success)' : 'var(--danger)';
    setTimeout(function () { m.style.display = 'none'; }, 3500);
  }

  function _msRender() {
    var tb = document.getElementById('ms-tbody');
    if (!tb) return;
    var ids = Object.keys(_msTerminales);
    if (!ids.length) {
      tb.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:14px;color:var(--text-muted);">Sin terminales registradas</td></tr>';
      return;
    }
    tb.innerHTML = ids.map(function (id) {
      var t = _msTerminales[id] || {};
      return '<tr>' +
        '<td class="td-mono">' + _acfgEsc(id) + '</td>' +
        '<td>' + _acfgEsc(t.sucursal_id || '') + '</td>' +
        '<td>' + _acfgEsc(t.label || '') + '</td>' +
        '<td><button class="btn btn-secondary btn-sm" style="font-size:0.68rem;" onclick="quitarTerminal(\'' + _acfgEsc(id) + '\')"><i class="fa-solid fa-trash"></i></button></td>' +
        '</tr>';
    }).join('');
  }

  global.loadTerminales = async function () {
    try {
      var cfg = await api('/api/multisucursal/config');
      _msTerminales = cfg.terminales || {};
      var en = document.getElementById('ms-enforce');
      if (en) en.value = cfg.enforce ? '1' : '0';
      _msRender();
    } catch (e) {
      var tb = document.getElementById('ms-tbody');
      if (tb) tb.innerHTML = '<tr><td colspan="4" style="color:var(--danger);padding:14px;">' + _acfgEsc(e.message) + '</td></tr>';
    }
  };

  global.agregarTerminal = function () {
    var id  = ((document.getElementById('ms-new-id')    || {}).value || '').trim();
    var suc = ((document.getElementById('ms-new-suc')   || {}).value || '').trim();
    var lab = ((document.getElementById('ms-new-label') || {}).value || '').trim();
    if (!id || !suc) { _msMsg('terminal_id y sede son obligatorios.', false); return; }
    _msTerminales[id] = { sucursal_id: suc, label: lab || id };
    document.getElementById('ms-new-id').value = '';
    document.getElementById('ms-new-suc').value = '';
    document.getElementById('ms-new-label').value = '';
    _msRender();
    _msMsg('Agregada (recuerda Guardar).', true);
  };

  global.quitarTerminal = function (id) {
    delete _msTerminales[id];
    _msRender();
    _msMsg('Quitada (recuerda Guardar).', true);
  };

  global.guardarTerminales = async function () {
    var enforce = ((document.getElementById('ms-enforce') || {}).value || '0') === '1';
    try {
      await put('/api/multisucursal/config', { enforce: enforce, terminales: _msTerminales });
      _msMsg('Terminales guardadas.', true);
      toast('Terminales actualizadas');
    } catch (e) {
      _msMsg('Error: ' + e.message, false);
    }
  };

  /* ─────────────────────────────────────────────────────────
     D3 — Editor estructurado de AdminConfig
     GET /api/admin/config  ·  PUT /api/admin/config/{key}
     Secciones: params.* · folio.* · catalog.* · avanzado
  ───────────────────────────────────────────────────────── */

  function _acfgEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _acfgShowMsg(elId, text, ok) {
    var m = document.getElementById(elId);
    if (!m) return;
    m.textContent = text;
    m.style.display = '';
    m.style.background = ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
    m.style.color      = ok ? 'var(--success)' : 'var(--danger)';
    setTimeout(function () { m.style.display = 'none'; }, 3000);
  }

  // Estado local de chips en memoria
  var _chipData = {};   // {catalogKey: [valor, ...]}

  // ── D3 entry point ──────────────────────────────────────
  global.loadD3 = async function () {
    try {
      var all = await api('/api/admin/config');
      _loadD3Params(all);
      _loadD3Folios(all);
      _loadD3Catalogos(all);
    } catch (e) {
      console.warn('[D3] Error cargando AdminConfig:', e.message);
    }
  };

  // ── D3-A: Parámetros generales ──────────────────────────
  function _loadD3Params(all) {
    var p = all['params.empresa_nombre'];
    var m = all['params.moneda'];
    var iv = all['params.iva_porcentaje'];
    var z = all['params.zona_horaria'];
    var el;
    if ((el = document.getElementById('acfg-empresa-nombre')) && p != null) el.value = p;
    if ((el = document.getElementById('acfg-moneda')) && m != null) el.value = m;
    if ((el = document.getElementById('acfg-iva')) && iv != null) el.value = iv;
    if ((el = document.getElementById('acfg-zona')) && z != null) el.value = z;
  }

  global.guardarParams = async function () {
    var nombre = (document.getElementById('acfg-empresa-nombre') || {}).value || '';
    var moneda = (document.getElementById('acfg-moneda') || {}).value || 'MXN';
    var iva    = parseFloat((document.getElementById('acfg-iva') || {}).value || 16);
    var zona   = (document.getElementById('acfg-zona') || {}).value || '';
    try {
      await Promise.all([
        put('/api/admin/config/params.empresa_nombre',  nombre),
        put('/api/admin/config/params.moneda',          moneda),
        put('/api/admin/config/params.iva_porcentaje',  iva),
        put('/api/admin/config/params.zona_horaria',    zona),
      ]);
      _acfgShowMsg('acfg-params-msg', 'Parámetros guardados.', true);
      toast('Parámetros guardados');
    } catch (e) {
      _acfgShowMsg('acfg-params-msg', 'Error: ' + e.message, false);
    }
  };

  // ── D3-B: Folios ────────────────────────────────────────
  var _FOLIO_DOCS = [
    { key: 'folio.venta',       label: 'Venta' },
    { key: 'folio.cotizacion',  label: 'Cotización' },
    { key: 'folio.compra',      label: 'Orden de Compra' },
    { key: 'folio.devolucion',  label: 'Devolución' },
    { key: 'folio.cfdi',        label: 'CFDI (Factura)' },
  ];

  function _loadD3Folios(all) {
    var tb = document.getElementById('acfg-folios-tbody');
    if (!tb) return;
    tb.innerHTML = _FOLIO_DOCS.map(function (fd) {
      var val = all[fd.key];
      var serie = (val && val.serie) ? val.serie : '';
      var sig   = (val && val.siguiente != null) ? val.siguiente : '';
      var esCfdi = fd.key === 'folio.cfdi';
      return '<tr>' +
        '<td>' + _acfgEsc(fd.label) +
          (esCfdi ? ' <span style="font-size:0.7rem;color:var(--text-muted);">(ver Datos Fiscales)</span>' : '') +
        '</td>' +
        '<td><input class="form-control" style="height:30px;font-size:0.82rem;' + (esCfdi ? 'opacity:.6;' : '') + '" ' +
          'id="folio-serie-' + _acfgEsc(fd.key) + '" value="' + _acfgEsc(serie) + '" ' +
          'placeholder="A"' + (esCfdi ? ' readonly' : '') + '></td>' +
        '<td><input class="form-control" type="number" min="1" style="height:30px;font-size:0.82rem;' + (esCfdi ? 'opacity:.6;' : '') + '" ' +
          'id="folio-sig-' + _acfgEsc(fd.key) + '" value="' + _acfgEsc(sig) + '" ' +
          'placeholder="1"' + (esCfdi ? ' readonly' : '') + '></td>' +
        '<td>' + (!esCfdi ?
          '<button class="btn btn-primary btn-sm" style="font-size:0.7rem;padding:3px 8px;" ' +
            'onclick="guardarFolio(\'' + _acfgEsc(fd.key) + '\')">' +
            '<i class="fa-solid fa-floppy-disk"></i></button>' :
          '') +
        '</td>' +
        '</tr>';
    }).join('');
  }

  global.guardarFolio = async function (key) {
    var serie = ((document.getElementById('folio-serie-' + key) || {}).value || '').trim();
    var sig   = parseInt((document.getElementById('folio-sig-' + key) || {}).value || 1, 10);
    if (!serie) { _acfgShowMsg('acfg-folios-msg', 'La serie no puede estar vacía.', false); return; }
    if (isNaN(sig) || sig < 1) { _acfgShowMsg('acfg-folios-msg', 'El siguiente número debe ser ≥ 1.', false); return; }
    try {
      await put('/api/admin/config/' + encodeURIComponent(key), { serie: serie, siguiente: sig });
      _acfgShowMsg('acfg-folios-msg', 'Folio «' + key + '» guardado.', true);
    } catch (e) {
      _acfgShowMsg('acfg-folios-msg', 'Error: ' + e.message, false);
    }
  };

  // ── D3-C: Catálogos maestros ────────────────────────────
  var _CATALOG_KEYS = ['formas_pago', 'unidades', 'bancos'];

  function _loadD3Catalogos(all) {
    _CATALOG_KEYS.forEach(function (ck) {
      var val = all['catalog.' + ck];
      _chipData[ck] = Array.isArray(val) ? val.slice() : [];
      _renderChips(ck);
    });
  }

  function _renderChips(ck) {
    var wrap = document.getElementById('chips-' + ck.replace(/_/g, '-'));
    if (!wrap) return;
    var items = _chipData[ck] || [];
    if (items.length === 0) {
      wrap.innerHTML = '<span style="color:var(--text-muted);font-size:0.78rem;">Sin elementos</span>';
      return;
    }
    wrap.innerHTML = items.map(function (v, i) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(14,165,233,0.1);' +
        'border:1px solid rgba(14,165,233,0.25);border-radius:999px;padding:2px 10px;font-size:0.78rem;">' +
        _acfgEsc(v) +
        '<button style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0;margin-left:2px;" ' +
          'onclick="quitarChip(\'' + _acfgEsc(ck) + '\',' + i + ')">' +
          '<i class="fa-solid fa-xmark" style="font-size:0.65rem;"></i></button>' +
        '</span>';
    }).join('');
  }

  global.agregarChip = function (ck) {
    var inputId = 'chip-input-' + ck.replace(/_/g, '-');
    var inp = document.getElementById(inputId);
    if (!inp) return;
    var val = inp.value.trim();
    if (!val) return;
    if (!_chipData[ck]) _chipData[ck] = [];
    if (_chipData[ck].indexOf(val) === -1) {
      _chipData[ck].push(val);
      _renderChips(ck);
    }
    inp.value = '';
    inp.focus();
  };

  global.quitarChip = function (ck, idx) {
    if (_chipData[ck]) {
      _chipData[ck].splice(idx, 1);
      _renderChips(ck);
    }
  };

  global.guardarCatalogo = async function (ck) {
    var items = _chipData[ck] || [];
    try {
      await put('/api/admin/config/' + encodeURIComponent('catalog.' + ck), items);
      _acfgShowMsg('acfg-catalog-msg', 'Catálogo «' + ck.replace(/_/g, ' ') + '» guardado.', true);
    } catch (e) {
      _acfgShowMsg('acfg-catalog-msg', 'Error: ' + e.message, false);
    }
  };

  // ── D3-D: Editor avanzado (JSON crudo) ─────────────────
  var _avanzadoCargado = false;

  global.toggleAvanzado = function () {
    var wrap = document.getElementById('acfg-avanzado');
    if (!wrap) return;
    var visible = wrap.style.display !== 'none';
    wrap.style.display = visible ? 'none' : '';
    if (!visible && !_avanzadoCargado) {
      _avanzadoCargado = true;
      loadConfigCatalogos();
    }
  };

  global.loadConfigCatalogos = async function () {
    var wrap = document.getElementById('acfg-list');
    if (!wrap) return;
    try {
      var all = await api('/api/admin/config');
      var skip = /^(multisucursal|integrations\.|ticket\.)/;
      var keys = Object.keys(all)
        .filter(function (k) { return /^(params|folio|catalog)\./.test(k) && !skip.test(k); })
        .sort();
      if (keys.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;">Sin claves guardadas.</div>';
        return;
      }
      wrap.innerHTML = keys.map(function (k) {
        var val = JSON.stringify(all[k], null, 2);
        return '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
            '<code style="font-weight:700;font-size:0.8rem;">' + _acfgEsc(k) + '</code>' +
            '<button class="btn btn-primary btn-sm" onclick="guardarClaveConfig(\'' + _acfgEsc(k) + '\')">' +
              '<i class="fa-solid fa-floppy-disk"></i></button>' +
          '</div>' +
          '<textarea class="form-control" data-acfg-key="' + _acfgEsc(k) + '" rows="' +
            Math.min(10, Math.max(2, val.split('\n').length)) + '" ' +
            'style="margin-top:6px;font-family:monospace;font-size:0.76rem;">' + _acfgEsc(val) + '</textarea>' +
          '</div>';
      }).join('');
    } catch (e) {
      wrap.innerHTML = '<div style="color:var(--danger);font-size:0.8rem;">Error: ' + _acfgEsc(e.message) + '</div>';
    }
  };

  global.guardarClaveConfig = async function (key) {
    var ta = document.querySelector('textarea[data-acfg-key="' + key + '"]');
    if (!ta) return;
    var parsed;
    try { parsed = JSON.parse(ta.value); }
    catch (e) { _acfgShowMsg('acfg-msg', '«' + key + '»: JSON inválido — ' + e.message, false); return; }
    try {
      await put('/api/admin/config/' + encodeURIComponent(key), parsed);
      _acfgShowMsg('acfg-msg', '«' + key + '» guardada.', true);
    } catch (e) {
      _acfgShowMsg('acfg-msg', 'Error al guardar «' + key + '»: ' + e.message, false);
    }
  };

  global.agregarClaveConfig = async function () {
    var k   = ((document.getElementById('acfg-new-key') || {}).value || '').trim();
    var raw = ((document.getElementById('acfg-new-val') || {}).value || '').trim();
    if (!/^(params|folio|catalog)\.[A-Za-z0-9_.\-]+$/.test(k)) {
      _acfgShowMsg('acfg-msg', 'La clave debe empezar con params. / folio. / catalog.', false); return;
    }
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { _acfgShowMsg('acfg-msg', 'JSON inválido — ' + e.message, false); return; }
    try {
      await put('/api/admin/config/' + encodeURIComponent(k), parsed);
      document.getElementById('acfg-new-key').value = '';
      document.getElementById('acfg-new-val').value = '';
      _acfgShowMsg('acfg-msg', '«' + k + '» creada.', true);
      loadConfigCatalogos();
    } catch (e) {
      _acfgShowMsg('acfg-msg', 'Error: ' + e.message, false);
    }
  };

  /* ─────────────────────────────────────────────────────────
     GUARDAR CONFIG DE TICKET — PUT /api/admin/config/{key}
  ───────────────────────────────────────────────────────── */
  global.guardarConfigTicket = async function () {
    var header = ((document.getElementById('ticket-header') || {}).value || '').trim();
    var footer = ((document.getElementById('ticket-footer') || {}).value || '').trim();
    var iva    = parseFloat((document.getElementById('ticket-iva') || {}).value || '16');
    var msg    = document.getElementById('ticket-save-msg');

    function showMsg(text, ok) {
      if (!msg) return;
      msg.textContent = text;
      msg.style.display = '';
      msg.style.background = ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
      msg.style.color      = ok ? 'var(--success)'        : 'var(--danger)';
      msg.style.border     = '1px solid ' + (ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)');
      setTimeout(function () { msg.style.display = 'none'; }, 3500);
    }

    try {
      await Promise.all([
        put('/api/admin/config/ticket.header', { value: header }),
        put('/api/admin/config/ticket.footer', { value: footer }),
        put('/api/admin/config/ticket.iva',    { value: iva    }),
      ]);
      showMsg('Configuracion del ticket guardada', true);
      toast('Ticket actualizado');
    } catch (e) {
      showMsg('Error: ' + e.message, false);
      toast(e.message, 'error');
    }
  };

  /* ─────────────────────────────────────────────────────────
     FASE C: INTEGRACIÓN WHATSAPP (TWILIO)
     GET/PUT /api/admin/integrations/whatsapp (+ /test, /log)
  ───────────────────────────────────────────────────────── */
  function _waMsg(text, ok) {
    var m = document.getElementById('wa-save-msg');
    if (!m) return;
    m.textContent = text;
    m.style.display = '';
    m.style.background = ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
    m.style.color      = ok ? 'var(--success)'        : 'var(--danger)';
    m.style.border     = '1px solid ' + (ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)');
    setTimeout(function () { m.style.display = 'none'; }, 4000);
  }

  function _waBadge(configured, statusText) {
    var b = document.getElementById('wa-status-badge');
    if (!b) return;
    if (configured) {
      b.textContent = 'Listo';
      b.style.background = 'rgba(16,185,129,0.15)'; b.style.color = 'var(--success)';
    } else {
      b.textContent = statusText || 'Sin configurar';
      b.style.background = 'rgba(245,158,11,0.15)'; b.style.color = 'var(--warning)';
    }
  }

  global.loadWhatsAppConfig = async function () {
    try {
      var c = await api('/api/admin/integrations/whatsapp');
      var el;
      el = document.getElementById('wa-enabled');     if (el) el.value = c.enabled ? '1' : '0';
      el = document.getElementById('wa-account-sid');  if (el) el.value = c.account_sid || '';
      el = document.getElementById('wa-from-number');  if (el) el.value = c.from_number || '';
      el = document.getElementById('wa-msg-sid');      if (el) el.value = c.messaging_service_sid || '';
      el = document.getElementById('wa-auth-token');   if (el) { el.value = ''; el.placeholder = c.has_auth_token ? '•••••• (guardado)' : 'Auth Token de Twilio'; }
      _waBadge(c.configured, c.config_status);
    } catch (e) {
      console.warn('[admin.js] loadWhatsAppConfig:', e.message);
      _waBadge(false, 'Error');
    }
    global.loadWhatsAppLog();
  };

  global.loadWhatsAppLog = async function () {
    var tb = document.getElementById('wa-log-tbody');
    if (!tb) return;
    try {
      var rows = await api('/api/admin/integrations/whatsapp/log');
      if (!rows || !rows.length) {
        tb.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:14px;color:var(--text-muted);">Sin actividad</td></tr>';
        return;
      }
      tb.innerHTML = rows.map(function (r) {
        var d = r.details || {};
        var txt = d.reason || d.error || d.provider_sid || (d.enabled != null ? ('enabled=' + d.enabled) : '') || '';
        var color = r.severity === 'WARNING' ? 'var(--danger)' : 'var(--text-muted)';
        return '<tr>' +
          '<td class="td-muted">' + fmtD(r.at) + '</td>' +
          '<td><code style="font-size:0.72rem;">' + (r.action || '') + '</code></td>' +
          '<td style="color:' + color + ';font-size:0.75rem;">' + txt + '</td>' +
          '</tr>';
      }).join('');
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="3" style="color:var(--danger);padding:12px;">' + e.message + '</td></tr>';
    }
  };

  global.guardarConfigWhatsApp = async function () {
    var body = {
      enabled:               (document.getElementById('wa-enabled') || {}).value === '1',
      account_sid:           ((document.getElementById('wa-account-sid') || {}).value || '').trim(),
      from_number:           ((document.getElementById('wa-from-number') || {}).value || '').trim(),
      messaging_service_sid: ((document.getElementById('wa-msg-sid') || {}).value || '').trim(),
    };
    var tok = ((document.getElementById('wa-auth-token') || {}).value || '').trim();
    if (tok) body.auth_token = tok;   // vacío => el backend conserva el actual

    try {
      var res = await put('/api/admin/integrations/whatsapp', body);
      _waMsg('Configuración guardada' + (res.configured ? '' : ' — falta: ' + res.config_status), !!res.configured);
      _waBadge(res.configured, res.config_status);
      var t = document.getElementById('wa-auth-token');
      if (t) { t.value = ''; t.placeholder = res.has_auth_token ? '•••••• (guardado)' : 'Auth Token de Twilio'; }
      toast('WhatsApp: configuración actualizada');
      global.loadWhatsAppLog();
    } catch (e) {
      _waMsg('Error: ' + e.message, false);
      toast(e.message, 'error');
    }
  };

  global.probarWhatsApp = async function () {
    var to = ((document.getElementById('wa-test-to') || {}).value || '').trim();
    if (!to) { _waMsg('Escribe un número de prueba en formato +52...', false); return; }
    try {
      var res = await post('/api/admin/integrations/whatsapp/test', { to: to });
      if (res.ok) {
        _waMsg('Mensaje de prueba enviado (SID ' + (res.provider_sid || '—') + ')', true);
        toast('WhatsApp de prueba enviado');
      } else {
        _waMsg('No se envió: ' + (res.reason || res.error || res.status), false);
        toast('WhatsApp: ' + (res.reason || res.error || 'falló'), 'error');
      }
      global.loadWhatsAppLog();
    } catch (e) {
      _waMsg('Error: ' + e.message, false);
      toast(e.message, 'error');
    }
  };

  /* ─────────────────────────────────────────────────────────
     P7: CRUD SUCURSALES — GET/POST/PUT /api/branches
  ───────────────────────────────────────────────────────── */
  global.loadSucursales = async function () {
    var tbody = document.getElementById('sucursales-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--text-muted);">Cargando...</td></tr>';
    try {
      var branches = await api('/api/branches');
      if (!branches || !branches.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--text-muted);">Sin sucursales registradas</td></tr>';
        return;
      }
      tbody.innerHTML = branches.map(function (b) {
        var badge = b.status === 'ACTIVE'
          ? '<span style="background:rgba(16,185,129,0.12);color:var(--success);font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:999px;">Activa</span>'
          : '<span style="background:rgba(239,68,68,0.10);color:var(--danger);font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:999px;">Inactiva</span>';
        var main = b.is_main ? '<i class="fa-solid fa-star" title="Principal" style="color:#f59e0b;margin-left:4px;font-size:0.75rem;"></i>' : '';
        return '<tr>' +
          '<td><strong>' + (b.name || '—') + '</strong>' + main + '</td>' +
          '<td>' + (b.address || '—') + '</td>' +
          '<td>' + (b.phone || '—') + '</td>' +
          '<td>' + badge + '</td>' +
          '<td><button class="btn btn-secondary btn-sm" style="padding:3px 10px;font-size:0.7rem;" onclick="abrirModalSucursal(' + JSON.stringify(b) + ')">' +
          '<i class="fa-solid fa-pen"></i></button></td>' +
          '</tr>';
      }).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--danger);padding:12px;">' + e.message + '</td></tr>';
    }
  };

  global.abrirModalSucursal = function (branch) {
    var modal = document.getElementById('modal-sucursal');
    var title = document.getElementById('modal-suc-title');
    var err   = document.getElementById('suc-error');
    if (!modal) return;
    // Limpiar error
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    if (branch) {
      // Editar
      if (title) title.innerHTML = '<i class="fa-solid fa-pen" style="color:var(--brand-400);margin-right:8px;"></i>Editar Sucursal';
      document.getElementById('suc-id').value      = branch.id      || '';
      document.getElementById('suc-name').value    = branch.name    || '';
      document.getElementById('suc-address').value = branch.address || '';
      document.getElementById('suc-phone').value   = branch.phone   || '';
      document.getElementById('suc-email').value   = branch.email   || '';
      document.getElementById('suc-status').value  = branch.status  || 'ACTIVE';
    } else {
      // Nueva
      if (title) title.innerHTML = '<i class="fa-solid fa-plus" style="color:var(--brand-400);margin-right:8px;"></i>Nueva Sucursal';
      document.getElementById('suc-id').value      = '';
      document.getElementById('suc-name').value    = '';
      document.getElementById('suc-address').value = '';
      document.getElementById('suc-phone').value   = '';
      document.getElementById('suc-email').value   = '';
      document.getElementById('suc-status').value  = 'ACTIVE';
    }
    modal.style.display = 'flex';
  };

  global.cerrarModalSucursal = function () {
    var modal = document.getElementById('modal-sucursal');
    if (modal) modal.style.display = 'none';
  };

  global.guardarSucursal = async function () {
    var id      = (document.getElementById('suc-id')      || {}).value || '';
    var name    = ((document.getElementById('suc-name')    || {}).value || '').trim();
    var address = ((document.getElementById('suc-address') || {}).value || '').trim();
    var phone   = ((document.getElementById('suc-phone')   || {}).value || '').trim();
    var email   = ((document.getElementById('suc-email')   || {}).value || '').trim();
    var status  = (document.getElementById('suc-status')  || {}).value || 'ACTIVE';
    var err     = document.getElementById('suc-error');
    var btn     = document.getElementById('btn-guardar-suc');

    function showErr(msg) {
      if (!err) return;
      err.textContent = msg;
      err.style.display = '';
    }
    if (!name) { showErr('El nombre es obligatorio.'); return; }

    if (btn) btn.disabled = true;
    try {
      if (id) {
        await put('/api/branches/' + id, { name, address, phone, email, status });
      } else {
        await post('/api/branches', { name, address, phone, email, status });
      }
      global.cerrarModalSucursal();
      toast('Sucursal guardada', 'success');
      await global.loadSucursales();
    } catch (e) {
      showErr('Error: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /* ─────────────────────────────────────────────────────────
     CP2 — INTEGRACIÓN CFDI (FACTURAMA · API Multiemisor)
     GET/PUT /api/admin/integrations/cfdi (+ /test, /csd)
     POST    /api/admin/cfdi/seed-catalogs

     Mismo contrato que la tarjeta de WhatsApp: las credenciales las captura
     el Admin del Tenant, el secreto nunca vuelve al front (se muestra como
     máscara) y dejar el campo vacío conserva el guardado.
  ───────────────────────────────────────────────────────── */
  function _cfdiMsg(text, ok) {
    var m = document.getElementById('cfdi-save-msg');
    if (!m) return;
    m.textContent = text;
    m.style.display = '';
    m.style.background = ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
    m.style.color      = ok ? 'var(--success)'        : 'var(--danger)';
    m.style.border     = '1px solid ' + (ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)');
    setTimeout(function () { m.style.display = 'none'; }, 6000);
  }

  function _cfdiBadge(configured, statusText, mock) {
    var b = document.getElementById('cfdi-status-badge');
    if (!b) return;
    if (mock) {
      b.textContent = 'Modo simulación';
      b.style.background = 'rgba(245,158,11,0.15)'; b.style.color = 'var(--warning)';
    } else if (configured) {
      b.textContent = 'Listo';
      b.style.background = 'rgba(16,185,129,0.15)'; b.style.color = 'var(--success)';
    } else {
      b.textContent = statusText || 'Sin configurar';
      b.style.background = 'rgba(148,163,184,0.15)'; b.style.color = 'var(--text-muted)';
    }
  }

  function _setVal(id, v) { var e = document.getElementById(id); if (e) e.value = v == null ? '' : v; }
  function _getVal(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }

  // Almacena si el usuario actual puede ver/editar campos PAC (se determina en el load).
  var _cfdiCanSeePac = false;

  function _applyPacModeUI(pac_mode, can_see_pac) {
    var platformInfo = document.getElementById('cfdi-pac-platform-info');
    var pacSection   = document.getElementById('cfdi-pac-section');
    var otherInfo    = document.getElementById('cfdi-pac-other-info');
    var csdSection   = document.getElementById('cfdi-csd-section');
    var showPac = can_see_pac && pac_mode !== 'other';
    if (platformInfo) platformInfo.style.display = (pac_mode === 'platform' && !can_see_pac) ? 'block' : 'none';
    if (pacSection)   pacSection.style.display   = showPac ? 'block' : 'none';
    if (otherInfo)    otherInfo.style.display     = (pac_mode === 'other') ? 'block' : 'none';
    if (csdSection)   csdSection.style.display    = (pac_mode === 'other') ? 'none' : '';
  }

  global.onCfdiPacModeChange = function () {
    var mode = _getVal('cfdi-pac-mode');
    // Cuando el usuario selecciona 'own' y antes no podía ver las credenciales PAC,
    // mostramos el bloque vacío para que las ingrese.
    var canSee = _cfdiCanSeePac || mode === 'own';
    _applyPacModeUI(mode, canSee);
  };

  global.loadCfdiConfig = async function () {
    try {
      var c = await api('/api/admin/integrations/cfdi');
      var pac_mode = c.pac_mode || 'platform';

      _setVal('cfdi-pac-mode', pac_mode);
      _setVal('cfdi-enabled', c.enabled ? '1' : '0');
      _setVal('cfdi-rfc-emisor', c.rfc_emisor);
      _setVal('cfdi-nombre-emisor', c.nombre_emisor);
      _setVal('cfdi-regimen-emisor', c.regimen_fiscal_emisor);
      _setVal('cfdi-lugar', c.lugar_expedicion);
      _setVal('cfdi-serie', c.serie_default || 'A');
      _setVal('cfdi-folios-mode', c.folios_mode || 'local');

      // El backend solo devuelve campos PAC si el usuario puede verlos.
      _cfdiCanSeePac = ('environment' in c);
      if (_cfdiCanSeePac) {
        _setVal('cfdi-environment', c.environment || 'sandbox');
        _setVal('cfdi-api-mode', c.api_mode || 'multiemisor');
        _setVal('cfdi-api-user', c.api_user);
        var pw = document.getElementById('cfdi-api-password');
        if (pw) pw.placeholder = c.has_api_password ? '(sin cambios)' : 'Contraseña de la API';
      }

      _applyPacModeUI(pac_mode, _cfdiCanSeePac);
      _cfdiBadge(c.configured, c.config_status, c.will_use_mock);

      var _csdTb   = document.getElementById('cfdi-csd-tbody');
      var _csdForm = document.getElementById('cfdi-csd-upload-form');
      if (c.will_use_mock || pac_mode === 'other') {
        if (_csdForm) _csdForm.style.display = 'none';
        var msg = pac_mode === 'other'
          ? 'PAC externo — el timbrado CFDI se gestiona fuera del sistema.'
          : 'Modo simulación activo — el CSD no se usa ni se envía al PAC.';
        if (_csdTb) _csdTb.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--text-muted);">' + msg + '</td></tr>';
      } else {
        if (_csdForm) _csdForm.style.display = 'block';
        loadCfdiCsds();
      }
    } catch (e) {
      console.warn('[admin.js] loadCfdiConfig:', e.message);
    }
  };

  global.guardarConfigCfdi = async function () {
    try {
      var pac_mode = _getVal('cfdi-pac-mode') || 'platform';
      var body = {
        pac_mode: pac_mode,
        enabled: _getVal('cfdi-enabled') === '1',
        rfc_emisor: _getVal('cfdi-rfc-emisor'),
        nombre_emisor: _getVal('cfdi-nombre-emisor'),
        regimen_fiscal_emisor: _getVal('cfdi-regimen-emisor'),
        lugar_expedicion: _getVal('cfdi-lugar'),
        serie_default: _getVal('cfdi-serie'),
        folios_mode: _getVal('cfdi-folios-mode')
      };
      // Campos PAC: si el bloque está visible (SUPERADMIN o pac_mode=own)
      var pacSection = document.getElementById('cfdi-pac-section');
      if (pacSection && pacSection.style.display !== 'none') {
        body.environment = _getVal('cfdi-environment');
        body.api_mode = _getVal('cfdi-api-mode');
        body.api_user = _getVal('cfdi-api-user');
        var pw = _getVal('cfdi-api-password');
        if (pw) body.api_password = pw;
      }

      var res = await put('/api/admin/integrations/cfdi', body);
      var pwEl = document.getElementById('cfdi-api-password');
      if (pwEl) { pwEl.value = ''; pwEl.placeholder = res.has_api_password ? '(sin cambios)' : 'Contraseña de la API'; }
      _cfdiBadge(res.configured, res.config_status, res.will_use_mock);
      _cfdiMsg(res.configured
        ? ('Configuración guardada — ' + (res.will_use_mock ? 'modo simulación (no timbra ante el SAT)' : 'entorno ' + (res.environment || 'producción')))
        : ('Guardado, pero falta: ' + res.config_status), res.configured);
      var _csdTb2   = document.getElementById('cfdi-csd-tbody');
      var _csdForm2 = document.getElementById('cfdi-csd-upload-form');
      var _resPacMode = res.pac_mode || 'platform';
      _cfdiCanSeePac = ('environment' in res);
      _applyPacModeUI(_resPacMode, _cfdiCanSeePac);
      if (res.will_use_mock || _resPacMode === 'other') {
        if (_csdForm2) _csdForm2.style.display = 'none';
        var msg2 = _resPacMode === 'other'
          ? 'PAC externo — el timbrado CFDI se gestiona fuera del sistema.'
          : 'Modo simulación activo — el CSD no se usa ni se envía al PAC.';
        if (_csdTb2) _csdTb2.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--text-muted);">' + msg2 + '</td></tr>';
      } else {
        if (_csdForm2) _csdForm2.style.display = 'block';
        loadCfdiCsds();
      }
    } catch (e) {
      _cfdiMsg('Error: ' + e.message, false);
    }
  };

  global.probarCfdi = async function () {
    _cfdiMsg('Timbrando comprobante de prueba…', true);
    try {
      var res = await post('/api/admin/integrations/cfdi/test', {});
      if (res.ok) {
        _cfdiMsg('Timbrado de prueba OK (' + res.mode + ') — folio fiscal ' + res.uuid, true);
      } else {
        _cfdiMsg('El PAC rechazó la prueba: ' + (res.error || 'sin detalle'), false);
      }
    } catch (e) {
      var msg = e.message || '';
      if (msg.indexOf('401') !== -1 || msg.toLowerCase().indexOf('token') !== -1) {
        msg = 'Sesión expirada — recarga la página e inicia sesión de nuevo.';
      }
      _cfdiMsg('Error: ' + msg, false);
    }
  };

  global.sembrarCatalogosSat = async function () {
    try {
      var res = await post('/api/admin/cfdi/seed-catalogs', {});
      _cfdiMsg('Catálogos SAT: ' + res.sembrados.length + ' sembrados, ' +
               res.respetados.length + ' respetados (ya editados). ' +
               'Se editan desde «Parámetros, folios y catálogos».', true);
      if (typeof loadConfigCatalogos === 'function') loadConfigCatalogos();
    } catch (e) {
      _cfdiMsg('Error: ' + e.message, false);
    }
  };

  /* CSD — sin sello digital cargado, el PAC no timbra para ese RFC. */
  global.loadCfdiCsds = async function () {
    var tb = document.getElementById('cfdi-csd-tbody');
    if (!tb) return;
    try {
      var res = await api('/api/admin/integrations/cfdi/csd');
      if (res.mode === 'mock') {
        tb.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--text-muted);">Modo simulación activo — el CSD no se usa ni se envía al PAC.</td></tr>';
        return;
      }
      var rows = res.csds || [];
      if (!res.ok) {
        tb.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--danger);">' +
                       (res.error || 'No se pudo consultar el PAC') + '</td></tr>';
        return;
      }
      tb.innerHTML = rows.length
        ? rows.map(function (c) {
            return '<tr><td>' + (c.Rfc || c.rfc || '—') + '</td>' +
                   '<td>' + (c.ExpirationDate || c.expirationDate || '—') + '</td>' +
                   '<td style="text-align:right;"><button class="btn btn-secondary btn-sm" onclick="eliminarCsd(\'' +
                   (c.Rfc || c.rfc) + '\')">Quitar</button></td></tr>';
          }).join('')
        : '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--warning);">' +
          'Sin sello digital cargado — el timbrado fallará hasta subir el .cer y .key del emisor.</td></tr>';
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--danger);">' + e.message + '</td></tr>';
    }
  };

  global.subirCsd = async function () {
    var rfc = _getVal('csd-rfc') || _getVal('cfdi-rfc-emisor');
    var pass = _getVal('csd-password');
    var cer = document.getElementById('csd-cer');
    var key = document.getElementById('csd-key');
    if (!rfc)  { _cfdiMsg('Captura el RFC del emisor.', false); return; }
    if (!cer || !cer.files.length || !key || !key.files.length) {
      _cfdiMsg('Selecciona los dos archivos del sello: .cer y .key', false); return;
    }
    if (!pass) { _cfdiMsg('Captura la contraseña de la llave privada.', false); return; }

    var fd = new FormData();
    fd.append('rfc', rfc);
    fd.append('password', pass);
    fd.append('cer', cer.files[0]);
    fd.append('key', key.files[0]);

    _cfdiMsg('Subiendo el sello digital al PAC…', true);
    try {
      var t = localStorage.getItem('calebsys_token') || sessionStorage.getItem('auth_token') || '';
      var r = await fetch('/api/admin/integrations/cfdi/csd', {
        method: 'POST', credentials: 'include',
        headers: t ? { Authorization: 'Bearer ' + t } : {},
        body: fd
      });
      var j = await r.json();
      if (r.status === 401) throw new Error('Sesión expirada — recarga la página e inicia sesión de nuevo.');
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail));
      if (j.mode === 'mock') {
        _cfdiMsg('Modo simulación: el CSD no se envió al PAC. Cambia el entorno a "sandbox" o "producción" y guarda las credenciales de Facturama primero.', false);
        return;
      }
      document.getElementById('csd-password').value = '';
      _cfdiMsg('Sello digital cargado para ' + (j.rfc || rfc) + '. Ya puedes timbrar.', true);
      loadCfdiCsds();
    } catch (e) {
      _cfdiMsg('No se pudo cargar el sello: ' + e.message, false);
    }
  };

  global.eliminarCsd = async function (rfc) {
    if (!confirm('¿Quitar el sello digital de ' + rfc + '? Dejará de poder timbrar con ese RFC.')) return;
    try {
      var t = localStorage.getItem('calebsys_token') || sessionStorage.getItem('auth_token') || '';
      var r = await fetch('/api/admin/integrations/cfdi/csd/' + encodeURIComponent(rfc), {
        method: 'DELETE', credentials: 'include',
        headers: t ? { Authorization: 'Bearer ' + t } : {}
      });
      if (!r.ok) throw new Error((await r.json()).detail || r.status);
      _cfdiMsg('Sello retirado.', true);
      loadCfdiCsds();
    } catch (e) {
      _cfdiMsg('Error: ' + e.message, false);
    }
  };

})(window);
