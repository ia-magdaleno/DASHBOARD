(function () {
  "use strict";

  const ADMIN_ROLES = new Set([
    "Administrador",
    "Administrador General",
    "Dueño",
    "Dueno",
    "Owner",
    "Admin",
    "admin",
    "Gerente"
  ]);

  /* Roles operativos: ven la MISMA pantalla /os pero con un solo módulo
     habilitado (los demás quedan atenuados). id del módulo = id del plugin. */
  const MODULE_BY_ROLE = {
    "vendedor": "pos", "cajero": "pos", "mostrador": "pos", "supervisor": "pos",
    "operador ventas": "pos", "operador caja": "pos", "solo lectura": "pos",
    "almacenista": "almacen", "almacen": "almacen", "almacén": "almacen",
    "operador almacen": "almacen", "operador almacén": "almacen",
    "comprador": "compras", "compras": "compras",
    "cartera": "clientes", "cobranza": "clientes", "crm": "clientes"
  };

  function _osModuleForRole() {
    const r = ((state.user && state.user.role) ||
               localStorage.getItem("calebsys_role") || "").toLowerCase().trim();
    return MODULE_BY_ROLE[r] || null;
  }

  /* El dueño del Tenant (admin) y el dueño del software (superadmin) NO checan
     reloj — se les oculta la opción de Asistencia Laboral / Reloj Checador.
     Gerente SÍ checa (RH-04, Don Antonio 02-09-2026). */
  var RELOJ_EXEMPT_ROLES = ["admin", "administrador", "administrador general",
                            "superadmin", "dueño", "dueno", "owner"];

  function isRelojExemptRole() {
    var r = ((state.user && state.user.role) ||
             localStorage.getItem("calebsys_role") || "").toLowerCase().trim();
    return RELOJ_EXEMPT_ROLES.indexOf(r) !== -1;
  }

  const ICONS = {
    // Administrador — users/people (Lucide style)
    admin: `
      <svg class="plugin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    `,
    // Punto de Venta — shopping cart (Lucide)
    pos: `
      <svg class="plugin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="9" cy="21" r="1"/>
        <circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
      </svg>
    `,
    // Almacén — warehouse/building (Lucide)
    warehouse: `
      <svg class="plugin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/>
        <path d="M6 18h12"/>
        <path d="M6 14h12"/>
        <rect x="9" y="14" width="6" height="8" rx="1"/>
      </svg>
    `,
    // GPS Envíos — map pin (Lucide)
    gps: `
      <svg class="plugin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    `,
    // Redes Sociales — message square (Lucide)
    social: `
      <svg class="plugin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    `,
    // El Contador — bar chart (Lucide)
    contador: `
      <svg class="plugin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="18" x2="18" y1="20" y2="10"/>
        <line x1="12" x2="12" y1="20" y2="4"/>
        <line x1="6"  x2="6"  y1="20" y2="14"/>
        <line x1="2"  x2="22" y1="20" y2="20"/>
      </svg>
    `,
    // Asistencia IA — sparkles (Lucide)
    ai: `
      <svg class="plugin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
        <path d="M20 3v4"/>
        <path d="M22 5h-4"/>
        <path d="M4 17v2"/>
        <path d="M5 18H3"/>
      </svg>
    `,
    // Compras — shopping bag with arrow (Lucide)
    compras: `
      <svg class="plugin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
        <line x1="3" x2="21" y1="6" y2="6"/>
        <path d="M16 10a4 4 0 0 1-8 0"/>
      </svg>
    `,
    // Clientes CRM — users check (Lucide)
    crm: `
      <svg class="plugin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <polyline points="16 11 18 13 22 9"/>
      </svg>
    `,
    // Configuración — settings (Lucide)
    config: `
      <svg class="plugin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    `
  };

  /* ═══════════════════════════════════════════════════════════
     SHORTCUT_MAP — tabla oficial de atajos F1–F9
     modal:true  → abre overlay en lugar de navegar
     available:false → muestra toast «Módulo aún no disponible»

     Política de atajos: cada F-key / CTRL+* / ALT+* es de un solo uso.
     F7 queda reservada para COBRAR en el POS — el Reloj Checador NO tiene
     F-key (se abre desde su botón en el launcher / admin-shell).
  ═══════════════════════════════════════════════════════════ */
  var SHORTCUT_MAP = {
    F1: { id: "administrador",  title: "Administrador",     route: "/admin",              available: true  },
    F2: { id: "pos",            title: "Punto de Venta",    route: "/",                   available: true  },
    F3: { id: "almacen",        title: "Almacén",           route: "/admin#inventario",    available: true  },
    F4: { id: "gps",            title: "GPS Envíos",        route: "/gps-envios",          available: false },
    F5: { id: "redes",          title: "Redes Sociales",    route: "/redes-sociales",      available: false },
    F6: { id: "contador",       title: "El Contador",       route: "/contador",            available: false },
    F8: { id: "asistente_ia",   title: "Asistente IA",      route: "/assistant",           available: false },
    F9: { id: "configuracion",  title: "Configuración",     route: "/admin#configuracion", available: true  }
  };

  /* Mapa inverso id → key para usar en renderPlugins() */
  var ID_TO_KEY = {};
  Object.keys(SHORTCUT_MAP).forEach(function (key) {
    ID_TO_KEY[SHORTCUT_MAP[key].id] = key;
  });

  const pluginsAdministrador = [
    { id: "administrador",  title: "Administrador",    icon: ICONS.admin,    color: "blue",   route: "/admin" },
    { id: "pos",            title: "Punto de Venta",   icon: ICONS.pos,      color: "blue",   route: "/" },
    { id: "almacen",        title: "Almacén",          icon: ICONS.warehouse, color: "teal",  route: "/admin#inventario" },
    { id: "compras",        title: "Compras",          icon: ICONS.compras,  color: "orange", route: "/admin#compras-ordenes" },
    { id: "clientes",       title: "Clientes / CRM",   icon: ICONS.crm,      color: "green",  route: "/admin#clientes" },
    { id: "gps",            title: "GPS Envíos",       icon: ICONS.gps,      color: "purple", route: "/gps-envios" },
    { id: "redes",          title: "Redes Sociales",   icon: ICONS.social,   color: "rose",   route: "/redes-sociales" },
    { id: "contador",       title: "El Contador",      icon: ICONS.contador, color: "green",  route: "/contador" },
    { id: "asistente_ia",   title: "Asistente IA",     icon: ICONS.ai,       color: "blue",   route: "/assistant" },
    { id: "configuracion",  title: "Configuración",    icon: ICONS.config,   color: "slate",  route: "/admin#configuracion" }
  ];

  const state = {
    user: {
      name: "Administrador",
      role: "Administrador General",
      company: "Maderas y Materiales",
      branch: "Magdaleno"
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function safeText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  /*
    Branding futuro:
    Desde Configuración el administrador podrá guardar:
    - calebsys_business_logo_url
    - calebsys_company_display_name
    - calebsys_branch
    - calebsys_user_display_name

    Luego estos datos deben venir de un endpoint oficial:
    GET /api/tenant/settings

    Por ahora se leen desde localStorage como puente visual.
  */
  function getStoredSession() {
    return {
      role:
        localStorage.getItem("calebsys_role") ||
        localStorage.getItem("role") ||
        "Administrador",

      name:
        localStorage.getItem("calebsys_user_display_name") ||
        (localStorage.getItem("calebsys_user") === "admin"
          ? "Antonio Magdaleno"
          : localStorage.getItem("calebsys_user")) ||
        "Antonio Magdaleno",

      username:
        localStorage.getItem("calebsys_user") ||
        "admin",

      company:
        localStorage.getItem("calebsys_company_display_name") ||
        "Maderas y Materiales Magdaleno",

      companyCode:
        localStorage.getItem("calebsys_company") ||
        "MAG-001",

      branch:
        localStorage.getItem("calebsys_branch") ||
        "Magdaleno",

      logoUrl:
        localStorage.getItem("calebsys_business_logo_url") ||
        ""
    };
  }

  function validateAdminAccess() {
    const session = getStoredSession();
    state.user = session;

    if (!ADMIN_ROLES.has(session.role)) {
      // Rol operativo con módulo asignado → entra a /os con la vista filtrada.
      if (_osModuleForRole()) {
        state.restrictedModule = _osModuleForRole();
        return true;
      }

      const fallbackRoutes = {
        // ── Dueño del software ──
        superadmin:          "/admin_shell.html",
        // ── Reparto ──
        Repartidor:          "/gps",
        Chofer:              "/gps",
        "Operador reparto":  "/gps",        // creado desde RH
        // ── Administrativos / contables ──
        "Recursos Humanos":  "/admin_shell.html", // creado desde RH
        Contador:            "/admin_shell.html", // creado desde RH
        // ── Otros ──
        Community:           "/connect"
      };

      window.location.href = fallbackRoutes[session.role] || "/login";
      return false;
    }

    return true;
  }

  function hydrateUserInfo() {
    safeText("companyName",       state.user.companyCode  || "MAG-001");
    safeText("companyBranch",     state.user.branch       || "Magdaleno");
    safeText("userName",          state.user.username     || "admin");
    safeText("userRole",          state.user.role         || "Administrador");
    safeText("homeAuthorized",    state.user.role         || "Administrador");
    safeText("welcomeUserName",   state.user.name         || "Antonio Magdaleno");
    safeText("welcomeCompanyName",state.user.company      || "Maderas y Materiales Magdaleno");

    hydrateBusinessLogo(state.user.logoUrl);
  }

  function hydrateBusinessLogo(logoUrl) {
    const logo     = document.getElementById("businessLogo");
    const fallback = document.getElementById("businessLogoFallback");

    if (!logo || !fallback) return;

    /* Resetear siempre antes de evaluar */
    logo.removeAttribute("src");
    logo.style.display     = "none";
    fallback.style.display = "grid";

    if (!logoUrl || String(logoUrl).trim() === "") {
      return; /* sin logo → mostrar fallback */
    }

    logo.onload = function () {
      logo.style.display     = "block";
      fallback.style.display = "none";
    };

    logo.onerror = function () {
      logo.removeAttribute("src");
      logo.style.display     = "none";
      fallback.style.display = "grid";
    };

    logo.src = logoUrl;
  }

  function updateClock() {
    const now = new Date();

    const dateText = new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(now);

    const timeText = new Intl.DateTimeFormat("es-MX", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(now);

    safeText("currentDate", dateText);
    safeText("currentTime", timeText);
  }

  function updateConnectionStatus() {
    safeText("connectionStatus", navigator.onLine ? "En línea" : "Sin conexión");
  }

  function renderPlugins() {
    const grid = $("pluginGrid");
    if (!grid) return;

    grid.innerHTML = "";

    const restricted = state.restrictedModule || null;

    pluginsAdministrador.forEach(function (plugin) {
      var shortcutKey = ID_TO_KEY[plugin.id] || "";
      const locked = restricted && plugin.id !== restricted;

      const card = document.createElement("button");
      card.type = "button";
      card.className = "plugin-card" + (locked ? " plugin-card--locked" : "");
      card.dataset.color = plugin.color;
      card.dataset.pluginId = plugin.id;
      if (locked) {
        card.style.opacity = "0.38";
        card.style.filter = "grayscale(1)";
        card.style.cursor = "not-allowed";
      }
      card.setAttribute("aria-label",
        (locked ? "Sin acceso a " : "Abrir ") + plugin.title +
        (shortcutKey && !locked ? " (" + shortcutKey + ")" : ""));

      /* Badge de tecla de acceso rápido */
      var badgeHtml = shortcutKey
        ? '<span class="plugin-key" aria-hidden="true">' + escapeHTML(shortcutKey) + '</span>'
        : "";

      card.innerHTML =
        badgeHtml +
        '<div class="plugin-circle">' +
          plugin.icon +
        '</div>' +
        '<div class="plugin-accent"></div>' +
        '<div class="plugin-title">' +
          escapeHTML(plugin.title) +
        '</div>';

      card.addEventListener("click", function () {
        if (locked) {
          showUnavailableToast(null, "Sin acceso a " + plugin.title + " con tu rol");
          return;
        }
        if (shortcutKey) {
          openShortcut(shortcutKey);
        } else {
          openPlugin(plugin.route);
        }
      });

      grid.appendChild(card);
    });

    safeText("pluginsCount", "Plugins cargados: " + pluginsAdministrador.length + "/" + pluginsAdministrador.length);
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  /* ── openPlugin: navegar a ruta ──────────────────────────── */
  function openPlugin(route) {
    if (!route) return;
    // Si va al POS ("/"), marcar origen OS para que el POS muestre el botón de regreso
    if (route === '/') {
      sessionStorage.setItem('calebsys_from_os', '1');
    } else {
      sessionStorage.removeItem('calebsys_from_os');
    }
    window.location.href = route;
  }

  /* ── showUnavailableToast: módulo no disponible ───────────── */
  /* title: nombre del módulo. fullMessage: si se pasa, se usa tal cual. */
  function showUnavailableToast(title, fullMessage) {
    var existing = document.getElementById("osShortcutToast");
    if (existing) existing.remove();

    var toast = document.createElement("div");
    toast.id = "osShortcutToast";
    toast.className = "os-shortcut-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = fullMessage || ((title || "Módulo") + " — aún no disponible");
    document.body.appendChild(toast);

    /* Animar entrada */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        toast.classList.add("os-shortcut-toast--visible");
      });
    });

    /* Auto-desaparecer en 2.4 s */
    setTimeout(function () {
      toast.classList.remove("os-shortcut-toast--visible");
      setTimeout(function () { toast.remove(); }, 300);
    }, 2400);
  }

  /* ── openShortcut: función unificada para teclado + click ─── */
  function openShortcut(key) {
    var entry = SHORTCUT_MAP[key];
    if (!entry) return;

    if (entry.modal) {
      /* F7 → abre Reloj Checador como modal.
         El admin/dueño y el superadmin no checan: se les ignora el atajo. */
      if (isRelojExemptRole()) {
        showUnavailableToast(null, "El reloj checador no aplica a tu rol");
        return;
      }
      openRelojModal();
      return;
    }

    /* Rol operativo: sólo su módulo responde a los atajos */
    if (state.restrictedModule && entry.id !== state.restrictedModule) {
      showUnavailableToast(null, "Sin acceso a " + entry.title + " con tu rol");
      return;
    }

    if (!entry.available) {
      showUnavailableToast(entry.title);
      return;
    }

    openPlugin(entry.route);
  }


  function bindActions() {
    const logoutButton = $("logoutButton");
    if (logoutButton) {
      logoutButton.addEventListener("click", logout);
    }

    /* Todos los botones con data-route navegan a su ruta */
    document.querySelectorAll("[data-route]").forEach(function (button) {
      button.addEventListener("click", function () {
        openPlugin(button.getAttribute("data-route"));
      });
    });

    /* Botón Asistencia Laboral — abre modal, NO navega.
       El admin/dueño y el superadmin no checan reloj: se les quita el botón. */
    var relojExempt = isRelojExemptRole();
    document.querySelectorAll("[data-action='open-reloj']").forEach(function (btn) {
      if (relojExempt) { btn.remove(); return; }
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        openRelojModal();
      });
    });

    window.addEventListener("online", updateConnectionStatus);
    window.addEventListener("offline", updateConnectionStatus);
  }

  /* ── Tema activo ────────────────────────────────────────── */
  function getCurrentTheme() {
    return (
      document.documentElement.getAttribute("data-theme") ||
      localStorage.getItem("calebsys_theme") ||
      "dark"
    );
  }

  /* ── Reloj Checador Modal ─────────────────────────────────
     F7             → abre modal overlay del Reloj Checador
     click (sidebar)→ llama la misma openRelojModal()
     ESC            → cierra modal si está abierto; si no, cierra sesión
     El modal vive en #relojModal (os.html), mismo DOM → hereda data-theme
  ────────────────────────────────────────── */
  function openRelojModal() {
    var modal = document.getElementById("relojModal");
    if (!modal) return;

    /* Sincronizar tema explícitamente — garantiza que F7 y click sean idénticos */
    var theme = getCurrentTheme();
    modal.setAttribute("data-theme", theme);

    modal.classList.add("is-open");
    modal.removeAttribute("aria-hidden");
    document.body.classList.add("reloj-open");

    document.dispatchEvent(new CustomEvent("reloj:open"));
  }

  function closeRelojModal() {
    var modal = document.getElementById("relojModal");
    if (!modal) return;

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("reloj-open");

    document.dispatchEvent(new CustomEvent("reloj:close"));
  }

  /* Exponer globalmente para que reloj-checador.js pueda llamarlo */
  window.closeRelojModal = closeRelojModal;

  /* Escuchar auto-close emitido por reloj-checador.js tras éxito */
  document.addEventListener("reloj:autoclose", function () {
    closeRelojModal();
  });

  function isRelojModalOpen() {
    var modal = document.getElementById("relojModal");
    return modal ? modal.classList.contains("is-open") : false;
  }

  function bindShortcuts() {
    document.addEventListener("keydown", function (event) {
      /* Ignorar si el foco está en un campo de texto */
      var tag = document.activeElement ? document.activeElement.tagName : "";
      var isEditable = (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") ||
        (document.activeElement &&
          document.activeElement.getAttribute("contenteditable") === "true");

      /* ESC siempre activo aunque haya foco en input */
      if (event.key === "Escape") {
        if (isRelojModalOpen()) {
          event.preventDefault();
          closeRelojModal();
        } else {
          logout();
        }
        return;
      }

      /* F1–F9: ignorar si el usuario está escribiendo */
      if (isEditable) return;

      if (SHORTCUT_MAP[event.key]) {
        event.preventDefault();
        openShortcut(event.key);
        return;
      }
    });

    /* Clic en fondo del overlay cierra el modal */
    var overlay = document.getElementById("relojModal");
    if (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) closeRelojModal();
      });
    }
  }

  function initTheme() {
    const savedTheme = localStorage.getItem("calebsys_theme") || "light";
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);

    const toggle = $("themeToggle");
    if (toggle) {
      toggle.textContent = theme === "dark" ? "🌙" : "☀️";
    }
  }

  function bindThemeToggle() {
    const toggle = $("themeToggle");
    if (!toggle) return;

    toggle.addEventListener("click", function () {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "dark" ? "light" : "dark";

      localStorage.setItem("calebsys_theme", next);
      applyTheme(next);
    });
  }

  function logout() {
    localStorage.removeItem("calebsys_role");
    localStorage.removeItem("calebsys_user");
    localStorage.removeItem("calebsys_company");
    localStorage.removeItem("calebsys_branch");

    window.location.href = "/login";
  }

  /* ── S4: Auto-show Reloj Checador al primer login del turno ──────
   *
   * Consulta /api/asistencia/reloj/estado-hoy.
   * Si el empleado aún no ha fichado entrada hoy, abre el modal
   * automáticamente 900 ms después de que el OS termine de pintar.
   *
   * Roles que nunca ven el auto-show:
   *   SUPERADMIN, ADMIN, GERENTE
   * ─────────────────────────────────────────────────────────────── */
  // RH-04: gerente de sede SÍ checa. Gerente General exento 16-sep-2026.
  var AUTOSHOW_SKIP_ROLES = ["SUPERADMIN", "ADMIN", "ADMINISTRADOR",
                             "GERENTE_GENERAL", "GERENTE GENERAL"];

  function checkRelojAutoShow() {
    var SESSION_KEY = "calebsys_reloj_autoshow_done";
    if (sessionStorage.getItem(SESSION_KEY)) return;

    /* Rol exento: primero de calebsys_role (lo que guarda login.js — el JWT va
       en cookie httpOnly, no en localStorage), luego del token si estuviera.
       Bug corregido 06-sep: sin token en localStorage el guard se saltaba y el
       modal se auto-abría también para ADMIN/SUPERADMIN. */
    var stored = localStorage.getItem("calebsys_token") ||
                 sessionStorage.getItem("calebsys_token") || "";
    var role = (localStorage.getItem("calebsys_role") || "").trim().toUpperCase();
    if (!role && stored) {
      try { role = (JSON.parse(atob(stored.split(".")[1])).role || "").toUpperCase(); } catch (_) {}
    }
    if (role && AUTOSHOW_SKIP_ROLES.indexOf(role) !== -1) {
      sessionStorage.setItem(SESSION_KEY, "1");
      return;
    }

    var headers = {};
    if (stored) headers["Authorization"] = "Bearer " + stored;

    fetch("/api/asistencia/reloj/estado-hoy", {
      credentials: "include",
      headers: headers
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        sessionStorage.setItem(SESSION_KEY, "1");
        // No abrir si ya fichó en dispositivo externo de control de acceso
        if (!data.fichado_hoy && !data.already_external) {
          setTimeout(function () { openRelojModal(); }, 900);
        }
      })
      .catch(function () { /* fallo silencioso — no bloquear */ });
  }

  function boot() {

    if (!validateAdminAccess()) return;

    initTheme();
    hydrateUserInfo();
    renderPlugins();
    updateClock();
    updateConnectionStatus();
    bindActions();
    bindShortcuts();
    bindThemeToggle();

    setInterval(updateClock, 1000);

    /* S4: Auto-show checador si el empleado aún no ha fichado hoy */
    checkRelojAutoShow();

    /* E-01: Si el empleado llegó desde POS (calebsys_return_to_pos),
     * redirigir de vuelta al POS tras el fichado exitoso.
     * reloj-checador.js dispara "reloj:close" al completar la acción. */
    if (sessionStorage.getItem('calebsys_return_to_pos')) {
      document.addEventListener('reloj:close', function _onRelojClose() {
        document.removeEventListener('reloj:close', _onRelojClose);
        sessionStorage.removeItem('calebsys_return_to_pos');
        setTimeout(function () {
          window.location.href = '/';
        }, 1200);   // pequeño delay para que el toast de éxito sea visible
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
