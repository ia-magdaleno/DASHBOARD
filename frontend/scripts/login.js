// =============================================================================
// CALEBSYS LOGIN — frontend/scripts/login.js
// Sin eventos inline. Todo via addEventListener. CSP-compliant.
// =============================================================================

document.addEventListener('DOMContentLoaded', function () {
  // ── Referencias ────────────────────────────────────────────────────────────
  var form     = document.getElementById('login-form');
  var errorEl  = document.getElementById('login-error');
  var btnLogin = document.getElementById('btn-login');

  // ── Toggle modo claro/oscuro ────────────────────────────────────────────────
  // (Antes vivía en un <script> inline de login.html; la CSP tiene
  // script-src 'self' sin 'unsafe-inline', asi que ese bloque nunca se
  // ejecutaba y el switch no hacia nada. Movido aqui, que si es CSP-safe.)
  var themeToggle = document.getElementById('dark-toggle');
  if (themeToggle) {
    // Evita que el clic en el switch (o su label) burbujee hasta el
    // .module-icon padre y dispare navegacion/otro data-action
    var themeToggleWrap = themeToggle.closest('.dark-toggle');
    if (themeToggleWrap) {
      themeToggleWrap.addEventListener('click', function (e) { e.stopPropagation(); });
    }
    // Sincroniza el checkbox con el tema ya aplicado por theme-init.js
    themeToggle.checked = !document.body.classList.contains('light-mode');
    themeToggle.addEventListener('change', function () {
      var isLight = !themeToggle.checked;
      document.body.classList.toggle('light-mode', isLight);
      localStorage.setItem('calebsys_theme', isLight ? 'light' : 'dark');
    });
  }


  if (!form) {
    console.error('[CALEBSYS LOGIN] No existe #login-form en el DOM');
    return;
  }

  // ── D4: identidad de la terminal ──────────────────────────────────────────
  // El terminal_id es config LOCAL de este equipo. Se puede fijar una vez con
  // ?terminal=TERM-9 en la URL; queda guardado via CalebNative (nativo en app,
  // localStorage en navegador). Ver native-bridge.js.
  (async function () {
    try {
      var qp = new URLSearchParams(location.search).get('terminal');
      if (qp) await CalebNative.setTerminalId(qp.trim());
    } catch (e) {}
  })();

  async function _terminalId() {
    return await CalebNative.getTerminalId();
  }

  // Si hay terminal_id y empresa, preguntamos a qué sede pertenece (pre-login).
  async function _checkTerminal() {
    var hint = document.getElementById('terminal-hint');
    var emp  = ((document.getElementById('empresa-id') || {}).value || '').trim();
    var tid  = await _terminalId();
    if (!hint) return;
    if (!emp || !tid) { hint.style.display = 'none'; return; }
    try {
      var r = await fetch('/api/terminal/whoami?empresa_id=' + encodeURIComponent(emp) +
                          '&terminal_id=' + encodeURIComponent(tid));
      var d = await r.json();
      if (!d.enforced) { hint.style.display = 'none'; return; }
      hint.style.display = 'block';
      if (d.authorized) {
        hint.textContent = '🖥 Terminal ' + tid + ' · Sucursal: ' + (d.label || d.sucursal_id || '—');
        hint.style.color = 'var(--success, #16a34a)';
      } else {
        hint.textContent = '⚠ Terminal ' + tid + ' no autorizada para este tenant.';
        hint.style.color = 'var(--danger, #dc2626)';
      }
    } catch (e) { hint.style.display = 'none'; }
  }
  var _empEl = document.getElementById('empresa-id');
  if (_empEl) _empEl.addEventListener('blur', _checkTerminal);
  _checkTerminal();

  // ── Restaurar "Recordar" ───────────────────────────────────────────────────
  if (localStorage.getItem('calebsys_remember') === '1') {
    var e1 = document.getElementById('empresa-id');
    var e2 = document.getElementById('usuario-id');
    var e3 = document.getElementById('recordar');
    if (e1) e1.value   = localStorage.getItem('calebsys_empresa') || '';
    if (e2) e2.value   = localStorage.getItem('calebsys_usuario') || '';
    if (e3) e3.checked = true;
  }

  // ── Iconos de módulo (data-href) ───────────────────────────────────────────
  document.querySelectorAll('[data-href]').forEach(function (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      window.location.href = el.getAttribute('data-href');
    });
  });
  document.querySelectorAll('[data-action="show-login-hint"]').forEach(function (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      if (errorEl) {
        errorEl.textContent = 'Por favor inicie sesión usando el botón INGRESAR.';
        errorEl.style.display = 'block';
      }
    });
  });
  document.querySelectorAll('[data-action="show-unavailable"]').forEach(function (el) {
    el.addEventListener('click', function () {
      if (errorEl) {
        errorEl.textContent = 'Módulo no disponible en este piloto.';
        errorEl.style.display = 'block';
      }
    });
  });

  // ── Enter entre campos ─────────────────────────────────────────────────────
  var fe = document.getElementById('empresa-id');
  var fu = document.getElementById('usuario-id');
  var fp = document.getElementById('password');
  if (fe) fe.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (fu) fu.focus(); } });
  if (fu) fu.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (fp) fp.focus(); } });
  if (fp) fp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.submit(); } });

  // ── Submit principal ───────────────────────────────────────────────────────
  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    var empresaId = ((document.getElementById('empresa-id') || {}).value || '').trim();
    var usuarioId = ((document.getElementById('usuario-id') || {}).value || '').trim();
    var password  =  (document.getElementById('password')  || {}).value || '';

    if (!empresaId || !usuarioId || !password) {
      console.error('[CALEBSYS LOGIN] Campos incompletos:', {
        empresa: !!empresaId, usuario: !!usuarioId, password: !!password
      });
      if (errorEl) {
        errorEl.textContent = '⚠ ID de empresa, usuario o contraseña incorrectos.';
        errorEl.style.display = 'block';
      }
      return;
    }

    if (errorEl) errorEl.style.display = 'none';
    if (btnLogin) { btnLogin.textContent = 'Verificando...'; btnLogin.disabled = true; }

    try {
      var response = await fetch('/api/auth/login', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          empresa_id:  empresaId,
          usuario_id:  usuarioId,
          username:    usuarioId,
          password:    password,
          terminal_id: (await _terminalId()) || null   // D4: sede de la terminal
        })
      });

      var data = {};
      try { data = await response.json(); } catch (e) { data = {}; }

      if (!response.ok) {
        console.error('[CALEBSYS LOGIN] ERROR LOGIN', data);
        if (errorEl) {
          // D4: login bloqueado por terminal no autorizada
          errorEl.textContent = (response.status === 403 && /terminal/i.test(data.detail || ''))
            ? '⚠ ' + data.detail
            : '⚠ Credenciales incorrectas. Verifique empresa, usuario y contraseña.';
          errorEl.style.display = 'block';
        }
        if (btnLogin) { btnLogin.textContent = 'Ingresar'; btnLogin.disabled = false; }
        return;
      }

      var role = data.role || data.rol || 'Cajero';
      if (data.token) localStorage.setItem('calebsys_token', data.token);
      localStorage.setItem('calebsys_role',     role);
      localStorage.setItem('calebsys_user',     usuarioId);
      localStorage.setItem('calebsys_company',  empresaId);
      // D4: la sede efectiva de la sesión la decide el backend (terminal o la
      // del usuario). Se guarda para que el resto de la app la use.
      localStorage.setItem('calebsys_sucursal', data.sucursal || '');
      localStorage.setItem('calebsys_branch',   data.sucursal || 'Magdaleno');

      // Nuevo login = nueva sesión de reloj: permitir que el modal
      // checador se auto-muestre otra vez (reloj-embed.js / os-admin.js).
      sessionStorage.removeItem('calebsys_reloj_autoshow_done');
      sessionStorage.removeItem('calebsys_autofichar_done');

      var rem = document.getElementById('recordar');
      if (rem && rem.checked) {
        localStorage.setItem('calebsys_remember', '1');
        localStorage.setItem('calebsys_empresa',  empresaId);
        localStorage.setItem('calebsys_usuario',  usuarioId);
      } else {
        localStorage.removeItem('calebsys_remember');
        localStorage.removeItem('calebsys_empresa');
        localStorage.removeItem('calebsys_usuario');
      }

      if (btnLogin) {
        btnLogin.textContent = '✓ Acceso Concedido';
        btnLogin.style.background = 'linear-gradient(90deg,#1aab5e,#0fcf5f)';
      }

      // Todos los roles operativos aterrizan en /os; ahí la pantalla se
      // muestra igual que a Admin/Gerente pero con sólo su módulo habilitado.
      var RUTAS = {
        // ── Dueño del software ──
        'superadmin':            '/admin_shell.html',
        // ── Administración ──
        'Administrador':         '/os',
        'Administrador General': '/os',
        'Dueño':                 '/os',
        'Dueno':                 '/os',
        'Owner':                 '/os',
        'Admin':                 '/os',
        'admin':                 '/os',
        'Gerente':               '/os',
        // ── Punto de Venta ──
        'Cajero':                '/os',
        'Vendedor':              '/os',
        'Supervisor':            '/os',
        'Operador ventas':       '/os',
        'Operador caja':         '/os',
        'Solo lectura':          '/os',
        // ── Almacén ──
        'Almacenista':           '/os',
        'Almacen':               '/os',
        'Almacén':               '/os',
        'Operador almacén':      '/os',
        'Operador almacen':      '/os',
        // ── Compras ──
        'Comprador':             '/os',
        'Compras':               '/os',
        // ── Cartera / CRM ──
        'Cartera':               '/os',
        'Cobranza':              '/os',
        // ── Reparto ──
        'vendedor_calle':        '/pages/movil/mi-ruta.html',
        'Repartidor':            '/pages/movil/mi-ruta.html',
        'Chofer':                '/pages/movil/mi-ruta.html',
        'Operador reparto':      '/pages/movil/mi-ruta.html',
        // ── Administrativos / contables ──
        'Recursos Humanos':      '/admin_shell.html',
        'Contador':              '/admin_shell.html',
        // ── Otros ──
        'Community':             '/connect'
      };

      var next = RUTAS[role] || '/os';
      window.location.href = next;

    } catch (err) {
      console.error('[CALEBSYS LOGIN] FETCH ERROR', err);
      if (errorEl) {
        errorEl.textContent = '⚠ Error de conexión. Intente de nuevo.';
        errorEl.style.display = 'block';
      }
      if (btnLogin) { btnLogin.textContent = 'Ingresar'; btnLogin.disabled = false; }
    }
  });

});
