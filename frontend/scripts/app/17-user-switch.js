// =============================================================================
// 17-user-switch.js  —  F9: Cambio de usuario sin cerrar sesión
// =============================================================================

(function () {

  var MODAL_ID  = 'modal-user-switch';
  var _busy     = false;

  // ── Abrir modal ────────────────────────────────────────────────────────────
  window.openUserSwitchModal = function () {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    // Rellenar empresa con la sesión activa (no editable en el modal)
    var empresa = localStorage.getItem('calebsys_company') || '';
    var empEl   = document.getElementById('us-empresa-display');
    if (empEl) empEl.textContent = empresa || '—';

    // Limpiar campos y errores anteriores
    var inpUser = document.getElementById('us-username');
    var inpPass = document.getElementById('us-password');
    var errEl   = document.getElementById('us-error');
    var btnEl   = document.getElementById('us-btn-enter');
    if (inpUser) inpUser.value = '';
    if (inpPass) inpPass.value = '';
    if (errEl)   { errEl.textContent = ''; errEl.hidden = true; }
    if (btnEl)   { btnEl.disabled = false; btnEl.textContent = 'Cambiar usuario'; }
    _busy = false;

    modal.classList.remove('hidden');
    if (inpUser) setTimeout(function () { inpUser.focus(); }, 80);
  };

  // ── Cerrar modal ───────────────────────────────────────────────────────────
  window.closeUserSwitchModal = function () {
    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.classList.add('hidden');
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  window.submitUserSwitch = async function () {
    if (_busy) return;

    var empresa  = localStorage.getItem('calebsys_company') || '';
    var inpUser  = document.getElementById('us-username');
    var inpPass  = document.getElementById('us-password');
    var errEl    = document.getElementById('us-error');
    var btnEl    = document.getElementById('us-btn-enter');

    var username = (inpUser ? inpUser.value : '').trim();
    var password = inpPass ? inpPass.value : '';

    function _setError(msg) {
      if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Cambiar usuario'; }
      _busy = false;
    }

    if (!username || !password) {
      _setError('⚠ Ingresa usuario y contraseña.');
      return;
    }
    if (!empresa) {
      _setError('⚠ No se encontró la empresa activa. Recargue la página.');
      return;
    }

    _busy = true;
    if (errEl)  { errEl.hidden = true; }
    if (btnEl)  { btnEl.disabled = true; btnEl.textContent = 'Verificando…'; }

    try {
      var resp = await fetch('/api/auth/login', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          empresa_id: empresa,
          usuario_id: username,
          username:   username,
          password:   password
        })
      });

      var data = {};
      try { data = await resp.json(); } catch (_) {}

      if (!resp.ok) {
        _setError('⚠ Credenciales incorrectas. Verifique usuario y contraseña.');
        return;
      }

      // ── Actualizar sesión sin redirigir ────────────────────────────────────
      var role        = data.role || data.rol || 'Cajero';
      var displayName = data.nombre_completo || data.name || username;

      if (data.token) {
        localStorage.setItem('calebsys_token', data.token);
      }
      localStorage.setItem('calebsys_role',         role);
      localStorage.setItem('calebsys_user',         username);
      localStorage.setItem('calebsys_display_name', displayName);
      if (data.sucursal) {
        localStorage.setItem('calebsys_sucursal', data.sucursal);
        localStorage.setItem('calebsys_branch',   data.sucursal);
      }

      // Reiniciar marcas de reloj checador para el nuevo usuario
      sessionStorage.removeItem('calebsys_reloj_autoshow_done');
      sessionStorage.removeItem('calebsys_autofichar_done');

      // ── Reflejar nuevo usuario en ambos headers del POS ───────────────────
      if (typeof _posApplyUserIdentity === 'function') {
        _posApplyUserIdentity(displayName, role);
      }

      // ── Aplicar RBAC del nuevo rol ─────────────────────────────────────────
      if (typeof _posApplyRbac === 'function') {
        _posApplyRbac();
      }

      closeUserSwitchModal();
      if (typeof showToast === 'function') {
        showToast('Sesión transferida a ' + displayName.toUpperCase(), 'success');
      }

    } catch (err) {
      _setError('⚠ Error de conexión. Intente de nuevo.');
    }
  };

  // ── Teclado dentro del modal ───────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    var modal = document.getElementById(MODAL_ID);
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeUserSwitchModal();
    }
    if (e.key === 'Enter') {
      var active = document.activeElement;
      // Avanzar de usuario → contraseña al pulsar Enter en el primer campo
      if (active && active.id === 'us-username') {
        e.preventDefault();
        var inpPass = document.getElementById('us-password');
        if (inpPass) inpPass.focus();
        return;
      }
      // Desde contraseña o botón → enviar
      if (active && (active.id === 'us-password' || active.id === 'us-btn-enter')) {
        e.preventDefault();
        submitUserSwitch();
      }
    }
  });

})();
