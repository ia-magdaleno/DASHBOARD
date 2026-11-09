/* loaders/cxc.js — Calebsys Admin Shell v5.1A */
(function (global) {
  'use strict';

  global.loadCXC = async function () {
    var container = document.getElementById('cxc-table-body');
    if (!container) return;

    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">Conectando con /api/accounts-receivable...</div></div>';

    try {
      var data = await AdminAPI.apiFetch('/api/accounts-receivable');
      var items = Array.isArray(data) ? data : (data.items || data.accounts || data.data || []);

      var countEl = document.getElementById('cxc-count');
      if (countEl) countEl.textContent = items.length + ' cuentas';

      if (!items.length) {
        container.innerHTML = '<table><tbody>' + AdminAPI.emptyRow('Sin cuentas por cobrar registradas', 6) + '</tbody></table>';
        return;
      }

      var rows = items.map(function (a) {
        var balance = Number(a.balance || a.saldo_pendiente || a.amount || 0);
        var original = Number(a.original_amount || a.monto_original || balance);
        var isOverdue = a.is_overdue || a.vencido || false;
        var statusBadge = isOverdue
          ? '<span class="badge badge-danger"><span class="dot"></span>Vencido</span>'
          : '<span class="badge badge-warning"><span class="dot"></span>Pendiente</span>';

        return '<tr>' +
          '<td style="font-weight:600;">' + (a.client_name || a.cliente || a.client || '—') + '</td>' +
          '<td class="td-mono">' + (a.sale_id || a.venta_id || a.invoice || '—') + '</td>' +
          '<td>' + AdminAPI.fmtCurrency(original) + '</td>' +
          '<td style="font-weight:700;color:var(--danger);">' + AdminAPI.fmtCurrency(balance) + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td><button class="btn btn-secondary btn-sm btn-icon" title="Registrar abono" style="color:var(--success);" onclick="openModal(\'modal-abono\')"><i class="fa-solid fa-dollar-sign"></i></button></td>' +
          '</tr>';
      }).join('');

      container.innerHTML = '<table>' +
        '<thead><tr><th>Cliente</th><th>Venta</th><th>Monto Original</th><th>Saldo Pendiente</th><th>Estado</th><th>Acciones</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';

    } catch (err) {
      container.innerHTML = '<table><tbody>' + AdminAPI.errorRow(err.message, 6) + '</tbody></table>';
      console.warn('[Calebsys] CxC no cargado:', err.message);
    }
  };

})(window);
