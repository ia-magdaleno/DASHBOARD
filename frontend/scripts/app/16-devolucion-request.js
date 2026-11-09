/* ============================================================================
   16-devolucion-request.js — Alerta al activar "Devolución rápida" (F2)
   ---------------------------------------------------------------------------
   El comportamiento de F2 no cambia: sigue activando el modo devolución en el
   carrito (los artículos se agregan con cantidad negativa). Lo único que se
   añade es un aviso: al oprimir F2 / el botón, se notifica a Gerente, Admin y
   Almacén para que estén al tanto y verifiquen.
   ============================================================================ */

var _f2AlertaCooldown = 0;   // evita spam si el vendedor alterna F2 varias veces
var _f2GroupId = null;       // D6: id del caso abierto, para poder anularlo

function notificarDevolucionRapida() {
  var ahora = Date.now();
  if (ahora - _f2AlertaCooldown < 15000) return;   // máx. 1 aviso cada 15 s
  _f2AlertaCooldown = ahora;

  var vendedor = localStorage.getItem('calebsys_user') ||
                 localStorage.getItem('calebsys_username') || 'un vendedor';

  apiFetch(API_BASE + '/devoluciones/solicitud', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({
      detalle: 'Devolución iniciada en el POS por ' + vendedor +
               ' — verificar ticket y artículos.',
      ticket_ref: null
    })
  })
    .then(function (res) {
      if (res && res.ok) {
        _f2GroupId = res.group_id || null;
        showToast('Se avisó a Almacén y Gerencia.', 'info');
      }
    })
    .catch(function () { /* silencioso — el aviso es best-effort */ });
}

/* D6: si el vendedor revierte la devolución (sale del modo F2 sin concretarla),
   se anula el caso para que no queden notificaciones colgadas. Best-effort. */
function cancelarDevolucionRapida() {
  var gid = _f2GroupId;
  _f2GroupId = null;
  if (!gid) return;
  apiFetch(API_BASE + '/devoluciones/caso/' + gid + '/cancelar', {
    method: 'POST',
    credentials: 'include'
  })
    .then(function (res) {
      if (res && res.ok) showToast('Solicitud de devolución anulada.', 'info');
    })
    .catch(function () { /* silencioso */ });
}

window.notificarDevolucionRapida = notificarDevolucionRapida;
window.cancelarDevolucionRapida  = cancelarDevolucionRapida;
