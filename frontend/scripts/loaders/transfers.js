/* loaders/transfers.js — Calebsys Admin Shell v5.1A */
(function (global) {
  'use strict';

  global.loadTraspasos = async function () {
    var container = document.getElementById('traspasos-table-body');
    if (!container) return;

    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">Conectando con /api/transfers...</div></div>';

    try {
      var data = await AdminAPI.apiFetch('/api/transfers');
      var items = Array.isArray(data) ? data : (data.items || data.transfers || data.data || []);

      if (!items.length) {
        container.innerHTML = '<table><tbody>' + AdminAPI.emptyRow('Sin traspasos registrados', 6) + '</tbody></table>';
        return;
      }

      var rows = items.map(function (t) {
        // NOTA (fix regresión post-C2, 2026-08-05): crud.get_transfers no expone
        // status/estado porque los traspasos son atómicos (se crean ya completos,
        // sin flujo pendiente/en tránsito — ver crud.create_transfer). Por eso el
        // estado se fija a COMPLETADO: es el único valor verdadero hoy, no un
        // placeholder. Si se introduce un traspaso asíncrono (DispatchOrder,
        // reversión) en el futuro, el backend deberá exponer un campo real y este
        // fallback debe eliminarse.
        var statusMap = {
          'COMPLETADO': 'badge-success',
          'PENDIENTE':  'badge-warning',
          'EN_TRANSITO':'badge-info',
          'CANCELADO':  'badge-danger'
        };
        var status = (t.status || t.estado || 'COMPLETADO').toUpperCase();
        var badgeClass = statusMap[status] || 'badge-neutral';

        return '<tr>' +
          '<td class="td-mono">' + (t.id || '—').toString().slice(0,8) + '</td>' +
          '<td class="td-muted">' + AdminAPI.fmtDate(t.created_at) + '</td>' +
          '<td class="td-muted">' + (t.source_warehouse_name || '—') + '</td>' +
          '<td class="td-muted">' + (t.destination_warehouse_name || t.destination || '—') + '</td>' +
          '<td>' + AdminAPI.fmtNum(t.quantity || 0) + ' uds.</td>' +
          '<td><span class="badge ' + badgeClass + '">' + status + '</span></td>' +
          '</tr>';
      }).join('');

      container.innerHTML = '<table>' +
        '<thead><tr><th>ID</th><th>Fecha</th><th>Origen</th><th>Destino</th><th>Cantidad</th><th>Estado</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';

    } catch (err) {
      container.innerHTML = '<table><tbody>' + AdminAPI.errorRow(err.message, 6) + '</tbody></table>';
      console.warn('[Calebsys] Traspasos no cargados:', err.message);
    }
  };

})(window);
