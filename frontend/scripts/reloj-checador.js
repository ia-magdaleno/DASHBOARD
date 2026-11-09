/* ============================================================
   RELOJ CHECADOR — SESIÓN 5
   Sin NIP · Identidad JWT · Auto-fichar · Toast · Auto-close
   No toca POS · No toca login · No crea tablas
   ============================================================ */

/* ── Tema: aplicar desde localStorage en carga standalone ─── */
(function applyInitialTheme() {
  var theme = localStorage.getItem("calebsys_theme") || "dark";
  document.documentElement.setAttribute("data-theme", theme);
})();

/* ── PostMessage: sincronización de tema desde OS ─────────── */
window.addEventListener("message", function (event) {
  if (event.data && event.data.type === "CALEBSYS_THEME") {
    var theme = event.data.theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("calebsys_theme", theme);
  }
});

(function () {
  "use strict";

  /* ── Estado local ────────────────────────────────────────── */
  var state = {
    loading:         false,
    currentState:    null,        // estado de jornada (nil = desconocido)
    fired:           false,       // evita doble-fichar en la misma apertura
    nextAction:      "entrada",   // RH-04: acción alternada que devuelve el backend
    nextActionLabel: "Hora de Ingreso",
    alreadyExternal: false        // RH-04: ya fichó en dispositivo de control de acceso
  };

  /* ── Helpers de DOM ───────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }

  /* ── Reloj digital en tiempo real ────────────────────────── */
  function updateClock() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, "0");
    var m = String(now.getMinutes()).padStart(2, "0");
    var s = String(now.getSeconds()).padStart(2, "0");
    var timeEl = $("rcTime");
    if (timeEl) {
      timeEl.innerHTML =
        h + "<span class='rc-time-sep'>:</span>" +
        m + "<span class='rc-time-sep'>:</span>" + s;
    }
    var dateEl = $("rcDate");
    if (dateEl) {
      var opts = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
      dateEl.textContent = now.toLocaleDateString("es-MX", opts);
    }
  }


  /* ── Estado de conexión ───────────────────────────────────── */
  function updateConnection() {
    var dot = document.querySelector(".rc-status-dot");
    if (!dot) return;
    var online = navigator.onLine;
    dot.classList.toggle("offline", !online);
    dot.title = online ? "Conectado" : "Sin conexión";
  }

  /* ── Hidratar empresa / sucursal desde sesión OS ─────────── */
  function hydrateContext() {
    var rawCo = localStorage.getItem("calebsys_company") || "";
    var rawBr = localStorage.getItem("calebsys_branch")  || "";
    var empresaEl  = $("rcEmpresa");
    var sucursalEl = $("rcSucursal");
    if (empresaEl)  empresaEl.textContent  = rawCo || "Calebsys";
    if (sucursalEl) sucursalEl.textContent = rawBr || "Sucursal";
  }

  /* ── Hidratar nombre/rol del usuario desde JWT ───────────── */
  function hydrateUserInfo() {
    var token = localStorage.getItem("calebsys_token") ||
                sessionStorage.getItem("calebsys_token") || "";
    if (!token) return;
    try {
      var parts   = token.split(".");
      var decoded = JSON.parse(atob(parts[1]));
      var nombre  = decoded.nombre_completo || decoded.name || decoded.sub || "";
      var role    = decoded.role || "";
      var nameEl = $("rcUserName");
      var roleEl = $("rcUserRole");
      if (nameEl && nombre) nameEl.textContent = nombre;
      if (roleEl && role)   roleEl.textContent = role;
    } catch (_) {}
  }

  /* ── Obtener JWT token para headers ───────────────────────── */
  function getToken() {
    return localStorage.getItem("calebsys_token") ||
           sessionStorage.getItem("calebsys_token") || "";
  }

  /* ── Resolver label de acción según estado de jornada ─────── */
  function _resolveAutoAction() {
    if (state.currentState === "jornada_activa") return "salida";
    return "entrada";
  }

  function getActionLabel(action) {
    var labels = { entrada: "Entrada registrada", salida: "Salida registrada" };
    return labels[action] || "Registro aplicado";
  }

  function getActionTitle(action) {
    var labels = { entrada: "¡Entrada registrada!", salida: "¡Salida registrada!" };
    return labels[action] || "¡Registro aplicado!";
  }

  function getPendingLabel(action) {
    var labels = { entrada: "Registrando entrada…", salida: "Registrando salida…" };
    return labels[action] || "Registrando…";
  }

  function getToastType(action) {
    return action === "salida" ? "danger" : "success";
  }


  /* ── Mostrar/ocultar overlay de carga ─────────────────────── */
  function showLoading(action) {
    var loadEl = $("rcLoading");
    var labEl  = $("rcPendingLabel");
    if (labEl)  labEl.textContent = getPendingLabel(action || _resolveAutoAction());
    if (loadEl) loadEl.hidden = false;
    hideResult();
  }

  function hideLoading() {
    var loadEl = $("rcLoading");
    if (loadEl) loadEl.hidden = true;
  }

  /* ── Resultado de error (inline) ─────────────────────────── */
  function showResult(type, title, sub) {
    var el = $("rcResult");
    if (!el) return;
    el.className = "rc-result visible rc-result-" + type;
    el.innerHTML =
      "<div class='rc-result-title'>" + title + "</div>" +
      "<div class='rc-result-sub'>"   + sub   + "</div>";
  }

  function hideResult() {
    var el = $("rcResult");
    if (el) el.classList.remove("visible");
  }

  /* ── Toast superior ───────────────────────────────────────── */
  function showToast(message, type) {
    var toast = $("rc-toast");
    if (!toast) return;
    toast.className = "rc-toast " + (type || "success");
    toast.innerHTML =
      "<i class='fa-solid fa-circle-check'></i><span>" + escapeHtml(message) + "</span>";
    requestAnimationFrame(function () { toast.classList.add("show"); });
    clearTimeout(window.__rcToastTimer);
    window.__rcToastTimer = setTimeout(function () {
      toast.classList.remove("show");
    }, 2300);
  }

  /* ── Aplicar estado de jornada en UI ─────────────────────── */
  function applyState(stateName) {
    if (!stateName) return;
    state.currentState = stateName;
    var msgCerrada = $("rcMsgJornadaCerrada");
    if (msgCerrada) msgCerrada.hidden = (stateName !== "jornada_cerrada");
    /* Actualizar label de acción pendiente */
    var labEl = $("rcPendingLabel");
    if (labEl && stateName !== "jornada_cerrada") {
      labEl.textContent = getPendingLabel(_resolveAutoAction());
    }
  }

  /* ── Vista de éxito ─────────────────────────────────────────  */
  function getInitials(name) {
    var value = String(name || "Usuario").trim();
    var parts = value.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function formatSuccessDate(date) {
    return new Intl.DateTimeFormat("es-MX", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric"
    }).format(date);
  }

  function formatSuccessTime(date) {
    return new Intl.DateTimeFormat("es-MX", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    }).format(date);
  }


  function showSuccessView(payload, action) {
    var keypad  = $("rc-keypad-view");
    var success = $("rc-success-view");
    if (!success) return;

    var user = payload && payload.user ? payload.user : {};
    var now  = (payload && payload.timestamp)
      ? new Date(payload.timestamp) : new Date();

    var displayName =
      user.display_name || user.nombre_completo || user.username || "Trabajador";
    var userCode =
      user.employee_code || user.usuario_id || user.username || "EMP-0001";
    var photoUrl = user.photo_url || "";

    var titleEl  = $("rc-success-title");
    var nameEl   = $("rc-success-name");
    var codeEl   = $("rc-success-code");
    var dateEl   = $("rc-success-date");
    var timeEl   = $("rc-success-time");
    var badgeEl  = $("rc-success-badge");
    var imgEl    = $("rc-success-photo");
    var avatarEl = $("rc-success-avatar");

    if (titleEl) titleEl.textContent = getActionTitle(action);
    if (nameEl)  nameEl.textContent  = displayName.toUpperCase();
    if (codeEl)  codeEl.textContent  = userCode;
    if (dateEl)  dateEl.textContent  = formatSuccessDate(now);
    if (timeEl)  timeEl.textContent  = formatSuccessTime(now);

    if (badgeEl) {
      var saved = payload && payload.saved === true;
      badgeEl.innerHTML = saved
        ? "<i class='fa-solid fa-circle-check'></i><span>Tu checada fue registrada correctamente</span>"
        : "<i class='fa-solid fa-circle-info'></i><span>Identificaci\u00f3n correcta \u00b7 Checada a\u00fan no guardada</span>";
    }

    var iconEl = $("rcSuccessIcon");
    if (iconEl) {
      var iconColors = { entrada: "#22c55e", salida: "#ef4444" };
      var col = iconColors[action] || "#22c55e";
      iconEl.style.background  = "linear-gradient(135deg, " + col + ", " + col + ")";
      iconEl.style.boxShadow   = "0 18px 48px " + col + "44";
    }

    if (imgEl && avatarEl) {
      imgEl.hidden    = true;
      imgEl.removeAttribute("src");
      avatarEl.hidden = false;
      avatarEl.textContent = getInitials(displayName);
      if (photoUrl) {
        imgEl.onload  = function () { imgEl.hidden = false; avatarEl.hidden = true; };
        imgEl.onerror = function () { imgEl.hidden = true;  avatarEl.hidden = false; imgEl.removeAttribute("src"); };
        imgEl.src = photoUrl;
      }
    }

    if (keypad)  keypad.hidden  = true;
    success.hidden = false;
  }

  /* ── Resetear UI al estado inicial ───────────────────────── */
  function resetRelojUI() {
    var keypad  = $("rc-keypad-view");
    var success = $("rc-success-view");
    if (success) success.hidden = true;
    if (keypad)  keypad.hidden  = false;
    hideLoading();
    hideResult();
    var msgCerrada = $("rcMsgJornadaCerrada");
    if (msgCerrada) msgCerrada.hidden = true;
    /* RH-04: ocultar leyenda/botón/mensajes hasta el próximo estado-hoy */
    var labelEl = $("rcAccionLabel");
    if (labelEl) labelEl.hidden = true;
    var btnEl = $("rcBtnAceptar");
    if (btnEl) { btnEl.hidden = true; btnEl.disabled = false; }
    var msgAutoriz = $("rcMsgAutorizacion");
    if (msgAutoriz) msgAutoriz.hidden = true;
    var msgExt = $("rcMsgControlAcceso");
    if (msgExt) msgExt.hidden = true;
    state.currentState   = null;
    state.fired          = false;
    state.loading        = false;
    state.alreadyExternal = false;
  }

  /* ── Cerrar modal después de éxito ───────────────────────── */
  function closeRelojAfterSuccess() {
    setTimeout(function () {
      var modal = document.getElementById("relojModal");
      if (modal && modal.classList.contains("is-open")) {
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("reloj-open");
        document.dispatchEvent(new CustomEvent("reloj:close"));
        setTimeout(resetRelojUI, 260);
        return;
      }
      document.dispatchEvent(new CustomEvent("reloj:autoclose"));
      resetRelojUI();
      if (window.location.pathname.indexOf("/asistencia") !== -1) {
        setTimeout(function () { window.location.href = "/os"; }, 100);
      }
    }, 2600);
  }


  /* ── RH-04 — Vista de confirmación (leyenda + botón ACEPTAR) ── */
  /*
   * Don Antonio (02-09-2026): el reloj NO ficha solo. Muestra la acción
   * detectada por el backend ("Hora de Ingreso" / "Hora de Salida") y un
   * único botón ACEPTAR. El usuario confirma con un clic.
   */
  function renderConfirmView() {
    hideLoading();
    hideResult();
    var msgAutoriz = $("rcMsgAutorizacion");
    if (msgAutoriz) msgAutoriz.hidden = true;

    var labelEl = $("rcAccionLabel");
    var btnEl   = $("rcBtnAceptar");
    var msgExt  = $("rcMsgControlAcceso");

    /* Ya fichó en un dispositivo externo de control de acceso */
    if (state.alreadyExternal) {
      if (labelEl) labelEl.hidden = true;
      if (btnEl)   btnEl.hidden   = true;
      if (msgExt)  msgExt.hidden  = false;
      return;
    }
    if (msgExt) msgExt.hidden = true;

    if (labelEl) {
      labelEl.textContent = state.nextActionLabel || "Registrar checada";
      labelEl.hidden = false;
    }
    if (btnEl) {
      btnEl.hidden   = false;
      btnEl.disabled = false;
    }
  }

  /* ── RH-04 — Vista "salida requiere autorización del admin" ── */
  function showAutorizacionView(mensaje) {
    hideLoading();
    hideResult();
    var labelEl = $("rcAccionLabel");
    var btnEl   = $("rcBtnAceptar");
    if (labelEl) labelEl.hidden = true;
    if (btnEl)   btnEl.hidden   = true;
    var box = $("rcMsgAutorizacion");
    if (box) {
      var span = box.querySelector("span");
      if (span && mensaje) span.textContent = mensaje;
      box.hidden = false;
    }
  }

  /* ── CORE — Confirmar checada (POST tras clic en ACEPTAR) ──── */
  /*
   * Guard: state.fired / state.loading evitan doble-POST por doble clic.
   */
  function confirmarChecada() {
    if (state.loading) return;
    if (state.fired)   return;

    var action = state.nextAction || "entrada";
    state.loading = true;
    var btnEl = $("rcBtnAceptar");
    if (btnEl) { btnEl.disabled = true; btnEl.hidden = true; }
    showLoading(action);

    var token = getToken();
    var headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    fetch("/api/asistencia/reloj/fichar", {
      method:      "POST",
      credentials: "include",
      headers:     headers,
      body:        JSON.stringify({})
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        state.loading = false;
        hideLoading();

        if (data && data.ok) {
          state.fired = true;
          if (data.state) applyState(data.state);
          if (data.next_action) {
            state.nextAction = data.next_action;
            state.nextActionLabel = data.next_action_label || state.nextActionLabel;
          }
          showToast(getActionLabel(data.action || action), getToastType(data.action || action));
          showSuccessView(data, data.action || action);
          closeRelojAfterSuccess();
          return;
        }

        /* RH-04: salida temprana (< 4h) → autorización del admin */
        if (data && data.error === "requiere_autorizacion") {
          showAutorizacionView(data.message ||
            "Tu salida requiere autorización del administrador.");
          showToast("Salida pendiente de autorización", "danger");
          return;
        }

        /* RH-04: ya registró ingreso en dispositivo externo */
        if (data && data.error === "ya_ficho_control_acceso") {
          state.alreadyExternal = true;
          renderConfirmView();
          showToast(data.message || "Ya fichaste en el control de acceso", "info");
          return;
        }

        /* Otros errores del servidor */
        var MSGS = {
          no_autenticado:        ["🔒 Sesión inválida",  "Inicia sesión nuevamente."],
          token_invalido:        ["🔒 Sesión expirada",  "Tu sesión expiró. Inicia sesión de nuevo."],
          usuario_no_encontrado: ["⚠️ Usuario no encontrado", "Contacta al Administrador."],
          error_servidor:        ["⚠️ Error del servidor", "Inténtalo de nuevo en un momento."]
        };
        var msg = MSGS[data && data.error] || ["❌ Error inesperado", data && data.error || ""];
        showResult("error", msg[0], msg[1]);
        showToast(msg[0].replace(/[❌⚠️🔒]/g, "").trim(), "error");
        /* permitir reintento */
        state.fired = false;
        if (btnEl) { btnEl.hidden = false; btnEl.disabled = false; }
        if (data && data.state) applyState(data.state);
      })
      .catch(function () {
        state.loading = false;
        hideLoading();
        showResult("error", "⚠️ Sin conexión", "No se pudo contactar al servidor. Verifica la red.");
        showToast("Sin conexión con el servidor", "error");
        state.fired = false;
        if (btnEl) { btnEl.hidden = false; btnEl.disabled = false; }
      });
  }

  /* ── Consultar estado-hoy al abrir el reloj (RH-04) ───────── */
  function initRelojState(callback) {
    var token = getToken();
    var headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;

    fetch("/api/asistencia/reloj/estado-hoy", {
      credentials: "include",
      headers: headers
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.state) applyState(data.state);
        if (data && data.next_action) {
          state.nextAction      = data.next_action;
          state.nextActionLabel = data.next_action_label || state.nextActionLabel;
        }
        state.alreadyExternal = !!(data && data.already_external);
        if (typeof callback === "function") callback();
      })
      .catch(function () {
        /* silencioso — asume entrada como default */
        if (typeof callback === "function") callback();
      });
  }


  /* ── Escape HTML ─────────────────────────────────────────── */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ── Eventos del modal desde os-admin ────────────────────── */
  function bindRelojEvents() {
    /* Al cerrar el modal → resetear UI y permitir re-fichar */
    document.addEventListener("reloj:close", function () {
      resetRelojUI();
    });

    /* Al abrir el modal → consultar estado y mostrar la vista de
       confirmación (RH-04: el usuario confirma con el botón ACEPTAR). */
    document.addEventListener("reloj:open", function () {
      state.fired = false; /* nueva apertura = permitir fichar de nuevo */
      initRelojState(function () {
        renderConfirmView();
      });
    });

    /* Botón ACEPTAR → confirmar la checada */
    var btnAceptar = $("rcBtnAceptar");
    if (btnAceptar && !btnAceptar._rcBound) {
      btnAceptar._rcBound = true;
      btnAceptar.addEventListener("click", function () { confirmarChecada(); });
    }
  }

  /* ── Init ────────────────────────────────────────────────── */
  function boot() {
    updateClock();
    updateConnection();
    hydrateContext();
    hydrateUserInfo();
    bindRelojEvents();

    setInterval(updateClock, 1000);
    window.addEventListener("online",  updateConnection);
    window.addEventListener("offline", updateConnection);

    /* Standalone (/asistencia/reloj en mobile) → mostrar vista de
       confirmación al cargar (RH-04: no ficha solo). */
    var isStandalone = window.location.pathname.indexOf("/asistencia") !== -1;
    if (isStandalone) {
      initRelojState(function () { renderConfirmView(); });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})();
