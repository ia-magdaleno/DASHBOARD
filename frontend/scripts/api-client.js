/* =============================================================
   api-client.js — Calebsys Admin Shell v5.1A
   Helpers: fetch wrapper, formatters, emptyRow builder
   Freeze: v1.0.0-ui-core-shell-freeze
   ============================================================= */
(function (global) {
  'use strict';

  function _token() {
    // calebsys_token es la clave canónica (login.js lo escribe en localStorage)
    // auth_token/sessionStorage mantenidos como fallback legacy
    return localStorage.getItem('calebsys_token') ||
           sessionStorage.getItem('auth_token') ||
           localStorage.getItem('auth_token') || '';
  }

  /** Fetch JSON from API with auth — siempre credentials:include para cookie httpOnly */
  function apiFetch(path, opts) {
    var headers = { 'Content-Type': 'application/json' };
    var tok = _token();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    return fetch(path, Object.assign({ headers: headers, credentials: 'include' }, opts || {})).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + path);
      return res.json();
    });
  }

  /** Format as Mexican Peso currency */
  function fmtCurrency(val) {
    if (val == null) return '—';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency', currency: 'MXN', minimumFractionDigits: 2
    }).format(Number(val));
  }

  /** Format as integer with thousands separator */
  function fmtNum(val) {
    if (val == null) return '—';
    return new Intl.NumberFormat('es-MX').format(Number(val));
  }

  /** Format ISO date string to local short format */
  function fmtDate(val) {
    if (!val) return '—';
    try {
      return new Date(val).toLocaleString('es-MX', {
        dateStyle: 'short', timeStyle: 'short'
      });
    } catch (e) { return String(val); }
  }

  /** Generate a table empty-state row */
  function emptyRow(msg, cols) {
    return '<tr><td colspan="' + cols + '">' +
      '<div class="empty-state" style="padding:40px 16px;">' +
      '<div class="empty-icon"><i class="fa-solid fa-inbox"></i></div>' +
      '<div class="empty-title">' + (msg || 'Sin resultados') + '</div>' +
      '<div class="empty-module-label"><i class="fa-solid fa-plug"></i>' +
      ' M\u00f3dulo dise\u00f1ado \u2014 datos pendientes de conexi\u00f3n</div>' +
      '</div></td></tr>';
  }

  /** Generate API-error row */
  function errorRow(err, cols) {
    return '<tr><td colspan="' + cols + '">' +
      '<div class="empty-state" style="padding:40px 16px;">' +
      '<div class="empty-icon" style="color:var(--danger);border-color:rgba(239,68,68,0.25);"><i class="fa-solid fa-triangle-exclamation"></i></div>' +
      '<div class="empty-title" style="color:var(--danger);">Error de conexi\u00f3n</div>' +
      '<div class="empty-desc">' + (err || 'No se pudo conectar con el endpoint.') + '</div>' +
      '<div class="empty-module-label"><i class="fa-solid fa-rotate-right"></i> Verifica que el backend est\u00e9 activo</div>' +
      '</div></td></tr>';
  }

  global.AdminAPI = {
    apiFetch:    apiFetch,
    fmtCurrency: fmtCurrency,
    fmtNum:      fmtNum,
    fmtDate:     fmtDate,
    emptyRow:    emptyRow,
    errorRow:    errorRow
  };

})(window);
