/* 15-pos-notifications.js — P3: Sistema de Notificaciones/Alarmas en el POS
   Polling cada 10 s a /api/notifications
   - Badge rojo con contador sobre la campana
   - Panel desplegable con lista unificada
   - Toast automático para severidad action_required (N-03: devoluciones)
   ──────────────────────────────────────────────────────────────────────── */

(function PosNotifications() {
  'use strict';

  var _pollInterval   = null;   // handle del setInterval
  var _knownReturnIds = {};     // IDs de devoluciones ya notificadas (evita toast repetido)
  var _panelOpen      = false;  // estado del panel

  // ── Tipos de notificación y sus íconos / clases ──────────────────────────
  var TYPE_META = {
    'return':    { icon: 'fa-rotate-left',   color: '#ef4444', label: 'Devolución' },
    'low_stock': { icon: 'fa-triangle-exclamation', color: '#f59e0b', label: 'Stock bajo' },
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  INIT — llamado desde 01-core.js / DOMContentLoaded
  // ══════════════════════════════════════════════════════════════════════════
  function init() {
    var btn = document.getElementById('pos-bell-btn');
    if (!btn) return;

    btn.addEventListener('click', function() {
      if (_panelOpen) { closePanel(); } else { _fetchAndOpenPanel(); }
    });

    // Cerrar panel al hacer clic fuera
    document.addEventListener('click', function(e) {
      if (_panelOpen && !btn.contains(e.target)) {
        var panel = document.getElementById('pos-notif-panel');
        if (panel && !panel.contains(e.target)) closePanel();
      }
    });

    _startPolling();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  POLLING
  // ══════════════════════════════════════════════════════════════════════════
  function _startPolling() {
    _poll();
    _pollInterval = setInterval(_poll, 10000);
  }

  function _poll() {
    apiFetch(API_BASE + '/notifications')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        var items = data.notifications || [];
        _updateBadge(items.length);
        _processActionRequired(items);
        if (_panelOpen) _renderPanelItems(items);
      })
      .catch(function(err) {
        console.warn('[POS-Notif] Poll error:', err);
      });
  }

  // ── Badge ────────────────────────────────────────────────────────────────
  function _updateBadge(count) {
    var badge = document.getElementById('pos-notif-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // ── Toasts automáticos para devoluciones nuevas (action_required) ────────
  function _processActionRequired(items) {
    items.forEach(function(n) {
      if (n.type !== 'return') return;
      var rid = n.id || n.return_id || n.sale_id;
      if (!rid || _knownReturnIds[rid]) return;
      _knownReturnIds[rid] = true;
      if (typeof showToast === 'function') {
        showToast('🔴 ' + (n.title || 'Devolución pendiente de aprobación'), 'error');
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PANEL DESPLEGABLE
  // ══════════════════════════════════════════════════════════════════════════
  function _fetchAndOpenPanel() {
    apiFetch(API_BASE + '/notifications')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        _openPanel(data.notifications || []);
      })
      .catch(function() { _openPanel([]); });
  }

  function _openPanel(items) {
    closePanel();
    var btn = document.getElementById('pos-bell-btn');
    var rect = btn ? btn.getBoundingClientRect() : { bottom: 48, right: 48 };

    var panel = document.createElement('div');
    panel.id = 'pos-notif-panel';
    panel.style.cssText = [
      'position:fixed;',
      'top:' + (rect.bottom + 6) + 'px;',
      'right:' + (window.innerWidth - rect.right) + 'px;',
      'width:320px;max-height:380px;overflow-y:auto;',
      'background:#fff;border:1px solid #e2e8f0;',
      'border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.15);',
      'z-index:99999;font-family:inherit;'
    ].join('');

    _panelOpen = true;
    panel.innerHTML = _buildPanelHTML(items);
    document.body.appendChild(panel);
  }

  function closePanel() {
    var panel = document.getElementById('pos-notif-panel');
    if (panel) panel.remove();
    _panelOpen = false;
  }

  function _renderPanelItems(items) {
    var list = document.getElementById('pos-notif-list');
    if (!list) return;
    list.innerHTML = _buildItemsHTML(items);
  }

  function _buildPanelHTML(items) {
    return [
      '<div style="padding:12px 16px 8px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;">',
      '  <span style="font-weight:800;font-size:13px;color:#1e293b;">🔔 Notificaciones</span>',
      '  <span style="font-size:10px;color:#94a3b8;font-weight:600;">' + items.length + ' total</span>',
      '</div>',
      '<div id="pos-notif-list" style="padding:4px 0;">',
      _buildItemsHTML(items),
      '</div>'
    ].join('');
  }

  function _buildItemsHTML(items) {
    if (!items || items.length === 0) {
      return '<div style="text-align:center;padding:24px 0;color:#94a3b8;font-size:12px;">Sin notificaciones pendientes ✓</div>';
    }
    return items.map(function(n) {
      var meta = TYPE_META[n.type] || { icon: 'fa-circle-info', color: '#64748b', label: n.type };
      var isReturn = (n.type === 'return');
      return [
        '<div style="padding:10px 16px;border-bottom:1px solid #f8fafc;display:flex;gap:10px;align-items:flex-start;">',
        '  <span style="margin-top:2px;color:' + meta.color + ';font-size:14px;flex-shrink:0;">',
        '    <i class="fa-solid ' + meta.icon + '"></i>',
        '  </span>',
        '  <div style="flex:1;min-width:0;">',
        '    <div style="font-weight:700;font-size:11px;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">',
        '      ' + _esc(n.title || meta.label),
        '    </div>',
        '    <div style="font-size:10px;color:#64748b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">',
        '      ' + _esc(n.body || n.mensaje || ''),
        '    </div>',
        isReturn ? '<div style="margin-top:6px;"><span style="font-size:9px;font-weight:700;background:#fef2f2;color:#ef4444;padding:2px 7px;border-radius:999px;text-transform:uppercase;">Requiere aprobación en Admin</span></div>' : '',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Exponer init para que 01-core.js lo llame en DOMContentLoaded ────────
  window.PosNotificationsInit = init;

})();
