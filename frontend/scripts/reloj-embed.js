/* ============================================================
   RELOJ CHECADOR — EMBED (POS + Admin Shell)
   ------------------------------------------------------------
   El modal #relojModal + reloj-checador.js viven ahora también
   dentro de index.html (POS) y admin_shell.html. Este script:

     1. Expone window.CalebsysReloj.open() / .close().
     2. Cierra el modal con ESC o clic en el fondo.
     3. checkAndOpen(): consulta /api/asistencia/reloj/estado-hoy
        y, si el empleado aún no ha fichado hoy, abre el modal
        automáticamente (RH-04: no ficha solo, el usuario confirma
        con el botón ACEPTAR).

   Antes de esto, Vendedor/Cajero/Almacenista quedaban atrapados:
   el banner "Fichar ahora →" los mandaba a /os, y validateAdminAccess()
   los rebotaba de vuelta sin llegar nunca al reloj.
   ============================================================ */
(function () {
  "use strict";

  var SESSION_KEY = "calebsys_reloj_autoshow_done";

  /* Roles exentos del reloj (dueño del Tenant y dueño del software).
     Gerente de sede SÍ checa — RH-04, Don Antonio 02-09-2026.
     Gerente General exento por petición explícita 16-sep-2026. */
  var SKIP_ROLES = [
    "admin", "superadmin", "administrador", "administrador general",
    "dueño", "dueno", "owner",
    "gerente_general", "gerente general"
  ];

  function $modal() { return document.getElementById("relojModal"); }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") ||
           localStorage.getItem("calebsys_theme") ||
           (document.body && document.body.classList.contains("light-mode") ? "light" : "dark");
  }

  function readRole() {
    var r = (localStorage.getItem("calebsys_role") || "").trim();
    if (r) return r.toLowerCase();
    var tok = localStorage.getItem("calebsys_token") ||
              sessionStorage.getItem("calebsys_token") || "";
    if (tok) {
      try {
        var decoded = JSON.parse(atob(tok.split(".")[1]));
        return String(decoded.role || "").toLowerCase();
      } catch (_) {}
    }
    return "";
  }

  function isOpen() {
    var m = $modal();
    return !!(m && m.classList.contains("is-open"));
  }

  function open() {
    var m = $modal();
    if (!m || m.classList.contains("is-open")) return;
    m.setAttribute("data-theme", currentTheme());
    m.classList.add("is-open");
    m.removeAttribute("aria-hidden");
    document.body.classList.add("reloj-open");
    document.dispatchEvent(new CustomEvent("reloj:open"));
  }

  function close() {
    var m = $modal();
    if (!m || !m.classList.contains("is-open")) return;
    m.classList.remove("is-open");
    m.setAttribute("aria-hidden", "true");
    document.body.classList.remove("reloj-open");
    document.dispatchEvent(new CustomEvent("reloj:close"));
  }

  /* ── Auto-apertura si el empleado no ha fichado hoy ───────── */
  function checkAndOpen() {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    if (!$modal()) return;

    var role = readRole();
    if (SKIP_ROLES.indexOf(role) !== -1) {
      sessionStorage.setItem(SESSION_KEY, "1");
      return;
    }

    var token = localStorage.getItem("calebsys_token") ||
                sessionStorage.getItem("calebsys_token") || "";
    var headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;

    fetch("/api/asistencia/reloj/estado-hoy", {
      credentials: "include",
      headers: headers
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        sessionStorage.setItem(SESSION_KEY, "1");
        // No abrir si ya fichó en dispositivo externo de control de acceso
        if (data && data.fichado_hoy === false && !data.already_external) {
          setTimeout(open, 500);
        }
      })
      .catch(function () { /* silencioso — no bloquear al usuario */ });
  }

  /* ── ESC + clic en el fondo cierran el modal ──────────────── */
  function bindDismiss() {
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) { e.preventDefault(); close(); }
    });
    var m = $modal();
    if (m && !m._rcEmbedBound) {
      m._rcEmbedBound = true;
      m.addEventListener("click", function (e) {
        if (e.target === m) close();
      });
    }
  }

  window.CalebsysReloj = { open: open, close: close, checkAndOpen: checkAndOpen };

  function boot() {
    bindDismiss();
    checkAndOpen();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
