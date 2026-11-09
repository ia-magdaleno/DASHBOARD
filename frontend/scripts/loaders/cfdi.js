/* =============================================================================
   CALEBSYS ADMIN SHELL — OPERACIONES · CFDI
   Archivo: frontend/scripts/loaders/cfdi.js
   Lista todos los CFDI generados en 4 pestañas:
     1 Facturas (tipo I) · 2 Complemento de Pagos (P) · 3 Notas de Crédito (E)
     4 Carta Porte (T)
   Accesos rápidos: F1..F4 seleccionan la pestaña correspondiente.
   Regla de envío: SIEMPRE se envía el JUEGO COMPLETO (PDF + XML) en Facturas,
   Complementos de Pago, Notas de Crédito y Carta Porte por cualquier método.
   Fuente: GET /api/cfdi  (backend/routers/cfdi.py)
   ============================================================================= */

(function (global) {
  'use strict';

  var TABS = {
    facturas: { tipo: 'I', title: 'Facturas',             empty: 'No hay facturas emitidas' },
    pagos:    { tipo: 'P', title: 'Complemento de Pagos', empty: 'No hay complementos de pago emitidos' },
    notas:    { tipo: 'E', title: 'Notas de Crédito',     empty: 'No hay notas de crédito emitidas' },
    carta:    { tipo: 'T', title: 'Carta Porte',          empty: 'No hay CFDI con complemento Carta Porte' }
  };

  // Orden de pestañas = acceso rápido F1..F4
  var TAB_KEYS = ['facturas', 'pagos', 'notas', 'carta'];

  // Columnas de importes separadas: Importe (subtotal) · IVA · Total
  var C_IMPORTE = ['Importe', function (d) { return _money(_sub(d)); }, 'cf-num'];
  var C_IVA     = ['IVA',     function (d) { return _money(_iva(d)); }, 'cf-num'];
  var C_TOTAL   = ['Total',   function (d) { return '<span class="cf-strong">' + _money(d.total) + '</span>'; }, 'cf-num'];
  var C_JUEGO   = ['Juego CFDI', function (d) { return _juegoBadge(d); }];

  // Columnas por pestaña: [encabezado, función(doc) -> html, clase opcional]
  var COLS = {
    facturas: [
      ['Serie / Folio', function (d) { return '<span class="cf-strong">' + _folio(d) + '</span>'; }],
      ['UUID',          function (d) { return '<span class="cf-mono">' + _esc(d.uuid_fiscal || '—') + '</span>'; }],
      ['Fecha',         function (d) { return _fecha(d); }],
      ['RFC Receptor',  function (d) { return '<span class="cf-mono">' + _esc(d.receptor_rfc || '—') + '</span>'; }],
      ['Razón Social',  function (d) { return _esc(d.receptor_nombre || '—'); }],
      ['Uso CFDI',      function (d) { return _esc(d.uso_cfdi || '—'); }],
      ['Método / Forma',function (d) { return _esc((d.metodo_pago || '—') + ' / ' + (d.forma_pago || '—')); }],
      C_IMPORTE, C_IVA, C_TOTAL,
      C_JUEGO,
      ['Estado',        function (d) { return _badge(d.status); }]
    ],
    pagos: [
      ['Serie / Folio', function (d) { return '<span class="cf-strong">' + _folio(d) + '</span>'; }],
      ['UUID',          function (d) { return '<span class="cf-mono">' + _esc(d.uuid_fiscal || '—') + '</span>'; }],
      ['Fecha de Pago', function (d) { return _fecha(d); }],
      ['RFC Receptor',  function (d) { return '<span class="cf-mono">' + _esc(d.receptor_rfc || '—') + '</span>'; }],
      ['Razón Social',  function (d) { return _esc(d.receptor_nombre || '—'); }],
      ['Forma de Pago', function (d) { return _esc(d.forma_pago || '—'); }],
      C_IMPORTE, C_IVA,
      ['Total Pagado',  function (d) { return '<span class="cf-strong">' + _money(d.total) + '</span>'; }, 'cf-num'],
      C_JUEGO,
      ['Estado',        function (d) { return _badge(d.status); }]
    ],
    notas: [
      ['Serie / Folio', function (d) { return '<span class="cf-strong">' + _folio(d) + '</span>'; }],
      ['UUID',          function (d) { return '<span class="cf-mono">' + _esc(d.uuid_fiscal || '—') + '</span>'; }],
      ['Fecha',         function (d) { return _fecha(d); }],
      ['RFC Receptor',  function (d) { return '<span class="cf-mono">' + _esc(d.receptor_rfc || '—') + '</span>'; }],
      ['Razón Social',  function (d) { return _esc(d.receptor_nombre || '—'); }],
      ['CFDI Relacionado', function (d) { return '<span class="cf-mono">' + _esc(d.cfdi_relacionado || '—') + '</span>'; }],
      C_IMPORTE, C_IVA, C_TOTAL,
      C_JUEGO,
      ['Estado',        function (d) { return _badge(d.status); }]
    ],
    carta: [
      ['Serie / Folio', function (d) { return '<span class="cf-strong">' + _folio(d) + '</span>'; }],
      ['UUID',          function (d) { return '<span class="cf-mono">' + _esc(d.uuid_fiscal || '—') + '</span>'; }],
      ['Fecha',         function (d) { return _fecha(d); }],
      ['Origen',        function (d) { return _esc(d.origen || '—'); }],
      ['Destino',       function (d) { return _esc(d.destino || '—'); }],
      ['Vehículo / Placas', function (d) { return _esc(d.vehiculo || '—'); }],
      ['Operador',      function (d) { return _esc(d.operador || '—'); }],
      C_JUEGO,
      ['Estado',        function (d) { return _badge(d.status); }]
    ]
  };

  var _all = [];
  var _tab = 'facturas';
  var _query = '';
  var _reg = {};
  var _sel = null;        // último id seleccionado
  var _selMap = {};       // mapa de ids seleccionados para envío múltiple o individual
  var _sendMethod = 'email';
  var _sendDocs = [];
  var _pkg = 500;         // paquete de timbres elegido
  var _suc = '';          // sucursal filtrada ('' = todas)
  var _sucOpts = [];      // [{id, name, serie}] — primera opción = Todas
  var _sucHl = 0;         // opción resaltada en la lista
  var _serieDefault = ''; // serie CFDI configurada de la empresa

  // Tiempo real: se consulta /api/cfdi/version y solo se recarga si cambió.
  var LIVE_MS = 5000;
  var _liveTimer = null;
  var _liveVer = null;
  var _liveBusy = false;
  var _newIds = {};       // renglones recién llegados (se resaltan)

  /* ── Carga principal ── */
  global.loadCfdi = function () {
    var body = document.getElementById('cf-table-body');
    if (!body) return;
    _sel = null;
    _selMap = {};
    _updateSelInfo();
    _loadStamps();
    _liveVer = null;
    body.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">Conectando con /api/cfdi...</div></div>';
    _refresh(false);
    _startLive();
  };

  function _refresh(silent) {
    return AdminAPI.apiFetch('/api/cfdi/version')
      .then(function (r) { _liveVer = (r && r.version) || null; })
      .catch(function () { _liveVer = null; })
      .then(function () { return _fetchList(silent); });
  }

  function _fetchList(silent) {
    var body = document.getElementById('cf-table-body');
    if (!body) return Promise.resolve();
    var prev = _reg;
    return AdminAPI.apiFetch('/api/cfdi?limit=1000&include_pending=true')
      .then(function (rows) {
        _all = Array.isArray(rows) ? rows : [];
        _reg = {};
        _newIds = {};
        _all.forEach(function (d) {
          _reg[d.id] = d;
          if (silent && (!prev[d.id] || prev[d.id].status !== d.status)) _newIds[d.id] = 1;
        });
        // Limpiar o actualizar seleccionados si una venta pendiente se timbró
        Object.keys(_selMap).forEach(function (id) {
          if (!_reg[id]) {
            delete _selMap[id];
            var old = prev[id];
            var repl = old && _all.filter(function (d) { return d.sale_id === old.sale_id; })[0];
            if (repl) _selMap[repl.id] = true;
          }
        });
        var selKeys = Object.keys(_selMap);
        _sel = selKeys.length ? selKeys[selKeys.length - 1] : null;
        _loadBranches();
        _renderCounts();
        _render();
        _updateSelInfo();
      })
      .catch(function (err) {
        if (silent) return;
        _all = [];
        _renderCounts();
        body.innerHTML = '<table class="cf-table"><tbody>' + AdminAPI.errorRow(err && err.message, 11) + '</tbody></table>';
        var c = document.getElementById('cf-count');
        if (c) c.textContent = '0 registros';
      });
  }

  function _startLive() {
    if (_liveTimer) clearInterval(_liveTimer);
    _liveTimer = setInterval(_liveTick, LIVE_MS);
  }

  function _liveTick() {
    if (!document.getElementById('cf-tabs')) { clearInterval(_liveTimer); _liveTimer = null; return; }
    if (document.hidden || _liveBusy) return;
    _liveBusy = true;
    AdminAPI.apiFetch('/api/cfdi/version')
      .then(function (r) {
        var v = r && r.version;
        if (v !== _liveVer) { _liveVer = v; return _fetchList(true); }
      })
      .catch(function () {})
      .then(function () { _liveBusy = false; });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && _liveTimer) _liveTick();
  });

  global.cfdiSetTab = function (tab) {
    if (!TABS[tab]) return;
    _tab = tab;
    document.querySelectorAll('#cf-tabs .cf-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-cf-tab') === tab);
    });
    _render();
  };

  global.cfdiSearch = function (q) { _query = (q || '').trim().toLowerCase(); _render(); };
  global.cfdiFilterChange = function () { _render(); };

  /* ── Filtros ── */
  function _byTab(tab) {
    var tipo = TABS[tab].tipo;
    return _all.filter(function (d) {
      if (_suc && (d.sucursal_id || '') !== _suc) return false;
      return (d.tipo || 'I').toUpperCase() === tipo;
    });
  }

  function _filtered() {
    var st    = (document.getElementById('cf-f-status') || {}).value || '';
    var desde = (document.getElementById('cf-f-desde') || {}).value || '';
    var hasta = (document.getElementById('cf-f-hasta') || {}).value || '';
    return _byTab(_tab).filter(function (d) {
      if (st && (d.status || '').toUpperCase() !== st) return false;
      var f = (d.timbrado_at || d.created_at || '').slice(0, 10);
      if (desde && f && f < desde) return false;
      if (hasta && f && f > hasta) return false;
      if (_query) {
        var hay = [_folio(d), d.uuid_fiscal, d.receptor_rfc, d.receptor_nombre].join(' ').toLowerCase();
        if (hay.indexOf(_query) === -1) return false;
      }
      return true;
    });
  }

  /* ── Render ── */
  function _renderCounts() {
    Object.keys(TABS).forEach(function (t) { _set('cf-count-' + t, _byTab(t).length); });
  }

  function _render() {
    var body = document.getElementById('cf-table-body');
    if (!body) return;
    var cols = COLS[_tab];
    var rows = _filtered();
    _set('cf-table-title', TABS[_tab].title);
    _set('cf-count', rows.length + (rows.length === 1 ? ' registro' : ' registros'));

    var allSel = rows.length > 0 && rows.every(function (d) { return !!_selMap[d.id]; });
    var head = '<thead><tr>' +
      '<th class="cf-chk-col"><input type="checkbox" class="cf-chk" id="cf-chk-all" title="Seleccionar todos" data-click="cfdiToggleAll"' + (allSel ? ' checked' : '') + '></th>' +
      cols.map(function (c) {
        return '<th' + (c[2] ? ' class="' + c[2] + '"' : '') + '>' + c[0] + '</th>';
      }).join('') + '<th>Acciones</th></tr></thead>';

    var bodyHtml;
    if (!rows.length) {
      bodyHtml = AdminAPI.emptyRow(TABS[_tab].empty, cols.length + 2);
    } else {
      bodyHtml = rows.map(function (d) {
        var isSel = !!_selMap[d.id];
        return '<tr class="cf-row' + (isSel ? ' sel' : '') + (_newIds[d.id] ? ' cf-new' : '') + '" data-click="cfdiSelectRow" data-click-arg="' + _esc(d.id) + '">' +
          '<td class="cf-chk-col"><input type="checkbox" class="cf-chk" data-row-id="' + _esc(d.id) + '"' + (isSel ? ' checked' : '') + ' title="Seleccionar comprobante (PDF + XML)"></td>' +
          cols.map(function (c) {
            return '<td' + (c[2] ? ' class="' + c[2] + '"' : '') + '>' + c[1](d) + '</td>';
          }).join('') + '<td>' + _actions(d) + '</td></tr>';
      }).join('');
    }
    body.innerHTML = '<table class="cf-table">' + head + '<tbody>' + bodyHtml + '</tbody></table>';
  }

  function _hasFullSet(d) {
    if (!d || d.pending || d.status === 'PENDIENTE') return false;
    var st = (d.status || '').toUpperCase();
    return (d.has_pdf && d.has_xml) || st === 'TIMBRADO' || st === 'CANCELADO';
  }

  function _juegoBadge(d) {
    if (_hasFullSet(d)) {
      return '<span class="cf-set-pill" title="Juego completo disponible: archivo PDF + archivo XML"><i class="fa-solid fa-file-pdf"></i> PDF + <i class="fa-solid fa-file-code"></i> XML</span>';
    }
    return '<span style="font-size:11px;color:var(--text-muted)">Pendiente</span>';
  }

  function _actions(d) {
    var id = _esc(d.id);
    var h = '<div class="cf-actions">' +
      '<button type="button" class="cf-act" title="Ver detalle" data-click="cfdiShowDetail" data-click-arg="' + id + '"><i class="fa-solid fa-eye"></i></button>';
    if (_hasFullSet(d)) {
      h += '<button type="button" class="cf-act cf-act-set" title="Descargar juego completo (PDF + XML)" data-click="cfdiDownloadSet" data-click-arg="' + id + '"><i class="fa-solid fa-box-archive"></i> PDF+XML</button>';
      h += '<button type="button" class="cf-act" title="Enviar juego completo (PDF + XML) por Email" data-click="cfdiQuickEmail" data-click-arg="' + id + '"><i class="fa-solid fa-envelope" style="color:var(--info)"></i></button>';
      h += '<button type="button" class="cf-act" title="Enviar juego completo (PDF + XML) por WhatsApp" data-click="cfdiQuickWhatsApp" data-click-arg="' + id + '"><i class="fa-brands fa-whatsapp" style="color:#25d366"></i></button>';
    }
    if (d.status === 'TIMBRADO') h += '<button type="button" class="cf-act danger" title="Cancelar CFDI" data-click="cfdiCancel" data-click-arg="' + id + '"><i class="fa-solid fa-ban"></i></button>';
    if (d.status === 'PENDIENTE' || d.status === 'ERROR') h += '<button type="button" class="cf-act" title="Timbrar ahora" data-click="cfdiStamp" data-click-arg="' + id + '"><i class="fa-solid fa-stamp"></i></button>';
    return h + '</div>';
  }

  /* ── Timbrar una venta pendiente del POS ── */
  global.cfdiStamp = function (id) {
    var d = _reg[id];
    if (!d) return;
    if (!confirm('¿Timbrar ahora la venta ' + _folio(d) + ' de ' + (d.receptor_nombre || 'este cliente') + ' por ' + _money(d.total) + '?')) return;
    AdminAPI.apiFetch('/api/sales/' + encodeURIComponent(d.sale_id) + '/cfdi', { method: 'POST', body: JSON.stringify({}) })
      .then(function (r) {
        _msg('CFDI timbrado' + (r && r.uuid_fiscal ? ': ' + r.uuid_fiscal : ''));
        return _refresh(true);
      })
      .catch(function (err) { _msg('No se pudo timbrar: ' + (err.message || err)); });
  };

  /* ── Detalle ── */
  global.cfdiShowDetail = function (id) {
    var d = _reg[id];
    var modal = document.getElementById('cf-modal');
    if (!d || !modal) return;
    var f = function (lbl, val, full) {
      return '<div class="cf-field' + (full ? ' full' : '') + '"><span>' + lbl + '</span><div>' + (val == null || val === '' ? '—' : val) + '</div></div>';
    };
    _set('cf-modal-title', TABS[_tabOf(d)].title + ' · ' + _folio(d));
    document.getElementById('cf-modal-body').innerHTML =
      f('UUID (Folio Fiscal)', '<span class="cf-mono">' + _esc(d.uuid_fiscal || '—') + '</span>', true) +
      f('Serie / Folio', _esc(_folio(d))) +
      f('Estado', _badge(d.status)) +
      f('Juego Completo de Archivos', _juegoBadge(d)) +
      f('Tipo de Comprobante', _esc(d.tipo || 'I')) +
      f('Sucursal', _esc(d.sucursal_id)) +
      f('RFC Receptor', _esc(d.receptor_rfc)) +
      f('Razón Social', _esc(d.receptor_nombre)) +
      f('Uso CFDI', _esc(d.uso_cfdi)) +
      f('Método / Forma de Pago', _esc((d.metodo_pago || '—') + ' / ' + (d.forma_pago || '—'))) +
      f('Importe', _money(_sub(d))) +
      f('IVA', _money(_iva(d))) +
      f('Total', '<b>' + _money(d.total) + '</b>') +
      f('Venta / Ticket', '<span class="cf-mono">' + _esc(d.sale_id) + '</span>') +
      f('Fecha de Timbrado', AdminAPI.fmtDate(d.timbrado_at)) +
      f('Fecha de Creación', AdminAPI.fmtDate(d.created_at)) +
      f('PAC / Ambiente', _esc((d.provider || '—') + ' / ' + (d.environment || '—'))) +
      f('ID en PAC', '<span class="cf-mono">' + _esc(d.pac_id) + '</span>') +
      (d.status === 'CANCELADO' ? f('Cancelado el', AdminAPI.fmtDate(d.cancelado_at)) + f('Motivo de Cancelación', _esc(d.motivo_cancelacion)) : '') +
      (d.error ? f('Error', '<span style="color:var(--danger)">' + _esc(d.error) + '</span>', true) : '');
    var ft = document.getElementById('cf-modal-ft');
    if (ft) {
      var eid = _esc(d.id);
      ft.innerHTML =
        (_hasFullSet(d)
          ? '<button type="button" class="btn btn-secondary btn-sm" data-click="cfdiDownloadSet" data-click-arg="' + eid + '"><i class="fa-solid fa-box-archive"></i> Descargar PDF + XML</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-click="cfdiQuickEmail" data-click-arg="' + eid + '"><i class="fa-solid fa-envelope"></i> Email (PDF + XML)</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-click="cfdiQuickWhatsApp" data-click-arg="' + eid + '"><i class="fa-brands fa-whatsapp"></i> WhatsApp (PDF + XML)</button>'
          : '') +
        '<button type="button" class="btn btn-primary btn-sm" data-click="cfdiCloseDetail">Cerrar</button>';
    }
    modal.style.display = 'flex';
  };

  global.cfdiCloseDetail = function () {
    var m = document.getElementById('cf-modal');
    if (m) m.style.display = 'none';
  };

  document.addEventListener('keydown', function (e) {
    if (_sucKeydown(e)) return;
    var sm = document.getElementById('cf-send-modal');
    if (e.key === 'Escape' && sm && sm.style.display === 'flex') {
      e.preventDefault();
      e.stopPropagation();
      global.cfdiCloseSendModal();
      return;
    }
    var m = document.getElementById('cf-modal');
    if (e.key === 'Escape' && m && m.style.display === 'flex') {
      e.preventDefault();
      e.stopPropagation();
      global.cfdiCloseDetail();
      return;
    }
    var buy = document.getElementById('cf-buy-modal');
    if (e.key === 'Escape' && buy && buy.style.display === 'flex') {
      e.preventDefault();
      e.stopPropagation();
      global.cfdiCloseBuy();
      return;
    }
    var tabs = document.getElementById('cf-tabs');
    if (!tabs || tabs.offsetParent === null) return;
    if ((m && m.style.display === 'flex') || (buy && buy.style.display === 'flex') || (sm && sm.style.display === 'flex')) return;
    if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    var k = /^F([1-4])$/.exec(e.key || '');
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    global.cfdiSetTab(TAB_KEYS[parseInt(k[1], 10) - 1]);
  }, true);

  // Normalización a MAYÚSCULAS en campo de observaciones del modal de envío (Regla global Calebsys)
  document.addEventListener('blur', function (e) {
    if (e.target && e.target.id === 'cf-send-msg') {
      e.target.value = (e.target.value || '').toUpperCase();
    }
  }, true);

  /* ── Archivos del CFDI (siempre juego completo PDF + XML) ── */
  function _b64ToBytes(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function _baseName(d) {
    var pref = { I: 'FACTURA', P: 'COMPLEMENTO_PAGO', E: 'NOTA_CREDITO', T: 'CARTA_PORTE' }[(d.tipo || 'I').toUpperCase()] || 'CFDI';
    return pref + '_' + (_folio(d).replace(/[^A-Za-z0-9_-]/g, '') || d.id);
  }

  function _fetchFiles(d) {
    return AdminAPI.apiFetch('/api/cfdi/' + encodeURIComponent(d.id) + '/archivos');
  }

  function _saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
  }

  // Descarga ambos archivos (.pdf y .xml) juntos de un comprobante
  function _saveBothFilesFromData(item) {
    var name = item.nombre_archivo || 'CFDI';
    if (item.pdf_base64) {
      _saveBlob(new Blob([_b64ToBytes(item.pdf_base64)], { type: 'application/pdf' }), name + '.pdf');
    }
    if (item.xml) {
      setTimeout(function () {
        _saveBlob(new Blob([item.xml], { type: 'application/xml' }), name + '.xml');
      }, 180);
    }
  }

  // Regla de negocio: SIEMPRE debe enviarse el juego completo (PDF + XML)
  function _ensureSet(d) {
    if (!d) return false;
    if (d.pending || d.status === 'PENDIENTE') {
      _msg('El comprobante ' + _folio(d) + ' aún está por timbrar. Tímbralo primero para poder enviar su PDF y XML.');
      return false;
    }
    if (!_hasFullSet(d)) {
      _msg('No se puede enviar ' + _folio(d) + ': debe contar con su juego completo (PDF y XML).');
      return false;
    }
    return true;
  }

  function _ensureSetList(docs) {
    if (!docs || !docs.length) {
      _msg('Selecciona al menos una Factura, Complemento de Pago o Nota de Crédito de la tabla');
      return false;
    }
    for (var i = 0; i < docs.length; i++) {
      if (!_ensureSet(docs[i])) return false;
    }
    return true;
  }

  /* ── Descargas (siempre juego completo PDF + XML) ── */
  global.cfdiDownloadSet = function (id) {
    var d = _reg[id];
    if (!d || !_ensureSet(d)) return;
    _fetchFiles(d)
      .then(function (r) {
        if (!r.xml || !r.pdf_base64) throw new Error('El CFDI no cuenta con su juego completo (PDF + XML)');
        _saveBothFilesFromData(r);
        _msg('Juego completo descargado: ' + (r.nombre_archivo || _baseName(d)) + '.pdf + .xml');
      })
      .catch(function (err) { _msg('No se pudo descargar el juego completo: ' + (err.message || err)); });
  };

  global.cfdiDownloadSelectedSet = function () {
    var docs = _selectedList();
    if (!_ensureSetList(docs)) return;
    if (docs.length === 1) {
      global.cfdiDownloadSet(docs[0].id);
      return;
    }
    var tok = localStorage.getItem('calebsys_token') || sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
    fetch('/api/cfdi/paquete-lote', {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
      body: JSON.stringify({ ids: docs.map(function (d) { return d.id; }) })
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.detail || ('HTTP ' + r.status)); });
      return r.blob();
    }).then(function (blob) {
      var zipName = 'CFDI_JUEGO_COMPLETO_' + docs.length + '_COMPROBANTES.zip';
      _saveBlob(blob, zipName);
      _msg('Juego completo descargado (' + docs.length + ' comprobantes con su PDF + XML en ' + zipName + ')');
    }).catch(function (err) {
      _msg('No se pudo descargar el paquete: ' + (err.message || err));
    });
  };

  global.cfdiDownload = function (id) {
    // Cualquier descarga individual entrega el juego completo PDF + XML
    global.cfdiDownloadSet(id);
  };

  /* ── Cancelación ── */
  global.cfdiCancel = function (id) {
    var d = _reg[id];
    if (!d) return;
    var motivo = prompt(
      'Cancelar CFDI ' + _folio(d) + '\n\nMotivo SAT:\n' +
      '01 - Comprobante emitido con errores con relación\n' +
      '02 - Comprobante emitido con errores sin relación\n' +
      '03 - No se llevó a cabo la operación\n' +
      '04 - Operación nominativa relacionada en factura global', '02');
    if (!motivo) return;
    motivo = motivo.trim();
    var body = { motivo: motivo };
    if (motivo === '01') {
      var rep = prompt('UUID del CFDI que sustituye:');
      if (!rep) return;
      body.uuid_replacement = rep.trim().toUpperCase();
    }
    AdminAPI.apiFetch('/api/cfdi/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: JSON.stringify(body) })
      .then(function () { _msg('CFDI ' + _folio(d) + ' cancelado correctamente'); global.loadCfdi(); })
      .catch(function (err) { _msg('No se pudo cancelar: ' + (err.message || err)); });
  };

  /* ── Selección de renglones (individual y múltiple) ── */
  global.cfdiSelectRow = function (id) {
    if (!id) return;
    if (_selMap[id]) {
      delete _selMap[id];
    } else {
      _selMap[id] = true;
    }
    var keys = Object.keys(_selMap);
    _sel = keys.length ? keys[keys.length - 1] : null;
    _syncRowSelectionDOM();
    _updateSelInfo();
  };

  global.cfdiToggleAll = function () {
    var rows = _filtered();
    var allSel = rows.length > 0 && rows.every(function (d) { return !!_selMap[d.id]; });
    rows.forEach(function (d) {
      if (allSel) delete _selMap[d.id];
      else _selMap[d.id] = true;
    });
    var keys = Object.keys(_selMap);
    _sel = keys.length ? keys[keys.length - 1] : null;
    _syncRowSelectionDOM();
    _updateSelInfo();
  };

  function _syncRowSelectionDOM() {
    var rows = _filtered();
    document.querySelectorAll('#cf-table-body tr.cf-row').forEach(function (tr) {
      var id = tr.getAttribute('data-click-arg');
      var on = !!_selMap[id];
      tr.classList.toggle('sel', on);
      var chk = tr.querySelector('input.cf-chk');
      if (chk) chk.checked = on;
    });
    var chkAll = document.getElementById('cf-chk-all');
    if (chkAll) {
      chkAll.checked = rows.length > 0 && rows.every(function (d) { return !!_selMap[d.id]; });
    }
  }

  function _selectedList() {
    var list = [];
    Object.keys(_selMap).forEach(function (id) {
      if (_reg[id]) list.push(_reg[id]);
    });
    if (!list.length && _sel && _reg[_sel]) list.push(_reg[_sel]);
    return list;
  }

  function _updateSelInfo() {
    var el = document.getElementById('cf-sel-info');
    if (!el) return;
    var list = _selectedList();
    if (!list.length) {
      el.innerHTML = '<i class="fa-regular fa-hand-pointer"></i> Selecciona Facturas, Complementos de Pago o Notas de Crédito para enviar su <b>juego completo (PDF + XML)</b>';
      return;
    }
    if (list.length === 1) {
      var d = list[0];
      el.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success)"></i> Seleccionado: <b>' + _esc(_folio(d)) + '</b> · ' +
        _esc(d.receptor_nombre || d.receptor_rfc || '—') + ' · <b>' + _money(d.total) + '</b> ' +
        '<span class="cf-set-pill"><i class="fa-solid fa-check"></i> Juego completo: PDF + XML</span>';
      return;
    }
    var sum = list.reduce(function (acc, x) { return acc + Number(x.total || 0); }, 0);
    el.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success)"></i> <b>' + list.length + ' comprobantes seleccionados</b> · Total: <b>' +
      _money(sum) + '</b> <span class="cf-set-pill"><i class="fa-solid fa-check"></i> Juego completo: ' + list.length + ' PDF + ' + list.length + ' XML</span>';
  }

  function _selected() {
    var list = _selectedList();
    if (!list.length) _msg('Selecciona primero un CFDI de la tabla');
    return list[0] || null;
  }

  function _resumen(d) {
    var tipoLbl = TABS[_tabOf(d)] ? TABS[_tabOf(d)].title : 'CFDI';
    return tipoLbl + ' ' + _folio(d) +
      '\nUUID: ' + (d.uuid_fiscal || '—') +
      '\nReceptor: ' + (d.receptor_nombre || '—') + ' (' + (d.receptor_rfc || '—') + ')' +
      '\nImporte: ' + _money(_sub(d)) +
      '\nIVA: ' + _money(_iva(d)) +
      '\nTotal: ' + _money(d.total) +
      '\nFecha: ' + _fecha(d) +
      '\nArchivos (Juego Completo): ' + _baseName(d) + '.pdf + ' + _baseName(d) + '.xml';
  }

  /* ── Imprimir ── */
  global.cfdiPrint = function () {
    var d = _selected();
    if (!d) return;
    if (_hasFullSet(d)) {
      _fetchFiles(d)
        .then(function (r) {
          if (!r.pdf_base64) throw new Error('El CFDI no tiene PDF');
          var url = URL.createObjectURL(new Blob([_b64ToBytes(r.pdf_base64)], { type: 'application/pdf' }));
          var w = window.open(url, '_blank');
          if (w) setTimeout(function () { try { w.print(); } catch (e) {} }, 800);
        })
        .catch(function (err) { _msg('No se pudo imprimir: ' + (err.message || err)); });
      return;
    }
    var w = window.open('', '_blank', 'width=720,height=800');
    if (!w) return _msg('El navegador bloqueó la ventana de impresión');
    var row = function (k, v) { return '<tr><th>' + k + '</th><td>' + _esc(v == null || v === '' ? '—' : v) + '</td></tr>'; };
    w.document.write('<html><head><title>CFDI ' + _esc(_folio(d)) + '</title><style>' +
      'body{font-family:Inter,Arial,sans-serif;padding:28px;color:#0f172a}h2{margin:0 0 4px}p{margin:0 0 18px;color:#64748b;font-size:12px}' +
      'table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;width:38%;color:#475569;padding:7px 8px;border-bottom:1px solid #e2e8f0}' +
      'td{padding:7px 8px;border-bottom:1px solid #e2e8f0;word-break:break-all}</style></head><body>' +
      '<h2>' + TABS[_tabOf(d)].title + ' · ' + _esc(_folio(d)) + '</h2><p>Representación impresa del CFDI — Calebsys</p><table>' +
      row('UUID (Folio Fiscal)', d.uuid_fiscal) + row('Estado', d.status) + row('RFC Receptor', d.receptor_rfc) +
      row('Razón Social', d.receptor_nombre) + row('Uso CFDI', d.uso_cfdi) +
      row('Método / Forma de Pago', (d.metodo_pago || '—') + ' / ' + (d.forma_pago || '—')) +
      row('Importe', _money(_sub(d))) + row('IVA', _money(_iva(d))) +
      row('Total', _money(d.total)) + row('Fecha', _fecha(d)) + row('Sucursal', d.sucursal_id) +
      '</table></body></html>');
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); }, 300);
  };

  /* ── Envío de Juego Completo (PDF + XML) por Email o WhatsApp ── */
  function _openSendModal(method, docs) {
    if (!_ensureSetList(docs)) return;
    _sendMethod = method;
    _sendDocs = docs;
    var modal = document.getElementById('cf-send-modal');
    if (!modal) return;
    var isMail = (method === 'email');
    var ico = document.getElementById('cf-send-ico');
    if (ico) {
      ico.className = isMail ? 'fa-solid fa-envelope' : 'fa-brands fa-whatsapp';
      ico.style.color = isMail ? 'var(--info)' : '#25d366';
    }
    _set('cf-send-title', (isMail ? 'Enviar por Correo Electrónico' : 'Enviar por WhatsApp') + ' · Juego Completo (PDF + XML)');
    _set('cf-send-dest-lbl', isMail ? 'Correo electrónico del destinatario' : 'Número de WhatsApp del destinatario (10 dígitos)');
    var input = document.getElementById('cf-send-dest');
    if (input) {
      input.type = isMail ? 'email' : 'tel';
      input.placeholder = isMail ? 'cliente@dominio.com' : 'Ej. 6181234567';
      var pre = '';
      for (var i = 0; i < docs.length; i++) {
        var val = isMail ? docs[i].receptor_email : docs[i].receptor_telefono;
        if (val) { pre = val; break; }
      }
      input.value = pre || '';
    }
    var msgEl = document.getElementById('cf-send-msg');
    if (msgEl) {
      msgEl.value = 'SE ENVIA JUEGO COMPLETO DE COMPROBANTE FISCAL DIGITAL (ARCHIVO PDF Y ARCHIVO XML).';
    }
    var listEl = document.getElementById('cf-send-list');
    if (listEl) {
      listEl.innerHTML = docs.map(function (d) {
        var b = _baseName(d);
        var tTitle = (TABS[_tabOf(d)] ? TABS[_tabOf(d)].title : 'CFDI');
        return '<div class="cf-send-item">' +
          '<div><b>' + _esc(tTitle + ' · ' + _folio(d)) + '</b> — ' + _esc(d.receptor_nombre || d.receptor_rfc || '—') +
          ' (' + _money(d.total) + ')</div>' +
          '<div class="cf-send-files">' +
            '<span class="cf-file-tag pdf" title="' + _esc(b + '.pdf') + '"><i class="fa-solid fa-file-pdf"></i> ' + _esc(b + '.pdf') + '</span>' +
            '<span class="cf-file-tag xml" title="' + _esc(b + '.xml') + '"><i class="fa-solid fa-file-code"></i> ' + _esc(b + '.xml') + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    var btn = document.getElementById('cf-send-confirm-btn');
    if (btn) {
      btn.innerHTML = isMail
        ? '<i class="fa-solid fa-envelope"></i> Enviar Juego Completo (PDF + XML)'
        : '<i class="fa-brands fa-whatsapp"></i> Enviar Juego Completo (PDF + XML)';
    }
    modal.style.display = 'flex';
    if (input) setTimeout(function () { input.focus(); }, 60);
  }

  global.cfdiCloseSendModal = function () {
    var m = document.getElementById('cf-send-modal');
    if (m) m.style.display = 'none';
  };

  global.cfdiSendEmail = function () {
    _openSendModal('email', _selectedList());
  };

  global.cfdiSendWhatsApp = function () {
    _openSendModal('whatsapp', _selectedList());
  };

  global.cfdiQuickEmail = function (id) {
    var d = _reg[id];
    if (!d) return;
    _selMap[id] = true;
    _sel = id;
    _syncRowSelectionDOM();
    _updateSelInfo();
    global.cfdiCloseDetail();
    _openSendModal('email', [d]);
  };

  global.cfdiQuickWhatsApp = function (id) {
    var d = _reg[id];
    if (!d) return;
    _selMap[id] = true;
    _sel = id;
    _syncRowSelectionDOM();
    _updateSelInfo();
    global.cfdiCloseDetail();
    _openSendModal('whatsapp', [d]);
  };

  global.cfdiConfirmSend = function () {
    var docs = _sendDocs || [];
    if (!_ensureSetList(docs)) return;
    var input = document.getElementById('cf-send-dest');
    var msgEl = document.getElementById('cf-send-msg');
    var destino = ((input && input.value) || '').trim();
    var nota = ((msgEl && msgEl.value) || '').trim().toUpperCase();
    if (msgEl) msgEl.value = nota;

    if (_sendMethod === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) {
        return _msg('Ingresa un correo electrónico válido');
      }
    } else {
      var digits = destino.replace(/\D/g, '');
      if (digits.length < 10) {
        return _msg('Ingresa un número de WhatsApp válido (10 dígitos)');
      }
      destino = digits.length === 10 ? ('52' + digits) : digits;
    }

    var btn = document.getElementById('cf-send-confirm-btn');
    if (btn) btn.disabled = true;

    AdminAPI.apiFetch('/api/cfdi/enviar', {
      method: 'POST',
      body: JSON.stringify({
        ids: docs.map(function (d) { return d.id; }),
        metodo: _sendMethod,
        destino: destino,
        mensaje: nota
      })
    }).then(function (res) {
      global.cfdiCloseSendModal();
      var archivos = (res && res.archivos) || [];
      if (!archivos.length) throw new Error('No se recibieron los archivos PDF y XML del servidor');

      // Construir lista de objetos File (siempre PDF + XML por cada comprobante)
      var shareFiles = [];
      archivos.forEach(function (a) {
        if (a.pdf_base64 && a.xml) {
          try {
            shareFiles.push(new File([_b64ToBytes(a.pdf_base64)], a.pdf_filename, { type: 'application/pdf' }));
            shareFiles.push(new File([a.xml], a.xml_filename, { type: 'text/xml' }));
          } catch (e) {}
        }
      });

      var resumenTxt = docs.map(_resumen).join('\n\n────────────────────────\n\n');
      var listaArchivos = archivos.map(function (a) {
        return '  • ' + a.pdf_filename + ' (Representación impresa PDF)\n  • ' + a.xml_filename + ' (Comprobante fiscal XML)';
      }).join('\n');

      if (_sendMethod === 'email') {
        // Descargar cada par PDF + XML para adjuntarlos en caso de cliente local
        archivos.forEach(function (a) { _saveBothFilesFromData(a); });
        var subject = (docs.length === 1
          ? (TABS[_tabOf(docs[0])].title + ' ' + _folio(docs[0]) + ' (Juego Completo PDF + XML)')
          : ('Juego Completo CFDI (' + docs.length + ' comprobantes: PDF + XML)'));
        var body = (nota ? nota + '\n\n' : '') +
          'Se adjunta el JUEGO COMPLETO de su(s) comprobante(s) fiscal(es) digital(es) (PDF + XML):\n\n' +
          resumenTxt + '\n\nArchivos del juego completo:\n' + listaArchivos + '\n\nSaludos cordiales.';
        window.location.href = 'mailto:' + encodeURIComponent(destino) +
          '?subject=' + encodeURIComponent(subject) +
          '&body=' + encodeURIComponent(body);
        _msg('Juego completo (PDF + XML) preparado y descargado para envío por correo a ' + destino);
        return;
      }

      // Método WhatsApp: intentar compartir directamente los archivos PDF + XML si el sistema lo soporta
      var waText = (nota ? nota + '\n\n' : '') +
        'Le enviamos el *JUEGO COMPLETO* de su comprobante fiscal (*PDF + XML*):\n\n' +
        resumenTxt + '\n\n*Archivos incluidos (PDF + XML):*\n' + listaArchivos;

      if (shareFiles.length >= 2 && navigator.canShare && navigator.share && navigator.canShare({ files: shareFiles })) {
        return navigator.share({
          files: shareFiles,
          title: 'Juego Completo CFDI (PDF + XML)',
          text: waText
        }).then(function () {
          _msg('Juego completo (PDF + XML) compartido por WhatsApp');
        }).catch(function () {
          archivos.forEach(function (a) { _saveBothFilesFromData(a); });
          window.open('https://wa.me/' + destino + '?text=' + encodeURIComponent(waText), '_blank');
          _msg('Se descargaron los archivos PDF y XML del juego completo. Adjúntalos en la conversación de WhatsApp.');
        });
      }

      // Respaldo escritorio: descarga ambos archivos (.pdf y .xml) y abre WhatsApp con el destinatario
      archivos.forEach(function (a) { _saveBothFilesFromData(a); });
      window.open('https://wa.me/' + destino + '?text=' + encodeURIComponent(waText), '_blank');
      _msg('Se descargaron el PDF y el XML (juego completo). Adjunta ambos archivos en el chat de WhatsApp.');
    }).catch(function (err) {
      _msg('No se pudo enviar el juego completo: ' + (err.message || err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  };

  /* ── Timbres disponibles ── */
  function _loadStamps() {
    var num = document.getElementById('cf-stamps-num');
    var box = document.getElementById('cf-stamps-box');
    if (!num) return;
    AdminAPI.apiFetch('/api/admin/integrations/cfdi')
      .then(function (cfg) {
        cfg = cfg || {};
        if (cfg.serie_default) { _serieDefault = String(cfg.serie_default).trim(); _renderSucList(); }
        var v = [cfg.timbres_disponibles, cfg.stamps_available, cfg.saldo_timbres, cfg.balance]
          .filter(function (x) { return x != null && x !== '' && !isNaN(Number(x)); })[0];
        if (v == null) {
          num.textContent = '—';
          if (box) { box.className = 'cf-stamps-box'; box.title = cfg.configured ? 'El PAC no reporta saldo de timbres' : 'PAC sin configurar (Configuración → Facturación)'; }
          return;
        }
        v = Number(v);
        num.textContent = AdminAPI.fmtNum(v);
        if (box) box.className = 'cf-stamps-box' + (v <= 0 ? ' empty' : v < 50 ? ' low' : '');
      })
      .catch(function () {
        num.textContent = '—';
        if (box) box.title = 'No se pudo consultar el saldo de timbres';
      });
  }

  /* ── Comprar paquete de timbres ── */
  global.cfdiOpenBuy = function () {
    var m = document.getElementById('cf-buy-modal');
    if (m) m.style.display = 'flex';
  };
  global.cfdiCloseBuy = function () {
    var m = document.getElementById('cf-buy-modal');
    if (m) m.style.display = 'none';
  };
  global.cfdiPickPkg = function (n) {
    _pkg = parseInt(n, 10) || 500;
    document.querySelectorAll('#cf-pkgs .cf-pkg').forEach(function (b) {
      b.classList.toggle('sel', b.getAttribute('data-click-arg') === String(_pkg));
    });
  };
  global.cfdiRequestPkg = function () {
    var emp = localStorage.getItem('calebsys_empresa') || localStorage.getItem('empresa_id') || '';
    var text = 'Hola, quiero comprar un paquete de ' + AdminAPI.fmtNum(_pkg) + ' timbres CFDI para Calebsys' +
      (emp ? ' (empresa: ' + emp + ')' : '') + '.';
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    global.cfdiCloseBuy();
  };

  /* ── Filtro de sucursal ── */
  function _loadBranches() {
    AdminAPI.apiFetch('/api/branches')
      .catch(function () { return []; })
      .then(function (branches) {
        var map = {}, order = [];
        (Array.isArray(branches) ? branches : []).forEach(function (b) {
          var id = b.id || b.sucursal_id;
          if (!id || map[id]) return;
          map[id] = { id: id, name: (b.name || b.nombre || id), inactive: (b.status && String(b.status).toUpperCase() !== 'ACTIVE') };
          order.push(id);
        });
        _all.forEach(function (d) {
          var id = d.sucursal_id;
          if (id && !map[id]) { map[id] = { id: id, name: id }; order.push(id); }
        });
        _sucOpts = [{ id: '', name: 'Todas las sucursales' }].concat(order.map(function (id) { return map[id]; }));
        if (_suc && !map[_suc]) _suc = '';
        _renderSucList();
      });
  }

  function _seriesOf(id) {
    if (!id) return '';
    var seen = {};
    _all.forEach(function (d) { if (d.sucursal_id === id && d.serie) seen[String(d.serie).trim()] = 1; });
    var s = Object.keys(seen).sort();
    return s.length ? s.join(', ') : (_serieDefault || '');
  }

  function _renderSucList() {
    var list = document.getElementById('cf-suc-list');
    var val  = document.getElementById('cf-suc-val');
    if (!list) return;
    if (!_sucOpts.length) _sucOpts = [{ id: '', name: 'Todas las sucursales' }];
    var cur = 0;
    list.innerHTML = _sucOpts.map(function (o, i) {
      if (o.id === _suc) cur = i;
      var serie = _seriesOf(o.id);
      return '<li class="cf-suc-opt' + (o.id === _suc ? ' sel' : '') + '" role="option" data-idx="' + i + '"' +
        (o.id === _suc ? ' aria-selected="true"' : '') + '>' +
        '<span>' + (o.id ? '<i class="fa-solid fa-store" style="opacity:.6;margin-right:6px;"></i>' : '<i class="fa-solid fa-layer-group" style="opacity:.6;margin-right:6px;"></i>') +
        _esc(o.name) + (o.inactive ? ' <small style="color:var(--text-muted)">(inactiva)</small>' : '') + '</span>' +
        (o.id ? '<span class="cf-suc-serie">Serie ' + _esc(serie || '—') + '</span>' : '') + '</li>';
    }).join('') + '<li class="cf-suc-hint" aria-hidden="true">↑ ↓ navegar · Enter elegir · Esc cerrar</li>';
    if (val) {
      var o = _sucOpts[cur];
      var s = _seriesOf(o.id);
      val.textContent = o.id ? (o.name + (s ? ' · Serie ' + s : '')) : 'Todas';
    }
    if (!_isSucOpen()) _sucHl = cur;
    _paintHl();
  }

  function _isSucOpen() {
    var w = document.getElementById('cf-suc');
    return !!(w && w.classList.contains('open'));
  }

  function _openSuc() {
    var w = document.getElementById('cf-suc');
    if (!w) return;
    _sucHl = Math.max(0, _sucOpts.findIndex(function (o) { return o.id === _suc; }));
    w.classList.add('open');
    var b = document.getElementById('cf-suc-btn');
    if (b) { b.setAttribute('aria-expanded', 'true'); b.focus(); }
    _paintHl();
  }

  function _closeSuc() {
    var w = document.getElementById('cf-suc');
    if (!w) return;
    w.classList.remove('open');
    var b = document.getElementById('cf-suc-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  }

  function _paintHl() {
    var items = document.querySelectorAll('#cf-suc-list .cf-suc-opt');
    items.forEach(function (li, i) { li.classList.toggle('hl', i === _sucHl); });
    var cur = items[_sucHl];
    if (cur && _isSucOpen()) cur.scrollIntoView({ block: 'nearest' });
  }

  function _chooseSuc(idx) {
    var o = _sucOpts[idx];
    if (!o) return;
    _suc = o.id;
    _closeSuc();
    Object.keys(_selMap).forEach(function (id) {
      if (_suc && _reg[id] && _reg[id].sucursal_id !== _suc) delete _selMap[id];
    });
    var keys = Object.keys(_selMap);
    _sel = keys.length ? keys[keys.length - 1] : null;
    _updateSelInfo();
    _renderSucList();
    _renderCounts();
    _render();
    var b = document.getElementById('cf-suc-btn');
    if (b) b.focus();
  }

  function _sucKeydown(e) {
    var btn = document.getElementById('cf-suc-btn');
    if (!btn || btn.offsetParent === null) return false;
    var open = _isSucOpen();
    var onBtn = (e.target === btn);
    if (!open && !onBtn) return false;
    var n = _sucOpts.length || 1;
    var k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
        e.preventDefault(); e.stopPropagation();
        _openSuc();
        return true;
      }
      return false;
    }
    if (k === 'ArrowDown') { _sucHl = (_sucHl + 1) % n; }
    else if (k === 'ArrowUp') { _sucHl = (_sucHl - 1 + n) % n; }
    else if (k === 'Home') { _sucHl = 0; }
    else if (k === 'End') { _sucHl = n - 1; }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); _chooseSuc(_sucHl); return true; }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); _closeSuc(); btn.focus(); return true; }
    else if (k === 'Tab') { _closeSuc(); return false; }
    else { return false; }
    e.preventDefault(); e.stopPropagation();
    _paintHl();
    return true;
  }

  document.addEventListener('click', function (e) {
    var w = document.getElementById('cf-suc');
    if (!w) return;
    if (e.target.closest('#cf-suc-btn')) { _isSucOpen() ? _closeSuc() : _openSuc(); return; }
    var opt = e.target.closest('#cf-suc-list .cf-suc-opt');
    if (opt) { _chooseSuc(parseInt(opt.getAttribute('data-idx'), 10)); return; }
    if (_isSucOpen() && !e.target.closest('#cf-suc')) _closeSuc();
  });

  document.addEventListener('mouseover', function (e) {
    var opt = e.target.closest && e.target.closest('#cf-suc-list .cf-suc-opt');
    if (!opt) return;
    var i = parseInt(opt.getAttribute('data-idx'), 10);
    if (i !== _sucHl) { _sucHl = i; _paintHl(); }
  });

  /* ── Helpers ── */
  function _tabOf(d) {
    var t = (d.tipo || 'I').toUpperCase();
    for (var k in TABS) if (TABS[k].tipo === t) return k;
    return 'facturas';
  }
  function _folio(d) {
    var s = (d.serie || '') + (d.serie && d.folio ? '-' : '') + (d.folio || '');
    return s || (d.id ? d.id.slice(0, 8).toUpperCase() : '—');
  }
  function _fecha(d) { return AdminAPI.fmtDate(d.timbrado_at || d.created_at); }
  function _money(v) { return v == null ? '—' : AdminAPI.fmtCurrency(v); }
  function _sub(d) {
    if (d.subtotal != null) return Number(d.subtotal);
    if (d.total == null) return null;
    return Math.round((Number(d.total) / 1.16) * 100) / 100;
  }
  function _iva(d) {
    if (d.iva != null) return Number(d.iva);
    var s = _sub(d);
    return s == null ? null : Math.round((Number(d.total) - s) * 100) / 100;
  }
  function _badge(st) {
    st = (st || 'BORRADOR').toUpperCase();
    var cls = { TIMBRADO: 'badge-success', CANCELADO: 'badge-danger', ERROR: 'badge-warning', BORRADOR: 'badge-neutral', PENDIENTE: 'badge-info' }[st] || 'badge-neutral';
    var lbl = { TIMBRADO: 'Timbrado', CANCELADO: 'Cancelado', ERROR: 'Error', BORRADOR: 'Borrador', PENDIENTE: 'Por timbrar' }[st] || st;
    return '<span class="badge ' + cls + '"><span class="dot"></span>' + lbl + '</span>';
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _set(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function _msg(m) {
    if (typeof AdminAPI.toast === 'function') AdminAPI.toast(m);
    else if (typeof global.showToast === 'function') global.showToast(m);
    else alert(m);
  }

})(window);
