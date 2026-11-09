/* =============================================================
   loaders/compras.js — Calebsys Admin Shell
   Loader para el módulo Compras:
     · proveedores
     · compras-ordenes
     · compras-recepciones
     · compras-cxp
   Las páginas son auto-contenidas (HTML + script inline),
   este loader solo pre-registra callbacks de init opcionales
   que el shell puede invocar al montar cada página.
   ============================================================= */
(function () {
  'use strict';

  /* El shell expone window.pageInitHandlers = {} para que los
     loaders registren callbacks post-mount por pageId.
     Si el objeto no existe aún, lo creamos defensivamente.     */
  if (!window.pageInitHandlers) {
    window.pageInitHandlers = {};
  }

  /* ── PROVEEDORES ──────────────────────────────────────────── */
  window.pageInitHandlers['proveedores'] = function () {
    if (typeof window.provCargar === 'function') {
      window.provCargar();
    }
  };

  /* ── ÓRDENES DE COMPRA ───────────────────────────────────── */
  window.pageInitHandlers['compras-ordenes'] = function () {
    if (typeof window.ocCargar === 'function') {
      window.ocCargar();
    }
  };

  /* ── RECEPCIÓN DE MERCANCÍA ──────────────────────────────── */
  window.pageInitHandlers['compras-recepciones'] = function () {
    if (typeof window.recCargar === 'function') {
      window.recCargar();
    }
  };

  /* ── CUENTAS POR PAGAR ───────────────────────────────────── */
  window.pageInitHandlers['compras-cxp'] = function () {
    if (typeof window.cxpCargar === 'function') {
      window.cxpCargar();
    }
  };

})();
