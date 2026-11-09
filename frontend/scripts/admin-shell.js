/* =============================================================
   admin-shell.js — Calebsys Admin Shell v5.1A
   SPA Router · Modal Manager · Session · Online/Offline
   Freeze: v1.0.0-ui-core-shell-freeze
   ============================================================= */
(function (global) {
  'use strict';

  /* ── PAGE REGISTRY ── */
  var PAGE_LABELS = {
    dashboard:      'Dashboard',
    productos:      'Catálogo de Productos',
    inventario:     'Inventario Multibodega',
    kardex:         'Kardex de Movimientos',
    cfdi:           'Operaciones · CFDI',
    proveedores:            'Compras · Proveedores',
    'compras-ordenes':      'Compras · Órdenes de Compra',
    'compras-recepciones':  'Compras · Recepción de Mercancía',
    'compras-cxp':          'Compras · Cuentas por Pagar',
    'almacen-compras':      'Almacén · Recepción Directa (legacy)',
    'almacen-devoluciones': 'Almacén · Devoluciones de Venta',
    'almacen-ajuste':       'Almacén · Ajuste de Inventario',
    traspasos:      'Traslados entre Bodegas',
    clientes:       'Clientes / CRM',
    cuentas_cobrar: 'Cuentas por Cobrar',
    cxc:            'Cartera · Cuentas por Cobrar',
    caja:           'Caja y Cortes',
    'recursos-humanos': 'Recursos Humanos',
    'empleado-alta': 'Recursos Humanos > Alta de empleado',
    reportes:       'Reportes',
    usuarios:       'Usuarios y Roles',
    auditoria:      'Auditoría del Sistema',
    configuracion:  'Configuración',
    superadmin:     'Consola SuperAdmin',
    plugins:        'Plugins y Licencias',
    loyalty:         'Fidelización de Puntos',
    contractors:     'Contratistas',
    projects:        'Proyectos / Obras',
    'sellers-config': 'Configuración de Vendedores',
    rutas:           'Rutas de Reparto',
    'producto-alta': 'Catálogo de Productos > Alta / Edición de Producto'
  };

  // Map page IDs to HTML filenames (handles underscore → hyphen)
  var PAGE_FILES = {
    cuentas_cobrar: 'cuentas-cobrar',
    cxc:            'cuentas-cobrar',   // alias Cartera → misma página CxC
    'producto-alta': 'producto-alta'
  };

  var pageCache  = {};
  var currentPage = 'dashboard';
  var isNavigating = false;
  var pendingEmployeePhotoFile = null;

  /* ── AREA → PUESTO MAP (definido a nivel IIFE para acceso global) ── */
  // Clave normalizada (sin acentos, mayúsculas) para robustez ante encoding
  var AREA_PUESTO_MAP = {
    'ADMINISTRACION': 'ADMINISTRATIVO',
    'MOSTRADOR':      'VENDEDOR MOSTRADOR',
    'CAJA':           'CAJERO',
    'VENTAS':         'VENDEDOR',
    'ALMACEN':        'ALMACENISTA',
    'REPARTO':        'REPARTIDOR'
  };
  function getPositionForArea(areaValue) {
    if (!areaValue) return '';
    var key = String(areaValue)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().trim();
    return AREA_PUESTO_MAP[key] || '';
  }

  /* ── PAGE LOADER ── */
  async function loadPageHTML(pageId) {
    if (pageCache[pageId]) return pageCache[pageId];

    var filename = PAGE_FILES[pageId] || pageId;
    var url = 'pages/admin/' + filename + '.html?v=20261108d';

    // ADMIN-RH-01: Intercept Recursos Humanos (rendered purely via JS)
    if (pageId === 'recursos-humanos') {
      pageCache[pageId] = renderRecursosHumanos();
      return pageCache[pageId];
    }
    if (pageId === 'empleado-alta') {
      pageCache[pageId] = renderEmployeeFormPage();
      return pageCache[pageId];
    }

    try {
      var res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      pageCache[pageId] = await res.text();
    } catch (err) {
      console.warn('[Calebsys] No se pudo cargar página "' + pageId + '":', err.message);
      pageCache[pageId] = '<div class="empty-state">' +
        '<div class="empty-icon" style="color:var(--danger);border-color:rgba(239,68,68,0.2);">' +
        '<i class="fa-solid fa-triangle-exclamation"></i></div>' +
        '<div class="empty-title">Página no disponible</div>' +
        '<div class="empty-desc">No se pudo cargar la página "' + pageId + '".</div>' +
        '<div class="empty-module-label"><i class="fa-solid fa-plug"></i> Verifique que el servidor esté activo</div>' +
        '</div>';
    }
    return pageCache[pageId];
  }

  /* Roles exentos del reloj checador (dueño del Tenant y dueño del software).
     Gerente SÍ checa — RH-04, Don Antonio 02-09-2026. Slugs en minúsculas. */
  var RELOJ_EXEMPT_ROLES = ['admin', 'administrador', 'administrador general',
                            'superadmin', 'dueño', 'dueno', 'owner'];

  /* Admin master del tenant: acceso 100% al shell, scope selector en reportes. */
  var MASTER_ADMIN_ROLES = ['admin', 'administrador', 'administrador general',
                            'dueño', 'dueno', 'owner', 'gerente general'];
  /* Gerente de sucursal: acceso operativo completo a su sucursal, sin configuración. */
  var GERENTE_SUC_ROLES  = ['gerente', 'gerente sucursal', 'administrador sucursal'];

  /* Roles que pueden entrar al Admin Shell (union de los anteriores + superadmin). */
  var ALLOWED_ADMIN_ROLES = MASTER_ADMIN_ROLES.concat(GERENTE_SUC_ROLES).concat(['superadmin']);

  /* ─── RBAC de navegación ───────────────────────────────────────────
     Cada rol que aterriza en el Admin Shell ve SOLO sus módulos.
     Roles sin entrada aquí (Admin / Gerente) ven todo.
     SuperAdmin es un caso aparte (Política de seguridad 1A, Isael 08-sep):
     el dueño del software SOLO da de alta el tenant y su admin — de ahí en
     adelante toda la operación es del admin del tenant. SuperAdmin nunca
     debe ver Productos/Inventario/Compras/Clientes/CxC/Caja de ningún
     tenant, así que aquí SÍ tiene entrada, restringida a su propia consola. */
  var NAV_BY_ROLE = {
    // Gerente Sucursal / Administrador Sucursal: todos los módulos operativos de
    // su sucursal. Sin Configuración, Plugins ni SuperAdmin.
    // Clientes, Cartera e Inventario en solo lectura (ver NAV_READONLY_BY_ROLE).
    'gerente': [
      'dashboard',
      'productos','inventario','cfdi','kardex','traspasos',
      'almacen-devoluciones','almacen-ajuste','compras-recepciones',
      'proveedores','compras-ordenes','compras-cxp',
      'clientes','cuentas_cobrar','caja','cxc',
      'recursos-humanos','empleado-alta',
      'reportes','auditoria',
      'loyalty','contractors','projects','sellers-config','rutas'
    ],
    'superadmin': ['superadmin']
  };
  NAV_BY_ROLE['gerente sucursal']       = NAV_BY_ROLE['gerente'];
  NAV_BY_ROLE['administrador sucursal'] = NAV_BY_ROLE['gerente'];

  // Páginas que el rol ve pero en modo consulta (badge "solo lectura").
  var NAV_READONLY_BY_ROLE = {
    'gerente':              ['clientes', 'cuentas_cobrar', 'cxc', 'inventario'],
    'gerente sucursal':     ['clientes', 'cuentas_cobrar', 'cxc', 'inventario'],
    'administrador sucursal': ['clientes', 'cuentas_cobrar', 'cxc', 'inventario']
  };

  /* Guard: solo Admin master y Gerente Sucursal pueden entrar al shell.
     Cualquier otro rol con sesión activa → redirigir al POS (/). */
  function _checkAdminAccess() {
    var role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
    // Sin sesión → el shell mismo redirigirá a /login vía 401 de la API
    if (!role) return true;
    if (ALLOWED_ADMIN_ROLES.indexOf(role) === -1) {
      window.location.replace('/');
      return false;
    }
    return true;
  }

  function _navAllowedPages() {
    var role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
    // Master admin → null = sin restricción (ve todo)
    if (MASTER_ADMIN_ROLES.indexOf(role) !== -1) return null;
    return NAV_BY_ROLE[role] || null;
  }

  function _navReadonlyPages() {
    var role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
    return NAV_READONLY_BY_ROLE[role] || [];
  }

  function _applyNavRbac() {
    var allowed = _navAllowedPages();
    if (!allowed) return;               // Admin / Gerente → menú completo
    var readonly = _navReadonlyPages();

    // 1. Ocultar items de navegación fuera del rol + badge "solo lectura"
    document.querySelectorAll('#sidebar-nav .nav-item[data-page]').forEach(function (el) {
      var page = el.getAttribute('data-page');
      el.style.display = allowed.indexOf(page) === -1 ? 'none' : '';
      if (readonly.indexOf(page) !== -1 && !el.querySelector('.nav-ro-badge')) {
        el.setAttribute('data-readonly', '1');
        var b = document.createElement('span');
        b.className = 'nav-ro-badge';
        b.textContent = 'solo lectura';
        b.style.cssText = 'margin-left:auto;font-size:9px;font-weight:700;text-transform:uppercase;' +
          'letter-spacing:.04em;background:rgba(148,163,184,.18);color:#94a3b8;' +
          'padding:2px 6px;border-radius:6px;white-space:nowrap;';
        el.appendChild(b);
      }
    });

    // 2. Ocultar el botón "OS" (regreso al shell de administración)
    var posWrap = document.querySelector('#sidebar-nav .nav-pos-wrapper');
    if (posWrap) posWrap.style.display = 'none';
    var posLink = document.getElementById('tb-pos-link');
    if (posLink) posLink.style.display = 'none';

    // 3. Ocultar etiquetas de grupo que quedaron sin items visibles
    document.querySelectorAll('#sidebar-nav .nav-group-label').forEach(function (label) {
      var vis = false, n = label.nextElementSibling;
      while (n && !n.classList.contains('nav-group-label')) {
        if (n.classList.contains('nav-item') && n.style.display !== 'none') { vis = true; break; }
        if (n.classList.contains('nav-pos-wrapper') && n.style.display !== 'none') { vis = true; break; }
        n = n.nextElementSibling;
      }
      label.style.display = vis ? '' : 'none';
    });

    // 4. Ocultar botones FAB cuya página no está en el rol actual
    document.querySelectorAll('[data-fab-page]').forEach(function (btn) {
      var page = btn.getAttribute('data-fab-page');
      btn.style.display = allowed.indexOf(page) === -1 ? 'none' : '';
    });
  }

  function _navFallbackPage() {
    var allowed = _navAllowedPages();
    return (allowed && allowed.length) ? allowed[0] : 'dashboard';
  }

  /* ─── PAGE LOADER ─── */
  function getPageFromHash() {
    var raw = window.location.hash || "#dashboard";
    var page = raw.replace("#", "").trim();
    if (!PAGE_LABELS[page]) return _navFallbackPage();
    var allowed = _navAllowedPages();
    if (allowed && allowed.indexOf(page) === -1) return _navFallbackPage();
    return page;
  }

  /* ── SPA NAVIGATION ── */
  async function navigateTo(pageId) {
    if (!PAGE_LABELS[pageId] || isNavigating) return;
    var _allowed = _navAllowedPages();
    if (_allowed && _allowed.indexOf(pageId) === -1) {
      pageId = _navFallbackPage();
    }
    isNavigating = true;

    if (window.location.hash !== "#" + pageId) {
      window.location.hash = pageId;
    }

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(function (el) {
      el.classList.remove('active');
    });
    var navEl = document.querySelector('[data-page="' + pageId + '"]');
    if (navEl) navEl.classList.add('active');

    // Update topbar breadcrumb
    var breadcrumb = document.getElementById('topbar-current-page');
    if (breadcrumb) breadcrumb.textContent = PAGE_LABELS[pageId] || pageId;

    // Inject page HTML into content area
    var contentArea = document.getElementById('content-area');
    if (contentArea) {
      contentArea.style.opacity = '0';
      contentArea.style.transform = 'translateY(6px)';

      var html = await loadPageHTML(pageId);

      // Usar createContextualFragment para ejecutar <script> inline de las páginas
      try {
        var frag = document.createRange().createContextualFragment(html);
        contentArea.innerHTML = '';
        contentArea.appendChild(frag);
      } catch (e) {
        contentArea.innerHTML = html; // fallback
      }

      // Llamar init handler registrado por compras.js / otros loaders
      if (window.pageInitHandlers && typeof window.pageInitHandlers[pageId] === 'function') {
        try { window.pageInitHandlers[pageId](); } catch (e) { console.warn('[shell] pageInitHandler error:', e); }
      }

      // Trigger transition
      requestAnimationFrame(function () {
        contentArea.style.transition = 'opacity 250ms ease, transform 250ms ease';
        contentArea.style.opacity = '1';
        contentArea.style.transform = 'translateY(0)';
        // Al terminar la animación, limpiar transform por completo (no dejarlo
        // en 'translateY(0)'). Cualquier valor de transform distinto de "none"
        // -- aunque sea visualmente un no-op -- convierte a este contenedor en
        // el "containing block" de sus descendientes position:fixed (spec de
        // CSS), rompiendo el centrado/tamaño de TODOS los modales
        // (.modal-backdrop) de cada página del admin-shell mientras el
        // usuario siga en esa página. Se notó en Proveedores porque su modal
        // es alto y se recortaba; el bug de fondo afectaba a cualquier modal.
        var _transformCleared = false;
        function _clearContentTransform() {
          if (_transformCleared) return;
          _transformCleared = true;
          contentArea.style.transform = '';
          contentArea.style.transition = '';
        }
        contentArea.addEventListener('transitionend', function (ev) {
          if (ev.propertyName === 'transform') _clearContentTransform();
        }, { once: true });
        // Fallback: si transitionend no dispara (prefers-reduced-motion,
        // navegador que no anima, etc.), limpiar de todas formas pasado el
        // tiempo de la transición — nunca debe quedar un transform "colgado".
        setTimeout(_clearContentTransform, 300);
      });
    }

    currentPage = pageId;
    isNavigating = false;
    
    var freezeTag = document.querySelector('.freeze-tag');
    if (freezeTag) {
      if (pageId === 'empleado-alta') {
        freezeTag.classList.add('hidden');
      } else {
        freezeTag.classList.remove('hidden');
      }
    }

    // Load data for pages with live endpoints
    loadPageData(pageId);
  }

  /* ── DATA DISPATCHER ── */
  function loadPageData(pageId) {
    switch (pageId) {
      case 'dashboard':      if (typeof loadDashboard  === 'function') loadDashboard();  break;
      case 'productos':      if (typeof loadProducts   === 'function') loadProducts();   break;
      case 'kardex':         if (typeof loadKardex     === 'function') loadKardex();     break;
      case 'inventario':     if (typeof loadInventario === 'function') loadInventario(); break;
      case 'cfdi':           if (typeof loadCfdi       === 'function') loadCfdi();       break;
      case 'traspasos':      if (typeof loadTraspasos  === 'function') loadTraspasos();  break;
      case 'almacen-compras':      if (typeof loadCompras     === 'function') loadCompras();     break;
      case 'almacen-devoluciones': if (typeof loadDevoluciones=== 'function') loadDevoluciones();break;
      case 'almacen-ajuste':       if (typeof loadAjustes     === 'function') loadAjustes();     break;
      case 'clientes':       if (typeof loadClients    === 'function') loadClients();    break;
      case 'cuentas_cobrar':
      case 'cxc':            if (typeof loadCXC        === 'function') loadCXC();        break;
      case 'recursos-humanos':   if (typeof loadRhEmployees      === 'function') loadRhEmployees();      break;
      case 'empleado-alta':      if (typeof bindEmployeeFormPageEvents === 'function') bindEmployeeFormPageEvents(); break;
      case 'producto-alta':      if (typeof initProductAltaPage === 'function') initProductAltaPage(); break;
      // Módulo Administración
      case 'usuarios':           if (typeof loadAdminUsers       === 'function') loadAdminUsers();       break;
      case 'auditoria':          if (typeof loadAuditLogs        === 'function') loadAuditLogs();        break;
      case 'configuracion':      if (typeof loadEmpresaConfig    === 'function') { loadEmpresaConfig(); if (typeof loadSucursales === 'function') loadSucursales(); if (typeof loadWhatsAppConfig === 'function') loadWhatsAppConfig(); }break;
      case 'superadmin':         if (typeof loadTenants          === 'function') loadTenants();          break;
      default: break;
    }
  }

  /* ── MODAL MANAGEMENT ── */
  function openModal(modalId) {
    var el = document.getElementById(modalId);
    if (el) el.classList.add('open');
  }

  function closeModal(modalId) {
    var el = document.getElementById(modalId);
    if (el) el.classList.remove('open');
  }

  function _setupModalBackdrops() {
    document.querySelectorAll('.modal-backdrop').forEach(function (bd) {
      bd.addEventListener('click', function (e) {
        if (e.target === bd) bd.classList.remove('open');
      });
    });
    // ESC key
    // Helper: detecta si la modal de baja está abierta
    function isDeleteModalOpen() {
      var modal = document.getElementById('modal-delete-employee');
      return !!(modal && modal.classList.contains('open'));
    }

    // Handler de teclado exclusivo para la modal de baja
    function handleDeleteModalKeydown(e) {
      var modal = document.getElementById('modal-delete-employee');
      if (!modal) return;
      var cancelBtn = modal.querySelector('.delete-modal-btn-cancel');
      var deleteBtn = modal.querySelector('.delete-modal-btn-danger');

      if (e.key === 'Escape') {
        e.preventDefault();
        if (typeof global.closeEmployeeDeleteModal === 'function') global.closeEmployeeDeleteModal();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (cancelBtn) cancelBtn.focus();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (deleteBtn) deleteBtn.focus();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        var active = document.activeElement;
        if (active === cancelBtn && deleteBtn) {
          deleteBtn.focus();
        } else if (cancelBtn) {
          cancelBtn.focus();
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        var active = document.activeElement;
        if (active === cancelBtn) {
          e.preventDefault();
          if (typeof global.closeEmployeeDeleteModal === 'function') global.closeEmployeeDeleteModal();
          return;
        }
        if (active === deleteBtn) {
          e.preventDefault();
          if (typeof global.confirmEmployeeSoftDelete === 'function') global.confirmEmployeeSoftDelete();
          return;
        }
      }
    }

    document.addEventListener('keydown', function (e) {
      var isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';

      // Si la modal de baja está abierta, interceptar TODO el teclado
      if (isDeleteModalOpen()) {
        handleDeleteModalKeydown(e);
        return;
      }

      if (e.key === 'Escape') {
        var openModals = document.querySelectorAll('.modal-backdrop.open');
        if (openModals.length > 0) {
          openModals.forEach(function (bd) {
            bd.classList.remove('open');
          });
        } else if (currentPage === 'empleado-alta') {
          if (typeof global.cancelEmployeeFormPage === 'function') {
            global.cancelEmployeeFormPage();
          } else {
            navigateTo('recursos-humanos');
          }
        } else if (currentPage === 'producto-alta') {
          var catPanelF5 = document.getElementById('pa-tab-panel-catalogos');
          var inCatF5 = !!(catPanelF5 && catPanelF5.style.display !== 'none');
          if (inCatF5) return;
          if (typeof global.cancelProductFromPage === 'function') {
            global.cancelProductFromPage();
          } else {
            navigateTo('productos');
          }
        }
      }

      // Tecla INS (Insert) = Nuevo Producto cuando estamos en el catálogo de productos
      var isInsert = (e.key === 'Insert' || e.code === 'Insert' || e.keyCode === 45);
      if (isInsert && currentPage === 'productos') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof global.productsNuevoProducto === 'function') {
          global.productsNuevoProducto();
        } else {
          navigateTo('producto-alta');
        }
        return;
      }

      // F12 = Guardar Producto (Alta o Edición)
      var isF12 = (e.key === 'F12' || e.code === 'F12' || e.keyCode === 123);
      if (isF12 && currentPage === 'producto-alta') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof global.saveProductFromPage === 'function') {
          global.saveProductFromPage();
        }
        return;
      }

      // F9 = Guardar empleado (alta o edicion)
      // Detecta F9 por los 3 metodos posibles para cubrir cualquier teclado/SO:
      //   e.key === 'F9'      → standard (Chrome/Edge/Firefox)
      //   e.code === 'F9'     → layout-independent physical key
      //   e.keyCode === 120   → legacy (algunos drivers/teclados ergonomicos)
      // Ctrl+S como respaldo silencioso (no visible en UI).
      var isF9 = (e.key === 'F9' || e.code === 'F9' || e.keyCode === 120);
      var isCtrlS = (e.ctrlKey && (e.key === 's' || e.key === 'S'));
      if ((isF9 || isCtrlS) && currentPage === 'empleado-alta') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof saveEmployeeFromPage === 'function') {
          saveEmployeeFromPage();
        }
        return;
      }

      // ← / → en formulario de empleado
      // - En SELECT: mueven foco al campo anterior/siguiente
      // - En INPUT/TEXTAREA: comportamiento nativo (mover cursor dentro del texto)
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && currentPage === 'empleado-alta') {
        if (document.activeElement && document.activeElement.tagName === 'SELECT') {
          e.preventDefault();
          var focusable = Array.from(document.querySelectorAll(
            '.employee-page select:not([disabled]), .employee-page input:not([disabled]):not([type="hidden"]), .employee-page textarea:not([disabled])'
          ));
          var idx = focusable.indexOf(document.activeElement);
          if (idx !== -1) {
            if (e.key === 'ArrowRight' && idx < focusable.length - 1) focusable[idx + 1].focus();
            else if (e.key === 'ArrowLeft' && idx > 0) focusable[idx - 1].focus();
          }
          return; // solo sale aquí si era SELECT
        }
        // Si el foco está en un INPUT, no hacer nada — el navegador maneja el cursor
      }

      if (!isInput && currentPage === 'recursos-humanos') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (typeof moveRhEmployeeSelection === 'function') moveRhEmployeeSelection(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (typeof moveRhEmployeeSelection === 'function') moveRhEmployeeSelection(-1);
        } else if (e.key === 'Insert') {
          e.preventDefault();
          if (typeof applyRhAction === 'function') applyRhAction('Insert');
        } else if (e.key === 'Delete') {
          e.preventDefault();
          if (typeof applyRhAction === 'function') applyRhAction('Delete');
        } else if (e.key.match(/^F\d+$/)) {
          var actionId = e.key;
          if (['F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','F13'].includes(actionId)) {
            e.preventDefault();
            if (typeof applyRhAction === 'function') applyRhAction(actionId);
          }
        }
      }
    });
  }

  // (capture-phase F9 listener eliminado: F9 ahora se maneja directamente
  //  en el bubble listener de _setupModalBackdrops con llamada directa a saveEmployeeFromPage)

  /* ── SESSION / USER ── */
  function loadUserInfo() {
    // calebsys_role es la señal canónica de sesión activa (login.js SIEMPRE la
    // escribe); calebsys_token/auth_token quedan como fallback legacy — nunca
    // los escribe login.js, así que exigirlos aquí cortaba la carga para
    // TODOS los usuarios (no solo SUPERADMIN) y el sidebar se quedaba en
    // "Cargando..." / "Administrador" por defecto. apiFetch ya manda
    // credentials:'include' y funciona con la cookie httpOnly sin token.
    var hasSession = localStorage.getItem('calebsys_role') ||
                     localStorage.getItem('calebsys_token') ||
                     sessionStorage.getItem('auth_token') ||
                     localStorage.getItem('auth_token');
    if (!hasSession) return;

    AdminAPI.apiFetch('/api/auth/me').then(function (user) {
      var name   = user.username || user.name || user.email || 'Admin';
      var role   = (user.role || user.rol || 'ADMIN').toUpperCase();
      var tenant = user.empresa_nombre || user.tenant || user.empresa_id || 'Tenant';
      var initials = name.slice(0, 2).toUpperCase();

      var nameEl   = document.getElementById('sidebar-user-name');
      var roleEl   = document.getElementById('sidebar-user-role');
      var avatarEl = document.getElementById('user-avatar-initials');
      var tenantEl = document.getElementById('sidebar-tenant-name');

      // Modal Mi Cuenta
      var mNameEl   = document.getElementById('modal-user-name');
      var mRoleEl   = document.getElementById('modal-user-role');
      var mAvatarEl = document.getElementById('modal-user-avatar');

      if (nameEl)   nameEl.textContent   = name;
      if (roleEl)   roleEl.textContent   = role;
      if (avatarEl) avatarEl.textContent = initials;
      if (tenantEl) tenantEl.textContent = tenant;

      if (mNameEl)   mNameEl.textContent   = name;
      if (mRoleEl)   mRoleEl.textContent   = role;
      if (mAvatarEl) mAvatarEl.textContent = initials;

      // Guardar para otros módulos
      try { localStorage.setItem('calebsys_display_name', name); } catch(_){}
    }).catch(function () {
      // Session info not critical — shell keeps working with defaults
    });
  }

  function handleLogout() {
    ['calebsys_token','calebsys_role','calebsys_user','calebsys_branch',
     'calebsys_empresa','auth_token','pos_cart','pos_active_client']
      .forEach(function(k){ sessionStorage.removeItem(k); localStorage.removeItem(k); });
    window.location.href = '/login';
  }

  /* ── FULLSCREEN TOGGLE ── */
  function toggleAdminFullscreen() {
    var icon = document.getElementById('fullscreen-icon');
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function(err) {
        console.warn('[Calebsys] No se pudo activar pantalla completa:', err.message);
      });
    } else {
      document.exitFullscreen();
    }
  }
  global.toggleAdminFullscreen = toggleAdminFullscreen;


  /* ── NOTIFICATION SYSTEM v2 ─────────────────────────────────────────────
   *  Polling HTTP cada 8 s a /api/notifications (no SSE — apropiado para LAN)
   *  - Badge rojo con contador en la campana
   *  - Panel desplegable con historial unificado
   *  - Modal de aprobacion automatico para devoluciones PENDIENTE
   * ─────────────────────────────────────────────────────────────────────── */

  // Estado del sistema de notificaciones
  var _notifPollInterval  = null;   // setInterval handle
  var _notifKnownIds      = {};     // IDs ya procesados (evita re-modal)
  var _notifApprovalOpen  = false;  // Protege contra apertura doble del modal

  /**
   * Inicializa la campana: click-handler + arranca el polling.
   */
  function _setupNotificationsBell() {
    var btn = document.getElementById('btn-notifications');
    if (!btn) return;

    // Click en campana → toggle del panel desplegable
    btn.addEventListener('click', function() {
      var existing = document.getElementById('notif-panel');
      if (existing) { existing.remove(); return; }
      _openNotifPanel(btn);
    });

    // Arrancar polling
    _startNotificationPolling();
  }

  /**
   * Polling cada 8 s. Actualiza badge y dispara modal de aprobacion si hay PENDIENTES.
   */
  function _startNotificationPolling() {
    // Primera ejecucion inmediata
    _pollNotifications();
    // Luego cada 8 segundos
    _notifPollInterval = setInterval(_pollNotifications, 8000);
  }

  /** Una iteracion de polling */
  function _pollNotifications() {
    // RH-04: autorizaciones de salida temprana del reloj (en paralelo)
    _pollRelojAutorizaciones();

    AdminAPI.apiFetch('/api/notifications').then(function(data) {
      var items    = data.notifications || [];
      var pending  = items.filter(function(n) { return n.type === 'return'; }); // P3: el backend emite 'return', no 'return_pending'
      var allCount = items.length;

      // Actualizar badge en la campana (combinado con autorizaciones del reloj)
      _notifBaseCount = allCount;
      _refreshNotifBadgeCombined();

      // Procesar devoluciones pendientes que no hemos visto aun
      pending.forEach(function(ret) {
        var rid = ret.return_id || ret.id;
        if (!rid || _notifKnownIds[rid]) return;
        _notifKnownIds[rid] = true;
        // Abrir modal de aprobacion (solo si no hay uno ya abierto)
        if (!_notifApprovalOpen) {
          _openApprovalModal(ret);
        }
      });

    }).catch(function(err) {
      // Silencioso: no molestar al usuario con errores de red en polling
      console.warn('[Notif] Poll error:', err.message || err);
    });
  }

  /**
   * Actualiza el badge numerico rojo sobre la campana.
   * count === 0 → oculta el badge.
   */
  function _updateNotifBadge(count) {
    var btn = document.getElementById('btn-notifications');
    if (!btn) return;

    var badge = btn.querySelector('.notif-badge-count');
    if (!badge) {
      // Crear badge la primera vez
      badge = document.createElement('span');
      badge.className = 'notif-badge-count';
      badge.style.cssText = [
        'position:absolute;top:-4px;right:-4px;',
        'background:#ef4444;color:#fff;',
        'font-size:0.55rem;font-weight:800;',
        'min-width:14px;height:14px;border-radius:9999px;',
        'display:flex;align-items:center;justify-content:center;',
        'padding:0 3px;line-height:1;',
        'box-shadow:0 0 0 2px var(--surface,#fff);'
      ].join('');
      // El boton necesita position:relative para que el badge se ubique correctamente
      btn.style.position = 'relative';
      btn.appendChild(badge);
    }

    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'flex';
      // Tambien mostrar el dot legacy si existe
      var dot = btn.querySelector('.notif-dot');
      if (dot) dot.style.display = 'block';
    } else {
      badge.style.display = 'none';
      var dot = btn.querySelector('.notif-dot');
      if (dot) dot.style.display = 'none';
    }
  }

  /**
   * Abre el panel desplegable de notificaciones con datos en tiempo real.
   */
  function _openNotifPanel(btn) {
    var panel = document.createElement('div');
    panel.id = 'notif-panel';
    panel.style.cssText = [
      'position:fixed;top:56px;right:12px;width:340px;max-height:420px;',
      'overflow-y:auto;background:var(--surface);border:1px solid var(--border);',
      'border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.18);',
      'z-index:9999;padding:0;'
    ].join('');

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;' +
        'padding:14px 16px 10px;border-bottom:1px solid var(--border);">' +
        '<span style="font-size:0.82rem;font-weight:700;color:var(--text-main);">' +
          '<i class="fa-solid fa-bell" style="color:var(--brand-400);margin-right:6px;"></i>' +
          'Notificaciones' +
        '</span>' +
        '<button onclick="document.getElementById(\'notif-panel\').remove()" ' +
          'style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;">&#x2715;</button>' +
      '</div>' +
      '<div id="notif-panel-body" style="padding:8px 0;">' +
        '<div style="text-align:center;padding:28px 0;color:var(--text-muted);font-size:0.8rem;">' +
          '<i class="fa-solid fa-circle-notch fa-spin" style="font-size:1.2rem;display:block;margin-bottom:8px;"></i>' +
          'Cargando...' +
        '</div>' +
      '</div>';

    document.body.appendChild(panel);

    // Cerrar al hacer click fuera
    function closeOnOutside(e) {
      if (!panel.contains(e.target) && e.target !== btn) {
        panel.remove();
        document.removeEventListener('click', closeOnOutside);
      }
    }
    setTimeout(function() { document.addEventListener('click', closeOnOutside); }, 10);

    // Cargar notificaciones
    AdminAPI.apiFetch('/api/notifications').then(function(data) {
      var items = data.notifications || [];
      var body  = document.getElementById('notif-panel-body');
      if (!body) return;

      if (items.length === 0) {
        body.innerHTML =
          '<div style="text-align:center;padding:28px 0;color:var(--text-muted);font-size:0.8rem;">' +
          '<i class="fa-solid fa-inbox" style="font-size:1.4rem;display:block;margin-bottom:8px;"></i>' +
          'Sin notificaciones pendientes</div>';
        return;
      }

      body.innerHTML = items.map(function(n) {
        var typeIcon = n.type === 'return'
          ? '<i class="fa-solid fa-rotate-left" style="color:#ef4444;margin-right:6px;"></i>'
          : '<i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;margin-right:6px;"></i>';
        var actionBtn = n.type === 'return'
          ? '<button onclick="AdminNotif.openApprovalById(\'' + (n.return_id || n.id) + '\')"' +
            ' style="background:#ef4444;color:#fff;border:none;cursor:pointer;font-size:0.65rem;' +
            'font-weight:700;padding:3px 10px;border-radius:6px;margin-top:4px;">Revisar</button>'
          : _d6ActionButtons(n);   // D6: botones de acción para el flujo F2
        return '<div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:0.78rem;">' +
          '<div style="font-weight:600;color:var(--text-main);">' + typeIcon + (n.title || n.message || '') + '</div>' +
          (n.body ? '<div style="color:var(--text-muted);margin-top:2px;">' + n.body + '</div>' : '') +
          _d6Evidence(n) +
          actionBtn +
          '</div>';
      }).join('');

      // Limpiar badge al ver el panel
      _updateNotifBadge(0);
    }).catch(function() {
      var body = document.getElementById('notif-panel-body');
      if (body) body.innerHTML =
        '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.78rem;">' +
        'Error al cargar notificaciones.</div>';
    });
  }

  /**
   * Abre el modal flotante de aprobacion de devolucion.
   * Se llama automaticamente cuando el polling detecta un PENDIENTE nuevo.
   * @param {Object} ret — objeto de notificacion { return_id, title, body, ... }
   */
  /**
   * Modal de confirmacion de aprobacion.
   * NOTA: El backend valida identidad via JWT del admin-shell (role_guard).
   * No se requiere re-ingresar credenciales — la sesion activa ya es la del Gerente/ADMIN.
   * El modal solo muestra el detalle y pide confirmacion explicita antes de ejecutar.
   */
  function _openApprovalModal(ret) {
    _notifApprovalOpen = true;
    var rid     = ret.return_id || ret.id || '';
    var titulo  = ret.title  || 'Solicitud de Devolucion';
    var detalle = ret.body   || 'Hay una devolucion pendiente de aprobacion.';
    var items   = ret.items  || [];   // lista opcional de articulos si viene en la notif

    var overlay = document.createElement('div');
    overlay.id = 'notif-approval-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;' +
      'display:flex;align-items:center;justify-content:center;';

    // Lista de articulos (si el backend la incluye en la notificacion)
    var itemsHtml = '';
    if (Array.isArray(items) && items.length > 0) {
      itemsHtml =
        '<div style="margin-top:12px;">' +
        '<div style="font-size:0.7rem;font-weight:700;color:var(--text-muted);' +
          'text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Articulos a devolver</div>' +
        '<div style="background:var(--bg-soft,#f8fafc);border:1px solid var(--border);' +
          'border-radius:8px;overflow:hidden;">' +
        items.map(function(it) {
          return '<div style="display:flex;justify-content:space-between;padding:6px 12px;' +
            'border-bottom:1px solid var(--border);font-size:0.75rem;">' +
            '<span style="color:var(--text-main);font-weight:600;">' + (it.product_name || it.sku || '-') + '</span>' +
            '<span style="color:var(--text-muted);">x' + (it.quantity || 1) + '</span></div>';
        }).join('') +
        '</div></div>';
    }

    overlay.innerHTML =
      '<div style="background:var(--surface);border-radius:20px;border:1px solid var(--border);' +
        'box-shadow:0 20px 60px rgba(0,0,0,0.25);width:440px;max-width:95vw;' +
        'font-family:var(--font-sans,Inter,sans-serif);overflow:hidden;">' +

        /* Encabezado */
        '<div style="background:linear-gradient(135deg,#b91c1c,#ef4444);padding:16px 20px;' +
          'display:flex;align-items:center;gap:10px;">' +
          '<i class="fa-solid fa-rotate-left" style="color:#fff;font-size:1rem;"></i>' +
          '<div>' +
            '<div style="font-size:0.75rem;font-weight:800;color:#fff;text-transform:uppercase;' +
              'letter-spacing:.05em;">Aprobacion Requerida</div>' +
            '<div style="font-size:0.68rem;color:#fca5a5;margin-top:1px;">' + titulo + '</div>' +
          '</div>' +
        '</div>' +

        /* Cuerpo */
        '<div style="padding:20px;">' +
          '<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px;">' + detalle + '</p>' +

          /* ID de la solicitud */
          '<div style="background:var(--bg-soft,#f8fafc);border:1px solid var(--border);' +
            'border-radius:10px;padding:10px 14px;margin-bottom:4px;">' +
            '<div style="font-size:0.68rem;color:var(--text-muted);font-weight:700;' +
              'text-transform:uppercase;letter-spacing:.04em;">ID Solicitud</div>' +
            '<div style="font-size:0.76rem;font-family:monospace;color:var(--text-main);' +
              'margin-top:2px;">' + rid + '</div>' +
          '</div>' +

          itemsHtml +

          /* Info de autorizacion */
          '<div style="margin-top:14px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;' +
            'border-radius:8px;display:flex;align-items:center;gap:8px;">' +
            '<i class="fa-solid fa-shield-check" style="color:#16a34a;font-size:0.9rem;"></i>' +
            '<span style="font-size:0.72rem;color:#15803d;font-weight:600;">' +
              'Autorizado con su sesion activa de Gerente / ADMIN' +
            '</span>' +
          '</div>' +

          /* Error inline */
          '<div id="na-error" style="display:none;font-size:0.75rem;color:#ef4444;' +
            'background:#fef2f2;border:1px solid #fecaca;border-radius:8px;' +
            'padding:8px 12px;margin-top:12px;"></div>' +
        '</div>' +

        /* Footer */
        '<div style="padding:12px 20px 16px;display:flex;justify-content:space-between;' +
          'align-items:center;border-top:1px solid var(--border);">' +
          '<button onclick="AdminNotif.dismissApproval()"' +
            ' style="background:none;border:none;cursor:pointer;font-size:0.78rem;' +
            'color:var(--text-muted);font-weight:600;padding:8px 16px;border-radius:8px;">' +
            'Ahora no (Esc)</button>' +
          '<button id="na-btn-approve" onclick="AdminNotif.submitApproval(\'' + rid + '\')"' +
            ' style="background:#16a34a;color:#fff;border:none;cursor:pointer;font-weight:800;' +
            'font-size:0.78rem;padding:10px 24px;border-radius:10px;transition:background .15s;">' +
            '<i class="fa-solid fa-check" style="margin-right:6px;"></i>Confirmar Aprobacion' +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Escape cierra sin aprobar
    function escHandler(e) {
      if (e.key === 'Escape') {
        AdminNotif.dismissApproval();
        document.removeEventListener('keydown', escHandler);
      }
    }
    document.addEventListener('keydown', escHandler);
  }

  /**
   * Cierra el modal de aprobacion sin procesar.
   */
  function _dismissApproval() {
    var overlay = document.getElementById('notif-approval-overlay');
    if (overlay) overlay.remove();
    _notifApprovalOpen = false;
  }

  /**
   * Abre el modal de aprobacion buscando la devolucion por ID
   * (llamado desde el boton "Revisar" del panel de notificaciones).
   */
  function _openApprovalById(rid) {
    if (_notifApprovalOpen) return;
    _openApprovalModal({ return_id: rid, title: 'Devolucion #' + rid.slice(0,8), body: 'Pendiente de aprobacion.' });
  }

  /**
   * Envia la aprobacion al backend.
   * POST /api/returns/{return_id}/approve con credenciales del gerente.
   * El backend re-verifica que el usuario tenga rol gerente o admin.
   */
  /**
   * Ejecuta la aprobacion de la devolucion.
   * El backend valida identidad via JWT (role_guard) — no se necesita body adicional.
   * AdminAPI.apiFetch agrega automaticamente el Bearer token de la sesion activa.
   */
  function _submitApproval(rid) {
    var errEl   = document.getElementById('na-error');
    var btnAppr = document.getElementById('na-btn-approve');

    if (errEl) errEl.style.display = 'none';
    if (btnAppr) { btnAppr.disabled = true; btnAppr.textContent = 'Procesando...'; }

    AdminAPI.apiFetch('/api/returns/' + rid + '/approve', { method: 'POST' })
    .then(function(data) {
      _dismissApproval();
      // Registrar como procesado para no volver a abrir modal en proximos polls
      _notifKnownIds[rid] = 'approved';

      // Toast de exito
      var toast = document.createElement('div');
      toast.style.cssText =
        'position:fixed;bottom:24px;right:24px;background:#16a34a;color:#fff;' +
        'font-size:0.8rem;font-weight:700;padding:12px 20px;border-radius:10px;' +
        'z-index:10001;box-shadow:0 8px 24px rgba(0,0,0,0.2);' +
        'display:flex;align-items:center;gap:8px;';
      toast.innerHTML = '<i class="fa-solid fa-circle-check"></i> Devolucion aprobada y stock actualizado.';
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 4000);

      // Actualizar badge (repoll inmediato)
      _pollNotifications();
    })
    .catch(function(err) {
      var msg = 'Error al procesar. Verifica que tienes permisos de Gerente o ADMIN.';
      if (err && err.message) msg = err.message;
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      if (btnAppr) {
        btnAppr.disabled = false;
        btnAppr.innerHTML = '<i class="fa-solid fa-check" style="margin-right:6px;"></i>Confirmar Aprobacion';
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  RH-04 — Autorizaciones de salida temprana del reloj checador
   *  Un empleado que intenta salir antes de 4 h desde su entrada genera
   *  una autorizacion 'pendiente'. Admin/Gerente la aprueba o rechaza
   *  aqui; al aprobar, el backend registra la salida con la hora actual.
   * ═══════════════════════════════════════════════════════════════════ */
  var _notifBaseCount        = 0;
  var _relojAuthPendingCount = 0;
  var _relojAuthKnownIds     = {};
  var _relojAuthModalOpen    = false;

  function _refreshNotifBadgeCombined() {
    _updateNotifBadge(_notifBaseCount + _relojAuthPendingCount);
  }

  function _rhEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _pollRelojAutorizaciones() {
    AdminAPI.apiFetch('/api/notificaciones/reloj/autorizaciones?status=pendiente')
      .then(function (data) {
        var items = (data && data.autorizaciones) || [];
        _relojAuthPendingCount = items.length;
        _refreshNotifBadgeCombined();
        items.forEach(function (a) {
          if (_relojAuthKnownIds[a.id]) return;
          _relojAuthKnownIds[a.id] = true;
          if (!_relojAuthModalOpen) _openRelojAuthModal(a);
        });
      })
      .catch(function (err) {
        // 401/403 para roles sin permiso → silencioso
        console.warn('[Notif] reloj-auth poll:', (err && err.message) || err);
      });
  }

  function _openRelojAuthModal(a) {
    if (document.getElementById('reloj-auth-overlay')) return;
    _relojAuthModalOpen = true;
    var horas = (a.horas_transcurridas != null)
      ? Number(a.horas_transcurridas).toFixed(1) : '?';
    var ov = document.createElement('div');
    ov.id = 'reloj-auth-overlay';
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10002;' +
      'display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.innerHTML =
      '<div style="background:var(--surface,#fff);color:var(--text,#111);max-width:420px;' +
        'width:100%;border-radius:16px;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,0.3);">' +
        '<div style="font-size:1rem;font-weight:800;margin-bottom:6px;display:flex;align-items:center;gap:8px;">' +
          '<i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i>Salida antes de 4 h</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted,#666);margin-bottom:16px;line-height:1.5;">' +
          '<b>' + _rhEsc(a.empleado) + '</b> intentó registrar su <b>salida</b> tras solo ' +
          '<b>' + horas + ' h</b> desde la entrada (mínimo ' + _rhEsc(a.horas_minimas || 4) + ' h).<br>' +
          'Fecha: ' + _rhEsc(a.event_date) + '</div>' +
        '<div id="ra-error" style="display:none;color:#dc2626;font-size:0.8rem;margin-bottom:10px;"></div>' +
        '<div style="display:flex;gap:10px;">' +
          '<button id="ra-reject" style="flex:1;padding:12px;border-radius:10px;border:1px solid #e5e7eb;' +
            'background:transparent;color:inherit;font-weight:700;cursor:pointer;">Rechazar</button>' +
          '<button id="ra-approve" style="flex:1;padding:12px;border-radius:10px;border:none;' +
            'background:#16a34a;color:#fff;font-weight:800;cursor:pointer;">Autorizar salida</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('#ra-approve').onclick = function () { _resolveRelojAuth(a.id, true); };
    ov.querySelector('#ra-reject').onclick  = function () { _resolveRelojAuth(a.id, false); };
  }

  function _resolveRelojAuth(id, aprobar) {
    var errEl = document.getElementById('ra-error');
    var bA = document.getElementById('ra-approve');
    var bR = document.getElementById('ra-reject');
    if (bA) bA.disabled = true;
    if (bR) bR.disabled = true;
    AdminAPI.apiFetch('/api/asistencia/reloj/autorizaciones/' + id + '/resolver', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ aprobar: !!aprobar })
    }).then(function () {
      var ov = document.getElementById('reloj-auth-overlay');
      if (ov) ov.remove();
      _relojAuthModalOpen = false;
      _relojAuthKnownIds[id] = aprobar ? 'aprobada' : 'rechazada';
      _pollRelojAutorizaciones();
    }).catch(function (e) {
      if (errEl) {
        errEl.textContent = (e && e.message) || 'Error al resolver. ¿Tienes permiso de Gerente/Admin?';
        errEl.style.display = 'block';
      }
      if (bA) bA.disabled = false;
      if (bR) bR.disabled = false;
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
   *  D6 — Notificaciones accionables (flujo F2 de devolución)
   *  Botones dentro del panel de la campana que llaman a
   *  POST /api/notifications/{id}/resolve
   * ═══════════════════════════════════════════════════════════════════ */
  var _D6_BTN = 'border:none;cursor:pointer;font-size:0.65rem;font-weight:700;' +
                'padding:4px 10px;border-radius:6px;margin:4px 4px 0 0;';

  function _d6Meta(n) { return (n && n.type === 'event' && n.meta) ? n.meta : null; }

  function _d6Evidence(n) {
    var m = _d6Meta(n);
    if (!m || m.action_type !== 'RETURN_AUTHORIZE') return '';
    var txt, color;
    if (m.purchase_found === true) {
      var k = (m.purchase_sedes || []).length;
      txt = '✓ El cliente compró este artículo' + (k ? ' (' + k + ' registro' + (k > 1 ? 's' : '') + ')' : '');
      color = '#16a34a';
    } else if (m.purchase_found === false) {
      txt = '✗ Sin registro de compra de este artículo';
      color = '#dc2626';
    } else {
      txt = 'Compra no verificada automáticamente';
      color = 'var(--text-muted)';
    }
    var extra = (m.estado === 'bloqueada')
      ? '<div style="color:#dc2626;font-weight:700;margin-top:3px;">Bloqueada por almacén' +
        (m.block_reason ? ': ' + _rhEsc(m.block_reason) : '') + '</div>'
      : (m.check_result === 'ok'
          ? '<div style="color:#16a34a;margin-top:3px;">Almacén verificó la condición ✓</div>'
          : '<div style="color:var(--text-muted);margin-top:3px;">Falta verificación de almacén</div>');
    return '<div style="margin-top:4px;font-size:0.72rem;color:' + color + ';">' + txt + '</div>' + extra;
  }

  function _d6ActionButtons(n) {
    var m = _d6Meta(n);
    if (!m || m.estado !== 'pendiente' || !m.action_type) return '';
    var id = n.id;
    var b = function(label, bg, oc) {
      return '<button onclick="' + oc + '" style="' + _D6_BTN + 'background:' + bg + ';color:#fff;">' + label + '</button>';
    };
    if (m.action_type === 'RETURN_CONDITION_CHECK') {
      return b('En condiciones', '#16a34a', "AdminNotif.d6Resolve('" + id + "','ok',false)") +
             b('No apto', '#dc2626', "AdminNotif.d6Resolve('" + id + "','rechazado',true)");
    }
    if (m.action_type === 'RETURN_AUTHORIZE') {
      var needNota = (m.estado === 'bloqueada' || m.check_result !== 'ok');
      return b(m.estado === 'bloqueada' ? 'Autorizar (override)' : 'Autorizar', '#16a34a',
               "AdminNotif.d6Resolve('" + id + "','autorizado'," + (needNota ? 'true' : 'false') + ")") +
             b('Rechazar', '#dc2626', "AdminNotif.d6Resolve('" + id + "','rechazado',true)");
    }
    if (m.action_type === 'RETURN_PHYSICAL_CONFIRM') {
      return b('Confirmar ingreso físico', '#2563eb', "AdminNotif.d6Resolve('" + id + "','confirmado',false)");
    }
    return '';
  }

  function _d6Resolve(notifId, outcome, needNota) {
    var nota = null;
    if (needNota) {
      nota = window.prompt('Motivo / nota (obligatorio):', '');
      if (nota === null) return;              // canceló el prompt
      if (!nota.trim()) { alert('La nota es obligatoria.'); return; }
    }
    AdminAPI.apiFetch('/api/notifications/' + notifId + '/resolve', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ outcome: outcome, nota: nota })
    }).then(function(res) {
      var msg = 'Listo.';
      if (res && res.executed) msg = 'Devolución ejecutada — ' + (res.items_returned || 0) + ' artículo(s) a stock.';
      else if (outcome === 'ok') msg = 'Condición confirmada.';
      else if (outcome === 'autorizado') msg = 'Devolución autorizada.';
      else if (outcome === 'rechazado') msg = 'Rechazada.';
      else if (outcome === 'confirmado') msg = 'Ingreso físico confirmado.';
      _d6Toast(msg, '#16a34a');
      var p = document.getElementById('notif-panel');
      if (p) { p.remove(); }
      _pollNotifications();
    }).catch(function(err) {
      var map = {
        bloqueada_por_almacen: 'El almacén rechazó el artículo. Solo un admin puede autorizar por encima.',
        espera_verificacion_almacen: 'Espera a que el almacén verifique la condición.',
        nota_requerida: 'Falta la nota.',
        nota_requerida_override: 'Para pasar por encima necesitas escribir una nota.',
        ya_resuelta: 'Esta notificación ya fue resuelta.',
        caso_cancelado: 'El caso fue cancelado.',
        rol_no_autorizado: 'No tienes permiso para esta acción.'
      };
      var code = (err && err.message) || '';
      _d6Toast(map[code] || ('Error: ' + (code || 'no se pudo resolver')), '#dc2626');
    });
  }

  function _d6Toast(text, bg) {
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:' + bg + ';color:#fff;' +
      'font-size:0.8rem;font-weight:700;padding:12px 18px;border-radius:10px;z-index:10001;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.2);max-width:320px;';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 4500);
  }

  // Exponer API publica del modulo de notificaciones para uso desde HTML inline
  var AdminNotif = {
    dismissApproval:  _dismissApproval,
    submitApproval:   _submitApproval,
    openApprovalById: _openApprovalById,
    resolveRelojAuth: _resolveRelojAuth,
    d6Resolve:        _d6Resolve
  };
  global.AdminNotif = AdminNotif;


  document.addEventListener('fullscreenchange', function () {
    var icon = document.getElementById('fullscreen-icon');
    if (!icon) return;
    if (document.fullscreenElement) {
      icon.className = 'fa-solid fa-compress';
      document.getElementById('btn-fullscreen').title = 'Salir de pantalla completa';
    } else {
      icon.className = 'fa-solid fa-expand';
      document.getElementById('btn-fullscreen').title = 'Pantalla completa (F11)';
    }
  });

  /* ── ONLINE / OFFLINE ── */
  function updateOnlineStatus() {
    document.body.classList.toggle('offline', !navigator.onLine);
    var chip = document.querySelector('.status-chip');
    if (chip) {
      if (navigator.onLine) {
        chip.style.background = 'rgba(16,185,129,0.12)';
        chip.style.borderColor = 'rgba(16,185,129,0.3)';
        chip.style.color = 'var(--success)';
        chip.innerHTML = '<div class="dot" style="background:var(--success);"></div>Online';
      } else {
        chip.style.background = 'rgba(245,158,11,0.12)';
        chip.style.borderColor = 'rgba(245,158,11,0.3)';
        chip.style.color = 'var(--warning)';
        chip.innerHTML = '<div class="dot" style="background:var(--warning);animation:none;"></div>Offline';
      }
    }
  }

  /* ── GLOBAL SEARCH ── */
  function _setupGlobalSearch() {
    var input = document.getElementById('global-search');
    if (!input) return;

    var dropdown = document.createElement('div');
    dropdown.id = 'global-search-dropdown';
    dropdown.style.cssText = 'position:absolute;z-index:9999;background:var(--surface);border:1px solid var(--border);' +
      'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);min-width:300px;max-height:380px;overflow-y:auto;display:none;';
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(dropdown);

    var _searchTimer = null;

    // ── Secciones del dropdown ────────────────────────────────
    function _section(label, icon, items) {
      if (!items.length) return '';
      var rows = items.map(function(it) {
        return '<div data-page="' + (it.page||'') + '" data-href="' + (it.href||'') + '" ' +
          'style="padding:8px 14px;cursor:pointer;font-size:0.8rem;display:flex;align-items:center;gap:10px;color:var(--text-primary);" ' +
          'onmouseover="this.style.background=\'var(--surface-hover)\'" onmouseout="this.style.background=\'\'">' +
          '<i class="fa-solid ' + it.icon + '" style="font-size:0.68rem;color:var(--text-muted);width:12px;text-align:center;"></i>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + it.label + '</div>' +
            (it.sub ? '<div style="font-size:0.68rem;color:var(--text-muted);">' + it.sub + '</div>' : '') +
          '</div>' +
          (it.badge ? '<span style="font-size:0.6rem;padding:2px 6px;border-radius:20px;background:var(--brand-100);color:var(--brand-600);font-weight:700;">' + it.badge + '</span>' : '') +
        '</div>';
      }).join('');
      return '<div style="padding:6px 14px 3px;font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);">' +
        '<i class="fa-solid ' + icon + '" style="margin-right:5px;"></i>' + label + '</div>' + rows;
    }

    function showDropdown(html) {
      if (!html) { dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = html;
      dropdown.style.display = 'block';
      dropdown.querySelectorAll('[data-page],[data-href]').forEach(function(el) {
        el.addEventListener('click', function() {
          var href = el.dataset.href;
          var page = el.dataset.page;
          input.value = ''; dropdown.style.display = 'none';
          if (href) window.location.href = href;
          else if (page) navigateTo(page);
        });
      });
    }

    // ── Buscar módulos (local) ────────────────────────────────
    function _searchModules(q) {
      return Object.entries(PAGE_LABELS)
        .filter(function(e){ return e[1].toLowerCase().includes(q) || e[0].toLowerCase().includes(q); })
        .slice(0, 5)
        .map(function(e){ return { page: e[0], label: e[1], icon: 'fa-grid-2', badge: 'Módulo' }; });
    }

    // ── Búsqueda async en APIs ────────────────────────────────
    async function _runSearch(q) {
      var html = '';
      var moduleMatches = _searchModules(q);
      if (moduleMatches.length) html += _section('Módulos', 'fa-grid-2', moduleMatches);

      // Mostrar resultados de módulos de inmediato
      showDropdown(html || '<div style="padding:14px;text-align:center;font-size:0.8rem;color:var(--text-muted);">Buscando…</div>');

      try {
        var results = await Promise.allSettled([
          AdminAPI.apiFetch('/api/products/search?q=' + encodeURIComponent(q) + '&limit=5'),
          AdminAPI.apiFetch('/api/clients?q=' + encodeURIComponent(q) + '&limit=5'),
          AdminAPI.apiFetch('/api/suppliers?q=' + encodeURIComponent(q) + '&limit=5'),
        ]);

        // Productos
        var prods = [];
        if (results[0].status === 'fulfilled') {
          var pd = results[0].value;
          var arr = Array.isArray(pd) ? pd : (pd.items || pd.products || []);
          prods = arr.slice(0,5).map(function(p){
            return { page:'productos', label: p.nombre||p.name||'—',
              sub: (p.sku||p.barcode||'') + (p.precio_venta ? ' · $' + Number(p.precio_venta).toFixed(2) : ''),
              icon:'fa-box', badge:'Producto' };
          });
        }
        if (prods.length) html += _section('Productos', 'fa-box', prods);

        // Clientes
        var clients = [];
        if (results[1].status === 'fulfilled') {
          var cd = results[1].value;
          var carr = Array.isArray(cd) ? cd : (cd.items || cd.clients || []);
          clients = carr.slice(0,5).map(function(c){
            return { page:'clientes', label: c.name||c.nombre||'—',
              sub: (c.rfc||'') + (c.phone ? ' · ' + c.phone : ''),
              icon:'fa-user', badge:'Cliente' };
          });
        }
        if (clients.length) html += _section('Clientes', 'fa-users', clients);

        // Proveedores
        var suppliers = [];
        if (results[2].status === 'fulfilled') {
          var sd = results[2].value;
          var sarr = Array.isArray(sd) ? sd : (sd.items || sd.suppliers || []);
          suppliers = sarr.slice(0,5).map(function(s){
            return { page:'proveedores', label: s.name||s.nombre||s.razon_social||'—',
              sub: s.rfc||s.email||'',
              icon:'fa-building-2', badge:'Proveedor' };
          });
        }
        if (suppliers.length) html += _section('Proveedores', 'fa-building-2', suppliers);

        if (!html) html = '<div style="padding:16px;text-align:center;font-size:0.8rem;color:var(--text-muted);">' +
          '<i class="fa-solid fa-magnifying-glass" style="margin-right:6px;"></i>Sin resultados para "' + q + '"</div>';

        showDropdown(html);
      } catch(e) {
        if (html) showDropdown(html); // al menos módulos
      }
    }

    input.addEventListener('input', function(e) {
      var q = e.target.value.toLowerCase().trim();
      if (!q) { dropdown.style.display = 'none'; return; }
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(function(){ _runSearch(q); }, 280);
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var q = input.value.toLowerCase().trim();
        if (!q) return;
        clearTimeout(_searchTimer);
        _runSearch(q);
      }
      if (e.key === 'Escape') { dropdown.style.display = 'none'; input.value = ''; }
    });

    // Cierra dropdown al hacer click fuera
    document.addEventListener('click', function(e) {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  } // fin _setupGlobalSearch

  /* ── GLOBAL DELEGATION ── */
  function _setupGlobalDelegation() {
    document.addEventListener('click', function(e) {
      var isActionClick = e.target.closest('[data-rh-action]');
      
      if (isActionClick) {
        var action = isActionClick.dataset.rhAction;
        if (action === 'toast') {
          var msg = isActionClick.dataset.toastMsg || 'Función en preparación';
          if (typeof rhToast === 'function') rhToast(msg);
        } else if (action === 'apply') {
          var actionId = isActionClick.dataset.actionId;
          if (typeof applyRhAction === 'function') applyRhAction(actionId);
        } else if (action === 'navigate') {
          var target = isActionClick.dataset.target;
          if (typeof navigateTo === 'function') navigateTo(target);
        } else if (action === 'cancelForm') {
          if (typeof global.cancelEmployeeFormPage === 'function') global.cancelEmployeeFormPage();
        } else if (action === 'resetForm') {
          if (typeof resetEmployeeFormPage === 'function') resetEmployeeFormPage();
        } else if (action === 'saveForm') {
          if (typeof saveEmployeeFromPage === 'function') saveEmployeeFromPage();
        } else if (action === 'closeNipModal') {
          if (typeof global.closeChangeNipModal === 'function') global.closeChangeNipModal();
        } else if (action === 'saveNip') {
          if (typeof global.saveNewNip === 'function') global.saveNewNip();
        } else if (action === 'openNipModal') {
          // Desde botón "Cambiar NIP" en el formulario de edición
          var empId = isActionClick.dataset.empId || global.currentEditEmployeeId;
          var empName = isActionClick.dataset.empName || 'Empleado';
          if (empId && typeof global.openChangeNipModal === 'function') {
            global.openChangeNipModal(empId, empName);
          } else {
            rhToast('No se pudo identificar al empleado');
          }
        } else if (action === 'closeDeleteModal') {
          if (typeof global.closeEmployeeDeleteModal === 'function') global.closeEmployeeDeleteModal();
        } else if (action === 'confirmDelete') {
          if (typeof global.confirmEmployeeSoftDelete === 'function') global.confirmEmployeeSoftDelete();
        } else if (action === 'suggestUsername') {
          // Botón explícito Sugerir usuario
          if (typeof global.doSuggestUsername === 'function') global.doSuggestUsername(true);
        } else if (action === 'togglePwdVisibility') {
          var targetId = isActionClick.dataset.target;
          var pwdInput = document.getElementById(targetId);
          if (pwdInput) {
            var showNow = pwdInput.type === 'password';
            pwdInput.type = showNow ? 'text' : 'password';
            var eyeIcon = isActionClick.querySelector('i');
            if (eyeIcon) eyeIcon.className = showNow ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
          }
        }
        return;
      }

      // Row selection
      var row = e.target.closest('[data-rh-row]');
      if (row) {
        var index = Number(row.dataset.index);
        if (typeof selectRhEmployee === 'function') selectRhEmployee(index);
      }
    });

    document.addEventListener('dblclick', function(e) {
      var row = e.target.closest('[data-rh-row]');
      if (row) {
        var index = Number(row.dataset.index);
        if (typeof selectRhEmployee === 'function') selectRhEmployee(index);
        if (typeof applyRhAction === 'function') applyRhAction('F3');
      }
    });

    // Drag & Drop / Click para Foto
    document.addEventListener('click', function(e) {
      var ph = e.target.closest('.rh-photo-placeholder');
      if (ph) {
        var input = document.getElementById('globalPhotoInput');
        if (!input) {
          input = document.createElement('input');
          input.type = 'file';
          input.id = 'globalPhotoInput';
          input.accept = 'image/png, image/jpeg, image/webp';
          input.style.display = 'none';
          document.body.appendChild(input);
          
          input.addEventListener('change', function(ev) {
            if (window.handlePhotoSelect && input._currentTarget) {
              window.handlePhotoSelect(ev.target.files, input._currentTarget);
            }
          });
        }
        input._currentTarget = ph; // Guardar referencia al placeholder actual
        input.click();
      }
    });

    document.addEventListener('dragover', function(e) {
      var ph = e.target.closest('.rh-photo-placeholder');
      if (ph) {
        e.preventDefault();
        ph.style.background = 'rgba(59,130,246,0.1)';
        ph.style.borderColor = 'var(--brand-500)';
      }
    });

    document.addEventListener('dragleave', function(e) {
      var ph = e.target.closest('.rh-photo-placeholder');
      if (ph) {
        e.preventDefault();
        ph.style.background = 'var(--bg-app)';
        ph.style.borderColor = 'var(--border)';
      }
    });

    document.addEventListener('drop', function(e) {
      var ph = e.target.closest('.rh-photo-placeholder');
      if (ph) {
        e.preventDefault();
        ph.style.background = 'var(--bg-app)';
        ph.style.borderColor = 'var(--border)';
        if (window.handlePhotoSelect) {
          window.handlePhotoSelect(e.dataTransfer.files, ph);
        }
      }
    });
  }

  // Hacer handler global para que sea accesible
  global.handlePhotoSelect = function(files, placeholder) {
    if (!files || files.length === 0) return;
    var file = files[0];
    
    if (!file.type.match('image/jpeg|image/png|image/webp')) {
      if (typeof rhToast === 'function') rhToast('Por favor selecciona una imagen válida (PNG, JPG, WEBP).');
      return;
    }
    
    if (file.size > 2 * 1024 * 1024) {
      if (typeof rhToast === 'function') rhToast('La imagen excede los 2 MB permitidos.');
      return;
    }
    
    var reader = new FileReader();
    reader.onload = function(e) {
      placeholder.style.backgroundImage = 'url(' + e.target.result + ')';
      placeholder.style.backgroundSize = 'cover';
      placeholder.style.backgroundPosition = 'center';
      placeholder.innerHTML = ''; // Hide the camera icon and text
      // TODO ADMIN-RH-FOTO-01: persistir foto de empleado en backend/storage
    };
    pendingEmployeePhotoFile = file;
    reader.readAsDataURL(file);
  };

  function renderEmployeePhoto(photoUrl) {
    var placeholder = document.getElementById('pageEmpPhotoPlaceholder');
    if (!placeholder) return;
    if (photoUrl) {
      placeholder.style.backgroundImage = 'url(' + photoUrl + ')';
      placeholder.style.backgroundSize = 'cover';
      placeholder.style.backgroundPosition = 'center';
      placeholder.innerHTML = '';
    } else {
      placeholder.style.backgroundImage = 'none';
      placeholder.innerHTML = '<i class="fa-solid fa-camera" style="font-size:24px; margin-bottom:8px;"></i><span style="font-size:11px;">Subir foto</span>';
    }
  }

  /* ?? INIT ── */
  async function init() {
    // Guard: solo admin-master y gerente-sucursal pueden usar el shell
    if (!_checkAdminAccess()) return;

    // Online/offline
    updateOnlineStatus();
    window.addEventListener('online',  updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Init Theme based on localStorage
    initTheme();
    bindThemeToggle();

    // Modal backdrop click-to-close
    _setupModalBackdrops();

    // Global Event Delegation (RH Actions)
    _setupGlobalDelegation();

    // Global search
    _setupGlobalSearch();

    // Notifications bell
    _setupNotificationsBell();

    // Load user session info
    loadUserInfo();

    // RBAC: recortar el menú lateral al rol del usuario
    _applyNavRbac();

    // S-2: la consola de SuperAdmin solo se muestra al dueño del software.
    (function () {
      var isSA = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim() === 'superadmin';
      document.querySelectorAll('[data-superadmin="1"]').forEach(function (el) {
        el.style.display = isSA ? '' : 'none';
      });
    })();

    // El dueño del Tenant (admin) y el dueño del software (superadmin) NO checan
    // reloj — se les quita la opción "Reloj checador" del menú por completo.
    (function () {
      var role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
      if (RELOJ_EXEMPT_ROLES.indexOf(role) === -1) return;
      document.querySelectorAll('[data-reloj="1"]').forEach(function (el) {
        el.remove();
      });
    })();

    // Client modal: listeners estáticos (registrados una sola vez)
    var _btnGuardar  = document.getElementById('btn-guardar-cliente');
    var _btnSembrar  = document.getElementById('btn-sembrar-publico');
    if (_btnGuardar) _btnGuardar.addEventListener('click', saveNewClient);
    if (_btnSembrar) _btnSembrar.addEventListener('click', seedPublicoGeneral);

    // Sidebar navigation listeners
    document.querySelectorAll("[data-page]").forEach(function (item) {
      item.addEventListener("click", function (event) {
        event.preventDefault();
        var page = item.getAttribute("data-page");
        navigateTo(page);
      });
    });

    // Load initial page from hash
    var initialPage = getPageFromHash();
    await navigateTo(initialPage);

    // Listen for hash changes
    window.addEventListener("hashchange", function () {
      var newPage = getPageFromHash();
      if (newPage !== currentPage) {
        navigateTo(newPage);
      }
    });
  }

  /* ─── ADMIN-RH-01: RECURSOS HUMANOS MODULE ─── */
  const RH_DEMO_EMPLOYEES = [
    { id: 1, initials: "AL", name: "Alexander Ruiz", area: "Mostrador", role: "Mostrador", comm_factor: "0.0000 %", comm_balance: "$0.00", tip: "$0.00", perms: { adm: 1, caj: 1, ven: 1, cob: 1, rep: 1, com: 1 }, status: "Activo" },
    { id: 2, initials: "AM", name: "Antonio García", area: "Administración", role: "Administrador", comm_factor: "0.0000 %", comm_balance: "$0.00", tip: "$0.00", perms: { adm: 0, caj: 1, ven: 0, cob: 1, rep: 0, com: 0 }, status: "Activo" },
    { id: 3, initials: "GM", name: "Gilberto Martínez", area: "Mostrador", role: "Mostrador", comm_factor: "0.0000 %", comm_balance: "$0.00", tip: "$25.50", perms: { adm: 0, caj: 1, ven: 1, cob: 0, rep: 0, com: 0 }, status: "Activo" },
    { id: 4, initials: "ML", name: "María López", area: "Ventas", role: "Vendedor", comm_factor: "0.0000 %", comm_balance: "$0.00", tip: "$120.75", perms: { adm: 0, caj: 0, ven: 1, cob: 0, rep: 1, com: 0 }, status: "Activo" },
    { id: 5, initials: "JP", name: "Juan Pérez", area: "Caja", role: "Cajero", comm_factor: "0.0000 %", comm_balance: "$0.00", tip: "$0.00", perms: { adm: 0, caj: 1, ven: 0, cob: 0, rep: 0, com: 0 }, status: "Activo" },
    { id: 6, initials: "RV", name: "Rosa Vargas", area: "Cobranzas", role: "Cobrador", comm_factor: "0.0000 %", comm_balance: "$0.00", tip: "$10.00", perms: { adm: 0, caj: 0, ven: 0, cob: 1, rep: 1, com: 0 }, status: "Inactivo" },
    { id: 7, initials: "JC", name: "José Castillo", area: "Almacén", role: "Almacenista", comm_factor: "0.0000 %", comm_balance: "$0.00", tip: "$0.00", perms: { adm: 0, caj: 0, ven: 0, cob: 0, rep: 0, com: 0 }, status: "Inactivo" },
    { id: 8, initials: "LS", name: "Luis Sánchez", area: "Mostrador", role: "Mostrador", comm_factor: "0.0000 %", comm_balance: "$0.00", tip: "$40.25", perms: { adm: 0, caj: 1, ven: 1, cob: 0, rep: 1, com: 0 }, status: "Activo" },
  ];

  function rhToast(msg) {
    var t = document.createElement("div");
    t.className = "rh-toast";
    t.innerHTML = "<i class='fa-solid fa-info-circle'></i> " + (msg || "Función en preparación");
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add("show"); }, 10);
    setTimeout(function() { 
      t.classList.remove("show"); 
      setTimeout(function(){ t.remove(); }, 300);
    }, 2500);
  }
  global.rhToast = rhToast;

  function renderRhTabs() {
    return `
      <div class="rh-tabs">
        <button class="rh-tab active">Personal</button>
        <button class="rh-tab" data-rh-action="toast">Áreas</button>
        <button class="rh-tab" data-rh-action="toast">Accesos</button>
        <button class="rh-tab" data-rh-action="toast">Horarios</button>
        <button class="rh-tab" data-rh-action="toast">Asistencia</button>
        <button class="rh-tab" data-rh-action="toast">Incidencias</button>
        <button class="rh-tab" data-rh-action="toast">NIPs</button>
        <button class="rh-tab" data-rh-action="toast">Reportes</button>
      </div>
    `;
  }

  function renderRhActions() {
    var actions = [
      { id: 'Insert', icon: 'fa-plus', label: 'Nuevo empleado', key: 'Insert' },
      { id: 'Delete', icon: 'fa-minus', label: 'Eliminar empleado', key: 'Supr', danger: true },
      { id: 'F3', icon: 'fa-pen', label: 'Editar', key: 'F3' },
      { id: 'F4', icon: 'fa-shield-halved', label: 'Accesos', key: 'F4' },
      { id: 'F5', icon: 'fa-users-rectangle', label: 'Áreas', key: 'F5' },
      { id: 'F6', icon: 'fa-clipboard', label: 'Notas', key: 'F6' },
      { id: 'F7', icon: 'fa-clock', label: 'Horario permitido', key: 'F7' },
      { id: 'F8', icon: 'fa-users', label: 'Clientes asociados', key: 'F8' },
      { id: 'F9', icon: 'fa-circle-check', label: 'Marcar', key: 'F9' },
      { id: 'F10', icon: 'fa-ban', label: 'Sin filtro', key: 'F10' },
      { id: 'F11', icon: 'fa-warehouse', label: 'Asociar almacén', key: 'F11' },
      { id: 'F12', icon: 'fa-dollar-sign', label: 'Asociar ventas', key: 'F12' },
      { id: 'F13', icon: 'fa-fingerprint', label: 'NIP / Reloj', key: 'F13' }
    ];

    var html = '<div class="rh-actions">';
    actions.forEach(function(a) {
      var colorClass = a.danger ? 'rh-action-danger' : '';
      html += `
        <button class="rh-action-card ${colorClass}" data-rh-action="apply" data-action-id="${a.id}">
          <div class="rh-action-icon"><i class="fa-solid ${a.icon}"></i></div>
          <div class="rh-action-label">${a.label}</div>
          <div class="rh-action-key">${a.key}</div>
        </button>
      `;
    });
    html += '</div>';
    return html;
  }

  function renderRhFilters() {
    return `
      <div class="rh-filters">
        <div class="rh-filter-group">
          <label>Área</label>
          <select><option>Todas las áreas</option></select>
        </div>
        <div class="rh-filter-group">
          <label>Estatus</label>
          <select><option>Todos</option></select>
        </div>
        <div class="rh-filter-group">
          <label>Almacén</label>
          <select><option>Todos</option></select>
        </div>
        <div class="rh-filter-group">
          <label>Rol</label>
          <select><option>Todos</option></select>
        </div>
        <div class="rh-filter-group rh-search">
          <label>Buscar personal</label>
          <div class="rh-search-wrapper">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" placeholder="Buscar por nombre, ID o NIP...">
          </div>
        </div>
        <button class="rh-btn-clear" data-rh-action="toast" data-toast-msg="Filtros limpiados">
          <i class="fa-solid fa-filter-slash"></i> Limpiar filtros
        </button>
      </div>
    `;
  }

  function renderRhTable() {
    return `
      <div class="rh-table-card">
        <div class="rh-table-header">
          <h3><i class="fa-solid fa-users"></i> Personal</h3>
        </div>
        <div class="rh-table-container">
          <table class="rh-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Personal / Nombre</th>
                <th>Área</th>
                <th>Rol / Puesto</th>
                <th>Factor comisión</th>
                <th>Saldo comisiones</th>
                <th>Propina acumulada</th>
                <th class="center">Puede Checar</th>
                <th>Usuario sistema</th>
                <th>Estatus</th>
                <th class="center">Acciones</th>
              </tr>
            </thead>
            <tbody id="rhTableBody">
              <tr><td colspan="11" class="center"><i class="fa-solid fa-spinner fa-spin"></i> Cargando empleados...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="rh-table-footer">
          <div class="rh-pagination-info" id="rhTableCount"></div>
        </div>
      </div>
    `;
  }

  let selectedRhEmployeeIndex = 0;
  let currentRhEmployees = [];

  function selectRhEmployee(index) {
    if (index < 0 || index >= currentRhEmployees.length) return;
    selectedRhEmployeeIndex = index;
    var rows = document.querySelectorAll('#rhTableBody tr');
    rows.forEach(function(r) { r.classList.remove('rh-row-selected'); });
    if (rows[index]) {
      rows[index].classList.add('rh-row-selected');
    }
  }

  function moveRhEmployeeSelection(direction) {
    if (currentRhEmployees.length === 0) return;
    var newIndex = selectedRhEmployeeIndex + direction;
    if (newIndex >= 0 && newIndex < currentRhEmployees.length) {
      selectRhEmployee(newIndex);
      var rows = document.querySelectorAll('#rhTableBody tr');
      if (rows[newIndex]) {
        var tableContainer = document.querySelector('.rh-table-container');
        if (tableContainer) {
          var row = rows[newIndex];
          var rowTop = row.offsetTop;
          var rowBottom = rowTop + row.offsetHeight;
          var containerTop = tableContainer.scrollTop;
          var containerBottom = containerTop + tableContainer.offsetHeight;
          if (rowTop < containerTop) {
            tableContainer.scrollTop = rowTop;
          } else if (rowBottom > containerBottom) {
            tableContainer.scrollTop = rowBottom - tableContainer.offsetHeight;
          }
        }
      }
    }
  }

  function getSelectedRhEmployee() {
    if (selectedRhEmployeeIndex >= 0 && selectedRhEmployeeIndex < currentRhEmployees.length) {
      return currentRhEmployees[selectedRhEmployeeIndex];
    }
    return null;
  }

  function applyRhAction(actionId) {
    var emp = getSelectedRhEmployee();
    
    if (actionId === 'Insert') {
      if (typeof global.openEmployeeCreatePage === 'function') {
        global.openEmployeeCreatePage();
      } else {
        navigateTo('empleado-alta');
      }
      return;
    }
    if (actionId === 'F10') {
      rhToast('Filtros limpiados');
      return;
    }
    
    if (!emp) {
      rhToast('Selecciona un empleado primero');
      return;
    }

    var name = emp.display_name || emp.full_name || 'Empleado';

    if (actionId === 'F3') {
      if (typeof global.openEmployeeEditPage === 'function') {
        global.openEmployeeEditPage(emp.id);
      } else {
        rhToast('Edición en preparación: ' + name);
      }
      return;
    }

    if (actionId === 'Delete') {
      if (typeof global.openEmployeeDeleteModal === 'function') {
        global.openEmployeeDeleteModal(emp);
      } else {
        rhToast('Función en preparación: baja lógica de ' + name);
      }
    } else if (actionId === 'F4') {
      rhToast('Función en preparación: accesos de ' + name);
    } else if (actionId === 'F13') {
      if (typeof global.openChangeNipModal === 'function') {
        global.openChangeNipModal(emp.id, name);
      } else {
        rhToast('Función en preparación: NIP / Reloj');
      }
    } else {
      rhToast('Función en preparación');
    }
  }

  async function loadRhEmployees() {
    var tbody = document.getElementById('rhTableBody');
    var tcount = document.getElementById('rhTableCount');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="11" class="center"><i class="fa-solid fa-spinner fa-spin"></i> Cargando empleados...</td></tr>';
    
    try {
      var token = localStorage.getItem('token');
      var response = await fetch('/api/rh/employees', {
        method: 'GET',
        credentials: 'include'
      });
      
      var data = await response.json();
      
      if (response.ok) {
        currentRhEmployees = data.employees || [];
        selectedRhEmployeeIndex = currentRhEmployees.length > 0 ? 0 : -1;
        renderRhTableRows(currentRhEmployees);
        if (tcount) tcount.innerText = `Mostrando ${(data.employees || []).length} registros`;
      } else {
        rhToast('Error al cargar empleados: ' + (data.detail || 'Desconocido'));
        tbody.innerHTML = '<tr><td colspan="11" class="center" style="color:var(--danger)">Error al cargar.</td></tr>';
      }
    } catch(e) {
      rhToast('Error de red al cargar empleados');
      tbody.innerHTML = '<tr><td colspan="11" class="center" style="color:var(--danger)">Error de red.</td></tr>';
    }
  }

  function normalizeRhStatus(status) {
    var value = String(status || "").trim().toLowerCase();
  
    if (value === "active" || value === "activo") {
      return {
        key: "active",
        label: "Activo",
        className: "status-active"
      };
    }
  
    if (value === "inactive" || value === "inactivo") {
      return {
        key: "inactive",
        label: "Inactivo",
        className: "status-inactive"
      };
    }
  
    return {
      key: "unknown",
      label: status || "Sin estatus",
      className: "status-inactive"
    };
  }

  function renderRhTableRows(employees) {
    var tbody = document.getElementById('rhTableBody');
    if (!tbody) return;
    
    if (!employees || employees.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11">
            <div class="empty-state">
              <div class="empty-icon" style="color:var(--text-muted);border-color:var(--border-color);"><i class="fa-solid fa-folder-open"></i></div>
              <div class="empty-title">No hay empleados registrados.</div>
              <div class="empty-desc">Usa "Nuevo empleado" para dar de alta el primero.</div>
            </div>
          </td>
        </tr>
      `;
      return;
    }
    
    var html = '';
    employees.forEach(function(e, index) {
      function check(val) {
        return val 
          ? '<div class="rh-check checked"><i class="fa-solid fa-check"></i></div>' 
          : '<div class="rh-check"></div>';
      }
      var normalizedStatus = normalizeRhStatus(e.status);
      var statusClass = normalizedStatus.className;
      var statusLabel = normalizedStatus.label;
      var initials = e.full_name ? e.full_name.substring(0, 2).toUpperCase() : '??';
      
      var rowClass = (index === selectedRhEmployeeIndex) ? 'rh-row-selected' : '';
      
      html += `
        <tr class="${rowClass}" data-rh-row="1" data-index="${index}" data-employee-id="${e.id || ''}">
          <td>${e.employee_code || (index+1)}</td>
          <td>
            <div class="rh-user-cell">
              <div class="rh-avatar">${initials}</div>
              <span>${e.display_name || e.full_name}</span>
            </div>
          </td>
          <td>${e.area || '-'}</td>
          <td>${e.position || '-'}</td>
          <td>${e.commission_factor !== null ? e.commission_factor : '-'}</td>
          <td>${e.commission_balance !== null ? '$' + e.commission_balance.toFixed(2) : '-'}</td>
          <td>${e.tips_balance !== null ? '$' + e.tips_balance.toFixed(2) : '-'}</td>
          <td class="center">${check(e.can_clock_in)}</td>
          <td>${e.usuario_id || '-'}</td>
          <td><span class="rh-status-dot ${statusClass}"></span> ${statusLabel}</td>
          <td class="center"><button class="rh-action-menu" data-rh-action="apply" data-action-id="F3"><i class="fa-solid fa-ellipsis-vertical"></i></button></td>
        </tr>
      `;
    });
    
    tbody.innerHTML = html;
  }

  function renderRhSummary() {
    return `
      <div class="rh-summary">
        <div class="rh-metric-card">
          <div class="rh-metric-icon" style="color: #3b82f6; background: rgba(59,130,246,0.1);"><i class="fa-solid fa-users"></i></div>
          <div class="rh-metric-content">
            <div class="rh-metric-title">Empleados activos</div>
            <div class="rh-metric-value">24</div>
            <div class="rh-metric-sub positive"><i class="fa-solid fa-arrow-up"></i> 13% vs mes anterior</div>
          </div>
        </div>
        <div class="rh-metric-card">
          <div class="rh-metric-icon" style="color: #8b5cf6; background: rgba(139,92,246,0.1);"><i class="fa-solid fa-fingerprint"></i></div>
          <div class="rh-metric-content">
            <div class="rh-metric-title">Áreas activas</div>
            <div class="rh-metric-value">6</div>
            <div class="rh-metric-sub neutral">Sin cambios</div>
          </div>
        </div>
        <div class="rh-metric-card">
          <div class="rh-metric-icon" style="color: #f59e0b; background: rgba(245,158,11,0.1);"><i class="fa-solid fa-triangle-exclamation"></i></div>
          <div class="rh-metric-content">
            <div class="rh-metric-title">Incidencias pendientes</div>
            <div class="rh-metric-value">3</div>
            <div class="rh-metric-sub negative"><i class="fa-solid fa-arrow-down"></i> 2 vs ayer</div>
          </div>
        </div>
        <div class="rh-metric-card">
          <div class="rh-metric-icon" style="color: #10b981; background: rgba(16,185,129,0.1);"><i class="fa-solid fa-clock"></i></div>
          <div class="rh-metric-content">
            <div class="rh-metric-title">Asistencia hoy</div>
            <div class="rh-metric-value">95.4 %</div>
            <div class="rh-metric-sub positive"><i class="fa-solid fa-arrow-up"></i> 2.1% vs ayer</div>
          </div>
        </div>
        <div class="rh-metric-card">
          <div class="rh-metric-icon" style="color: #0ea5e9; background: rgba(14,165,233,0.1);"><i class="fa-solid fa-calendar-check"></i></div>
          <div class="rh-metric-content">
            <div class="rh-metric-title">Jornadas abiertas</div>
            <div class="rh-metric-value">5</div>
            <div class="rh-metric-sub neutral">2 en curso</div>
          </div>
        </div>
        <div class="rh-metric-card">
          <div class="rh-metric-icon" style="color: #d946ef; background: rgba(217,70,239,0.1);"><i class="fa-solid fa-fingerprint"></i></div>
          <div class="rh-metric-content">
            <div class="rh-metric-title">NIPs registrados</div>
            <div class="rh-metric-value">28</div>
            <div class="rh-metric-sub neutral">De 32 empleados</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderRecursosHumanos() {
    return `
      <div class="rh-page">
        <div class="rh-header">
          <div class="rh-header-title">
            <i class="fa-solid fa-users"></i>
            <div>
              <h2>Recursos Humanos</h2>
              <p>Administra empleados, accesos, áreas, horarios y asistencia laboral.</p>
            </div>
          </div>
          ${renderRhTabs()}
        </div>
        
        ${renderRhActions()}
        ${renderRhFilters()}
        
        <div class="rh-layout">
          ${renderRhTable()}
          ${renderRhSummary()}
        </div>
      </div>
    `;
  }

  function renderEmployeeProfilePanel() {
    return `
      <div class="employee-profile-card card" style="text-align: center; gap: 16px;">
        <div style="font-size:14px; font-weight:700; color:var(--brand-400); text-align:left; margin-bottom: 8px;">
          <i class="fa-solid fa-id-badge"></i> Perfil rápido
        </div>
        <div id="pageEmpPhotoPlaceholder" class="rh-photo-placeholder" style="width:120px; height:120px; border-radius:50%; margin:0 auto; border:2px dashed var(--border); display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-muted); cursor:pointer; background:var(--bg-app); transition:background 0.2s;">
          <i class="fa-solid fa-camera" style="font-size:24px; margin-bottom:8px;"></i>
          <span style="font-size:11px;">Subir foto</span>
        </div>
        <div style="font-size:10px; color:var(--text-muted);">JPG o PNG, máx. 2 MB</div>
        
        <div class="form-group" style="text-align:left; margin-top:16px;">
          <label class="form-label">Estatus</label>
          <select class="form-control" id="pageEmpStatus">
            <option value="Activo">Activo</option>
            <option value="Inactivo">Inactivo</option>
            <option value="Suspendido">Suspendido</option>
            <option value="Baja">Baja</option>
          </select>
        </div>
        
        <div class="form-group" style="text-align:left;">
          <label class="form-label">Código de empleado</label>
          <input class="form-control" type="text" id="pageEmpCode"
            placeholder="EMP-000123"
            autocomplete="nope"
            style="text-transform:uppercase;"
            oninput="this.value=this.value.toUpperCase()">
        </div>
        
        <div style="text-align:left; margin-top:24px;">
          <div style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:12px;">Acciones rápidas</div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button class="btn btn-secondary" style="width:100%; justify-content:flex-start;" data-rh-action="toast"><i class="fa-solid fa-key" style="width:20px;"></i> Generar usuario</button>
            <button class="btn btn-secondary" style="width:100%; justify-content:flex-start;" data-rh-action="toast"><i class="fa-solid fa-fingerprint" style="width:20px;"></i> Generar NIP</button>
            <button class="btn btn-secondary" style="width:100%; justify-content:flex-start;" data-rh-action="toast"><i class="fa-solid fa-eye" style="width:20px;"></i> Vista previa</button>
            <button class="btn btn-danger" style="width:100%; justify-content:flex-start; margin-top:8px;" data-rh-action="resetForm"><i class="fa-solid fa-eraser" style="width:20px;"></i> Limpiar formulario</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderEmployeeMainForm() {
    return `
      <div class="employee-form-card card" style="padding:0; overflow:hidden;">
        <!-- 1. Datos personales -->
        <div class="rh-modal-section" style="border:none; border-bottom:1px solid var(--border); border-radius:0;">
          <h3 class="rh-section-title"><i class="fa-solid fa-id-card"></i> 1. Datos personales</h3>
          <div class="grid-2">
            <div class="form-group" style="grid-column: span 2;">
              <label class="form-label">Nombre completo *</label>
              <input class="form-control" type="text" id="pageEmpFullName"
                placeholder="Ej. JUAN PEREZ GARCIA"
                autocomplete="nope"
                style="text-transform:uppercase;"
                oninput="this.value=this.value.toUpperCase()">
            </div>
            <div class="form-group">
              <label class="form-label">Nombre visible *</label>
              <input class="form-control" type="text" id="pageEmpDisplayName"
                placeholder="Ej. JUAN P."
                autocomplete="nope"
                style="text-transform:uppercase;"
                oninput="this.value=this.value.toUpperCase()">
            </div>
            <div class="form-group">
              <label class="form-label">Tel&eacute;fono</label>
              <input class="form-control" type="tel" id="pageEmpPhone"
                placeholder="10 d&iacute;gitos" autocomplete="nope">
            </div>
            <div class="form-group" style="grid-column: span 2;">
              <label class="form-label">Correo electr&oacute;nico</label>
              <input class="form-control" type="text" id="pageEmpEmail"
                placeholder="correo@empresa.com"
                autocomplete="nope"
                inputmode="email">
            </div>
          </div>
        </div>

        <!-- 2. Datos laborales -->
        <div class="rh-modal-section" style="border:none; border-bottom:1px solid var(--border); border-radius:0;">
          <h3 class="rh-section-title"><i class="fa-solid fa-briefcase"></i> 2. Datos laborales</h3>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Área *</label>
              <select class="form-control" id="pageEmpArea">
                <option value="">Selecciona...</option>
                <option value="Administración">Administración</option>
                <option value="Mostrador">Mostrador</option>
                <option value="Caja">Caja</option>
                <option value="Ventas">Ventas</option>
                <option value="Almacén">Almacén</option>
                <option value="Reparto">Reparto</option>
              </select>
            </div>
            <!-- Puesto: oculto visualmente, derivado automáticamente del Área -->
            <div class="form-group" style="display:none;" id="pageEmpPositionGroup">
              <label class="form-label">Puesto</label>
              <select class="form-control" id="pageEmpPosition" tabindex="-1">
                <option value="">Selecciona...</option>
                <option value="Administrativo">Administrativo</option>
                <option value="Vendedor mostrador">Vendedor mostrador</option>
                <option value="Cajero">Cajero</option>
                <option value="Vendedor">Vendedor</option>
                <option value="Almacenista">Almacenista</option>
                <option value="Repartidor">Repartidor</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Tipo de empleado *</label>
              <select class="form-control" id="pageEmpType">
                <option value="Planta (tiempo indefinido)" selected>Planta (tiempo indefinido)</option>
                <option value="Temporal (contrato fijo)">Temporal (contrato fijo)</option>
                <option value="Medio tiempo">Medio tiempo</option>
                <option value="Honorarios / Servicios profesionales">Honorarios / Servicios profesionales</option>
                <option value="Comisionista puro">Comisionista puro</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Fecha de ingreso *</label>
              <input class="form-control" type="date" id="pageEmpDate">
            </div>
          </div>
        </div>

        <!-- 3. Ubicación operativa -->
        <div class="rh-modal-section" style="border:none; border-bottom:1px solid var(--border); border-radius:0;">
          <h3 class="rh-section-title"><i class="fa-solid fa-building"></i> 3. Ubicación operativa</h3>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Empresa actual <span style="font-size:10px; color:var(--text-muted); font-weight:400;">(solo lectura)</span></label>
              <div class="emp-empresa-badge" id="pageEmpEmpresaBadge">
                <i class="fa-solid fa-building"></i>
                <span id="pageEmpEmpresaName">Empresa no disponible</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Sucursal base *</label>
              <select class="form-control" id="pageEmpSucursal">
                <option value="">Selecciona...</option>
                <option value="MATRIZ">MATRIZ</option>
                <option value="SUCURSAL NORTE">SUCURSAL NORTE</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Almacén asignado</label>
              <select class="form-control" id="pageEmpWarehouse">
                <option value="">Selecciona...</option>
                <option value="BODEGA PRINCIPAL">BODEGA PRINCIPAL</option>
                <option value="BODEGA SECUNDARIA">BODEGA SECUNDARIA</option>
              </select>
            </div>
            <div class="form-group" id="pageEmpCashRegisterGroup">
              <label class="form-label">Caja asignada <span style="font-size:10px; color:var(--text-muted);">(solo cajeros)</span></label>
              <select class="form-control" id="pageEmpCashRegister"><option value="">No aplica</option><option value="CAJA 1">CAJA 1</option></select>
            </div>
            <div class="form-group" id="pageEmpRouteGroup" style="grid-column: span 2; display:none;">
              <label class="form-label">Ruta asignada <span style="font-size:10px; color:var(--text-muted);">(solo Reparto)</span></label>
              <input class="form-control" type="text" id="pageEmpRoute" placeholder="Ej. Ruta Norte, Zona Centro">
            </div>
          </div>
        </div>

        <!-- 4. Cuenta de acceso a Calebsys -->
        <div class="rh-modal-section" style="border:none; border-bottom:1px solid var(--border); border-radius:0;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
            <div>
              <h3 class="rh-section-title" style="margin:0;"><i class="fa-solid fa-id-badge"></i> 4. Cuenta de acceso a Calebsys</h3>
            <label class="rh-toggle-switch" style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-left:16px; white-space:nowrap;">
              <input type="checkbox" id="pageEmpAccessToggle" style="width:16px; height:16px; accent-color:var(--brand-500); cursor:pointer;">
              <span class="rh-toggle-label" style="font-size:13px; font-weight:600;">Este empleado tendrá acceso a Calebsys</span>
            </label>
          </div>

          <div id="pageEmpAccessFields" class="grid-2" style="display:none; margin-top:16px; padding:16px; background:var(--bg-app); border:1px solid var(--border); border-radius:var(--radius-sm);">
            <div class="form-group" style="grid-column: span 2;">
              <label class="form-label">Usuario Calebsys *</label>
              <input class="form-control" type="text" id="pageEmpUserId" placeholder="Ej. jperez" autocomplete="off">
              <button type="button" id="btnSuggestUsername"
                style="margin-top:6px; width:100%; display:flex; align-items:center; justify-content:center; gap:6px;
                       padding:7px 12px; font-size:12px; background:var(--bg-input); border:1px dashed var(--brand-500);
                       color:var(--brand-400); border-radius:var(--radius-sm); cursor:pointer;
                       transition:background 0.15s, color 0.15s;"
                data-rh-action="suggestUsername"
                title="Genera un usuario a partir del nombre completo del empleado">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
                Sugerir usuario desde el nombre
              </button>
            </div>
             <div class="form-group">
              <label class="form-label">
                Perfil de acceso *
                <span style="font-size:10px; color:var(--text-muted); font-weight:400; margin-left:4px;">(permisos en el sistema)</span>
              </label>
              <select class="form-control" id="pageEmpRole">
                <option value="Administrador">Administrador</option>
                <option value="Supervisor">Supervisor</option>
                <option value="Operador ventas">Operador ventas</option>
                <option value="Operador caja">Operador caja</option>
                <option value="Operador almacén">Operador almacén</option>
                <option value="Operador reparto">Operador reparto</option>
                <option value="Recursos Humanos">Recursos Humanos</option>
                <option value="Contador">Contador</option>
                <option value="Solo lectura">Solo lectura</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Contraseña temporal *</label>
              <div class="pwd-field-wrap">
                <input class="form-control" type="password" id="pageEmpPassword" placeholder="••••••••" autocomplete="new-password">
                <button type="button" class="pwd-eye-btn" tabindex="-1" data-rh-action="togglePwdVisibility" data-target="pageEmpPassword" title="Mostrar/ocultar">
                  <i class="fa-solid fa-eye"></i>
                </button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Confirmar contraseña *</label>
              <div class="pwd-field-wrap">
                <input class="form-control" type="password" id="pageEmpPasswordConfirm" placeholder="••••••••" autocomplete="new-password">
                <button type="button" class="pwd-eye-btn" tabindex="-1" data-rh-action="togglePwdVisibility" data-target="pageEmpPasswordConfirm" title="Mostrar/ocultar">
                  <i class="fa-solid fa-eye"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Edición: mostrar cuenta activa si existe -->
          <div id="pageEmpAccessEditInfo" style="display:none; margin-top:12px; padding:12px 14px; background:var(--bg-app); border:1px solid var(--border); border-radius:var(--radius-sm); font-size:12px;">
            <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
              <span id="pageEmpAccessStatusBadge" class="badge badge-success" style="padding:4px 10px;">
                <i class="fa-solid fa-circle-check"></i> Cuenta activa
              </span>
              <span style="color:var(--text-muted);">Usuario: <strong id="pageEmpAccessUserLabel" style="color:var(--text-primary);">-</strong></span>
              <span style="color:var(--text-muted);">Rol: <strong id="pageEmpAccessRoleLabel" style="color:var(--text-primary);">-</strong></span>
            </div>
            <p style="font-size:11px; color:var(--text-muted); margin:8px 0 0 0;">
              <i class="fa-solid fa-circle-info" style="color:var(--brand-400);"></i>
              Para cambiar usuario, rol o contraseña, usa el módulo de Usuarios del sistema.
            </p>
          </div>
        </div>

        <!-- 5. Reloj checador — DESHABILITADO EN 02L -->
        <!-- La unificación de contraseña + checador queda para ADMIN-RH-02N-P1 -->
        <!-- El backend exige pin numérico de 4 dígitos cuando can_clock_in=true; -->
        <!-- en esta fase siempre se envía can_clock_in=false, pin=null           -->
        <div class="rh-modal-section" style="display:none;" id="pageEmpClockSection">
          <input type="hidden" id="pageEmpClockToggle" value="false">
          <input type="hidden" id="pageEmpNip" value="">
          <input type="hidden" id="pageEmpNipConfirm" value="">
        </div>
  `;
}

  function renderEmployeeSummaryPanel() {
  return `
    <div class="employee-summary-card card" style="position: sticky; top: 20px; gap: 24px;">
      <div>
        <div class="card-title"><i class="fa-solid fa-list-check"></i> Resumen del empleado</div>
        <div style="display:flex; flex-direction:column; gap:12px; font-size:13px; margin-top:16px;">
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:8px;">
            <span style="color:var(--text-muted);">Código:</span>
            <span style="font-weight:600;" id="sumCode">-</span>
          </div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:8px;">
            <span style="color:var(--text-muted);">Estatus:</span>
            <span style="font-weight:600;" id="sumStatus">Activo</span>
          </div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:8px;">
            <span style="color:var(--text-muted);">Fecha ingreso:</span>
            <span style="font-weight:600;" id="sumDate">-</span>
          </div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:8px;">
            <span style="color:var(--text-muted);">Área:</span>
            <span style="font-weight:600;" id="sumArea">-</span>
          </div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:8px;">
            <span style="color:var(--text-muted);">Puesto:</span>
            <span style="font-weight:600;" id="sumPosition">-</span>
          </div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:8px;">
            <span style="color:var(--text-muted);">Tipo:</span>
            <span style="font-weight:600;" id="sumType">Planta (tiempo indefinido)</span>
          </div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:8px;">
            <span style="color:var(--text-muted);">Sucursal:</span>
            <span style="font-weight:600;" id="sumSucursal">-</span>
          </div>
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:8px;">
            <span style="color:var(--text-muted);">Almacén:</span>
            <span style="font-weight:600;" id="sumWarehouse">-</span>
          </div>
        </div>
      </div>

      <div>
        <div style="font-size:14px; font-weight:700; color:var(--text-primary); margin-bottom:10px;"><i class="fa-solid fa-sliders"></i> Configuraciones</div>
        <div style="display:flex; flex-direction:column; gap:7px; font-size:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="color:var(--text-muted);">Cuenta Calebsys:</span>
            <span id="sumAccess" style="font-weight:600;"><i class="fa-solid fa-circle-xmark" style="color:var(--danger);"></i> No</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="color:var(--text-muted);">Checador:</span>
            <span id="sumClock" style="font-weight:600;"><i class="fa-solid fa-circle-xmark" style="color:var(--danger);"></i> No</span>
          </div>
        </div>
      </div>

      <div style="background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.2); border-radius:var(--radius-sm); padding:12px; font-size:11px; color:var(--text-secondary); line-height:1.4;">
        <i class="fa-solid fa-circle-info" style="color:var(--brand-400); margin-bottom:6px; display:block;"></i>
        Este empleado quedará disponible para Recursos Humanos. Las conexiones con Reloj Checador y Nómina se configurarán en fases posteriores.
      </div>
    </div>
  `;
}

  function renderEmployeeFormPage() {
  return `
    <div class="employee-page">
      <div class="employee-header">
        <div class="page-header-left">
          <h2 class="page-title">Alta de empleado</h2>
          <p class="page-subtitle">Registra a un nuevo integrante y configura su información laboral y de acceso</p>
        </div>
      </div>

      <div class="employee-layout">
        ${renderEmployeeProfilePanel()}
        ${renderEmployeeMainForm()}
        ${renderEmployeeSummaryPanel()}
      </div>

      <div class="employee-footer">
        <button class="btn btn-secondary" data-rh-action="cancelForm">Cancelar</button>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:11px; color:var(--text-muted); user-select:none;">
            <kbd style="background:var(--bg-card);border:1px solid var(--border);border-radius:3px;padding:1px 6px;font-size:11px;">F9</kbd>
            para guardar
          </span>
          <button class="btn btn-primary" id="btnSaveEmployee" data-rh-action="saveForm"><i class="fa-solid fa-save"></i> Guardar empleado</button>
        </div>
    </div>
  `;
}

  function bindEmployeeFormPageEvents() {

    // Leer empresa del JWT (solo lectura)
    try {
      var token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
      if (token) {
        var jwtParts = token.split('.');
        if (jwtParts.length === 3) {
          var jwtPayload = JSON.parse(atob(jwtParts[1].replace(/-/g, '+').replace(/_/g, '/')));
          var empresaNombre = jwtPayload.empresa_nombre || jwtPayload.empresa || jwtPayload.company || jwtPayload.tenant || 'Empresa no disponible';
          var empNameEl = document.getElementById('pageEmpEmpresaName');
          if (empNameEl) empNameEl.textContent = empresaNombre;
        }
      }
    } catch(e) { /* JWT parsing no crítico */ }

    var accessToggle = document.getElementById('pageEmpAccessToggle');
    var accessFields = document.getElementById('pageEmpAccessFields');
    if (accessToggle && accessFields) {
      accessToggle.addEventListener('change', function() {
        accessFields.style.display = this.checked ? 'grid' : 'none';
        updateEmployeeSummary();
      });
    }

    // Sugerencia explícita de usuario
    // Se activa únicamente desde el botón visible "Sugerir usuario"
    global.doSuggestUsername = function() {
      // Conectores/partículas a ignorar al identificar nombre y apellido
      var CONECTORES = ['de','del','la','las','los','y','e','da','das','dos','van','von','le','les'];

      function normalizarTexto(str) {
        return str.normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');
      }

      var userField = document.getElementById('pageEmpUserId');
      if (!userField) { rhToast('Campo de usuario no disponible'); return; }

      var fullName = (document.getElementById('pageEmpFullName') || {}).value || '';
      // Separar en tokens y filtrar conectores
      var allTokens = fullName.trim().split(/\s+/).filter(Boolean);
      var tokens = allTokens.filter(function(t) {
        return CONECTORES.indexOf(t.toLowerCase()) === -1;
      });

      if (tokens.length < 2) {
        rhToast('Escribe el nombre completo (nombre y al menos un apellido)');
        return;
      }

      // Posición del primer apellido en nombres mexicanos:
      // Con 4+ tokens: [Nombre] [Nombre2?] [ApellidoPat] [ApellidoMat]
      //   → apellido = tokens[length-2]
      // Con 3 tokens:  [Nombre] [ApellidoPat] [ApellidoMat]
      //   → apellido = tokens[1]
      // Con 2 tokens:  [Nombre] [Apellido]
      //   → apellido = tokens[1]
      // Fórmula unificada: Math.max(1, tokens.length - 2)
      // Ejemplos verificados:
      //   ANTONIO JESUS MAGDALENO MORA → tokens[2]=MAGDALENO → amagdaleno ✅
      //   JUAN CARLOS PEREZ LOPEZ      → tokens[2]=PEREZ     → jperez     ✅
      //   MARIA CARMEN GONZALEZ RUIZ   → tokens[2]=GONZALEZ  → mgonzalez  ✅
      //   JUAN PEREZ GARCIA            → tokens[1]=PEREZ     → jperez     ✅
      var inicial      = normalizarTexto(tokens[0]).charAt(0);
      var apellidoIdx  = Math.max(1, tokens.length - 2);
      var apellido     = normalizarTexto(tokens[apellidoIdx]);
      // Resultado en MAYUSCULAS segun regla de negocio (AMAGDALENO, JPEREZ, etc.)
      var sugerido = (inicial + apellido).substring(0, 20).toUpperCase();

      if (!sugerido) { rhToast('No se pudo generar usuario a partir del nombre'); return; }
      userField.value = sugerido;
      userField.focus();
      userField.select();
    };

    var clockToggle = document.getElementById('pageEmpClockToggle');
    var clockFields = document.getElementById('pageEmpClockFields');
    if (clockToggle && clockFields) {
      clockToggle.addEventListener('change', function() {
        clockFields.style.display = this.checked ? 'block' : 'none';
        updateEmployeeSummary();
      });
    }

    // Ruta asignada: solo visible para Área = Reparto
    var areaSelect = document.getElementById('pageEmpArea');
    var routeGroup = document.getElementById('pageEmpRouteGroup');
    function toggleRouteField() {
      if (!areaSelect || !routeGroup) return;
      var isReparto = areaSelect.value === 'Reparto';
      routeGroup.style.display = isReparto ? 'block' : 'none';
      var routeInput = document.getElementById('pageEmpRoute');
      if (routeInput) routeInput.disabled = !isReparto;
      // Auto-derivar Puesto desde Area usando funcion robusta (normaliza acentos)
      var posEl = document.getElementById('pageEmpPosition');
      if (posEl && areaSelect.value) {
        posEl.value = getPositionForArea(areaSelect.value);
      }
    }
    if (areaSelect) {
      areaSelect.addEventListener('change', toggleRouteField);
      toggleRouteField(); // estado inicial
    }

    var updateFields = [
      'pageEmpCode', 'pageEmpStatus', 'pageEmpDate', 'pageEmpArea',
      'pageEmpPosition', 'pageEmpType', 'pageEmpSucursal', 'pageEmpWarehouse'
    ];

    updateFields.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', updateEmployeeSummary);
        el.addEventListener('change', updateEmployeeSummary);
      }
    });

    updateEmployeeSummary(); // estado inicial
  }

  function updateEmployeeSummary() {
    var val = function(id) {
      var el = document.getElementById(id);
      return el && el.value ? el.value : '-';
    };

    var sumCode = document.getElementById('sumCode');
    if (sumCode) sumCode.textContent = val('pageEmpCode');
    
    var sumStatus = document.getElementById('sumStatus');
    if (sumStatus) {
      var sVal = val('pageEmpStatus');
      sumStatus.textContent = sVal !== '-' ? sVal : 'Activo';
    }
    
    var sumDate = document.getElementById('sumDate');
    if (sumDate) sumDate.textContent = val('pageEmpDate');

    var sumArea = document.getElementById('sumArea');
    if (sumArea) sumArea.textContent = val('pageEmpArea');

    var sumPosition = document.getElementById('sumPosition');
    if (sumPosition) sumPosition.textContent = val('pageEmpPosition');

    var sumType = document.getElementById('sumType');
    if (sumType) {
      var tVal = val('pageEmpType');
      sumType.textContent = tVal !== '-' ? tVal : 'Planta (tiempo indefinido)';
    }

    var sumSucursal = document.getElementById('sumSucursal');
    if (sumSucursal) sumSucursal.textContent = val('pageEmpSucursal');

    var sumWarehouse = document.getElementById('sumWarehouse');
    if (sumWarehouse) sumWarehouse.textContent = val('pageEmpWarehouse');

    var accessToggle = document.getElementById('pageEmpAccessToggle');
    var sumAccess = document.getElementById('sumAccess');
    var sumPwdChange = document.getElementById('sumPwdChange');
    if (sumAccess && accessToggle) {
      if (accessToggle.checked) {
        sumAccess.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success);"></i> Sí';
        if (sumPwdChange) sumPwdChange.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success);"></i> Sí';
      } else {
        sumAccess.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:var(--danger);"></i> No';
        if (sumPwdChange) sumPwdChange.textContent = '—';
      }
    }

    var clockToggle = document.getElementById('pageEmpClockToggle');
    var sumClock = document.getElementById('sumClock');
    if (sumClock && clockToggle) {
      if (clockToggle.checked) {
        sumClock.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success);"></i> Sí';
      } else {
        sumClock.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:var(--danger);"></i> No';
      }
    }

    // Contrato/IMSS: siempre estático en esta fase
    // Los elementos sumContractType, sumAlertDays, etc. ya no existen en el panel lateral.
    // El bloque de Contrato/IMSS en el resumen es estático.
  }

  function resetEmployeeFormPage() {
    var inputs = document.querySelectorAll('.employee-page input, .employee-page select, .employee-page textarea');
    inputs.forEach(function(el) {
      if (el.type === 'checkbox') {
        el.checked = false;
      } else if (el.tagName === 'SELECT') {
        el.selectedIndex = 0;
      } else {
        el.value = '';
      }
    });
    // Restore default values
    var statusEl = document.getElementById('pageEmpStatus');
    if (statusEl) statusEl.value = 'Activo';

    var typeEl = document.getElementById('pageEmpType');
    if (typeEl) typeEl.value = 'Planta (tiempo indefinido)';

    // Restaurar bloques NIP al modo alta
    var nipNewBlock = document.getElementById('pageEmpNipNewBlock');
    var nipEditBlock = document.getElementById('pageEmpNipEditBlock');
    if (nipNewBlock) nipNewBlock.style.display = '';
    if (nipEditBlock) nipEditBlock.style.display = 'none';

    // Ocultar bloque informativo de cuenta (edición) — debe estar limpio en alta
    var accessEditInfo = document.getElementById('pageEmpAccessEditInfo');
    if (accessEditInfo) accessEditInfo.style.display = 'none';

    // Trigger events para ocultar campos y actualizar resumen
    var accessToggle = document.getElementById('pageEmpAccessToggle');
    if (accessToggle) {
      accessToggle.disabled = false;
      accessToggle.checked = false;
      var accessFields = document.getElementById('pageEmpAccessFields');
      if (accessFields) accessFields.style.display = 'none';
    }

    var clockToggle = document.getElementById('pageEmpClockToggle');
    if (clockToggle) {
      clockToggle.checked = false;
      clockToggle.dispatchEvent(new Event('change'));
    }

    updateEmployeeSummary();
    rhToast('Formulario limpiado');
  }

  // ADMIN-RH-02I - Change NIP Modal Logic
  global.currentNipEmployeeId = null;

  global.openChangeNipModal = function(empId, empName) {
    global.currentNipEmployeeId = empId;
    
    var modal = document.getElementById('modal-change-nip');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-change-nip';
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal-dialog" style="max-width:400px;">
          <div class="modal-header">
            <h3><i class="fa-solid fa-fingerprint"></i> Cambiar NIP</h3>
            <button class="modal-close" data-rh-action="closeNipModal"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <p style="margin-bottom:15px; color:var(--text-secondary);">Empleado: <strong id="nipEmpName"></strong></p>
            <div class="form-group" style="margin-bottom:15px;">
              <label class="form-label">Nuevo NIP *</label>
              <input class="form-control" type="password" id="nipNew" maxlength="4" inputmode="numeric" placeholder="4 dígitos numéricos">
            </div>
            <div class="form-group">
              <label class="form-label">Confirmar nuevo NIP *</label>
              <input class="form-control" type="password" id="nipConfirm" maxlength="4" inputmode="numeric" placeholder="4 dígitos numéricos">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-rh-action="closeNipModal">Cancelar</button>
            <button class="btn btn-primary" id="btnSaveNip" data-rh-action="saveNip"><i class="fa-solid fa-save"></i> Guardar NIP</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    
    document.getElementById('nipEmpName').innerText = empName;
    document.getElementById('nipNew').value = '';
    document.getElementById('nipConfirm').value = '';
    
    // reset button state
    var btn = document.getElementById('btnSaveNip');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar NIP';
    }
    
    modal.classList.add('open');
  };

  global.closeChangeNipModal = function() {
    var modal = document.getElementById('modal-change-nip');
    if (modal) modal.classList.remove('open');
    
    var nipNew = document.getElementById('nipNew');
    var nipConfirm = document.getElementById('nipConfirm');
    if (nipNew) nipNew.value = '';
    if (nipConfirm) nipConfirm.value = '';
    
    var btn = document.getElementById('btnSaveNip');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar NIP';
    }
    
    global.currentNipEmployeeId = null;
  };

  global.saveNewNip = async function() {
    if (!global.currentNipEmployeeId) {
      return rhToast("Selecciona un empleado primero");
    }
    
    var nip = document.getElementById('nipNew').value.trim();
    var nipConfirm = document.getElementById('nipConfirm').value.trim();
    
    if (!nip || !nipConfirm) {
      return rhToast('Ambos campos son requeridos');
    }
    if (!/^\d{4}$/.test(nip)) {
      return rhToast('El NIP debe tener exactamente 4 dígitos numéricos');
    }
    if (nip !== nipConfirm) {
      return rhToast('Los NIP no coinciden');
    }
    
    var btn = document.getElementById('btnSaveNip');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
    
    try {
      var token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
      var res = await fetch('/api/rh/employees/' + global.currentNipEmployeeId + '/pin', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ pin: nip, pin_confirm: nipConfirm })
      });
      
      var data = await res.json();
      
      if (!res.ok) {
        throw data;
      }
      
      rhToast('NIP actualizado correctamente');
      global.closeChangeNipModal();
      
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar NIP';
      
      var msg = 'Error al actualizar NIP';
      if (e && e.detail) {
        if (e.detail === 'pin_invalid_format') {
          msg = 'Formato de NIP inválido';
        } else if (e.detail === 'pin_confirm_mismatch') {
          msg = 'La confirmación del NIP no coincide';
        } else if (e.detail === 'employee_not_found') {
          msg = 'Empleado no encontrado';
        }
      }
      rhToast(msg);
    }
  };

  // ADMIN-RH-02K-P0 - Delete Employee Modal Logic
  global.currentDeleteEmployee = null;

  global.openEmployeeDeleteModal = function(emp) {
    global.currentDeleteEmployee = emp;

    var modal = document.getElementById('modal-delete-employee');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-delete-employee';
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="delete-modal-card">
          <div class="modal-header">
            <h3 class="delete-modal-title">
              <i class="fa-solid fa-triangle-exclamation"></i> Dar de baja empleado
            </h3>
            <button type="button" class="modal-close" data-rh-action="closeDeleteModal" aria-label="Cerrar">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="modal-body">
            <p style="margin-bottom:0; font-size:0.95rem;">
              &iquest;Est&aacute;s seguro de que deseas dar de baja a este empleado?
            </p>
            <div class="delete-modal-summary">
              <p><strong>C&oacute;digo:</strong> <span id="delEmpCode"></span></p>
              <p><strong>Nombre:</strong> <span id="delEmpName"></span></p>
              <p><strong>&Aacute;rea:</strong> <span id="delEmpArea"></span></p>
              <p><strong>Puesto:</strong> <span id="delEmpPosition"></span></p>
            </div>
            <p class="delete-modal-warning">
              <i class="fa-solid fa-info-circle" style="color:#f59e0b; margin-right:4px;"></i>
              Esta acci&oacute;n ocultar&aacute; al empleado de los listados activos, pero conservar&aacute; su historial y checadas.
            </p>
          </div>
          <div class="delete-modal-actions">
            <button type="button" class="delete-modal-btn-cancel" data-rh-action="closeDeleteModal">Cancelar</button>
            <button type="button" class="delete-modal-btn-danger" id="btnConfirmDelete" data-rh-action="confirmDelete">
              <i class="fa-solid fa-trash"></i> Dar de baja
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('delEmpCode').innerText = emp.employee_code || 'N/A';
    document.getElementById('delEmpName').innerText = emp.full_name || 'N/A';
    document.getElementById('delEmpArea').innerText = emp.area || 'N/A';
    document.getElementById('delEmpPosition').innerText = emp.position || 'N/A';

    var btn = document.getElementById('btnConfirmDelete');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-trash"></i> Dar de baja';
    }

    modal.classList.add('open');

    // Foco inicial en Cancelar para operación segura con teclado
    var cancelBtn = modal.querySelector('.delete-modal-btn-cancel');
    if (cancelBtn) {
      setTimeout(function() { cancelBtn.focus(); }, 50);
    }
  };

  global.closeEmployeeDeleteModal = function() {
    var modal = document.getElementById('modal-delete-employee');
    if (modal) modal.classList.remove('open');
    
    global.currentDeleteEmployee = null;
    
    var btn = document.getElementById('btnConfirmDelete');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-trash"></i> Dar de baja';
    }
  };

  global.confirmEmployeeSoftDelete = async function() {
    if (!global.currentDeleteEmployee || !global.currentDeleteEmployee.id) {
      return rhToast("Selecciona un empleado primero");
    }
    
    var btn = document.getElementById('btnConfirmDelete');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';
    
    try {
      var token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
      var res = await fetch('/api/rh/employees/' + global.currentDeleteEmployee.id, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + token
        }
      });
      
      var data = await res.json();
      
      if (!res.ok) {
        throw data;
      }
      
      rhToast('Empleado dado de baja correctamente');
      global.closeEmployeeDeleteModal();
      
      if (typeof loadRhEmployees === 'function') {
        loadRhEmployees();
      }
      
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-trash"></i> Dar de baja';
      
      var msg = 'Error al dar de baja empleado';
      if (e && e.detail === 'employee_not_found') {
        msg = 'Empleado no encontrado';
      }
      rhToast(msg);
    }
  };

  global.cancelEmployeeFormPage = function() {
    pendingEmployeePhotoFile = null;
    var form = document.getElementById('employeePageForm');
    if (form) form.reset();
    var photo = document.getElementById('pageEmpPhotoPlaceholder');
    if (photo) photo.style.backgroundImage = 'none';
    global.currentEmployeeFormMode = "create";
    global.currentEditEmployeeId = null;
    navigateTo('recursos-humanos');
  };

  global.openEmployeeCreatePage = function() {
    pendingEmployeePhotoFile = null;
    global.currentEmployeeFormMode = "create";
    global.currentEditEmployeeId = null;
    var form = document.getElementById('employeePageForm');
    if (form) form.reset();
    var title = document.querySelector('#empleado-alta .rh-header-title');
    if (title) title.innerText = 'Alta de empleado';
    var btn = document.getElementById('btnSaveEmployee');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar empleado';
    
    var passContainer = document.getElementById('pageEmpNipContainer');
    if (passContainer) passContainer.style.display = 'block';
    
    var uId = document.getElementById('pageEmpUserId');
    if (uId) uId.disabled = false;
    
    var accToggle = document.getElementById('pageEmpAccessToggle');
    if (accToggle) accToggle.disabled = false;
    
    var nipWarning = document.getElementById('nipEditWarning');
    if (nipWarning) nipWarning.style.display = 'none';
    
    navigateTo('empleado-alta');
  };

  global.openEmployeeEditPage = async function(employeeId) {
    pendingEmployeePhotoFile = null;
    global.currentEmployeeFormMode = "edit";
    global.currentEditEmployeeId = employeeId;
    
    var title = document.querySelector('#empleado-alta .rh-header-title');
    if (title) title.innerText = 'Editar empleado';
    var btn = document.getElementById('btnSaveEmployee');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar cambios';
    
    navigateTo('empleado-alta');
    
    try {
      var token = localStorage.getItem('session_token') || sessionStorage.getItem('session_token');
      var response = await fetch('/api/rh/employees/' + employeeId, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token
        }
      });
      var data = await response.json();
      if (response.ok) {
        fillEmployeeForm(data);
      } else {
        rhToast('Error al cargar empleado: ' + (data.detail || 'Desconocido'));
        cancelEmployeeFormPage();
      }
    } catch(e) {
      rhToast('Error de red al cargar empleado');
      cancelEmployeeFormPage();
    }
  };

  function fillEmployeeForm(emp) {
    var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('pageEmpCode', emp.employee_code);
    setVal('pageEmpFullName', emp.full_name);
    setVal('pageEmpDisplayName', emp.display_name);
    setVal('pageEmpPhone', emp.phone);
    setVal('pageEmpEmail', emp.email);
    renderEmployeePhoto(emp.photo_url || null);
    setVal('pageEmpArea', emp.area);
    setVal('pageEmpPosition', emp.position);
    setVal('pageEmpType', emp.employment_type);
    
    // Check if the date contains "T", if so grab only YYYY-MM-DD
    var ddate = emp.hire_date || '';
    if (ddate.indexOf('T') !== -1) {
      ddate = ddate.substring(0, 10);
    }
    setVal('pageEmpDate', ddate);
    
    setVal('pageEmpStatus', emp.status);
    setVal('pageEmpSucursal', emp.sucursal_id);
    setVal('pageEmpWarehouse', emp.assigned_warehouse_name); 
    setVal('pageEmpCashRegister', emp.assigned_cash_register_id);
    
    var com = document.getElementById('pageEmpCommission');
    if (com && emp.commission_factor !== null && emp.commission_factor !== undefined) {
      com.value = emp.commission_factor;
    }
    
    var accessToggle = document.getElementById('pageEmpAccessToggle');
    if (accessToggle) {
      accessToggle.checked = emp.can_login;
      accessToggle.disabled = true; // can_login es solo lectura en edición (fase 02L-P1)
      var accessFields = document.getElementById('pageEmpAccessFields');
      var accessEditInfo = document.getElementById('pageEmpAccessEditInfo');
      if (emp.can_login) {
        // Ocultar campos de alta, mostrar bloque informativo de cuenta existente
        if (accessFields) accessFields.style.display = 'none';
        if (accessEditInfo) {
          accessEditInfo.style.display = 'block';
          var userLabel = document.getElementById('pageEmpAccessUserLabel');
          var roleLabel = document.getElementById('pageEmpAccessRoleLabel');
          var statusBadge = document.getElementById('pageEmpAccessStatusBadge');
          if (userLabel) userLabel.textContent = emp.usuario_id || '—';
          if (roleLabel) roleLabel.textContent = emp.role || '—';
          if (statusBadge) {
            statusBadge.className = 'badge badge-success';
            statusBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Cuenta activa';
          }
        }
      } else {
        if (accessFields) accessFields.style.display = 'none';
        if (accessEditInfo) {
          accessEditInfo.style.display = 'block';
          var statusBadge2 = document.getElementById('pageEmpAccessStatusBadge');
          if (statusBadge2) {
            statusBadge2.className = 'badge badge-neutral';
            statusBadge2.innerHTML = '<i class="fa-solid fa-circle-minus"></i> Sin cuenta de acceso';
          }
          var userLabel2 = document.getElementById('pageEmpAccessUserLabel');
          var roleLabel2 = document.getElementById('pageEmpAccessRoleLabel');
          if (userLabel2) userLabel2.textContent = '—';
          if (roleLabel2) roleLabel2.textContent = '—';
        }
      }
    }

    var clockToggle = document.getElementById('pageEmpClockToggle');
    if (clockToggle) {
      clockToggle.checked = emp.can_clock_in;
      var clockFields = document.getElementById('pageEmpClockFields');
      if (clockFields) clockFields.style.display = emp.can_clock_in ? 'block' : 'none';
    }

    // Edición: ocultar campos NIP, mostrar badge con botón Cambiar NIP
    var nipNewBlock = document.getElementById('pageEmpNipNewBlock');
    var nipEditBlock = document.getElementById('pageEmpNipEditBlock');
    if (nipNewBlock) nipNewBlock.style.display = 'none';
    if (nipEditBlock) {
      nipEditBlock.style.display = 'flex';
      var nipBadge = nipEditBlock.querySelector('.badge');
      if (nipBadge) {
        if (emp.can_clock_in) {
          nipBadge.className = 'badge badge-success';
          nipBadge.innerHTML = '<i class="fa-solid fa-fingerprint"></i> NIP configurado';
        } else {
          nipBadge.className = 'badge badge-neutral';
          nipBadge.innerHTML = '<i class="fa-solid fa-circle-minus"></i> Sin NIP';
        }
      }
      var nipBtn = nipEditBlock.querySelector('[data-rh-action="openNipModal"]');
      if (nipBtn) {
        nipBtn.dataset.empId = emp.id || '';
        nipBtn.dataset.empName = emp.full_name || emp.display_name || 'Empleado';
      }
    }

    setVal('pageEmpUserId', emp.usuario_id);
    var uId = document.getElementById('pageEmpUserId');
    if (uId) uId.disabled = true;

    // En edición: ocultar botón Sugerir (el usuario ya existe)
    var btnSuggest = document.getElementById('btnSuggestUsername');
    if (btnSuggest) btnSuggest.style.display = 'none';
  }

  async function saveEmployeeFromPage() {
    var btn = document.getElementById('btnSaveEmployee');
    var val = function(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };

    var fullName = val('pageEmpFullName');
    var displayName = val('pageEmpDisplayName') || fullName.split(' ')[0] || 'Empleado';
    var area = val('pageEmpArea');
    // Auto-derivar puesto desde area (el select de puesto está oculto en la UI)
    // getPositionForArea normaliza acentos, así que funciona con cualquier encoding
    var position = val('pageEmpPosition') || getPositionForArea(area);
    // Si aún no se detectó, escribirlo en el campo oculto para consistencia
    if (position) { var posEl = document.getElementById('pageEmpPosition'); if (posEl) posEl.value = position; }
    var date = val('pageEmpDate');
    var sucursal = val('pageEmpSucursal');

    if (!fullName) return rhToast('El Nombre completo es requerido');
    if (!area)     return rhToast('El Área es requerida');
    if (!position) return rhToast('El Puesto no pudo determinarse. Seleccione un Área válida.');
    if (!date) return rhToast('La Fecha de ingreso es requerida');
    if (!sucursal) return rhToast('La Sucursal es requerida');

    var accessToggle = document.getElementById('pageEmpAccessToggle');
    var canLogin = accessToggle && accessToggle.checked;
    
    var userId = val('pageEmpUserId');
    var pass = val('pageEmpPassword');
    var passConfirm = val('pageEmpPasswordConfirm');
    var role = val('pageEmpRole');
    var isEditingExistingEmployee =
      global.currentEmployeeFormMode === 'edit' && Boolean(global.currentEditEmployeeId);
    var hasExistingAccount = isEditingExistingEmployee && canLogin && Boolean(userId);
    var requiresTemporaryPassword = canLogin && !hasExistingAccount;

    if (requiresTemporaryPassword) {
      if (!userId) return rhToast('El Usuario es requerido');
      if (!pass) return rhToast('La Contraseña temporal es requerida');
      if (!passConfirm) return rhToast('Confirmar contraseña es requerido');
      if (pass !== passConfirm) return rhToast('Las contraseñas no coinciden');
      if (!role) return rhToast('El Perfil de acceso es requerido');
    }

    // ADMIN-RH-02N-P1: reloj checador deshabilitado en 02L.
    // Backend exige pin numérico 4 dígitos cuando can_clock_in=true.
    // En 02L siempre se envía can_clock_in=false para no romper altas.
    // La unificación contraseña+checador se implementará en fase 02N.
    var canClockIn = false;

    // Build payload
    var payload = {
      full_name: fullName,
      display_name: displayName,
      phone: val('pageEmpPhone'),
      email: val('pageEmpEmail'),
      employee_code: val('pageEmpCode'),
      
      area: area,
      position: position,
      employment_type: val('pageEmpType') || 'Tiempo completo',
      hire_date: date,
      status: val('pageEmpStatus') || 'Activo',
      
      sucursal_id: sucursal,
      assigned_warehouse_id: val('pageEmpWarehouse') || null,
      assigned_warehouse_name: val('pageEmpWarehouse') || null,
      assigned_cash_register_id: val('pageEmpCashRegister') || null,
      
      commission_factor: val('pageEmpCommission') ? parseFloat(val('pageEmpCommission')) : 0,
      commission_balance: 0,
      tips_balance: 0,
      
      can_login: canLogin,
      usuario_id: canLogin ? userId : null,
      temporary_password: requiresTemporaryPassword ? pass : null,
      temporary_password_confirm: requiresTemporaryPassword ? passConfirm : null,
      role: canLogin ? role : null,
      
      can_clock_in: false,   // 02N-P1: siempre false en esta fase
      pin: null,              // 02N-P1: unificación pendiente
      pin_confirm: null
      
      // TODO ADMIN-RH-04: conectar contrato/IMSS/nómina futura
    };

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
    }

    try {
      var token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
      var url = '/api/rh/employees';
      var method = 'POST';
      var finalPayload = payload;
      
      if (global.currentEmployeeFormMode === 'edit') {
        url = '/api/rh/employees/' + global.currentEditEmployeeId;
        method = 'PUT';
        
        finalPayload = {
          employee_code: payload.employee_code,
          full_name: payload.full_name,
          display_name: payload.display_name,
          phone: payload.phone,
          email: payload.email,
          area: payload.area,
          position: payload.position,
          employment_type: payload.employment_type,
          hire_date: payload.hire_date,
          status: payload.status,
          sucursal_id: payload.sucursal_id,
          assigned_warehouse_id: payload.assigned_warehouse_id,
          assigned_warehouse_name: payload.assigned_warehouse_name,
          assigned_cash_register_id: payload.assigned_cash_register_id,
          commission_factor: payload.commission_factor
          // NOTA (04-sep-2026): se evaluó agregar "role" aquí para poder
          // editarlo desde este formulario, pero pageEmpRole vive dentro de
          // #pageEmpAccessFields -- oculto y NUNCA poblado con el rol actual
          // en modo edición (fillEmployeeForm solo lo muestra como texto en
          // pageEmpAccessRoleLabel, de solo lectura). Mandar val('pageEmpRole')
          // aquí habría enviado el valor del <select> sin tocar (su primera
          // opción por defecto), sobrescribiendo el rol real del usuario en
          // CADA edición. El propio formulario ya redirige correctamente:
          // "Para cambiar rol, usa el módulo de Usuarios del sistema" — eso
          // ya funciona (ver modal-editar-usuario en usuarios.html/admin.js).
        };
      }
      
      var res = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(finalPayload)
      });
      
      var data = await res.json();
      
      if (!res.ok) {
        throw data;
      }
      
      var savedEmployeeId = data.id || data.employee_id || global.currentEditEmployeeId;
      if (pendingEmployeePhotoFile) {
        var photoForm = new FormData();
        photoForm.append('file', pendingEmployeePhotoFile);
        var photoResponse;
        var photoData;
        try {
          photoResponse = await fetch('/api/rh/employees/' + encodeURIComponent(savedEmployeeId) + '/photo', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: photoForm
          });
          photoData = await photoResponse.json().catch(function() { return {}; });
          if (!photoResponse.ok) throw photoData;
          renderEmployeePhoto(photoData.photo_url || null);
          pendingEmployeePhotoFile = null;
        } catch (photoError) {
          console.error('[CALEBSYS RH] Error al cargar fotografía:', photoError && (photoError.detail || photoError.message || photoError));
          rhToast('Los datos del empleado se guardaron, pero la fotografía no pudo cargarse');
          return;
        }
      }

      if (typeof rhToast === 'function') {
        rhToast(global.currentEmployeeFormMode === 'edit' ? 'Empleado actualizado correctamente' : 'Empleado registrado correctamente');
      }
      pendingEmployeePhotoFile = null;
      if (typeof navigateTo === 'function') navigateTo('recursos-humanos');
      if (typeof loadRhEmployees === 'function') loadRhEmployees();
      
      // Cleanup edit state
      global.currentEmployeeFormMode = 'create';
      global.currentEditEmployeeId = null;
    } catch (e) {
      var msg = global.currentEmployeeFormMode === 'edit' ? 'Error al actualizar empleado' : 'Error al registrar empleado';
      if (e && e.detail) {
        if (e.detail === 'usuario_id_duplicado' || (typeof e.detail === 'string' && e.detail.includes('Username already exists'))) {
          msg = 'El usuario ya existe.';
        } else if (e.detail === 'employee_code_duplicate') {
          msg = 'El código de empleado ya está en uso.';
        } else if (e.detail === 'full_name_required') {
          msg = 'Nombre completo requerido.';
        } else if (e.detail === 'sucursal_required') {
          msg = 'Sucursal requerida.';
        } else if (e.detail === 'area_required') {
          msg = 'Área requerida.';
        } else if (e.detail === 'position_required') {
          msg = 'Puesto requerido.';
        } else if (e.detail === 'hire_date_required') {
          msg = 'Fecha de ingreso requerida.';
        } else if (e.detail === 'pin_invalid_format') {
          msg = 'El NIP debe tener 4 dígitos.';
        } else if (e.detail === 'pin_confirm_mismatch') {
          msg = 'El NIP no coincide.';
        } else if (e.detail === 'password_confirm_mismatch') {
          msg = 'La contraseña no coincide.';
        } else if (e.detail === 'employee_duplicate') {
          msg = 'Ya existe un empleado con ese nombre y teléfono.';
        } else if (typeof e.detail === 'string') {
          msg = e.detail;
        } else if (Array.isArray(e.detail) && e.detail[0] && e.detail[0].msg) {
          msg = e.detail[0].msg;
        }
      } else if (e && e.message) {
        msg = e.message;
      }
      rhToast(msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar empleado';
      }
    }
  }

  /* ─── THEME MANAGER ─── */
  function initTheme() {
    var savedTheme = localStorage.getItem("calebsys_theme") || "dark";
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("calebsys_theme", theme);
    updateThemeToggleIcon(theme);
  }

  function updateThemeToggleIcon(theme) {
    var btn = document.getElementById("adminThemeToggle");
    if (!btn) return;

    var icon = btn.querySelector("i");
    if (!icon) return;

    if (theme === "dark") {
      icon.className = "fa-solid fa-sun";
      btn.setAttribute("aria-label", "Cambiar a modo claro");
      btn.title = "Cambiar a modo claro";
    } else {
      icon.className = "fa-solid fa-moon";
      btn.setAttribute("aria-label", "Cambiar a modo oscuro");
      btn.title = "Cambiar a modo oscuro";
    }
  }

  function bindThemeToggle() {
    var btn = document.getElementById("adminThemeToggle");
    if (!btn) return;

    btn.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme") || (localStorage.getItem("calebsys_theme") || "dark");
      var next = current === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  }

  /* ─── ADMIN-RH-02C: EMPLOYEES MODAL ─── */
  function renderEmployeeModal() {
    if (document.getElementById('modal-employee')) return;
    
    var html = `
    <div class="modal-backdrop" id="modal-employee">
      <div class="modal rh-employee-modal" style="width: 700px; max-width: 95vw;">
        <div class="modal-header">
          <div class="modal-title" style="display:flex; align-items:center;">
            <i class="fa-solid fa-user-plus" style="color:var(--brand-400);margin-right:12px;font-size:24px;"></i>
            <div>
              <div style="font-size:18px; font-weight:700;">Nuevo empleado</div>
              <div style="font-size:13px; color:var(--text-muted); font-weight:400; margin-top:2px;">Registra datos laborales, accesos y asistencia del empleado.</div>
            </div>
          </div>
          <button class="modal-close rh-close-emp-modal"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body" style="max-height: 65vh; overflow-y: auto; padding: 24px; background:var(--bg-card); display:flex; flex-direction:column; gap:24px;">
          
          <!-- SECCIÓN 1: Datos personales -->
          <div class="rh-modal-section">
            <h3 class="rh-section-title"><i class="fa-solid fa-id-card"></i> 1. Datos personales</h3>
            <div class="rh-form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
              <div class="form-group" style="grid-column: span 2;">
                <label class="form-label">Nombre completo *</label>
                <input class="form-control" type="text" id="empFullName" placeholder="Ej. Juan Pérez García">
              </div>
              <div class="form-group">
                <label class="form-label">Nombre visible</label>
                <input class="form-control" type="text" id="empDisplayName" placeholder="Ej. Juan P.">
              </div>
              <div class="form-group">
                <label class="form-label">Teléfono</label>
                <input class="form-control" type="tel" id="empPhone" placeholder="10 dígitos">
              </div>
              <div class="form-group">
                <label class="form-label">Correo</label>
                <input class="form-control" type="email" id="empEmail" placeholder="correo@empresa.com">
              </div>
              <div class="form-group" style="display:flex; flex-direction:column; justify-content:flex-end;">
                <label class="form-label">Foto del empleado</label>
                <div class="rh-photo-placeholder" style="border:1px dashed var(--border); border-radius:6px; text-align:center; padding:8px; color:var(--text-muted); font-size:13px; cursor:pointer; background:var(--bg-app); transition:background 0.2s;"><i class="fa-solid fa-camera"></i> Subir foto</div>
              </div>
            </div>
          </div>

          <!-- SECCIÓN 2: Datos laborales -->
          <div class="rh-modal-section">
            <h3 class="rh-section-title"><i class="fa-solid fa-briefcase"></i> 2. Datos laborales</h3>
            <div class="rh-form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
              <div class="form-group">
                <label class="form-label">Código de empleado</label>
                <input class="form-control" type="text" id="empCode" placeholder="EMP-000">
              </div>
              <div class="form-group">
                <label class="form-label">Área</label>
                <select class="form-control" id="empArea">
                  <option>Administración</option>
                  <option>Mostrador</option>
                  <option>Caja</option>
                  <option>Ventas</option>
                  <option>Almacén</option>
                  <option>Cobranza</option>
                  <option>Reparto</option>
                  <option>Compras</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Puesto</label>
                <input class="form-control" type="text" id="empPosition" placeholder="Ej. Cajero Principal">
              </div>
              <div class="form-group">
                <label class="form-label">Tipo de empleado</label>
                <select class="form-control" id="empType">
                  <option>Planta</option>
                  <option>Temporal</option>
                  <option>Medio tiempo</option>
                  <option>Honorarios</option>
                  <option>Comisionista</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Fecha de ingreso</label>
                <input class="form-control" type="date" id="empDate">
              </div>
              <div class="form-group">
                <label class="form-label">Estatus</label>
                <select class="form-control" id="empStatus">
                  <option>Activo</option>
                  <option>Inactivo</option>
                  <option>Suspendido</option>
                  <option>Baja</option>
                </select>
              </div>
            </div>
          </div>

          <!-- SECCIÓN 3: Ubicación operativa -->
          <div class="rh-modal-section">
            <h3 class="rh-section-title"><i class="fa-solid fa-building"></i> 3. Ubicación operativa</h3>
            <div class="rh-form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
              <div class="form-group">
                <label class="form-label">Empresa</label>
                <select class="form-control" id="empEmpresa"><option>MATRIZ</option></select>
              </div>
              <div class="form-group">
                <label class="form-label">Sucursal</label>
                <select class="form-control" id="empSucursal"><option value="MATRIZ">MATRIZ</option></select>
              </div>
              <div class="form-group">
                <label class="form-label">Almacén asociado</label>
                <select class="form-control" id="empWarehouse"><option value="ALM-MATRIZ">BODEGA PRINCIPAL</option></select>
              </div>
              <div class="form-group">
                <label class="form-label">Caja asociada</label>
                <select class="form-control" id="empCashRegister"><option value="CAJA-1">CAJA 1</option></select>
              </div>
              <div class="form-group" style="grid-column: span 2;">
                <label class="form-label">Escala / tabulador</label>
                <input class="form-control" type="text" placeholder="Nivel salarial">
              </div>
            </div>
          </div>

          <!-- SECCIÓN 4: Acceso al sistema -->
          <div class="rh-modal-section" style="border: 1px solid var(--border); padding: 16px; border-radius: 8px; background:var(--bg-app);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
              <h3 class="rh-section-title" style="margin:0;"><i class="fa-solid fa-shield-halved"></i> 4. Acceso al sistema</h3>
              <label class="rh-toggle-switch" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="empAccessToggle" style="width:16px; height:16px; accent-color:var(--brand-500); cursor:pointer;">
                <span class="rh-toggle-label" style="font-size:14px; font-weight:600;">Permitir acceso</span>
              </label>
            </div>
            
            <div id="empAccessFields" style="display: none; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
              <div class="form-group">
                <label class="form-label">Usuario</label>
                <input class="form-control" type="text" id="empUserId" placeholder="Ej. jperez">
              </div>
              <div class="form-group">
                <label class="form-label">Perfil de acceso</label>
                <select class="form-control" id="empRole">
                  <option>Administrador</option>
                  <option>Supervisor</option>
                  <option>Operador ventas</option>
                  <option>Operador caja</option>
                  <option>Operador almacén</option>
                  <option>Operador reparto</option>
                  <option>Recursos Humanos</option>
                  <option>Contador</option>
                  <option>Solo lectura</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Contraseña temporal</label>
                <input class="form-control" type="password" id="empPassword" placeholder="••••••••">
              </div>
              <div class="form-group">
                <label class="form-label">Confirmar contraseña</label>
                <input class="form-control" type="password" id="empPasswordConfirm" placeholder="••••••••">
              </div>
              <div class="form-group" style="grid-column: span 2;">
                <label class="form-label">Permisos rápidos</label>
                <div class="rh-perms-badges" style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">
                  <span class="rh-perm-badge" style="background:var(--bg-card); border:1px solid var(--border); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">ADM</span>
                  <span class="rh-perm-badge" style="background:var(--bg-card); border:1px solid var(--border); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">CAJ</span>
                  <span class="rh-perm-badge" style="background:var(--bg-card); border:1px solid var(--border); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">VEN</span>
                  <span class="rh-perm-badge" style="background:var(--bg-card); border:1px solid var(--border); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">COB</span>
                  <span class="rh-perm-badge" style="background:var(--bg-card); border:1px solid var(--border); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">REP</span>
                  <span class="rh-perm-badge" style="background:var(--bg-card); border:1px solid var(--border); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">COM</span>
                  <span class="rh-perm-badge" style="background:var(--bg-card); border:1px solid var(--border); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">ALM</span>
                  <span class="rh-perm-badge" style="background:var(--bg-card); border:1px solid var(--border); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">CON</span>
                </div>
              </div>
            </div>
          </div>

          <!-- SECCIÓN 5: Reloj checador -->
          <div class="rh-modal-section" style="border: 1px solid var(--border); padding: 16px; border-radius: 8px; background:var(--bg-app);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
              <h3 class="rh-section-title" style="margin:0;"><i class="fa-solid fa-clock"></i> 5. Reloj checador</h3>
              <label class="rh-toggle-switch" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="empClockToggle" checked style="width:16px; height:16px; accent-color:var(--brand-500); cursor:pointer;">
                <span class="rh-toggle-label" style="font-size:14px; font-weight:600;">Permitir checar asistencia</span>
              </label>
            </div>
            <div id="empClockFields" style="display: grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
              <div class="form-group" style="grid-column: span 2;">
                <label class="form-label">Método</label>
                <select class="form-control">
                  <option>NIP (Activo)</option>
                  <option disabled>Código QR (Futuro)</option>
                  <option disabled>Huella Dactilar (Futuro)</option>
                  <option disabled>Reconocimiento Facial (Futuro)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">NIP (4 dígitos)</label>
                <input class="form-control" type="password" maxlength="4" id="empPin" placeholder="••••">
              </div>
              <div class="form-group">
                <label class="form-label">Confirmar NIP</label>
                <input class="form-control" type="password" maxlength="4" id="empPinConfirm" placeholder="••••">
              </div>
            </div>
          </div>

          <!-- SECCIÓN 6: Comisiones / propinas -->
          <div class="rh-modal-section">
            <h3 class="rh-section-title"><i class="fa-solid fa-coins"></i> 6. Comisiones / propinas</h3>
            <div class="rh-form-grid" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:16px;">
              <div class="form-group">
                <label class="form-label">Factor comisión (%)</label>
                <input class="form-control" type="number" step="0.01" value="0.00">
              </div>
              <div class="form-group">
                <label class="form-label">Saldo comisiones</label>
                <input class="form-control" type="number" step="0.01" value="0.00">
              </div>
              <div class="form-group">
                <label class="form-label">Propina acumulada</label>
                <input class="form-control" type="number" step="0.01" value="0.00">
              </div>
            </div>
          </div>

        </div>
        <div class="modal-footer" style="justify-content: flex-end; gap: 12px; padding: 16px 24px;">
          <button class="btn btn-secondary rh-close-emp-modal">Cancelar</button>
          <button class="btn btn-primary" id="btnSaveEmployee"><i class="fa-solid fa-save"></i> Guardar empleado</button>
        </div>
      </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  function toggleSystemAccessFields() {
    var toggle = document.getElementById('empAccessToggle');
    var fields = document.getElementById('empAccessFields');
    if (toggle && fields) {
      fields.style.display = toggle.checked ? 'grid' : 'none';
    }
  }

  function toggleClockInFields() {
    var toggle = document.getElementById('empClockToggle');
    var fields = document.getElementById('empClockFields');
    if (toggle && fields) {
      fields.style.display = toggle.checked ? 'grid' : 'none';
    }
  }

  function bindEmployeeModalEvents() {
    var toggleAccess = document.getElementById('empAccessToggle');
    if (toggleAccess && !toggleAccess.dataset.bound) {
      toggleAccess.addEventListener('change', toggleSystemAccessFields);
      toggleAccess.dataset.bound = 'true';
    }

    var toggleClock = document.getElementById('empClockToggle');
    if (toggleClock && !toggleClock.dataset.bound) {
      toggleClock.addEventListener('change', toggleClockInFields);
      toggleClock.dataset.bound = 'true';
    }

    var btnSave = document.getElementById('btnSaveEmployee');
    if (btnSave && !btnSave.dataset.bound) {
      btnSave.addEventListener('click', saveEmployee);
      btnSave.dataset.bound = 'true';
    }
  }

  async function saveEmployee() {
    var payload = {
      full_name: document.getElementById('empFullName') ? document.getElementById('empFullName').value : '',
      display_name: document.getElementById('empDisplayName') ? document.getElementById('empDisplayName').value : '',
      phone: document.getElementById('empPhone') ? document.getElementById('empPhone').value : '',
      email: document.getElementById('empEmail') ? document.getElementById('empEmail').value : '',
      employee_code: document.getElementById('empCode') ? document.getElementById('empCode').value : '',
      
      area: document.getElementById('empArea') ? document.getElementById('empArea').value : '',
      position: document.getElementById('empPosition') ? document.getElementById('empPosition').value : '',
      employment_type: document.getElementById('empType') ? document.getElementById('empType').value : '',
      hire_date: document.getElementById('empDate') ? document.getElementById('empDate').value : '',
      status: document.getElementById('empStatus') ? document.getElementById('empStatus').value : 'active',
      
      sucursal_id: document.getElementById('empSucursal') ? document.getElementById('empSucursal').value : '',
      assigned_warehouse_id: document.getElementById('empWarehouse') ? document.getElementById('empWarehouse').value : '',
      assigned_warehouse_name: document.getElementById('empWarehouse') ? document.getElementById('empWarehouse').options[document.getElementById('empWarehouse').selectedIndex]?.text : '',
      
      can_login: document.getElementById('empAccessToggle') ? document.getElementById('empAccessToggle').checked : false,
      usuario_id: document.getElementById('empUserId') ? document.getElementById('empUserId').value : '',
      temporary_password: document.getElementById('empPassword') ? document.getElementById('empPassword').value : '',
      temporary_password_confirm: document.getElementById('empPasswordConfirm') ? document.getElementById('empPasswordConfirm').value : '',
      role: document.getElementById('empRole') ? document.getElementById('empRole').value : '',
      
      can_clock_in: document.getElementById('empClockToggle') ? document.getElementById('empClockToggle').checked : false,
      pin: document.getElementById('empPin') ? document.getElementById('empPin').value : '',
      pin_confirm: document.getElementById('empPinConfirm') ? document.getElementById('empPinConfirm').value : ''
    };

    var btnSave = document.getElementById('btnSaveEmployee');
    var originalText = btnSave.innerHTML;
    btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
    btnSave.disabled = true;

    try {
      var token = localStorage.getItem('token');
      var response = await fetch('/api/rh/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(payload)
      });
      
      var data = await response.json();
      
      if (response.ok) {
        rhToast('Empleado guardado correctamente');
        closeEmployeeModal();
        if (typeof loadRhEmployees === 'function') loadRhEmployees();
      } else {
        var errStr = data.detail || 'Error desconocido';
        rhToast('Error: ' + errStr);
      }
    } catch(e) {
      rhToast('Error de red al guardar empleado');
    } finally {
      btnSave.innerHTML = originalText;
      btnSave.disabled = false;
    }

    var closeBtns = document.querySelectorAll('.rh-close-emp-modal');
    closeBtns.forEach(function(btn) {
      if (!btn.dataset.bound) {
        btn.addEventListener('click', closeEmployeeModal);
        btn.dataset.bound = 'true';
      }
    });
  }

  function openEmployeeModal() {
    renderEmployeeModal();
    bindEmployeeModalEvents();
    openModal('modal-employee');
  }

  function closeEmployeeModal() {
    closeModal('modal-employee');
  }

  /* ── CLIENTES: guardar nuevo cliente + sembrar PUBLICO EN GENERAL ── */

  /** Muestra toast de admin shell (fallback a console.warn) */
  function _adminToast(msg, type) {
    type = type || 'info';
    var colors = { success: '#22c55e', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;' +
      'background:#1e293b;color:#fff;padding:12px 20px;border-radius:10px;' +
      'font-size:.85rem;font-weight:600;border-left:4px solid ' + (colors[type]||'#3b82f6') + ';' +
      'box-shadow:0 8px 32px rgba(0,0,0,.35);max-width:320px;transition:opacity .3s;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() { t.style.opacity='0'; setTimeout(function(){ t.remove(); }, 350); }, 3500);
  }

  /** Obtiene token de sesión — calebsys_token es la clave canónica del login */
  function _getAuthToken() {
    return localStorage.getItem('calebsys_token') ||
           sessionStorage.getItem('auth_token')   ||
           localStorage.getItem('auth_token')     || '';
  }

  /** Helper POST a la API */
  async function _apiPost(path, payload) {
    var headers = { 'Content-Type': 'application/json' };
    var tok = _getAuthToken();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    var res = await fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(payload) });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
    return data;
  }

  /** Guarda un cliente nuevo desde el modal */
  async function saveNewClient() {
    var nombre  = (document.getElementById('nc-nombre') ? document.getElementById('nc-nombre').value : '').trim().toUpperCase();
    var rfc     = (document.getElementById('nc-rfc')    ? document.getElementById('nc-rfc').value    : '').trim().toUpperCase();
    var phone   = (document.getElementById('nc-phone')  ? document.getElementById('nc-phone').value  : '').trim();
    var escala  = document.getElementById('nc-escala')  ? document.getElementById('nc-escala').value  : 'PUBLICO';
    var regimen = document.getElementById('nc-regimen') ? document.getElementById('nc-regimen').value : '616';
    var limite  = parseFloat(document.getElementById('nc-limite') ? document.getElementById('nc-limite').value : '0') || 0;

    if (!nombre) { _adminToast('El nombre es requerido', 'error'); return; }

    var btn = document.getElementById('btn-guardar-cliente');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
      var payload = {
        name:           nombre,
        rfc:            rfc     || null,
        client_type:    escala === 'PUBLICO' ? 'P\u00FAblico General' : escala,
        phone:          phone   || null,
        regimen_fiscal: regimen || null,
        limite_credito: limite
      };
      var created = await _apiPost('/api/clients', payload);
      _adminToast('\u2713 Cliente guardado: ' + created.name, 'success');
      closeModal('modal-nuevo-cliente');
      /* Reset form */
      ['nc-nombre','nc-rfc','nc-phone'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
      });
      if (document.getElementById('nc-limite')) document.getElementById('nc-limite').value = '0';
      if (typeof loadClients === 'function') setTimeout(loadClients, 400);
    } catch (err) {
      _adminToast('Error al guardar cliente: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar Cliente'; }
    }
  }

  /** Siembra PUBLICO EN GENERAL si no existe (idempotente) */
  async function seedPublicoGeneral() {
    try {
      var list  = await AdminAPI.apiFetch('/api/clients?q=XAXX010101000');
      var items = Array.isArray(list) ? list : (list.items || list.clients || list.data || []);
      var existing = items.find(function(c) {
        return (c.rfc || '').toUpperCase() === 'XAXX010101000' ||
               (c.name|| '').toUpperCase() === 'PUBLICO EN GENERAL';
      });
      if (existing) {
        _adminToast('PUBLICO EN GENERAL ya existe (id: ' + existing.id + ')', 'info');
        return;
      }
      var created = await _apiPost('/api/clients', {
        name:           'PUBLICO EN GENERAL',
        rfc:            'XAXX010101000',
        client_type:    'P\u00FAblico General',
        regimen_fiscal: '616',
        limite_credito: 0
      });
      _adminToast('\u2713 PUBLICO EN GENERAL creado (id: ' + created.id + ')', 'success');
      if (typeof loadClients === 'function') setTimeout(loadClients, 400);
    } catch (err) {
      _adminToast('Error al sembrar PUBLICO EN GENERAL: ' + err.message, 'error');
    }
  }

  /* ─────────────────────────────────────────────────────────
     BUG-A FIX — Auto-fichar al primer login del turno
     Para usuarios no-admin que aterrizan en admin_shell.html.
     Sin modal: consulta estado-hoy y si sin_jornada → llama
     /api/asistencia/reloj/fichar con JWT → toast con resultado.
     Guard por sessionStorage para no duplicar en la misma sesión.
  ─────────────────────────────────────────────────────────── */
  var AUTOFICHAR_SESSION_KEY = "calebsys_autofichar_done";

  function checkRelojAutoFichar() {
    /* RH-04: el reloj ya NO ficha solo. La auto-apertura del modal
       #relojModal (embebido en admin_shell.html) + el botón ACEPTAR
       los gobierna scripts/reloj-embed.js. Esta función queda inerte. */
    return;
    /* --- código legado, ya no se ejecuta --- */
    if (sessionStorage.getItem(AUTOFICHAR_SESSION_KEY)) return;

    var token = localStorage.getItem("calebsys_token") ||
                sessionStorage.getItem("calebsys_token") || "";
    if (!token) return;

    /* Roles que no auto-fichan (admins manejan el reloj via F7 modal) */
    var SKIP_ROLES = ["SUPERADMIN", "ADMIN", "ADMINISTRADOR", "ADMINISTRADOR GENERAL", "GERENTE"];
    try {
      var parts   = token.split(".");
      var decoded = JSON.parse(atob(parts[1]));
      var role    = (decoded.role || "").toUpperCase();
      if (SKIP_ROLES.indexOf(role) !== -1) {
        sessionStorage.setItem(AUTOFICHAR_SESSION_KEY, "1");
        return;
      }
    } catch (_) {}

    var headers = {
      "Authorization": "Bearer " + token,
      "Content-Type":  "application/json"
    };

    /* 1. Consultar estado actual */
    fetch("/api/asistencia/reloj/estado-hoy", { credentials: "include", headers: headers })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        sessionStorage.setItem(AUTOFICHAR_SESSION_KEY, "1");
        /* Solo auto-fichar si aún no ha iniciado jornada */
        if (data && !data.fichado_hoy && data.state === "sin_jornada") {
          /* 2. Registrar checada con identidad JWT */
          fetch("/api/asistencia/reloj/fichar", {
            method: "POST", credentials: "include", headers: headers, body: "{}"
          })
            .then(function (r2) { return r2.json(); })
            .then(function (d2) {
              if (d2 && d2.ok) {
                var nombre = (d2.user && d2.user.display_name) || "Empleado";
                _adminToast("\u2713 Entrada registrada — " + nombre, "success");
              }
            })
            .catch(function () { /* silencioso */ });
        }
      })
      .catch(function () { /* silencioso — no bloquear al usuario */ });
  }

  /* ─── EXPOSE TO GLOBAL SCOPE (for legacy HTML actions) ─── */
  global.navigateTo  = navigateTo;
  global.openModal   = openModal;
  global.closeModal  = closeModal;
  global.handleLogout = handleLogout;
  global.openEmployeeModal = openEmployeeModal;
  global.closeEmployeeModal = closeEmployeeModal;
  global.resetEmployeeFormPage = resetEmployeeFormPage;
  global.saveEmployeeFromPage = saveEmployeeFromPage;
  global.selectRhEmployee = selectRhEmployee;
  global.applyRhAction = applyRhAction;
  // saveNewClient y seedPublicoGeneral NO se exponen globalmente:
  // sus listeners se registran en init() vía addEventListener.

  /* ── BOOT ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init(); // DOM already ready
  }

})(window);

// ── FAB quick-access toggle ───────────────────────────────────────────────────
window.toggleFabMenu = function () {
  var menu = document.getElementById('fab-menu');
  var icon = document.getElementById('fab-icon');
  var btn  = document.getElementById('fab-btn');
  if (!menu) return;
  var open = menu.style.display === 'flex';
  menu.style.display = open ? 'none' : 'flex';
  icon.className     = open ? 'fa-solid fa-bolt'  : 'fa-solid fa-xmark';
  btn.style.background = open ? 'var(--brand-500,#2563eb)' : '#dc2626';
};

document.addEventListener('click', function (e) {
  var fab = document.getElementById('fab-quick-access');
  if (fab && !fab.contains(e.target)) {
    var menu = document.getElementById('fab-menu');
    var icon = document.getElementById('fab-icon');
    var btn  = document.getElementById('fab-btn');
    if (menu) menu.style.display = 'none';
    if (icon) icon.className = 'fa-solid fa-bolt';
    if (btn)  btn.style.background = 'var(--brand-500,#2563eb)';
  }
});
